import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import telegramReaderModule from '../apps/desktop/electron/telegram-reader.cjs';

const { TelegramReader, classifyAuthError, DEAD_SESSION_ERRORS } = telegramReaderModule;

/**
 * CANLI HATA REGRESYONU — 15 Ağustos 2026
 *
 * Ayarlar ekranı "Telegram hesabı bağlı — kanallar okunabilir" diyordu.
 * Ölçüm bunun yanlış olduğunu gösterdi:
 *
 *   Kayitli session uzunlugu : 369
 *   GetUsers HATA kodu       : SESSION_REVOKED   (401)
 *
 * SEBEP: isAuthenticated() yalnızca dizenin uzunluğuna bakıyordu
 * (`TELEGRAM_SESSION.length > 10`). İptal edilmiş bir oturum da 369 karakter
 * olduğu için kontrol "geçti", arayüz yeşil yandı ve `tgAuthStep === 'done'`
 * dalı giriş formunu TAMAMEN gizledi. Kullanıcının yeniden giriş yapmasına
 * hiçbir yol kalmadı — "Kod Gönder" düğmesi ekranda yoktu.
 *
 * Ders: dizenin var olması yetkinin geçerli olduğunu göstermez.
 * Beyan kanıt değildir.
 */

let dir;
let configPath;

function writeConfig(extra = {}) {
  fs.writeFileSync(configPath, JSON.stringify({
    TELEGRAM_API_ID: '34757271',
    TELEGRAM_API_HASH: 'a'.repeat(32),
    TELEGRAM_CHAT_ID: '8777977368',
    ...extra,
  }, null, 2), 'utf-8');
}

/** Gerçek uzunlukta ama iptal edilmiş bir oturum dizesi taklidi. */
const REVOKED_SESSION = '1'.repeat(369);

function makeReader() {
  const reader = new TelegramReader(configPath);
  reader.configure('34757271', 'a'.repeat(32));
  return reader;
}

/** connect()'i ağa çıkmadan taklit et; invoke verilen hatayı fırlatsın. */
function stubTransport(reader, invokeImpl) {
  let invocations = 0;
  reader.connect = async () => {
    reader.client = {
      invoke: async () => {
        invocations += 1;
        return invokeImpl();
      },
    };
    reader.connected = true;
  };
  return () => invocations;
}

function telegramError(code) {
  const err = new Error(`401: ${code} (caused by users.GetUsers)`);
  err.errorMessage = code;
  return err;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-tg-'));
  configPath = path.join(dir, 'cakal-config.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('oturum dizesi ile yetki ayrımı', () => {
  it('REGRESYON — iptal edilmiş oturum "bağlı" sayılmıyor', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => { throw telegramError('SESSION_REVOKED'); });

    // Dize diskte duruyor — eski kontrol tam da buna bakıp "bağlı" diyordu.
    expect(reader.hasStoredSession()).toBe(true);

    const auth = await reader.verifyAuthorization();
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toBe('revoked');
    expect(auth.code).toBe('SESSION_REVOKED');
  });

  it('geçerli oturum bağlı raporlanıyor', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => [{ id: 1, firstName: 'Emrah' }]);

    const auth = await reader.verifyAuthorization();
    expect(auth.authorized).toBe(true);
    expect(auth.reason).toBe('ok');
  });

  it('hiç oturum yoksa sebep no_session', async () => {
    writeConfig();
    const auth = await makeReader().verifyAuthorization();
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toBe('no_session');
  });

  it('API bilgisi yoksa sebep not_configured', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = new TelegramReader(configPath); // configure() çağrılmadı
    const auth = await reader.verifyAuthorization();
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toBe('not_configured');
  });
});

describe('ağ hatası ile iptal ayrımı', () => {
  it('ağ hatası "revoked" sayılmıyor', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => { throw new Error('socket hang up'); });

    const auth = await reader.verifyAuthorization();
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toBe('unreachable');
  });

  it('ağ hatasında kayıtlı oturum SİLİNMİYOR', async () => {
    // Kritik: bağlantı koptu diye çalışan oturumu silmek, düzeltmeye
    // çalıştığımız kilidin aynısını üretirdi.
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => { throw new Error('ETIMEDOUT'); });

    await reader.verifyAuthorization();

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(saved.TELEGRAM_SESSION).toBe(REVOKED_SESSION);
  });

  it('ölü oturum kodlarının hepsi revoked olarak sınıflanıyor', () => {
    for (const code of DEAD_SESSION_ERRORS) {
      expect(classifyAuthError(telegramError(code)).reason).toBe('revoked');
    }
  });

  it('AUTH_KEY_DUPLICATED sebebi kullanıcıya açıklanıyor', () => {
    // Aynı oturum dizesini iki uygulamada kullanınca çıkan hata — mesaj
    // bunun sebebini söylemeli, yoksa kullanıcı neden koptuğunu anlamaz.
    const result = classifyAuthError(telegramError('AUTH_KEY_DUPLICATED'));
    expect(result.reason).toBe('revoked');
    expect(result.message).toMatch(/başka bir uygulama/i);
  });

  it('tanınmayan hata unreachable, çünkü emin değiliz', () => {
    expect(classifyAuthError(new Error('FLOOD_WAIT_42')).reason).toBe('unreachable');
    expect(classifyAuthError(undefined).reason).toBe('unreachable');
  });
});

describe('önbellek', () => {
  it('başarılı sonuç tekrar ağa çıkmıyor', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    const count = stubTransport(reader, () => [{ id: 1 }]);

    await reader.verifyAuthorization();
    await reader.verifyAuthorization();
    expect(count()).toBe(1);
  });

  it('force ile önbellek atlanıyor', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    const count = stubTransport(reader, () => [{ id: 1 }]);

    await reader.verifyAuthorization();
    await reader.verifyAuthorization({ force: true });
    expect(count()).toBe(2);
  });
});

describe('resetAuth', () => {
  it('oturumu siler ama API bilgilerini ve diğer ayarları korur', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION, TELEGRAM_CHANNELS: [{ id: '1', title: 'x' }] });
    const reader = makeReader();

    await reader.resetAuth();

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(saved.TELEGRAM_SESSION).toBeUndefined();
    expect(saved.TELEGRAM_API_ID).toBe('34757271');
    expect(saved.TELEGRAM_API_HASH).toHaveLength(32);
    expect(saved.TELEGRAM_CHANNELS).toHaveLength(1);
    expect(reader.hasStoredSession()).toBe(false);
  });

  it('sıfırlamadan sonra durum no_session', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => [{ id: 1 }]);

    await reader.verifyAuthorization();       // önbelleğe "bağlı" yazılır
    await reader.resetAuth();                  // önbellek de temizlenmeli

    const auth = await reader.verifyAuthorization();
    expect(auth.reason).toBe('no_session');
  });
});

describe('sendCode ölü oturumu temizler', () => {
  it('iptal edilmiş oturumla kod istenirse önce sıfırlanır', async () => {
    // Ölü auth key ile YAPILAN HER istek 401 döner — kod isteği dahil.
    // Temizlenmezse "Kod Gönder" SESSION_REVOKED ile düşer ve kullanıcı
    // kilitli kalır.
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => { throw telegramError('SESSION_REVOKED'); });

    let sessionAtSendTime = 'okunmadi';
    reader.client = null;
    const origConnect = reader.connect;
    reader.connect = async () => {
      await origConnect();
      sessionAtSendTime = JSON.parse(fs.readFileSync(configPath, 'utf-8')).TELEGRAM_SESSION;
      reader.client.sendCode = async () => ({ phoneCodeHash: 'hash123' });
    };

    const res = await reader.sendCode('+905412879705');

    expect(res.phoneCodeHash).toBe('hash123');
    expect(sessionAtSendTime).toBeUndefined(); // ölü oturum silinmiş olmalı
  });

  it('ağ hatasında oturum silinmez', async () => {
    writeConfig({ TELEGRAM_SESSION: REVOKED_SESSION });
    const reader = makeReader();
    stubTransport(reader, () => { throw new Error('socket hang up'); });
    const origConnect = reader.connect;
    reader.connect = async () => {
      await origConnect();
      reader.client.sendCode = async () => ({ phoneCodeHash: 'hash123' });
    };

    await reader.sendCode('+905412879705');

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(saved.TELEGRAM_SESSION).toBe(REVOKED_SESSION);
  });
});
