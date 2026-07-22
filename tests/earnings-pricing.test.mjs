import { describe, expect, it } from 'vitest';
import pricingModule from '../apps/desktop/electron/earnings-pricing.cjs';
import guardsModule from '../apps/desktop/electron/decision-guards.cjs';

const { assessEarningsPricing, PRICING_CLASSIFICATIONS } = pricingModule;
const {
  EARNINGS_PRICING_TOOL,
  detectBuySideTimingVerdict,
  evaluateEarningsPricingGate,
  hasCompletedEarningsPricingRun,
} = guardsModule;

// ── Sentetik fiyat serisi üreticisi ──
function isoDate(baseDate, offsetDays) {
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const BASE = '2026-01-01';

function buildBars(count, closeFn, volumeFn) {
  return Array.from({ length: count }, (_, i) => ({
    time: isoDate(BASE, i),
    close: closeFn(i),
    volume: volumeFn ? volumeFn(i) : 1_000_000,
  }));
}

// Senaryo 1 verisi: 90 gün yatay (100 TL), bilanço öncesi son 20 günde +%28
// koşu (yüksek hacim), bilanço sonrası ilk gün yüksek hacimle -%3 tepki.
function pricedInBars() {
  return buildBars(
    120,
    (i) => {
      if (i <= 90) return 100;
      if (i <= 110) return 100 + (i - 90) * 1.4; // 110'da 128
      return 124 - (i - 111) * 0.5; // bilanço sonrası düşüş
    },
    (i) => {
      if (i <= 90) return 1_000_000;
      if (i <= 110) return 2_500_000;
      return 3_500_000;
    },
  );
}

function flatIndexBars() {
  return buildBars(120, () => 3000, () => null);
}

const ANNOUNCEMENT = isoDate(BASE, 111); // bar 111 = açıklama günü, 0..110 öncesi

describe('earnings-pricing (deterministik fiyatlanma motoru)', () => {
  it('exposes the honest categorical classification set', () => {
    expect(PRICING_CLASSIFICATIONS).toContain('NOT_ASSESSED');
    expect(PRICING_CLASSIFICATIONS).toContain('INSUFFICIENT_DATA');
    expect(PRICING_CLASSIFICATIONS).toContain('LOW_EVIDENCE_OF_PRICING');
    expect(PRICING_CLASSIFICATIONS).toContain('PARTIALLY_PRICED');
    expect(PRICING_CLASSIFICATIONS).toContain('LARGELY_PRICED');
    expect(PRICING_CLASSIFICATIONS).toContain('OVEREXTENDED');
  });

  it('senaryo: güçlü fakat önceden fiyatlanmış bilanço → LARGELY_PRICED/OVEREXTENDED + dil güvenliği', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: flatIndexBars(),
      announcementDate: ANNOUNCEMENT,
    });

    expect(['LARGELY_PRICED', 'OVEREXTENDED']).toContain(result.classification);
    expect(result.mode).toBe('ANNOUNCEMENT_ANCHORED');
    expect(result.profitTakingRisk).toBe('high');
    expect(result.evidence.return20d).toBeGreaterThan(25);
    expect(result.evidence.relativeReturn20d).toBeGreaterThan(25); // endeks yatay
    expect(result.evidence.volumeExpansion).toBeGreaterThan(2);
    expect(result.evidence.postReaction.direction).toBe('negative');
    // Ölçülebilir gerekçeler cevapta gösterilmek üzere hazır olmalı
    expect(result.evidenceLines.join('\n')).toContain('20 gün');
    expect(result.evidence.scoreBreakdown.length).toBeGreaterThan(2);
    // Dil güvenliği: "güçlü alım fırsatı" yasak, uyarı zorunlu
    expect(result.constraints.forbiddenPhrases).toContain('güçlü alım fırsatı');
    expect(result.constraints.requiredWarnings.length).toBeGreaterThan(0);
    expect(result.constraints.timingVerdictAllowed).toBe(true);
  });

  it('senaryo: güçlü ve fiyatlanmamış bilanço → LOW_EVIDENCE_OF_PRICING, kısıt yok', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: buildBars(120, () => 100, () => 1_000_000),
      indexBars: flatIndexBars(),
      announcementDate: ANNOUNCEMENT,
    });

    expect(result.classification).toBe('LOW_EVIDENCE_OF_PRICING');
    expect(result.profitTakingRisk).toBe('low');
    expect(result.verdictPolicy).toBe('FRESH_CATALYST_POSSIBLE');
    expect(result.constraints.forbiddenPhrases).toHaveLength(0);
    expect(result.constraints.timingVerdictAllowed).toBe(true);
  });

  it('senaryo: konsensüs yok → beklenti sürprizi UNKNOWN, fiyatlanma yine ölçülür', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: flatIndexBars(),
      announcementDate: ANNOUNCEMENT,
      consensus: null,
    });

    expect(result.expectationSurprise).toBe('UNKNOWN');
    expect(result.expectationNote).toContain('sağlanmadı');
    // Konsensüs yokluğu fiyat verisi yokluğu ile KARIŞTIRILMAZ:
    expect(result.classification).not.toBe('INSUFFICIENT_DATA');
    expect(result.constraints.notes.join(' ')).toContain('güven seviyesi düşürülerek');
  });

  it('gerçek konsensüs verildiğinde aynen aktarılır, geçersiz değer UNKNOWN olur', () => {
    const withConsensus = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: flatIndexBars(),
      announcementDate: ANNOUNCEMENT,
      consensus: { surprise: 'above', source: 'İş Yatırım beklenti anketi' },
    });
    expect(withConsensus.expectationSurprise).toBe('above');
    expect(withConsensus.expectationSource).toBe('İş Yatırım beklenti anketi');

    const invalid = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: flatIndexBars(),
      consensus: { surprise: 'kesin çok iyi' },
    });
    expect(invalid.expectationSurprise).toBe('UNKNOWN');
  });

  it('senaryo: yetersiz fiyat verisi → INSUFFICIENT_DATA, zamanlama hükmü yasak', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: buildBars(10, () => 100, () => 1_000_000),
      indexBars: [],
      announcementDate: isoDate(BASE, 9),
    });

    expect(result.classification).toBe('INSUFFICIENT_DATA');
    expect(result.verdictPolicy).toBe('NO_TIMING_VERDICT');
    expect(result.constraints.timingVerdictAllowed).toBe(false);
    expect(result.profitTakingRisk).toBe('unknown');
  });

  it('endeks verisi yoksa göreceli getiri null kalır ama sınıflandırma yine üretilir', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: [],
      announcementDate: ANNOUNCEMENT,
    });

    expect(result.evidence.relativeReturn20d).toBeNull();
    expect(result.classification).not.toBe('INSUFFICIENT_DATA');
    expect(result.dataConfidence).not.toBe('high');
  });

  it('açıklama tarihi verilmezse güncel fiyatlama modunda çalışır', () => {
    const result = assessEarningsPricing({
      symbol: 'TEST',
      bars: pricedInBars(),
      indexBars: flatIndexBars(),
    });

    expect(result.mode).toBe('CURRENT_PRICING');
    expect(result.evidence.postReaction.direction).toBe('not_observed');
  });
});

describe('evaluateEarningsPricingGate (provenance tabanlı fiyatlanma kilidi)', () => {
  const bilancoMessage = 'THYAO bilanço açıkladı, yorumlar mısın alınır mı?';
  const buyResponse = [
    'THYAO bilançosu güçlü: net kâr yıllık %80 arttı, marjlar genişledi.',
    'Karar: AL',
  ].join('\n');

  const completedEvent = {
    type: 'tool_call',
    tool: EARNINGS_PRICING_TOOL,
    detail: 'sınıflandırma: LARGELY_PRICED (veri güveni: high, beklenti sürprizi: UNKNOWN)',
    timestamp: Date.now(),
  };

  it('bilanço kaynaklı AL hükmü + ölçüm yok → kilit devreye girer, AL nötralize edilir', () => {
    const result = evaluateEarningsPricingGate(bilancoMessage, buyResponse, []);
    expect(result).not.toBeNull();
    expect(result.status).toBe('pricing_locked');
    expect(result.response).toContain('FİYATLANMA KİLİDİ');
    expect(result.response).not.toMatch(/Karar: AL$/m);
    expect(result.response).toContain('İNCELE');
  });

  it('cevapta "önceden fiyatlanmış olabilir" YAZMASI kilidi açmaz — sadece provenance açar', () => {
    const wordyResponse = buyResponse + '\nNot: Sonuçlar önceden fiyatlanmış olabilir, bilanço öncesi getiri incelendi.';
    const result = evaluateEarningsPricingGate(bilancoMessage, wordyResponse, []);
    expect(result).not.toBeNull();
    expect(result.status).toBe('pricing_locked');
  });

  it('araç çağrılmış ama sınıflandırma üretmemişse kilit AÇILMAZ', () => {
    const incompleteEvent = {
      type: 'tool_call',
      tool: EARNINGS_PRICING_TOOL,
      detail: 'Bilanço fiyatlanma analizi: THYAO (güncel mod)',
      timestamp: Date.now(),
    };
    expect(hasCompletedEarningsPricingRun([incompleteEvent])).toBe(false);
    const result = evaluateEarningsPricingGate(bilancoMessage, buyResponse, [incompleteEvent]);
    expect(result).not.toBeNull();
  });

  it('araç çalışıp sınıflandırma ürettiyse kilit devreye girmez', () => {
    expect(hasCompletedEarningsPricingRun([completedEvent])).toBe(true);
    const result = evaluateEarningsPricingGate(bilancoMessage, buyResponse, [completedEvent]);
    expect(result).toBeNull();
  });

  it('hükümsüz bilanço yorumu serbesttir: finansal yapı yorumlanabilir', () => {
    const informational = 'THYAO bilançosunda net kâr %80 arttı, borçluluk azaldı. Marjlar güçlü görünüyor.';
    const result = evaluateEarningsPricingGate(bilancoMessage, informational, []);
    expect(result).toBeNull();
  });

  it('"güçlü alım fırsatı" gibi fırsat dili de zamanlama hükmü sayılır', () => {
    expect(detectBuySideTimingVerdict('Bu bilanço sonrası hisse güçlü fırsat sunuyor.')).toBe(true);
    const result = evaluateEarningsPricingGate(
      bilancoMessage,
      'Bilanço mükemmel, bu bir alım fırsatı.',
      [],
    );
    expect(result).not.toBeNull();
  });

  it('SAT hükmü fiyatlanma kilidini tetiklemez (kilit alım tarafına özeldir)', () => {
    const result = evaluateEarningsPricingGate(bilancoMessage, 'Karar: SAT — marjlar eriyor.', []);
    expect(result).toBeNull();
  });

  it('bilanço bağlamı olmayan finans mesajında devreye girmez', () => {
    const result = evaluateEarningsPricingGate('dolar ne olur?', 'Karar: AL', []);
    expect(result).toBeNull();
  });

  it('ürün/pazaryeri mesajında devreye girmez', () => {
    const result = evaluateEarningsPricingGate(
      'trendyol ürün bilanço fırsatı',
      'Bu ürün alım fırsatı.',
      [],
    );
    expect(result).toBeNull();
  });
});
