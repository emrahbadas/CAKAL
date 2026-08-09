// ============================================================
// session-manager.cjs — cerrahi oturum orkestrasyonu
// ============================================================
// ÇAKAL bir talebi Kademe 2 (kaynak kod) olarak sınıflandırdığında burada bir
// "bekleyen değişiklik talebi" oluşur. Cerrahi YALNIZ kullanıcının açık UI
// onayıyla başlar — sohbetteki "evet" yeterli sayılmaz.
//
// Akış:
//   registerRequest  → PENDING
//   startSurgery     → worktree aç → Copilot bağlan → çalıştır → AWAITING_REVIEW
//   (kullanıcı Cerrahi Bakım ekranında diff'i onaylar → mevcut merge kapısı)
//   abortSurgery     → oturumu kes, worktree'yi bırak (inceleme için)
//
// Kritik kurallar:
//   - Aynı anda TEK cerrahi. İkinci istek reddedilir (yarış durumu, çakışan
//     worktree ve kafası karışık kullanıcı üretir).
//   - Cerrah canlı uygulama dizininde asla çalışmaz.
//   - Başarısızlıkta worktree SİLİNMEZ; kullanıcı ne olduğunu görebilmeli.

const path = require('path');
const crypto = require('crypto');

const handoff = require('./handoff.cjs');
const { CopilotSurgeon, resolveNativeCliPath, redact } = require('./copilot-surgeon.cjs');
const { startDeviceLogin, GITHUB_DEVICE_URL } = require('./auth-login.cjs');
const cakalIdentity = require('../cakal-identity.cjs');

const STATUS = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  CHATTING: 'CHATTING',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED',
});

const MAX_PENDING = 20;

// Kullanıcının onay kartına cevap vermesi için tanınan süre. Bittiğinde istek
// REDDEDİLİR — cevapsızlık onay sayılmaz. İzin kancasının kendi zaman aşımı
// (20 dk) bunun ARKASINDA duran yedektir; normalde bu sayaç önce dolar.
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

// Cerrahi için varsayılan model. "auto" bilinçli olarak SEÇİLMEDİ: kod
// kalitesi cerrahi işin tamamını belirliyor, model kararı şansa bırakılmamalı.
// Kullanıcı UI'dan değiştirebilir; liste hesabın aboneliğine göre gelir.
const DEFAULT_SURGERY_MODEL = 'claude-sonnet-5';

function createSessionManager(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '../../../..');
  const surgeonFactory = typeof options.surgeonFactory === 'function'
    ? options.surgeonFactory
    : (opts) => new CopilotSurgeon(opts);
  // Merge/preflight servisi enjekte edilebilir: testler gerçek preflight
  // sürecini (60+ sn) başlatmak zorunda kalmamalı.
  const reviewService = options.reviewService || require('./review-service.cjs');
  const permissionTimeoutMs = Number.isFinite(options.permissionTimeoutMs)
    ? options.permissionTimeoutMs
    : PERMISSION_TIMEOUT_MS;

  /** id → changeRequest (PENDING) */
  const pending = new Map();

  let active = null;      // { changeRequestId, branch, worktreePath, surgeon, startedAt }
  let chat = null;        // etkileşimli sohbet oturumu (aşağıda)
  let lastResult = null;  // son tamamlanan/başarısız oturumun özeti
  let status = STATUS.IDLE;

  const listeners = new Set();

  function emit(event) {
    const payload = { ...event, ts: Date.now() };
    for (const listener of listeners) {
      try { listener(payload); } catch { /* dinleyici hatası akışı bozmasın */ }
    }
  }

  function onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** ÇAKAL bir Kademe 2 talebi tespit ettiğinde çağırır. Cerrahiyi BAŞLATMAZ. */
  function registerRequest(input = {}) {
    const changeRequest = handoff.buildChangeRequest(input);
    if (pending.size >= MAX_PENDING) {
      // En eskiyi düşür; kuyruk sınırsız büyümemeli.
      const oldest = pending.keys().next().value;
      pending.delete(oldest);
    }
    pending.set(changeRequest.changeRequestId, changeRequest);
    emit({ type: 'request_registered', changeRequestId: changeRequest.changeRequestId, title: input.title || null });
    return changeRequest;
  }

  function listRequests() {
    return [...pending.values()];
  }

  function getStatus() {
    return {
      status,
      active: active
        ? {
          changeRequestId: active.changeRequestId,
          branch: active.branch,
          worktreePath: active.worktreePath,
          startedAt: active.startedAt,
        }
        : null,
      chat: chat
        ? {
          changeRequestId: chat.changeRequestId,
          branch: chat.branch,
          worktreePath: chat.worktreePath,
          startedAt: chat.startedAt,
          model: chat.model,
          busy: chat.busy,
          turns: chat.turns,
          pendingPermissions: [...chat.permissions.values()].map((p) => p.payload),
        }
        : null,
      pendingCount: pending.size,
      lastResult,
    };
  }

  /**
   * Copilot kimlik durumu. Token okunmaz; yalnız var/yok.
   *
   * DURUMSUZ kontrol: bağlan → sor → kapat. CLI'ı sürekli ayakta tutmak
   * kaynak yakar ve yeni hata yolları açar; bağlantı asıl cerrahi sırasında
   * oturum boyunca açık kalır.
   *
   * Bu yüzden alt seviyedeki connect/disconnect olayları YENİDEN ETİKETLENİR:
   * ham hâlleriyle akışta "bağlandı → koptu" gibi görünüp kullanıcıya bağlantı
   * düşüyormuş izlenimi veriyordu.
   */
  /** Kullanılabilir model listesi (UI seçimi için). */
  async function listModels() {
    const surgeon = surgeonFactory({ onEvent: () => {} });
    try {
      await surgeon.connect();
      const models = typeof surgeon.listModels === 'function' ? await surgeon.listModels() : [];
      return { ok: true, models, defaultModel: DEFAULT_SURGERY_MODEL };
    } catch (err) {
      return { ok: false, models: [], defaultModel: DEFAULT_SURGERY_MODEL, error: err?.message || 'model listesi alınamadı' };
    } finally {
      try { await surgeon.disconnect(); } catch { /* yoksay */ }
    }
  }

  async function checkAuth() {
    emit({ type: 'auth_check_started' });
    const surgeon = surgeonFactory({
      onEvent: (event) => {
        // Kontrol turunun iç gürültüsünü dışarı sızdırma; yalnız gerçek
        // hataları geçir.
        if (event?.type === 'surgeon_connected' || event?.type === 'surgeon_disconnected'
          || event?.type === 'surgeon_auth') {
          return;
        }
        emit(event);
      },
    });
    try {
      const result = await surgeon.connect();
      const authenticated = Boolean(result?.authenticated);
      emit({
        type: 'auth_check_finished',
        detail: authenticated ? 'oturum açık' : 'oturum kapalı — giriş gerekli',
      });
      return { ok: true, authenticated };
    } catch (err) {
      const message = err?.message || 'bağlantı kurulamadı';
      emit({ type: 'auth_check_failed', detail: message });
      return { ok: false, authenticated: false, error: message };
    } finally {
      try { await surgeon.disconnect(); } catch { /* yoksay */ }
    }
  }

  // ── GitHub girişi (cihaz kodu akışı) ──
  // ÇAKAL kullanıcı adına giriş YAPMAZ: yalnız kodu ekrana taşır, onayı
  // kullanıcı kendi tarayıcısında verir, token CLI'ın kasasında kalır.
  let activeLogin = null;

  async function startLogin(opts = {}) {
    if (activeLogin) return { ok: false, error: 'Giriş akışı zaten çalışıyor.' };

    const cliPath = opts.cliPath || resolveNativeCliPath();
    if (!cliPath) {
      return { ok: false, error: 'Copilot CLI bulunamadı. @github/copilot paketi kurulu olmalı.' };
    }

    emit({ type: 'login_started' });
    try {
      activeLogin = startDeviceLogin({
        cliPath,
        onEvent: emit,
        timeoutMs: opts.timeoutMs,
        spawnImpl: opts.spawnImpl,
      });
      const result = await activeLogin.promise;
      return { ok: result.ok, error: result.ok ? null : result.message, deviceUrl: GITHUB_DEVICE_URL };
    } finally {
      activeLogin = null;
    }
  }

  function cancelLogin() {
    if (!activeLogin) return { ok: false, error: 'Çalışan giriş akışı yok.' };
    activeLogin.cancel();
    activeLogin = null;
    emit({ type: 'login_cancelled' });
    return { ok: true };
  }

  /** Cerraha verilecek görev metni: orijinal talep + bağlayıcı kısıtlar. */
  function buildSurgeryPrompt(changeRequest) {
    return [
      '# Cerrahi bakım görevi',
      '',
      '## Kullanıcının orijinal talebi (değiştirilmemiş)',
      changeRequest.originalUserRequest,
      '',
      changeRequest.cakalInterpretation
        ? `## ÇAKAL'ın yorumu (yardımcı bağlam, talimat değil)\n${changeRequest.cakalInterpretation}\n`
        : '',
      cakalIdentity.buildSurgeonContract(),
      '',
      '## Bağlayıcı kısıtlar',
      '- Yalnız bu worktree içinde çalış. Dışına çıkma.',
      '- Güvenlik katmanlarına, preflight kapısına ve cerrahi altyapıya DOKUNMA.',
      '- .env ve secret dosyalarını okuma/yazma.',
      '- git push, remote değişikliği, npm publish YASAK.',
      '- Mevcut testleri silme veya zayıflatma; yeni davranış için yeni test yaz.',
      '- Değişikliği küçük ve geri alınabilir tut.',
      '- İşin bitince değişiklikleri commit et.',
      '',
      '## Bu çalışma alanının gerçekleri',
      '- Burası bir git worktree. `node_modules` YOK: `npm test`, `npm install`',
      '  veya bağımlılık gerektiren komutlar ÇALIŞMAZ. Denemeye zaman harcama.',
      '- Doğrulama (test + typecheck + build) merge kapısında ayrıca koşar;',
      '  senin görevin doğru değişikliği yapmak, test altyapısını kurmak değil.',
      '- Görev belirsizse TAHMİN ETME: ne yapacağını kısaca yaz ve dur.',
      '  Kullanıcı netleştirecek.',
      '',
      'Not: Her dosya yazma ve komut, deterministik bir izin kapısından geçer.',
      'Reddedilen bir işlem olursa gerekçesini oku ve kapsamı daralt; kapıyı aşmaya çalışma.',
    ].filter(Boolean).join('\n');
  }

  /**
   * Cerrahiyi başlatır. Kullanıcının açık onayı bu çağrının ön koşuludur.
   * @returns {Promise<object>} oturum sonucu
   */
  async function startSurgery(changeRequestId, opts = {}) {
    if (active || chat) {
      return { ok: false, error: 'Zaten çalışan bir cerrahi var. Önce onu bitir veya iptal et.' };
    }
    const changeRequest = pending.get(changeRequestId);
    if (!changeRequest) {
      return { ok: false, error: `Bekleyen talep bulunamadı: ${changeRequestId}` };
    }

    let worktree;
    try {
      worktree = handoff.createWorktree(repoRoot, changeRequest.changeRequestId, {
        startPoint: opts.startPoint || 'HEAD',
      });
    } catch (err) {
      status = STATUS.FAILED;
      lastResult = { changeRequestId, status: STATUS.FAILED, error: `Worktree açılamadı: ${err.message}` };
      emit({ type: 'surgery_failed', changeRequestId, detail: lastResult.error });
      return { ok: false, error: lastResult.error };
    }

    const surgeon = surgeonFactory({ onEvent: emit });
    active = {
      changeRequestId,
      branch: worktree.branch,
      worktreePath: worktree.worktreePath,
      surgeon,
      startedAt: new Date().toISOString(),
    };
    status = STATUS.RUNNING;
    pending.delete(changeRequestId);
    emit({ type: 'surgery_started', changeRequestId, branch: worktree.branch });

    try {
      const auth = await surgeon.connect();
      if (!auth?.authenticated) {
        throw new Error('Copilot oturumu açık değil. Terminalde `copilot` ile giriş yap.');
      }

      const result = await surgeon.runSurgery({
        changeRequest,
        worktreePath: worktree.worktreePath,
        prompt: buildSurgeryPrompt(changeRequest),
        timeoutMs: opts.timeoutMs,
        model: opts.model || DEFAULT_SURGERY_MODEL,
      });

      status = STATUS.AWAITING_REVIEW;
      lastResult = {
        changeRequestId,
        branch: worktree.branch,
        worktreePath: worktree.worktreePath,
        status: STATUS.AWAITING_REVIEW,
        surgeonStatus: result.status,
        rejectedCount: result.rejectedCount,
        decisions: result.decisions,
        reply: result.reply,
      };
      emit({
        type: 'surgery_awaiting_review',
        changeRequestId,
        branch: worktree.branch,
        detail: `${result.status} · ${result.rejectedCount} izin reddi`,
      });
      return { ok: true, ...lastResult };
    } catch (err) {
      status = STATUS.FAILED;
      lastResult = {
        changeRequestId,
        branch: worktree.branch,
        worktreePath: worktree.worktreePath,
        status: STATUS.FAILED,
        error: err?.message || 'cerrahi başarısız',
      };
      emit({ type: 'surgery_failed', changeRequestId, detail: lastResult.error });
      // Worktree BİLEREK silinmez: kullanıcı ne olduğunu inceleyebilmeli.
      return { ok: false, ...lastResult };
    } finally {
      try { await surgeon.disconnect(); } catch { /* yoksay */ }
      active = null;
    }
  }

  /** Çalışan cerrahiyi keser. Worktree korunur. */
  async function abortSurgery() {
    if (!active) return { ok: false, error: 'Çalışan cerrahi yok.' };
    const { changeRequestId, surgeon } = active;
    try { await surgeon.abort(); } catch { /* yoksay */ }
    try { await surgeon.disconnect(); } catch { /* yoksay */ }
    status = STATUS.ABORTED;
    lastResult = { changeRequestId, status: STATUS.ABORTED };
    active = null;
    emit({ type: 'surgery_aborted', changeRequestId });
    return { ok: true, changeRequestId };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ETKİLEŞİMLİ SOHBET OTURUMU
  // ══════════════════════════════════════════════════════════════════════
  // startSurgery tek atımlıdır: talep gider, dakikalarca beklersin, sonucu
  // dal olarak görürsün. Sohbet oturumu bunun karşıtıdır — konuşma açık kalır
  // ve cerrahın her dosya yazma / komut / ağ isteği kullanıcıya onay kartı
  // olarak düşer (VS Code Copilot davranışı).
  //
  // İKİ AYRI ONAY DÜZLEMİ, KARIŞTIRILMAMALI:
  //   1. İzin kartı  → "bu dosyayı worktree'ye yazayım mı?"  (tur içinde)
  //   2. Uygulama    → "bu iş canlı koda insin mi?"           (oturum sonunda)
  // Kullanıcı kararına göre 2. adım oturum bitince OTOMATİK çalışır; ama
  // preflight kapısı BLOCK derse onay bile geçersizdir (review-service
  // içindeki kural). Yani hız kullanıcının, veto kapının.

  /** Sohbet turlarına eklenen bağlayıcı çerçeve — ilk mesajla bir kez gider. */
  function buildChatPreamble() {
    return [
      '# Etkileşimli cerrahi bakım oturumu',
      '',
      cakalIdentity.buildSurgeonContract(),
      '',
      '## Bağlayıcı kısıtlar',
      '- Yalnız bu worktree içinde çalış. Dışına çıkma.',
      '- Güvenlik katmanlarına, preflight kapısına ve cerrahi altyapıya DOKUNMA.',
      '- .env ve secret dosyalarını okuma/yazma.',
      '- git push, remote değişikliği, npm publish YASAK.',
      '- Mevcut testleri silme veya zayıflatma; yeni davranış için yeni test yaz.',
      '- Değişikliği küçük ve geri alınabilir tut.',
      '',
      '## Bu oturumun işleyişi',
      '- Bu bir SOHBET. Kullanıcı sana adım adım yazacak; her turda kısa ve net cevap ver.',
      '- Yazdığın HER dosya ve çalıştırdığın HER komut kullanıcıya onay kartı olarak',
      '  gösterilir. Kullanıcı reddederse gerekçesini oku, kapsamı daralt, kapıyı aşmaya çalışma.',
      '- Büyük değişiklikleri tek hamlede yapma: küçük parçalara böl ki kullanıcı',
      '  her adımı görüp onaylayabilsin.',
      '- Burası bir git worktree; `node_modules` YOK. `npm test`/`npm install` çalışmaz,',
      '  denemeye zaman harcama. Doğrulama merge kapısında ayrıca koşar.',
      '- Görev belirsizse TAHMİN ETME: ne yapacağını kısaca yaz ve kullanıcıya sor.',
      '',
      '## Kullanıcının mesajı',
    ].join('\n');
  }

  /** Bekleyen tüm izin isteklerini verilen gerekçeyle kapatır. */
  function flushPermissions(feedback) {
    if (!chat) return;
    for (const [permissionId, entry] of chat.permissions) {
      clearTimeout(entry.timer);
      chat.permissions.delete(permissionId);
      try { entry.resolve({ approved: false, feedback }); } catch { /* yoksay */ }
      emit({ type: 'permission_cancelled', permissionId, detail: feedback });
    }
  }

  /**
   * İzin kancasının askUser köprüsü: isteği UI'a yollar ve kullanıcının
   * kararını bekler. Cevap respondPermission ile gelir.
   */
  function askUserBridge(ask) {
    const permissionId = crypto.randomBytes(8).toString('hex');
    // Ham metin cerrahtan gelir; token benzeri her şey UI'a gitmeden maskelenir.
    const payload = {
      permissionId,
      kind: ask.kind,
      intention: ask.intention ? redact(String(ask.intention)) : null,
      target: ask.target ? redact(String(ask.target)) : null,
      file: ask.file || null,
      diff: ask.diff ? redact(ask.diff) : null,
      command: ask.command ? redact(ask.command) : null,
      url: ask.url ? redact(String(ask.url)) : null,
      toolName: ask.toolName || null,
      paths: Array.isArray(ask.paths) ? ask.paths.slice(0, 20) : null,
      createdAt: Date.now(),
      expiresAt: Date.now() + permissionTimeoutMs,
    };

    return new Promise((resolve) => {
      if (!chat) { resolve({ approved: false, feedback: 'Sohbet oturumu kapalı.' }); return; }

      const timer = setTimeout(() => {
        if (!chat || !chat.permissions.has(permissionId)) return;
        chat.permissions.delete(permissionId);
        resolve({ approved: false, feedback: 'Kullanıcı süresi içinde yanıt vermedi; işlem reddedildi.' });
        emit({ type: 'permission_timeout', permissionId });
      }, permissionTimeoutMs);
      // Zaman aşımı sayacı Electron main sürecini ayakta tutmasın.
      if (typeof timer.unref === 'function') timer.unref();

      chat.permissions.set(permissionId, { resolve, timer, payload });
      emit({ type: 'permission_request', permissionId, payload });
    });
  }

  /** UI'dan gelen onay/red kararı. Bekleyen istek yoksa sessizce başarısız olur. */
  function respondPermission(permissionId, approved, feedback) {
    if (!chat) return { ok: false, error: 'Açık sohbet oturumu yok.' };
    const entry = chat.permissions.get(permissionId);
    if (!entry) {
      return { ok: false, error: 'Bu izin isteği artık bekletilmiyor (zaman aşımı veya iptal).' };
    }
    clearTimeout(entry.timer);
    chat.permissions.delete(permissionId);
    const decision = approved === true ? 'approved' : 'rejected';
    entry.resolve({ approved: approved === true, feedback });
    emit({ type: 'permission_resolved', permissionId, decision, detail: entry.payload.target || '' });
    return { ok: true, permissionId, decision };
  }

  /**
   * Sohbet oturumunu açar: izole worktree + açık Copilot oturumu.
   * @param {object} opts
   * @param {string} [opts.changeRequestId] Bekleyen bir talebe bağlanır (yoksa ad-hoc oturum)
   * @param {string} [opts.title] Ad-hoc oturum başlığı
   * @param {string} [opts.model]
   */
  async function startChat(opts = {}) {
    if (active || chat) {
      return { ok: false, error: 'Zaten çalışan bir cerrahi/sohbet var. Önce onu bitir.' };
    }

    // Bekleyen talebe bağlanabilir ya da serbest başlatılabilir. Her iki
    // durumda da izlenebilir bir CR kimliği üretilir — dal adı ondan gelir.
    let changeRequest;
    if (opts.changeRequestId && pending.has(opts.changeRequestId)) {
      changeRequest = pending.get(opts.changeRequestId);
    } else {
      changeRequest = handoff.buildChangeRequest({
        originalUserRequest: String(opts.title || '').trim() || 'Etkileşimli cerrahi sohbet oturumu',
      });
    }

    let worktree;
    try {
      worktree = handoff.createWorktree(repoRoot, changeRequest.changeRequestId, {
        startPoint: opts.startPoint || 'HEAD',
      });
    } catch (err) {
      emit({ type: 'chat_failed', detail: `Worktree açılamadı: ${err.message}` });
      return { ok: false, error: `Worktree açılamadı: ${err.message}` };
    }

    const surgeon = surgeonFactory({ onEvent: emit });
    chat = {
      changeRequestId: changeRequest.changeRequestId,
      changeRequest,
      branch: worktree.branch,
      worktreePath: worktree.worktreePath,
      surgeon,
      model: opts.model || DEFAULT_SURGERY_MODEL,
      startedAt: new Date().toISOString(),
      busy: false,
      turns: 0,
      preambleSent: false,
      permissions: new Map(),
    };
    status = STATUS.CHATTING;

    try {
      const auth = await surgeon.connect();
      if (!auth?.authenticated) throw new Error('Copilot oturumu açık değil. Önce GitHub girişi yap.');

      await surgeon.startInteractive({
        worktreePath: worktree.worktreePath,
        model: chat.model,
        askUser: askUserBridge,
      });
    } catch (err) {
      // Başlatma başarısız: worktree BİLEREK bırakılır (inceleme için).
      try { await surgeon.disconnect(); } catch { /* yoksay */ }
      const message = err?.message || 'sohbet oturumu açılamadı';
      chat = null;
      status = STATUS.FAILED;
      lastResult = { changeRequestId: changeRequest.changeRequestId, status: STATUS.FAILED, error: message };
      emit({ type: 'chat_failed', changeRequestId: changeRequest.changeRequestId, detail: message });
      return { ok: false, error: message, branch: worktree.branch, worktreePath: worktree.worktreePath };
    }

    // Talebe bağlandıysa kuyruktan düşür: iş artık bu oturumda.
    pending.delete(changeRequest.changeRequestId);

    emit({
      type: 'chat_started',
      changeRequestId: changeRequest.changeRequestId,
      branch: worktree.branch,
      detail: `sohbet açıldı · ${chat.model}`,
    });
    return {
      ok: true,
      changeRequestId: changeRequest.changeRequestId,
      branch: worktree.branch,
      worktreePath: worktree.worktreePath,
      model: chat.model,
    };
  }

  /** Sohbete bir tur mesaj gönderir. Tur bitene kadar ikinci mesaj kabul edilmez. */
  async function sendChat(text, opts = {}) {
    if (!chat) return { ok: false, error: 'Açık sohbet oturumu yok.' };
    if (chat.busy) return { ok: false, error: 'Cerrah hâlâ çalışıyor; turun bitmesini bekle.' };
    const message = String(text || '').trim();
    if (!message) return { ok: false, error: 'Boş mesaj gönderilemez.' };

    chat.busy = true;
    chat.turns += 1;
    emit({ type: 'chat_user_message', detail: message.slice(0, 400) });

    // Çerçeve yalnız ilk turda gider; her turda tekrarlamak bağlamı şişirir.
    const payload = chat.preambleSent ? message : `${buildChatPreamble()}\n${message}`;

    try {
      const result = await chat.surgeon.sendMessage(payload, opts.timeoutMs);
      chat.preambleSent = true;
      emit({
        type: 'chat_reply',
        detail: result?.reply || '(cevap metni yok)',
        rejectedCount: result?.rejectedCount ?? 0,
      });
      return { ok: true, reply: result?.reply || null, rejectedCount: result?.rejectedCount ?? 0 };
    } catch (err) {
      const detail = err?.message || 'tur başarısız';
      emit({ type: 'chat_turn_failed', detail });
      return { ok: false, error: detail };
    } finally {
      chat.busy = false;
      // Tur bitti ama cevaplanmamış kart kalmışsa artık anlamı yok: kapat.
      flushPermissions('Tur sona erdiği için istek düştü.');
    }
  }

  /**
   * Oturumdaki işi canlı koda indirir.
   *
   * Sıra ÖNEMLİ: önce commit (commit'siz iş merge'de kaybolur), sonra
   * "merge edilecek bir şey var mı" kontrolü, sonra preflight + merge.
   * approved:true buraya kullanıcının oturum boyunca verdiği onaylardan
   * gelir; ama BLOCK durumunda review-service onayı zaten geçersiz sayar.
   */
  async function applyChat(opts = {}) {
    if (!chat) return { ok: false, error: 'Açık sohbet oturumu yok.' };
    const { branch, worktreePath, changeRequestId } = chat;

    emit({ type: 'chat_apply_started', branch });

    try {
      handoff.commitAll(worktreePath, `cerrahi: ${changeRequestId} sohbet oturumu`);
    } catch (err) {
      emit({ type: 'chat_apply_failed', detail: `Commit başarısız: ${err.message}` });
      return { ok: false, error: `Commit başarısız: ${err.message}` };
    }

    let ahead = 0;
    try { ahead = handoff.commitsAhead(worktreePath, opts.base || 'main'); } catch { /* aşağıda 0 sayılır */ }
    if (ahead === 0) {
      emit({ type: 'chat_apply_skipped', detail: 'Uygulanacak değişiklik yok.' });
      return { ok: true, applied: false, reason: 'NO_CHANGES', message: 'Bu oturumda kod değişikliği olmadı; uygulanacak bir şey yok.' };
    }

    const result = await reviewService.approveAndMerge({
      base: opts.base || 'main',
      head: branch,
      approved: true,
      verify: opts.verify !== false,
      cwd: repoRoot,
    });

    if (result.merged) {
      emit({ type: 'chat_apply_merged', branch, detail: `geri dönüş: ${result.rollbackCommand}` });
    } else {
      emit({ type: 'chat_apply_blocked', branch, detail: `${result.reason}: ${result.message || ''}` });
    }
    return { ok: true, applied: result.merged === true, commits: ahead, result };
  }

  /**
   * Sohbeti kapatır ve (varsayılan olarak) işi uygular.
   * apply:false verilirse dal incelemeye bırakılır — mevcut Cerrahi Bakım
   * ekranından elle merge edilebilir.
   */
  async function endChat(opts = {}) {
    if (!chat) return { ok: false, error: 'Açık sohbet oturumu yok.' };
    const { changeRequestId, branch, worktreePath, surgeon } = chat;

    flushPermissions('Oturum kapatıldı; istek reddedildi.');

    let apply = null;
    if (opts.apply !== false) {
      apply = await applyChat({ base: opts.base, verify: opts.verify });
    }

    try { await surgeon.disconnect(); } catch { /* yoksay */ }

    // Merge başarılıysa worktree'ye ihtiyaç kalmaz; dal her hâlükârda korunur.
    if (apply?.applied === true) {
      try { handoff.removeWorktree(repoRoot, worktreePath); } catch { /* yoksay */ }
    }

    const decisions = typeof surgeon.decisions === 'object' ? surgeon.decisions : [];
    chat = null;
    status = apply?.applied ? STATUS.IDLE : STATUS.AWAITING_REVIEW;
    lastResult = {
      changeRequestId,
      branch,
      worktreePath,
      status,
      applied: apply?.applied === true,
      apply: apply || null,
      decisions,
    };
    emit({ type: 'chat_ended', changeRequestId, branch, detail: apply?.applied ? 'uygulandı' : 'incelemede' });
    return { ok: true, ...lastResult };
  }

  /** Sohbeti uygulamadan keser. Dal ve worktree inceleme için korunur. */
  async function abortChat() {
    if (!chat) return { ok: false, error: 'Açık sohbet oturumu yok.' };
    const { changeRequestId, surgeon } = chat;
    flushPermissions('Oturum iptal edildi; istek reddedildi.');
    try { await surgeon.abort(); } catch { /* yoksay */ }
    return endChat({ apply: false }).then((r) => {
      emit({ type: 'chat_aborted', changeRequestId });
      return r;
    });
  }

  /** İnceleme bittikten sonra worktree'yi kaldırır (dal korunur). */
  function cleanupWorktree(worktreePath) {
    try {
      handoff.removeWorktree(repoRoot, worktreePath);
      emit({ type: 'worktree_removed', worktreePath });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function reset() {
    pending.clear();
    flushPermissions('Oturum sıfırlandı.');
    active = null;
    chat = null;
    lastResult = null;
    status = STATUS.IDLE;
  }

  return {
    STATUS,
    registerRequest,
    listRequests,
    getStatus,
    checkAuth,
    listModels,
    DEFAULT_SURGERY_MODEL,
    startLogin,
    cancelLogin,
    startSurgery,
    abortSurgery,
    // Etkileşimli sohbet oturumu
    startChat,
    sendChat,
    respondPermission,
    applyChat,
    endChat,
    abortChat,
    buildChatPreamble,
    cleanupWorktree,
    buildSurgeryPrompt,
    onEvent,
    reset,
  };
}

module.exports = { createSessionManager, STATUS, MAX_PENDING, PERMISSION_TIMEOUT_MS };
