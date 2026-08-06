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
const { CopilotSurgeon, resolveNativeCliPath } = require('./copilot-surgeon.cjs');
const { startDeviceLogin, GITHUB_DEVICE_URL } = require('./auth-login.cjs');
const cakalIdentity = require('../cakal-identity.cjs');

const STATUS = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED',
});

const MAX_PENDING = 20;

// Cerrahi için varsayılan model. "auto" bilinçli olarak SEÇİLMEDİ: kod
// kalitesi cerrahi işin tamamını belirliyor, model kararı şansa bırakılmamalı.
// Kullanıcı UI'dan değiştirebilir; liste hesabın aboneliğine göre gelir.
const DEFAULT_SURGERY_MODEL = 'claude-sonnet-5';

function createSessionManager(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '../../../..');
  const surgeonFactory = typeof options.surgeonFactory === 'function'
    ? options.surgeonFactory
    : (opts) => new CopilotSurgeon(opts);

  /** id → changeRequest (PENDING) */
  const pending = new Map();

  let active = null;      // { changeRequestId, branch, worktreePath, surgeon, startedAt }
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
    if (active) {
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
    active = null;
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
    cleanupWorktree,
    buildSurgeryPrompt,
    onEvent,
    reset,
  };
}

module.exports = { createSessionManager, STATUS, MAX_PENDING };
