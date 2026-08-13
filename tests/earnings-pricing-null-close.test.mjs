import { describe, it, expect } from 'vitest';

import { assessEarningsPricing } from '../apps/desktop/electron/earnings-pricing.cjs';

/**
 * CANLI HATA REGRESYONU — 13 Ağustos 2026, THYAO
 *
 * Yahoo, seansı süren veya henüz işlem görmemiş günün barını `close: null`
 * (hacim DOLU) olarak gönderiyor. `toFinite` bunu SIFIRA çeviriyordu, çünkü
 * `Number(null) === 0` ve `Number.isFinite(0) === true`. Sıfır kapanışlı bar
 * dizinin sonuncusu olduğu için ÇAPA seçiliyor ve tüm getiriler tam -%100
 * çıkıyordu; MA50 de sıfırla kirleniyordu.
 *
 * Canlı çıktı (düzeltmeden önce):
 *   - Son 5 gün: %-100
 *   - Son 20 gün: %-100
 *   - Son 60 gün: %-100
 *   - REFERANS KAPANIŞIN 50 günlük ortalamaya uzaklığı: %-100
 *
 * TEHLİKELİ KISMI: sınıflandırma yine de NOT_EXTENDED + "veri güveni: high"
 * diyordu. Çöp veriye yüksek güven etiketi; o etiket fiyatlanma kapısının
 * zamanlama hükmüne izin verip vermediğini belirliyor.
 *
 * ÇAKAL bu bozukluğu kendi cevabında bildirdi ("kanıt satırları bariz bozuk
 * görünüyor, -100% gibi anomali var") — kapı değil, model yakaladı.
 */

/** Yahoo şeklinde gerçekçi bar dizisi: sabit artışlı, son barı null kapanışlı. */
function buildBars({ count = 80, start = 300, step = 0.5, trailingNull = false } = {}) {
  const bars = [];
  const base = Date.UTC(2026, 4, 1);
  for (let i = 0; i < count; i++) {
    const time = new Date(base + i * 86400000).toISOString().slice(0, 10);
    bars.push({ time, close: start + i * step, volume: 1_000_000 + i * 1000 });
  }
  if (trailingNull) {
    const time = new Date(base + count * 86400000).toISOString().slice(0, 10);
    // Yahoo'nun gerçekte gönderdiği şekil: close null, volume DOLU.
    bars.push({ time, close: null, volume: 32_818_860 });
  }
  return bars;
}

describe('null kapanışlı son bar', () => {
  it('REGRESYON — getiriler -%100 olmuyor', () => {
    const withNull = assessEarningsPricing({ symbol: 'THYAO', bars: buildBars({ trailingNull: true }) });
    for (const key of ['return5d', 'return20d', 'return60d']) {
      expect(withNull.evidence[key], `${key} bozuk`).not.toBe(-100);
    }
    expect(withNull.evidence.distanceToMa50).not.toBe(-100);
  });

  it('null bar ELENİYOR — çapa son GEÇERLİ kapanış', () => {
    const clean = assessEarningsPricing({ symbol: 'THYAO', bars: buildBars() });
    const withNull = assessEarningsPricing({ symbol: 'THYAO', bars: buildBars({ trailingNull: true }) });
    // Null bar atıldığı için iki sonuç birebir aynı olmalı.
    expect(withNull.evidence.referenceClose).toBe(clean.evidence.referenceClose);
    expect(withNull.evidence.referenceDate).toBe(clean.evidence.referenceDate);
    expect(withNull.evidence.return20d).toBe(clean.evidence.return20d);
  });

  it('sıfır kapanış da eleniyor (ikinci savunma)', () => {
    // toFinite düzeltildi, ama kaynak GERÇEKTEN 0 gönderirse aynı zincir
    // kurulurdu. Sıfır/negatif fiyat geçerli bir kapanış değildir.
    const bars = buildBars();
    bars.push({ time: '2026-07-25', close: 0, volume: 5_000_000 });
    const out = assessEarningsPricing({ symbol: 'THYAO', bars });
    expect(out.evidence.referenceClose).toBeGreaterThan(0);
    expect(out.evidence.return20d).not.toBe(-100);
  });

  it('negatif kapanış da eleniyor', () => {
    const bars = buildBars();
    bars.push({ time: '2026-07-25', close: -12, volume: 5_000_000 });
    const out = assessEarningsPricing({ symbol: 'THYAO', bars });
    expect(out.evidence.referenceClose).toBeGreaterThan(0);
  });

  it('geçerli veri bozulmadı (kapsam daralmadı)', () => {
    const out = assessEarningsPricing({ symbol: 'THYAO', bars: buildBars() });
    expect(out.evidence.referenceClose).toBeCloseTo(300 + 79 * 0.5, 5);
    expect(out.evidence.return5d).toBeGreaterThan(0);
  });

  it('boş metin kapanış da sayı sanılmıyor', () => {
    // Number('') === 0 — aynı tuzağın kardeşi.
    const bars = buildBars();
    bars.push({ time: '2026-07-26', close: '', volume: 1000 });
    const out = assessEarningsPricing({ symbol: 'THYAO', bars });
    expect(out.evidence.referenceClose).toBeGreaterThan(0);
  });
});
