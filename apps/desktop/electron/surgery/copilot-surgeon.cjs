// ============================================================
// copilot-surgeon.cjs — Copilot SDK cerrahi bakım adaptörü
// ============================================================
// SurgicalAgentProvider sözleşmesini Copilot SDK üzerinden gerçekler.
// Spike ile kanıtlanan API'ye göre yazılmıştır (@github/copilot-sdk 1.0.8).
//
// TASARIM: SDK bağlantısı ENJEKTE EDİLEBİLİR (clientFactory). Böylece:
//   - Üretimde @github/copilot-sdk lazy require edilir (ağır bağımlılık).
//   - Testte sahte istemci verilir; güvenlik mantığı gerçek SDK olmadan
//     uçtan uca sınanır.
// Bu, adaptörün "ölü sandbox dosyası" olmasını önler: mantık tam test edilir,
// SDK bağımlılığı kararı ayrı ve açık kalır.

const { buildPermissionHandler } = require('./permission-hook.cjs');

/**
 * `session.sendAndWait()` cevabından asistan metnini çıkarır.
 *
 * DİKKAT — buradaki şekil tahmin edilemez, paketten okundu:
 * `sendAndWait` düz bir metin değil bir OLAY döndürür
 * (`AssistantMessageEvent | undefined`) ve metin `data.content` altındadır.
 * Kod uzun süre `result.text` okuyordu; öyle bir alan hiç yok, bu yüzden cevap
 * HER ZAMAN boş geliyordu ve arayüzde "(cevap metni gelmedi)" görünüyordu.
 * Hata sessizdi: null bir cevap, çökme değil eksik metin olarak görünür.
 *
 * `text` / düz string yolları savunma amaçlı korunur (SDK sürümü değişirse
 * sessizce boşa düşmek yerine çalışmaya devam etsin).
 */
function extractReplyText(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  const content = result?.data?.content ?? result?.content ?? result?.text;
  return typeof content === 'string' && content.trim() ? content : null;
}

/** Token benzeri desenleri maskeler. Loglanan/rapora giren HER şey buradan geçer. */
function redact(text) {
  return String(text ?? '')
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GH_PAT]')
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]');
}

// ── Electron altında CLI başlatma sorunu ve çözümü ─────────────────────
//
// SDK, CLI'ı şöyle başlatır:
//     const isJsFile = cliPath.endsWith('.js');
//     isJsFile ? spawn(process.execPath, [cliPath, ...args]) : spawn(cliPath, args)
//
// Electron main process'inde `process.execPath` Node DEĞİL, Electron
// binary'sidir. Varsayılan yol (.js) bu yüzden çalışmaz:
//   - düzeltmesiz            → "CLI server exited unexpectedly with code 0"
//     (Electron dosyayı yeni uygulama açma isteği sanıp hemen çıkar)
//   - ELECTRON_RUN_AS_NODE=1 → "error: too many arguments. Expected 0 got 1"
//     (Electron-as-node argv'ye fazladan giriş ekliyor, CLI ayrıştırıcısı takılıyor)
//
// ÇÖZÜM: platform paketindeki NATIVE binary'yi göster. Uzantı .js olmadığı
// için SDK onu doğrudan çalıştırır; Node hiç devreye girmez.
// Gerçek Electron 31.3.1 içinde doğrulandı: protocolVersion 3, auth OK.

const NATIVE_BIN_NAME = process.platform === 'win32' ? 'copilot.exe' : 'copilot';

/**
 * `@github/copilot-<platform>-<arch>` paketindeki native CLI binary'sini bulur.
 * @returns {string|null} tam yol, bulunamazsa null
 */
function resolveNativeCliPath(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  // SDK ile aynı isimlendirme: linux'ta musl varyantı da denenir.
  const variants = platform === 'linux' ? ['linux', 'linuxmusl'] : [platform];
  const resolver = options.resolve || require.resolve;

  for (const variant of variants) {
    try {
      // DİKKAT: derin import kullanılamaz. Platform paketinin exports haritası
      //   { ".": "./copilot.exe", "./sdk": { "import": ... } }
      // şeklindedir; `/package.json` ve `/sdk` CJS'ten ERR_PACKAGE_PATH_NOT_EXPORTED
      // verir. Kök giriş noktası ise doğrudan native binary'yi döndürür.
      const resolved = resolver(`@github/copilot-${variant}-${arch}`);
      if (resolved && require('fs').existsSync(resolved)) return resolved;
    } catch {
      // bu varyant kurulu değil, sıradakine bak
    }
  }
  return null;
}

/**
 * CopilotClient seçeneklerini kurar.
 * Düz Node altında (testler, scriptler) varsayılan yol zaten çalışır ve
 * doğrulanmıştır — dokunulmaz. Yalnız Electron'da native binary'ye yönlendirilir.
 */
function buildClientOptions(options = {}) {
  const versions = options.versions || process.versions;
  const baseEnv = options.baseEnv || process.env;
  if (!versions || !versions.electron) return {};

  const nativeCliPath = options.nativeCliPath !== undefined
    ? options.nativeCliPath
    : resolveNativeCliPath();

  if (!nativeCliPath) {
    throw new Error(
      'Copilot CLI native binary bulunamadı. Electron altında paketlenmiş .js '
      + 'giriş noktası çalışmıyor; @github/copilot platform paketi kurulu olmalı.',
    );
  }
  // Kendi sürecimizin env'i değil, yalnız çocuk sürecin env'i.
  return { env: { ...baseEnv, COPILOT_CLI_PATH: nativeCliPath } };
}

/** Üretim varsayılanı: SDK'yı yalnız gerçekten çalışırken yükle. */
function defaultClientFactory() {
  // eslint-disable-next-line global-require
  const { CopilotClient } = require('@github/copilot-sdk');
  return new CopilotClient(buildClientOptions());
}

class CopilotSurgeon {
  /**
   * @param {object} [opts]
   * @param {()=>object} [opts.clientFactory] CopilotClient benzeri örnek üretir
   * @param {(evt:object)=>void} [opts.onEvent] Aktivite izleyici köprüsü
   */
  constructor(opts = {}) {
    this._clientFactory = typeof opts.clientFactory === 'function' ? opts.clientFactory : defaultClientFactory;
    this._onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
    this._client = null;
    this._session = null;
    this._decisions = [];
    this._interactive = false;
    this._unsubscribe = null;
  }

  _emit(type, detail) {
    this._onEvent({ type, detail: redact(typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')), ts: Date.now() });
  }

  /** Bağlanır ve kimlik durumunu döner. Token okunmaz; yalnız var/yok. */
  async connect() {
    this._client = this._clientFactory();
    await this._client.start();
    this._emit('surgeon_connected', 'Copilot çalışma zamanı başlatıldı');

    let authed = false;
    try {
      const auth = await this._client.getAuthStatus();
      authed = Boolean(auth?.isAuthenticated ?? auth?.authenticated ?? auth?.status === 'authenticated');
    } catch (err) {
      this._emit('surgeon_auth_error', err?.message || 'auth hatası');
    }
    this._emit('surgeon_auth', authed ? 'oturum açık' : 'oturum kapalı — copilot login gerekli');
    return { authenticated: authed };
  }

  /**
   * Cerrahi görevi izole worktree'de yürütür.
   * @param {object} params
   * @param {object} params.changeRequest handoff.buildChangeRequest çıktısı
   * @param {string} params.worktreePath izole çalışma alanı (mutlak)
   * @param {string} params.prompt cerraha verilecek görev metni
   * @param {number} [params.timeoutMs]
   * @returns {Promise<{status:string, decisions:object[], reply:string|null, eventCounts:object}>}
   */
  async runSurgery(params = {}) {
    if (!this._client) throw new Error('Önce connect() çağrılmalı.');
    const { changeRequest, worktreePath, prompt } = params;
    if (!worktreePath) throw new Error('worktreePath zorunlu.');
    if (!prompt) throw new Error('prompt zorunlu.');

    this._decisions = [];
    const eventCounts = {};

    const handler = buildPermissionHandler({
      worktreeRoot: worktreePath,
      onDecision: (d) => {
        this._decisions.push(d);
        // Hedef de yayılır: "reject" görüp neyin reddedildiğini bilememek
        // canlı testte teşhisi imkânsız kılmıştı.
        const target = d.target ? ` — ${String(d.target).slice(0, 120)}` : '';
        this._emit('surgeon_permission', `${d.decision}:${d.reason}${target}`);
      },
    });

    // Model AÇIKÇA seçilir. Varsayılan "auto" idi; kod kalitesi cerrahi
    // işin tamamını belirlediği için model kararı şansa bırakılmamalı.
    const sessionConfig = {
      workingDirectory: worktreePath,
      onPermissionRequest: handler,
    };
    if (params.model) sessionConfig.model = params.model;

    this._session = await this._client.createSession(sessionConfig);
    this._emit('surgeon_session', `oturum açıldı (${changeRequest?.changeRequestId || 'CR-?'}) · model: ${params.model || 'auto'}`);

    const unsubscribe = this._session.on((event) => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });

    let reply = null;
    let status = 'COMPLETED';
    try {
      const result = await this._session.sendAndWait(prompt, params.timeoutMs || 300000);
      const text = extractReplyText(result);
      reply = text ? redact(text) : null;
    } catch (err) {
      status = 'FAILED';
      this._emit('surgeon_error', err?.message || 'görev hatası');
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
    }

    // Herhangi bir red varsa görev "kısıtlarla" tamamlandı olarak işaretlenir.
    const rejected = this._decisions.filter((d) => d.decision === 'reject').length;
    if (status === 'COMPLETED' && rejected > 0) status = 'COMPLETED_WITH_DENIALS';

    return { status, decisions: this._decisions.slice(), reply, eventCounts, rejectedCount: rejected };
  }

  // ── Etkileşimli (çok turlu) cerrahi oturum ────────────────────────────
  //
  // runSurgery tek atımlıdır: prompt gider, 5 dakika sonra sonuç gelir ve
  // kullanıcı arada olan biteni yalnız seyreder. Sohbet kutusu için oturumun
  // AÇIK kalması gerekir: kullanıcı yazar, cerrah cevaplar, cerrah izin ister,
  // kullanıcı onaylar/reddeder, konuşma devam eder.
  //
  // Aynı SDK oturumu turlar arasında korunduğu için bağlam da korunur —
  // her tur için yeni oturum açmak cerrahın hafızasını sıfırlardı.

  /**
   * Açık kalan bir oturum başlatır.
   * @param {object} params
   * @param {string} params.worktreePath izole çalışma alanı (mutlak)
   * @param {string} [params.model]
   * @param {(ask:object)=>Promise<{approved:boolean,feedback?:string}>} [params.askUser]
   *        Verilirse izin kapısı etkileşimli olur (onay katmanı kullanıcıya sorulur).
   * @param {number} [params.askTimeoutMs]
   */
  async startInteractive(params = {}) {
    if (!this._client) throw new Error('Önce connect() çağrılmalı.');
    const { worktreePath } = params;
    if (!worktreePath) throw new Error('worktreePath zorunlu.');
    if (this._session) throw new Error('Zaten açık bir oturum var.');

    this._decisions = [];

    const handler = buildPermissionHandler({
      worktreeRoot: worktreePath,
      askUser: params.askUser,
      askTimeoutMs: params.askTimeoutMs,
      onDecision: (d) => {
        this._decisions.push(d);
        const target = d.target ? ` — ${String(d.target).slice(0, 120)}` : '';
        this._emit('surgeon_permission', `${d.decision}:${d.reason}${target}`);
      },
    });

    const sessionConfig = {
      workingDirectory: worktreePath,
      onPermissionRequest: handler,
    };
    if (params.model) sessionConfig.model = params.model;

    this._session = await this._client.createSession(sessionConfig);
    this._interactive = true;
    this._emit('surgeon_session', `etkileşimli oturum açıldı · model: ${params.model || 'auto'}`);

    // Ham SDK olaylarını canlı akışa köprüle. Şekilleri sürüm sürüm değişebildiği
    // için YALNIZ type taşınır; yüksek frekanslı akış parçaları elenir, aksi
    // halde arayüz saniyede onlarca satırla dolar.
    this._unsubscribe = this._session.on((event) => {
      const type = String(event?.type || '');
      if (!type || /delta|chunk|token/i.test(type)) return;
      this._emit('surgeon_event', type);
    });

    return { ok: true };
  }

  /**
   * Açık oturuma bir tur mesaj gönderir ve cevabı bekler.
   * Bu çağrı sırasında izin istekleri askUser üzerinden kullanıcıya düşer;
   * bu yüzden zaman aşımı runSurgery'den cömerttir (insan onayı bekliyor).
   * @returns {Promise<{reply:string|null, decisions:object[], rejectedCount:number}>}
   */
  async sendMessage(text, timeoutMs) {
    if (!this._session) throw new Error('Açık etkileşimli oturum yok.');
    const message = String(text || '').trim();
    if (!message) throw new Error('Boş mesaj gönderilemez.');

    const before = this._decisions.length;
    const result = await this._session.sendAndWait(message, timeoutMs || 30 * 60 * 1000);
    const turnDecisions = this._decisions.slice(before);
    const replyText = extractReplyText(result);

    return {
      reply: replyText ? redact(replyText) : null,
      decisions: turnDecisions,
      rejectedCount: turnDecisions.filter((d) => d.decision === 'reject').length,
    };
  }

  /** Oturum boyunca biriken tüm izin kararları (denetim için). */
  get decisions() {
    return this._decisions.slice();
  }

  /** Kullanılabilir modelleri listeler (UI seçimi için). */
  async listModels() {
    if (!this._client) throw new Error('Önce connect() çağrılmalı.');
    const models = await this._client.listModels();
    return (models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
  }

  async abort() {
    if (this._session) {
      try { await this._session.abort(); this._emit('surgeon_abort', 'oturum iptal edildi'); }
      catch (err) { this._emit('surgeon_error', err?.message || 'abort hatası'); }
    }
  }

  async disconnect() {
    if (typeof this._unsubscribe === 'function') {
      try { this._unsubscribe(); } catch { /* yoksay */ }
      this._unsubscribe = null;
    }
    this._interactive = false;
    if (this._session) {
      try { await this._session.disconnect(); } catch { /* yoksay */ }
      this._session = null;
    }
    if (this._client) {
      try { await this._client.stop(); }
      catch { try { await this._client.forceStop(); } catch { /* yoksay */ } }
      this._client = null;
    }
    this._emit('surgeon_disconnected', 'çalışma zamanı kapatıldı');
  }
}

module.exports = {
  CopilotSurgeon,
  extractReplyText,
  redact,
  defaultClientFactory,
  buildClientOptions,
  resolveNativeCliPath,
  NATIVE_BIN_NAME,
};
