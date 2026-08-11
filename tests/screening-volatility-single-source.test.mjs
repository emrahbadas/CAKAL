import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import policyCore from '../packages/core/investment-research/shared/policy-core.cjs';
import { DEFAULT_SCREENING_CONFIG, runInvestmentScreening } from '../packages/core/investment-research/src/index.ts';

const {
  VOLATILITY_UNIT,
  VOLATILITY_CAPS,
  DEFAULT_VOLATILITY_CAP,
  resolveVolatilityCap,
} = policyCore;

/**
 * YOL HARİTASI ADIM 4 — iki tarama hesabını tekleştir.
 *
 * ÖLÇÜLEN VAKA: core `maximumVolatility: 35` ile ESKİ ARALIK GENİŞLİĞİ
 * semantiğindeydi; canlı taraf 2026-08-09'da günlük getiri STANDART
 * SAPMASINA geçip eşikleri 3/5/8 yaptı. Aynı koşula zıt etiket veriyorlardı
 * (`SCREENING_READY` ↔ `PARTIAL_RESEARCH`).
 *
 * TAŞIMA SIRASI KRİTİKTİ: core'un 35'i canlı tarafa taşınsaydı filtre hiçbir
 * şeyi elemezdi (std-sapma neredeyse hiç 35'i geçmez) — sessiz regresyon.
 * Bu yüzden önce DOĞRU semantik core'a taşındı, sonra canlı ona yönlendirildi.
 */

describe('volatilite semantiği tek kaynakta', () => {
  it('birim açıkça beyan edilmiş', () => {
    expect(VOLATILITY_UNIT).toBe('DAILY_RETURN_STDDEV_PCT');
  });

  it('risk toleransına göre tavanlar 3/5/8', () => {
    expect(resolveVolatilityCap('low')).toBe(3);
    expect(resolveVolatilityCap('medium')).toBe(5);
    expect(resolveVolatilityCap('high')).toBe(8);
  });

  it('bilinmeyen tolerans muhafazakâr orta yola düşer', () => {
    expect(resolveVolatilityCap(undefined)).toBe(DEFAULT_VOLATILITY_CAP);
    expect(resolveVolatilityCap('')).toBe(5);
    expect(resolveVolatilityCap('saçmalık')).toBe(5);
    expect(resolveVolatilityCap('HIGH')).toBe(8); // büyük/küçük harf duyarsız
  });

  it('core varsayılanı ESKİ birimin değerine geri dönemez', () => {
    // 35 aralık genişliği semantiğine aitti; std-sapma birimi için anlamsızdır
    // ve o değere dönmek filtreyi sessizce etkisizleştirir.
    expect(DEFAULT_SCREENING_CONFIG.maximumVolatility).toBe(DEFAULT_VOLATILITY_CAP);
    expect(DEFAULT_SCREENING_CONFIG.maximumVolatility).not.toBe(35);
    expect(DEFAULT_SCREENING_CONFIG.maximumVolatility).toBeLessThanOrEqual(10);
  });
});

describe('canlı taraf inline eşik tutmuyor', () => {
  const aiSource = fs.readFileSync(
    path.resolve('apps/desktop/electron/ai-service.cjs'),
    'utf8',
  );

  it('inline 3/5/8 üçlüsü kaldırıldı, köprü kullanılıyor', () => {
    expect(aiSource).toContain('resolveResearchVolatilityCap(mandateGuidance.mandate.riskTolerance)');
    // Eski inline üçlü koşul geri gelmemeli.
    expect(aiSource).not.toMatch(/riskTolerance === 'low'\s*\?\s*3/);
  });

  it('köprü policy-core\'a bağlanıyor', () => {
    expect(aiSource).toContain("packages/core/investment-research/shared/policy-core.cjs");
  });

  it('fallback sabitleri policy-core ile AYNI (drift koruması)', () => {
    // Paketlenmiş uygulamada yol çözümlemesi bozulursa fallback devreye girer;
    // değerleri kaynaktan sapmışsa iki hesap yine ayrışır.
    const match = aiSource.match(/FALLBACK_VOLATILITY_CAPS = Object\.freeze\(\{([^}]+)\}\)/);
    expect(match).toBeTruthy();
    const fallback = Object.fromEntries(
      match[1].split(',').map((p) => {
        const [k, v] = p.split(':').map((x) => x.trim());
        return [k, Number(v)];
      }).filter(([k]) => k),
    );
    expect(fallback).toEqual({ ...VOLATILITY_CAPS });
  });
});

describe('yeni birimle tarama davranışı', () => {
  const universe = {
    universeId: 'u-test',
    mode: 'FRESH_MARKET_SCAN',
    market: 'BIST',
    securityCount: 20,
    asOf: '2026-08-11T10:00:00.000Z',
    source: 'test',
  };

  const snapshot = (symbol, volatility, avgVolume) => ({
    symbol,
    price: 50,
    currency: 'TRY',
    changePercent: 1.2,
    ret20d: 8,
    volatility,
    avgVolume,
    volumeRatio: 1.3,
    rangePosition: 72,
    trend: 'YUKARI',
    sampleSize: 80,
    sourceEvidenceId: `ev-${symbol}`,
    dataAsOf: '2026-08-11T10:00:00.000Z',
  });

  it('tipik BIST volatilitesi (%2-4) elenmez', () => {
    const result = runInvestmentScreening({
      mode: 'FRESH_MARKET_SCAN',
      universe,
      snapshots: [snapshot('SISE.IS', 2.4, 500000)],
    });
    expect(result.researchable.map((c) => c.symbol)).toContain('SISE.IS');
  });

  it('oynak hisse (std-sapma > tavan) sert filtreden elenir', () => {
    const result = runInvestmentScreening({
      mode: 'FRESH_MARKET_SCAN',
      universe,
      snapshots: [snapshot('OYNAK.IS', 9, 500000)],
    });
    const elenen = result.eliminated.find((c) => c.symbol === 'OYNAK.IS');
    expect(elenen).toBeTruthy();
    expect(elenen.hardFilterFailures.join(' ')).toContain('Volatilite');
  });

  it('ESKİ birimde filtre hiçbir şeyi elemezdi (regresyonun kanıtı)', () => {
    // 35 tavanıyla std-sapma 9 olan hisse geçerdi — filtre etkisiz kalırdı.
    expect(9).toBeLessThan(35);
    expect(9).toBeGreaterThan(VOLATILITY_CAPS.high);
  });
});
