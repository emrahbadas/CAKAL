// ============================================================
// auth-login.cjs — Copilot cihaz kodu (device flow) girişi
// ============================================================
// SDK'da giriş ucu YOKTUR; yalnız okuma amaçlı getAuthStatus() vardır.
// Giriş, CLI'ın kendi OAuth akışıyla yapılır:
//     copilot login --device-code
// çıktısı:
//     To authenticate, visit https://github.com/login/device and enter code XXXX-YYYY
//     Waiting for authorization...
//
// GÜVENLİK SINIRI (önemli):
//   - ÇAKAL kullanıcı adına GitHub'a giriş YAPMAZ. Yalnız cihaz kodunu ekrana
//     taşır; onayı kullanıcı kendi tarayıcısında kendi verir.
//   - Token ÇAKAL'ın eline HİÇ geçmez. CLI onu işletim sisteminin kimlik
//     kasasına yazar; biz yalnız "oturum açık mı" bilgisini okuruz.
//   - Bu yüzden burada token okuma/saklama/loglama kodu yoktur ve olmamalıdır.

const { spawn } = require('child_process');

// GitHub'ın resmî cihaz aktivasyon adresi. Açılmasına izin verilen TEK adres;
// CLI çıktısından gelen rastgele bir URL açtırılmaz.
const GITHUB_DEVICE_URL = 'https://github.com/login/device';

// Cihaz kodları tipik olarak 15 dakikada dolar; biraz pay bırakıyoruz.
const DEFAULT_TIMEOUT_MS = 16 * 60 * 1000;

const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;

/** CLI çıktısından cihaz kodunu ayıklar. */
function parseDeviceCode(text) {
  const match = CODE_RE.exec(String(text || ''));
  return match ? match[1] : null;
}

/**
 * Cihaz kodu giriş akışını başlatır.
 *
 * @param {object} options
 * @param {string} options.cliPath copilot binary yolu
 * @param {(evt:object)=>void} [options.onEvent]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.spawnImpl] test enjeksiyonu
 * @returns {{ promise: Promise<object>, cancel: () => void }}
 */
function startDeviceLogin(options = {}) {
  const { cliPath } = options;
  if (!cliPath) throw new Error('cliPath zorunlu.');

  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const child = spawnImpl(cliPath, ['login', '--device-code'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let codeEmitted = false;
  let settled = false;
  let timer = null;

  const handleChunk = (chunk) => {
    const text = String(chunk);
    if (!codeEmitted) {
      const code = parseDeviceCode(text);
      if (code) {
        codeEmitted = true;
        // Kod bir sır değildir: kullanıcının GÖRMESİ gereken eşleştirme kodudur.
        onEvent({ type: 'login_code', code, url: GITHUB_DEVICE_URL });
      }
    }
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);

  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      onEvent({ type: 'login_finished', ok: result.ok, reason: result.reason || null });
      resolve(result);
    };

    timer = setTimeout(() => {
      try { child.kill(); } catch { /* yoksay */ }
      finish({ ok: false, reason: 'timeout', message: 'Cihaz kodu süresi doldu. Tekrar dene.' });
    }, timeoutMs);

    child.on('error', (err) => {
      finish({ ok: false, reason: 'spawn_error', message: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) finish({ ok: true });
      else finish({ ok: false, reason: 'exit_code', message: `Giriş tamamlanmadı (çıkış kodu ${code}).` });
    });
  });

  return {
    promise,
    cancel() {
      try { child.kill(); } catch { /* yoksay */ }
    },
  };
}

module.exports = {
  GITHUB_DEVICE_URL,
  DEFAULT_TIMEOUT_MS,
  parseDeviceCode,
  startDeviceLogin,
};
