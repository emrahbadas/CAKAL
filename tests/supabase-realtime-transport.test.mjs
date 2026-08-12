import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import transport from '../apps/desktop/electron/supabase-realtime-transport.cjs';

const {
  TRANSPORT_STATUS,
  resolveRealtimeTransport,
  buildRealtimeClientOptions,
  describeRealtimeTransport,
} = transport;

const require = createRequire(import.meta.url);

/**
 * CANLI KUSUR REGRESYONU
 *
 * Electron 31 = Node 20; global WebSocket yok, realtime-js transport ister.
 * main.cjs bunu `try { transport: require('ws') } catch (_) {}` ile çözüyordu.
 * İki bağımsız kusur vardı:
 *   1. `ws` hiçbir package.json'da BİLDİRİLMEMİŞTİ — yalnız openai@6 üzerinden
 *      transitive geliyordu. openai onu bıraksa düzeltme sessizce ölürdü.
 *   2. catch bloğu hatayı YUTUYORDU — realtime kapanır, REST çalışmaya devam
 *      eder, hiçbir sinyal çıkmaz.
 *
 * Aşağıdaki testler ikisini de kapatır. Özellikle "beyan" testi önemlidir:
 * kodun `require('ws')` yazması, `ws`'in orada olacağının kanıtı değildir.
 */

describe('ws bağımlılığı beyanı', () => {
  it('ws kök package.json içinde AÇIKÇA bildirilmiştir', () => {
    // Bu testin tek işi budur: transitive'e yaslanmayı regresyon saymak.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies?.ws).toBeTruthy();
  });

  it('ws gerçekten çözülebiliyor (beyan ile kurulum uyuşuyor)', () => {
    expect(() => require('ws')).not.toThrow();
    expect(typeof require('ws')).toBe('function');
  });
});

describe('resolveRealtimeTransport', () => {
  it('ws yüklenince OK ve constructor döner', () => {
    const result = resolveRealtimeTransport();
    expect(result.status).toBe(TRANSPORT_STATUS.OK);
    expect(typeof result.transport).toBe('function');
    expect(result.detail).toBeNull();
  });

  it('ws yoksa MISSING döner ve sebebi TAŞIR (sessiz yutma yok)', () => {
    const result = resolveRealtimeTransport({
      load: () => { throw new Error("Cannot find module 'ws'"); },
    });
    expect(result.status).toBe(TRANSPORT_STATUS.MISSING);
    expect(result.transport).toBeNull();
    expect(result.detail).toContain('ws');
  });

  it('ws beklenmedik şekil döndürürse INVALID — bağlantı anında değil şimdi yakalanır', () => {
    const result = resolveRealtimeTransport({ load: () => ({ default: class {} }) });
    expect(result.status).toBe(TRANSPORT_STATUS.INVALID);
    expect(result.transport).toBeNull();
    expect(result.detail).toContain('object');
  });
});

describe('buildRealtimeClientOptions', () => {
  it('OK durumunda createClient seçeneğini üretir', () => {
    const ws = require('ws');
    const options = buildRealtimeClientOptions({ status: TRANSPORT_STATUS.OK, transport: ws });
    expect(options).toEqual({ realtime: { transport: ws } });
  });

  it('transport yoksa BOŞ nesne döner — null geçmek supabase varsayılanını bozar', () => {
    expect(buildRealtimeClientOptions({ status: TRANSPORT_STATUS.MISSING, transport: null })).toEqual({});
    expect(buildRealtimeClientOptions(null)).toEqual({});
    expect(buildRealtimeClientOptions(undefined)).toEqual({});
  });

  it('OK olsa bile transport düşmüşse seçenek üretmez', () => {
    expect(buildRealtimeClientOptions({ status: TRANSPORT_STATUS.OK, transport: null })).toEqual({});
  });
});

describe('describeRealtimeTransport', () => {
  it('OK durumunda uyarı üretmez (gürültü yok)', () => {
    expect(describeRealtimeTransport({ status: TRANSPORT_STATUS.OK, detail: null })).toBeNull();
  });

  it('başarısızlıkta REST etkilenmediğini de söyler — yanlış panik yaratmasın', () => {
    const line = describeRealtimeTransport({ status: TRANSPORT_STATUS.MISSING, detail: 'yok' });
    expect(line).toContain('Realtime transport yok');
    expect(line).toContain('REST');
  });
});

describe('main.cjs bağlantısı', () => {
  const mainSource = readFileSync(new URL('../apps/desktop/electron/main.cjs', import.meta.url), 'utf8');

  it('main.cjs modülü kullanıyor, eski sessiz try/catch geri gelmemiş', () => {
    expect(mainSource).toContain("require('./supabase-realtime-transport.cjs')");
    // Eski hâl: transport doğrudan inline require ile alınıp hata yutuluyordu.
    expect(mainSource).not.toContain("{ transport: require('ws') }");
  });

  it('çözümleme başarısız olduğunda main.cjs uyarı yazıyor', () => {
    expect(mainSource).toContain('describeRealtimeTransport');
    expect(mainSource).toMatch(/console\.warn\(realtimeWarning\)/);
  });
});
