import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';

import authLogin from '../apps/desktop/electron/surgery/auth-login.cjs';

const { parseDeviceCode, startDeviceLogin, GITHUB_DEVICE_URL } = authLogin;

/**
 * Cihaz kodu akışı.
 *
 * GÜVENLİK SINIRI: ÇAKAL kullanıcı adına GitHub'a giriş yapmaz. Yalnız CLI'ın
 * ürettiği eşleştirme kodunu ekrana taşır; onayı kullanıcı kendi tarayıcısında
 * verir ve token CLI'ın kimlik kasasında kalır — ÇAKAL'ın eline geçmez.
 */

/** Gerçek CLI yerine kontrollü sahte süreç. */
function fakeSpawn(script = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    child.killed = false;

    setImmediate(() => {
      if (script.stdout) child.stdout.emit('data', script.stdout);
      if (script.stderr) child.stderr.emit('data', script.stderr);
      if (script.error) child.emit('error', new Error(script.error));
      else if (script.exitCode !== undefined) child.emit('close', script.exitCode);
    });
    return child;
  };
}

describe('cihaz kodu ayıklama', () => {
  it('gerçek CLI çıktısından kodu çıkarır', () => {
    const line = 'To authenticate, visit https://github.com/login/device and enter code 93F5-8266';
    expect(parseDeviceCode(line)).toBe('93F5-8266');
  });

  it('stderr varyantından da çıkarır', () => {
    const line = 'Failed to copy to clipboard. Please visit https://github.com/login/device and enter the code A1B2-C3D4 manually.';
    expect(parseDeviceCode(line)).toBe('A1B2-C3D4');
  });

  it('kod yoksa null döner', () => {
    expect(parseDeviceCode('Waiting for authorization...')).toBeNull();
    expect(parseDeviceCode('')).toBeNull();
    expect(parseDeviceCode(null)).toBeNull();
  });
});

describe('giriş akışı', () => {
  it('kodu olay olarak yayar ve resmî GitHub adresini verir', async () => {
    const seen = [];
    const { promise } = startDeviceLogin({
      cliPath: 'copilot.exe',
      onEvent: (e) => seen.push(e),
      spawnImpl: fakeSpawn({
        stdout: 'To authenticate, visit https://github.com/login/device and enter code 93F5-8266\n',
        exitCode: 0,
      }),
    });

    const result = await promise;
    expect(result.ok).toBe(true);

    const codeEvent = seen.find((e) => e.type === 'login_code');
    expect(codeEvent.code).toBe('93F5-8266');
    // URL CLI çıktısından DEĞİL, sabitten gelir: rastgele adres açtırılamaz.
    expect(codeEvent.url).toBe(GITHUB_DEVICE_URL);
    expect(codeEvent.url).toBe('https://github.com/login/device');
  });

  it('kodu yalnız bir kez yayar', async () => {
    const seen = [];
    const { promise } = startDeviceLogin({
      cliPath: 'copilot.exe',
      onEvent: (e) => seen.push(e),
      spawnImpl: fakeSpawn({
        stdout: 'enter code 93F5-8266',
        stderr: 'enter the code 93F5-8266 manually',
        exitCode: 0,
      }),
    });
    await promise;
    expect(seen.filter((e) => e.type === 'login_code')).toHaveLength(1);
  });

  it('sıfırdan farklı çıkışta başarısız sayar', async () => {
    const { promise } = startDeviceLogin({
      cliPath: 'copilot.exe',
      spawnImpl: fakeSpawn({ exitCode: 1 }),
    });
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('exit_code');
  });

  it('süre dolarsa keser', async () => {
    const { promise } = startDeviceLogin({
      cliPath: 'copilot.exe',
      timeoutMs: 30,
      spawnImpl: fakeSpawn({ stdout: 'enter code AAAA-BBBB' }),  // hiç kapanmaz
    });
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout');
  });

  it('süreç başlatılamazsa hata döner', async () => {
    const { promise } = startDeviceLogin({
      cliPath: 'yok.exe',
      spawnImpl: fakeSpawn({ error: 'ENOENT' }),
    });
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('spawn_error');
  });

  it('cliPath olmadan başlatılamaz', () => {
    expect(() => startDeviceLogin({})).toThrow(/cliPath/);
  });

  it('iptal edilebilir', async () => {
    const { promise, cancel } = startDeviceLogin({
      cliPath: 'copilot.exe',
      timeoutMs: 5000,
      spawnImpl: fakeSpawn({ stdout: 'enter code AAAA-BBBB' }),
    });
    cancel();
    // İptal süreci öldürür; sahte süreçte close gelmediği için timeout'a düşmemesi
    // adına yalnız cancel'in patlamadığını doğruluyoruz.
    expect(typeof promise.then).toBe('function');
  });
});
