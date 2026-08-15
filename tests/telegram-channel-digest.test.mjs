import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import telegramReaderModule from '../apps/desktop/electron/telegram-reader.cjs';

const { TelegramReader } = telegramReaderModule;

/**
 * Takip listesi + zaman penceresi okuma davranışı.
 *
 * Kapsam BEYANI ile kapsam GERÇEĞİ ayrı tutulmalı: "20 mesaj tarandı, 3'ü
 * bugüne ait" ile "kanalda bugün 3 mesaj var" farklı iddialardır. İkincisini
 * söyleyebilmek için limitin dolup dolmadığını da bilmek gerekir.
 */

let dir;
let configPath;

const GUN = 24 * 60 * 60 * 1000;
const SIMDI = Date.parse('2026-08-15T12:00:00.000Z');
const BUGUN_BASI = '2026-08-14T21:00:00.000Z'; // 15 Ağu 00:00 İstanbul

function writeConfig(channels) {
  fs.writeFileSync(configPath, JSON.stringify({
    TELEGRAM_API_ID: '34757271',
    TELEGRAM_API_HASH: 'a'.repeat(32),
    TELEGRAM_SESSION: '1'.repeat(369),
    ...(channels ? { TELEGRAM_CHANNELS: channels } : {}),
  }, null, 2), 'utf-8');
}

/** GramJS mesaj taklidi: `date` unix saniye gelir. */
function msg(id, iso, text) {
  return { id, date: Math.floor(Date.parse(iso) / 1000), message: text, views: 0 };
}

function makeReader(channelMessages) {
  const reader = new TelegramReader(configPath);
  reader.configure('34757271', 'a'.repeat(32));

  reader.connect = async () => { reader.connected = true; };
  reader._resolveChannelEntity = async (ref) => ({
    entity: { id: ref },
    channelId: String(ref),
    channelTitle: `Kanal ${ref}`,
  });
  reader.client = {
    getMessages: async (entity) => channelMessages[String(entity.id)] || [],
  };
  return reader;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-tgch-'));
  configPath = path.join(dir, 'cakal-config.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('tek kanal okuma — pencere raporlaması', () => {
  it('aralık dışı mesajlar elenir, sayaçlar ayrı raporlanır', async () => {
    writeConfig();
    const reader = makeReader({
      '111': [
        msg(1, '2026-08-15T09:00:00Z', 'bugün A'),
        msg(2, '2026-08-15T08:00:00Z', 'bugün B'),
        msg(3, '2026-08-13T09:00:00Z', 'önceki gün'),
        msg(4, '2026-08-01T09:00:00Z', 'geçen hafta'),
      ],
    });

    const res = await reader.readChannelMessages('111', 20, { sinceIso: BUGUN_BASI });

    expect(res.inWindow).toBe(2);
    expect(res.fetched).toBe(4);
    expect(res.messages.map(m => m.text)).toEqual(['bugün A', 'bugün B']);
  });

  it('LİMİT DOLDUYSA ve hepsi aralıktaysa kesinti bildirilir', async () => {
    // "Bugün 3 mesaj var" diyemeyiz: limit 3'tü ve üçü de doldu, dördüncüsü
    // olabilir. Sessiz kalmak eksik kapsamı tam gibi göstermek olurdu.
    writeConfig();
    const reader = makeReader({
      '111': [
        msg(1, '2026-08-15T09:00:00Z', 'a'),
        msg(2, '2026-08-15T08:00:00Z', 'b'),
        msg(3, '2026-08-15T07:00:00Z', 'c'),
      ],
    });

    const res = await reader.readChannelMessages('111', 3, { sinceIso: BUGUN_BASI });
    expect(res.truncated).toBe(true);
  });

  it('aralıkta boşluk varsa kesinti bildirilmez', async () => {
    writeConfig();
    const reader = makeReader({
      '111': [
        msg(1, '2026-08-15T09:00:00Z', 'a'),
        msg(2, '2026-08-10T08:00:00Z', 'eski'),
        msg(3, '2026-08-09T07:00:00Z', 'daha eski'),
      ],
    });

    const res = await reader.readChannelMessages('111', 3, { sinceIso: BUGUN_BASI });
    expect(res.truncated).toBe(false);
    expect(res.inWindow).toBe(1);
  });

  it('sinceIso yoksa hepsi döner', async () => {
    writeConfig();
    const reader = makeReader({ '111': [msg(1, '2020-01-01T00:00:00Z', 'çok eski')] });
    const res = await reader.readChannelMessages('111', 20, {});
    expect(res.inWindow).toBe(1);
  });
});

describe('takip listesi okuma', () => {
  it('yalnız SEÇİLİ kanallar taranır', async () => {
    writeConfig([{ id: '111', title: 'Borsa' }, { id: '222', title: 'Yatırım' }]);
    const reader = makeReader({
      '111': [msg(1, '2026-08-15T09:00:00Z', 'a')],
      '222': [msg(2, '2026-08-15T08:00:00Z', 'b')],
      '999': [msg(3, '2026-08-15T07:00:00Z', 'GÜRÜLTÜ — seçili değil')],
    });

    const digest = await reader.readSavedChannelsDigest(20, { sinceIso: BUGUN_BASI });

    expect(digest.channels).toHaveLength(2);
    expect(digest.messages.map(m => m.text)).not.toContain('GÜRÜLTÜ — seçili değil');
    expect(digest.inWindow).toBe(2);
  });

  it('SEÇİM YOKSA sessizce tüm kanallara genişlemez', async () => {
    // Kullanıcının amacı daraltmaktı; boş seçimi "hepsi" saymak tam tersi
    // olurdu. Çağıran taraf bu durumu ayırt edip kullanıcıyı yönlendirir.
    writeConfig();
    const reader = makeReader({ '111': [msg(1, '2026-08-15T09:00:00Z', 'a')] });

    const digest = await reader.readSavedChannelsDigest(20, { sinceIso: BUGUN_BASI });
    expect(digest.missingSelection).toBe(true);
    expect(digest.messages).toHaveLength(0);
  });

  it('mesajlar tarihe göre en yeniden eskiye sıralanır', async () => {
    writeConfig([{ id: '111', title: 'A' }, { id: '222', title: 'B' }]);
    const reader = makeReader({
      '111': [msg(1, '2026-08-15T06:00:00Z', 'erken')],
      '222': [msg(2, '2026-08-15T11:00:00Z', 'geç')],
    });

    const digest = await reader.readSavedChannelsDigest(20, { sinceIso: BUGUN_BASI });
    expect(digest.messages.map(m => m.text)).toEqual(['geç', 'erken']);
  });

  it('BİR KANAL DÜŞERSE diğerleri okunur ama hata SAKLANMAZ', async () => {
    writeConfig([{ id: '111', title: 'Çalışan' }, { id: 'kirik', title: 'Bozuk' }]);
    const reader = makeReader({ '111': [msg(1, '2026-08-15T09:00:00Z', 'a')] });
    const origResolve = reader._resolveChannelEntity;
    reader._resolveChannelEntity = async (ref) => {
      if (ref === 'kirik') throw new Error('Kanal bulunamadı');
      return origResolve(ref);
    };

    const digest = await reader.readSavedChannelsDigest(20, { sinceIso: BUGUN_BASI });

    expect(digest.messages).toHaveLength(1);
    const bozuk = digest.channels.find(c => c.channelId === 'kirik');
    expect(bozuk.error).toMatch(/bulunamadı/);
  });
});

describe('arama — pencere kesmeden ÖNCE uygulanır', () => {
  it('aralık dışı eşleşmeler kotayı doldurmaz', async () => {
    // SIRA HATASI RİSKİ: eskiden `.slice(limit)` zaman filtresinden önceydi.
    // O sırayla, aralık dışındaki 2 eşleşme limit=2 kotasını doldurur ve
    // bugünün eşleşmesi hiç dönmezdi.
    writeConfig([{ id: '111', title: 'A' }]);
    const reader = makeReader({
      '111': [
        msg(1, '2026-08-01T09:00:00Z', 'THYAO eski haber'),
        msg(2, '2026-08-02T09:00:00Z', 'THYAO eski haber 2'),
        msg(3, '2026-08-15T09:00:00Z', 'THYAO bugünkü haber'),
      ],
    });

    const results = await reader.searchChannels(['111'], ['thyao'], 2, { sinceIso: BUGUN_BASI });

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('THYAO bugünkü haber');
  });

  it('pencere yoksa eski davranış korunur', async () => {
    writeConfig([{ id: '111', title: 'A' }]);
    const reader = makeReader({
      '111': [
        msg(1, '2026-08-01T09:00:00Z', 'THYAO bir'),
        msg(2, '2026-08-02T09:00:00Z', 'THYAO iki'),
      ],
    });

    const results = await reader.searchChannels(['111'], ['thyao'], 10, {});
    expect(results).toHaveLength(2);
  });
});

describe('varsayılan pencere gerçek zamanla tutarlı', () => {
  it('"bugün" penceresi dünün mesajını almaz', async () => {
    writeConfig([{ id: '111', title: 'A' }]);
    const reader = makeReader({
      '111': [
        msg(1, new Date(SIMDI).toISOString(), 'bugün'),
        msg(2, new Date(SIMDI - GUN).toISOString(), 'dün'),
      ],
    });

    const res = await reader.readChannelMessages('111', 20, { sinceIso: BUGUN_BASI });
    expect(res.messages.map(m => m.text)).toEqual(['bugün']);
  });
});
