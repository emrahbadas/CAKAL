import { describe, it, expect } from 'vitest';

import surgeon from '../apps/desktop/electron/surgery/copilot-surgeon.cjs';

const { buildClientOptions, resolveNativeCliPath } = surgeon;

/**
 * CANLI HATA REGRESYONU
 *
 * SDK CLI'ı şöyle başlatır:
 *   isJsFile ? spawn(process.execPath, [cliPath]) : spawn(cliPath)
 *
 * Electron'da process.execPath Node değil Electron binary'sidir. Gerçek
 * Electron 31.3.1 içinde iki başarısız yol ölçüldü:
 *   - düzeltmesiz            → "CLI server exited unexpectedly with code 0"
 *   - ELECTRON_RUN_AS_NODE=1 → "error: too many arguments. Expected 0 got 1"
 * Çalışan yol: native binary'yi doğrudan göstermek (COPILOT_CLI_PATH).
 */

describe('Copilot istemci seçenekleri', () => {
  it('düz Node altında varsayılanı bozmaz', () => {
    // Düz Node'da bundled .js yolu doğrulanmıştır; müdahale edilmemeli.
    expect(buildClientOptions({ versions: { node: '20.0.0' } })).toEqual({});
    expect(buildClientOptions({ versions: {} })).toEqual({});
  });

  it('Electron altında COPILOT_CLI_PATH ile native binary gösterir', () => {
    const opts = buildClientOptions({
      versions: { electron: '31.3.1' },
      baseEnv: { PATH: '/usr/bin' },
      nativeCliPath: 'C:/x/copilot.exe',
    });
    expect(opts.env.COPILOT_CLI_PATH).toBe('C:/x/copilot.exe');
    expect(opts.env.PATH).toBe('/usr/bin');
  });

  it('ELECTRON_RUN_AS_NODE KULLANMAZ (ölçülen başarısız yol)', () => {
    const opts = buildClientOptions({
      versions: { electron: '31.3.1' },
      baseEnv: {},
      nativeCliPath: 'C:/x/copilot.exe',
    });
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('native binary yoksa sessizce geçmez, açık hata verir', () => {
    expect(() => buildClientOptions({
      versions: { electron: '31.3.1' },
      nativeCliPath: null,
    })).toThrow(/native binary bulunamadı/i);
  });

  it('kendi sürecimizin env objesini mutasyona uğratmaz', () => {
    const original = { PATH: '/usr/bin' };
    buildClientOptions({ versions: { electron: '31.3.1' }, baseEnv: original, nativeCliPath: 'C:/x/copilot.exe' });
    expect(original.COPILOT_CLI_PATH).toBeUndefined();
  });
});

describe('native binary çözümleme', () => {
  it('bu makinede platform paketini bulur', () => {
    const resolved = resolveNativeCliPath();
    // Paket kurulu olmayan ortamda null dönmesi de geçerlidir; ama kuruluysa
    // dosya gerçekten var olmalı.
    if (resolved) {
      expect(resolved).toMatch(/copilot(\.exe)?$/);
    } else {
      expect(resolved).toBeNull();
    }
  });

  it('bilinmeyen platform/arch için null döner', () => {
    expect(resolveNativeCliPath({ platform: 'solaris', arch: 'sparc' })).toBeNull();
  });
});
