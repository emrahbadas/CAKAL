import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const funnel = require(path.join(here, '..', 'apps', 'desktop', 'electron', 'candidate-funnel.cjs'));

const {
  FUNNEL_VERDICTS,
  STAGE_REJECTION_REASONS,
  createFunnel,
  recordStage,
  recordEvidence,
  recordScores,
  finalizeFunnel,
  stageCounts,
  rejectionReasonCodes,
  dataGapDropouts,
  candidateLineage,
  buildFunnelEvidence,
  validateFunnelEvidence,
  verifyAnswerSymbols,
} = funnel;

function newFunnel(overrides = {}) {
  return createFunnel({
    funnelId: 'fnl-test-1',
    configVersion: 'balanced_swing_v1',
    strategyProfile: 'balanced_swing',
    asOf: '2026-08-10T18:10:00+03:00',
    marketSession: 'CLOSED',
    universeHash: 'sha256:deadbeef',
    maxCandidates: 5,
    ...overrides,
  });
}

/** 4 sembollük tam huni: evren → uygunluk → ön tarama → havuz → derin → kapı. */
function runFullFunnel(f) {
  recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN', 'THYAO', 'MCARD', 'ISGSY'] });
  recordStage(f, {
    stage: 'ELIGIBILITY',
    kept: ['BRSAN', 'THYAO', 'MCARD'],
    dropped: [{ symbol: 'ISGSY', reason: 'INSUFFICIENT_LIQUIDITY', detail: '20g medyan TL hacmi taban altı' }],
  });
  recordStage(f, {
    stage: 'CHEAP_SCREEN',
    kept: ['BRSAN', 'THYAO'],
    dropped: [{ symbol: 'MCARD', reason: 'BELOW_SCREEN_CUTOFF' }],
  });
  recordStage(f, { stage: 'RESEARCH_POOL', kept: ['BRSAN', 'THYAO'] });
  recordStage(f, {
    stage: 'DEEP_RESEARCH',
    kept: ['BRSAN'],
    dropped: [{ symbol: 'THYAO', reason: 'SOURCE_FAILED', detail: 'İş Yatırım 429' }],
  });
  recordStage(f, { stage: 'FINAL_GATE', kept: ['BRSAN'] });
  return f;
}

describe('huni açılışı', () => {
  it('zorunlu alan eksikse huni açılmaz', () => {
    expect(() => createFunnel({ funnelId: 'x' })).toThrow(/zorunlu alanlar eksik/);
  });

  it('universeHash ve configVersion zorunludur (yeniden üretilebilirlik)', () => {
    expect(() => createFunnel({
      funnelId: 'x', strategyProfile: 'p', asOf: 'a', marketSession: 'CLOSED',
    })).toThrow(/configVersion/);
  });
});

describe('kademe grameri', () => {
  it('kademeler sırayla kaydedilmeli', () => {
    const f = newFunnel();
    expect(() => recordStage(f, { stage: 'CHEAP_SCREEN', kept: ['BRSAN'] }))
      .toThrow(/Kademe sırası bozuk/);
  });

  it('bilinmeyen kademe reddedilir', () => {
    const f = newFunnel();
    expect(() => recordStage(f, { stage: 'MAGIC', kept: [] })).toThrow(/Bilinmeyen kademe/);
  });

  // Huninin tüm denetlenebilirliği buna dayanır.
  it('gerekçesiz kaybolan sembol hata verir — sessiz eleme yasak', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN', 'THYAO'] });
    expect(() => recordStage(f, { stage: 'ELIGIBILITY', kept: ['BRSAN'] }))
      .toThrow(/gerekçesiz kayboldu/);
  });

  it('gerekçe kodu boş olamaz', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN', 'THYAO'] });
    expect(() => recordStage(f, {
      stage: 'ELIGIBILITY', kept: ['BRSAN'], dropped: [{ symbol: 'THYAO' }],
    })).toThrow(/gerekçesiz elendi/);
  });

  it('gerekçe kodu kademeye ait olmalı', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN', 'THYAO'] });
    // SCORE_BELOW_THRESHOLD FINAL_GATE kodudur, uygunluk kademesinde yazılamaz.
    expect(() => recordStage(f, {
      stage: 'ELIGIBILITY', kept: ['BRSAN'], dropped: [{ symbol: 'THYAO', reason: 'SCORE_BELOW_THRESHOLD' }],
    })).toThrow(/geçersiz gerekçe/);
  });

  it('huni yalnız daraltır — sonradan sembol eklenemez', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN'] });
    expect(() => recordStage(f, { stage: 'ELIGIBILITY', kept: ['BRSAN', 'ASELS'] }))
      .toThrow(/önceki kademede olmayan sembol/);
  });

  it('sembol .IS eki ve küçük harften bağımsız eşleşir', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['brsan.is', 'THYAO'] });
    expect(f.stages[0].kept).toEqual(['BRSAN', 'THYAO']);
  });
});

describe('nihai liste', () => {
  it('kota doldurmaz — geçen kaç taneyse o kadar döner', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    expect(f.finalCandidates).toEqual(['BRSAN']);
    expect(f.verdict).toBe(FUNNEL_VERDICTS.CANDIDATES_FOUND);
  });

  it('hiçbiri geçmezse NO_CANDIDATE geçerli bir sonuçtur', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN'] });
    recordStage(f, { stage: 'ELIGIBILITY', kept: ['BRSAN'] });
    recordStage(f, { stage: 'CHEAP_SCREEN', kept: ['BRSAN'] });
    recordStage(f, { stage: 'RESEARCH_POOL', kept: ['BRSAN'] });
    recordStage(f, { stage: 'DEEP_RESEARCH', kept: ['BRSAN'] });
    recordStage(f, {
      stage: 'FINAL_GATE', kept: [],
      dropped: [{ symbol: 'BRSAN', reason: 'CONFIDENCE_BELOW_THRESHOLD' }],
    });
    finalizeFunnel(f);
    expect(f.verdict).toBe(FUNNEL_VERDICTS.NO_CANDIDATE);
    expect(f.finalCandidates).toEqual([]);
  });

  it('maxCandidates tavandır, hedef değil', () => {
    const f = newFunnel({ maxCandidates: 2 });
    recordStage(f, { stage: 'UNIVERSE', kept: ['A1', 'B2', 'C3'] });
    recordStage(f, { stage: 'ELIGIBILITY', kept: ['A1', 'B2', 'C3'] });
    recordStage(f, { stage: 'CHEAP_SCREEN', kept: ['A1', 'B2', 'C3'] });
    recordStage(f, { stage: 'RESEARCH_POOL', kept: ['A1', 'B2', 'C3'] });
    recordStage(f, { stage: 'DEEP_RESEARCH', kept: ['A1', 'B2', 'C3'] });
    recordStage(f, { stage: 'FINAL_GATE', kept: ['A1', 'B2', 'C3'] });
    finalizeFunnel(f);
    expect(f.finalCandidates).toEqual(['A1', 'B2']);
  });

  it('FINAL_GATE tamamlanmadan kapatılırsa BLOCKED', () => {
    const f = newFunnel();
    recordStage(f, { stage: 'UNIVERSE', kept: ['BRSAN'] });
    finalizeFunnel(f);
    expect(f.verdict).toBe(FUNNEL_VERDICTS.BLOCKED);
  });
});

describe('raporlama ve denetim', () => {
  it('kademe sayıları 4 → 3 → 2 → 2 → 1 → 1 zincirini verir', () => {
    const f = runFullFunnel(newFunnel());
    expect(stageCounts(f).map((s) => s.kept)).toEqual([4, 3, 2, 2, 1, 1]);
  });

  it('gerekçe kodları kademesiyle birlikte sayılır', () => {
    const f = runFullFunnel(newFunnel());
    expect(rejectionReasonCodes(f)).toEqual({
      'ELIGIBILITY:INSUFFICIENT_LIQUIDITY': 1,
      'CHEAP_SCREEN:BELOW_SCREEN_CUTOFF': 1,
      'DEEP_RESEARCH:SOURCE_FAILED': 1,
    });
  });

  // Kaynak çökmesi kalite hükmü değildir — ayrı sayılmazsa "İş Yatırım limit
  // verdi" sessizce "bu hisse elendi"ye dönüşür.
  it('veri yokluğundan elenenler kalite elemesinden ayrı raporlanır', () => {
    const f = runFullFunnel(newFunnel());
    const gaps = dataGapDropouts(f);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ symbol: 'THYAO', reason: 'SOURCE_FAILED' });
    // Likidite elemesi kalite hükmüdür, veri boşluğu değil.
    expect(gaps.some((g) => g.symbol === 'ISGSY')).toBe(false);
  });

  it('soy zinciri elenen sembolün nerede düştüğünü gösterir', () => {
    const f = runFullFunnel(newFunnel());
    const lineage = candidateLineage(f, 'MCARD');
    expect(lineage.path.at(-1)).toMatchObject({ stage: 'CHEAP_SCREEN', result: 'DROPPED', reason: 'BELOW_SCREEN_CUTOFF' });
  });

  it('geçen sembolün soy zinciri tüm kademeleri PASS gösterir', () => {
    const f = runFullFunnel(newFunnel());
    const lineage = candidateLineage(f, 'BRSAN');
    expect(lineage.path).toHaveLength(6);
    expect(lineage.path.every((step) => step.result === 'PASS')).toBe(true);
  });
});

describe('CANDIDATE_FUNNEL kanıt nesnesi', () => {
  it('eksiksiz huni geçerli kanıt üretir', () => {
    const f = runFullFunnel(newFunnel());
    recordScores(f, 'BRSAN', { technical: 78, fundamentals: 71, valuation: 62, confidence: 84 });
    recordEvidence(f, 'BRSAN', { evidenceClass: 'FUNDAMENTALS', toolName: 'get_financial_statements' });
    finalizeFunnel(f);

    const evidence = buildFunnelEvidence(f);
    expect(validateFunnelEvidence(evidence)).toEqual({ valid: true, errors: [] });
    expect(evidence.candidateLineage[0].scores).toMatchObject({ technical: 78 });
    expect(evidence.candidateLineage[0].evidence[0].toolName).toBe('get_financial_statements');
  });

  it('eksik alanlı kanıt reddedilir', () => {
    const result = validateFunnelEvidence({ funnelId: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('universeHash'))).toBe(true);
  });

  it('soy zinciri olmayan nihai aday reddedilir', () => {
    const result = validateFunnelEvidence({
      funnelId: 'x', configVersion: 'v', strategyProfile: 'p', asOf: 'a',
      marketSession: 'CLOSED', universeHash: 'h', verdict: 'CANDIDATES_FOUND',
      stageCounts: [], rejectionReasonCodes: {}, evidenceRefs: {},
      finalCandidates: ['BRSAN'], candidateLineage: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('soy zinciri yok'))).toBe(true);
  });
});

describe('model listeyi değiştiremez kapısı', () => {
  it('huniden geçmiş adayı anlatan cevap geçerlidir', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    const check = verifyAnswerSymbols(f, 'Tek aday BRSAN — likidite ve teknik skor yeterli.');
    expect(check).toEqual({ valid: true, invented: [], omitted: [] });
  });

  it('elenen sembolü aday gibi sunan cevap yakalanır', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    const check = verifyAnswerSymbols(f, 'Adaylar: BRSAN ve MCARD.');
    expect(check.valid).toBe(false);
    expect(check.invented).toEqual(['MCARD']);
  });

  it('nihai adayı yutan cevap yakalanır', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    const check = verifyAnswerSymbols(f, 'Bugün kriterleri karşılayan aday yok.');
    expect(check.valid).toBe(false);
    expect(check.omitted).toEqual(['BRSAN']);
  });

  // Projede iki kez yaşanan tuzak: büyük harfli her dizi sembol değildir.
  it('BIST/XU100 gibi büyük harfli kelimeler aday iddiası sayılmaz', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    const check = verifyAnswerSymbols(f, 'BIST evreninde XU100 dışından tek aday: BRSAN. Kaynak KAP.');
    expect(check.valid).toBe(true);
  });

  it('huni evreninde olmayan büyük harfli kelime uydurma sayılmaz', () => {
    const f = runFullFunnel(newFunnel());
    finalizeFunnel(f);
    // ASELS huninin evreninde hiç yok — aday iddiası değil, serbest metin.
    const check = verifyAnswerSymbols(f, 'BRSAN öne çıktı; ASELS bu taramanın evreninde değildi.');
    expect(check.valid).toBe(true);
  });
});

describe('gerekçe kodu tablosu', () => {
  it('her kademenin kodları benzersizdir (kod iki kademeye ait olamaz)', () => {
    const seen = new Map();
    for (const [stage, codes] of Object.entries(STAGE_REJECTION_REASONS)) {
      for (const code of codes) {
        expect(seen.has(code), `${code} iki kademede: ${seen.get(code)} ve ${stage}`).toBe(false);
        seen.set(code, stage);
      }
    }
  });
});
