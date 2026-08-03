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

/** Token benzeri desenleri maskeler. Loglanan/rapora giren HER şey buradan geçer. */
function redact(text) {
  return String(text ?? '')
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GH_PAT]')
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]');
}

/** Üretim varsayılanı: SDK'yı yalnız gerçekten çalışırken yükle. */
function defaultClientFactory() {
  // eslint-disable-next-line global-require
  const { CopilotClient } = require('@github/copilot-sdk');
  return new CopilotClient();
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
        this._emit('surgeon_permission', `${d.decision}:${d.reason}`);
      },
    });

    this._session = await this._client.createSession({
      workingDirectory: worktreePath,
      onPermissionRequest: handler,
    });
    this._emit('surgeon_session', `oturum açıldı (${changeRequest?.changeRequestId || 'CR-?'})`);

    const unsubscribe = this._session.on((event) => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });

    let reply = null;
    let status = 'COMPLETED';
    try {
      const result = await this._session.sendAndWait(prompt, params.timeoutMs || 300000);
      reply = result?.text ? redact(result.text) : null;
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

  async abort() {
    if (this._session) {
      try { await this._session.abort(); this._emit('surgeon_abort', 'oturum iptal edildi'); }
      catch (err) { this._emit('surgeon_error', err?.message || 'abort hatası'); }
    }
  }

  async disconnect() {
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

module.exports = { CopilotSurgeon, redact, defaultClientFactory };
