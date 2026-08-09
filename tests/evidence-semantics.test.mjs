// Semantik kanıt doğrulama: kanıtın MEVCUT olması ile İLGİLİ ve YETERLİ
// KAPSAMDA olması ayrı şeylerdir. Canlı testte get_bist_gainers (EMPAE,
// GIPTA, MRSHL) çalıştı, MARKET_MOVERS etiketi üretildi ve sözleşme
// THYAO/ASELS/KCHOL hakkındaki s2'yi COMPLETE saydı.
import { describe, it, expect } from 'vitest';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const { buildEvidenceLedger, evaluatePriceLevelProvenanceGate, extractQuotedPriceLevels } = guards;
const {
  createResearchRun, submitPlan, evaluateContract,
  CONTRACT_STATUS, SUB_QUESTION_STATUS, universeScopeFor,
} = contract;

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);
const ok = (data = {}) => ({ success: true, data, source: 'test' });
const TRIO = ['THYAO', 'ASELS', 'KCHOL'];

function plan(subQuestions) {
  return submitPlan(createResearchContractRun().get(), { subQuestions });
}
function createResearchContractRun() {
  return createResearchRun({ userQuestion: 'test' });
}

describe('1) Boş entities içeren named comparison planı reddedilir', () => {
  it('current_leader entities olmadan kabul edilmez', () => {
    const res = plan([{
      id: 's2', question: 'THYAO, ASELS, KCHOL guncel teknik gorunum?',
      outputKind: 'current_leader', requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
    }]);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/entities BOS BIRAKILAMAZ/);
  });

  it('comparison ve investable_candidate için de zorunlu', () => {
    for (const kind of ['comparison', 'investable_candidate']) {
      const res = plan([{ id: 'x', question: 'q', outputKind: kind, requiredEvidence: ['CURRENT_EQUITY_PRICE'] }]);
      expect(res.ok, kind).toBe(false);
      expect(res.errors.join(' ')).toMatch(/entities BOS BIRAKILAMAZ/);
    }
  });

  it('structural_leader ve thesis için zorunlu değil (evren geneli olabilir)', () => {
    const res = plan([{ id: 's1', question: 'yapisal lider', outputKind: 'structural_leader', requiredEvidence: ['INDEX_MEMBERSHIP', 'LIQUIDITY'] }]);
    expect(res.ok).toBe(true);
  });
});

describe('2) EMPAE gainers kanıtı THYAO/ASELS/KCHOL s2\'sini tamamlamaz', () => {
  it('KRİTİK — başka şirketlerin MARKET_MOVERS kaydı soruyu kapatmaz', () => {
    const run = createResearchContractRun();
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'ucunun guncel gorunumu', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: TRIO, coverage: 'ALL',
      }],
    });
    expect(res.ok).toBe(true);
    run.set(res.contract);

    // Canlı vakadaki gainers listesi — üçlüyle hiç ilgisi yok.
    run.record('get_bist_gainers', {}, ok({ items: [{ symbol: 'EMPAE' }, { symbol: 'GIPTA' }, { symbol: 'MRSHL' }] }));

    const result = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(result.status).toBe(CONTRACT_STATUS.BLOCKED);
    expect(result.subQuestions[0].missingEvidence).toEqual(
      expect.arrayContaining(['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL']),
    );
  });
});

describe('3) Yalnız THYAO kanıtı coverage:ALL şartını geçmez', () => {
  it('üç sembolden biri yeterli değil', () => {
    const run = createResearchContractRun();
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'ucu karsilastir', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: TRIO, coverage: 'ALL',
      }],
    });
    run.set(res.contract);
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));
    run.record('analyze_finance_signal', { asset: 'THYAO' }, ok({ symbol: 'THYAO' }));

    const evaluated = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    const s2 = evaluated.subQuestions[0];
    expect(s2.status).not.toBe(SUB_QUESTION_STATUS.COMPLETE);
    // Hangi sembolün eksik olduğu adıyla raporlanır.
    const miss = s2.missingByEntity.find((m) => m.evidenceClass === 'CURRENT_EQUITY_PRICE');
    expect(miss.entities.sort()).toEqual(['ASELS', 'KCHOL']);
  });

  it('coverage:ANY ile tek sembol yeterli olur', () => {
    const run = createResearchContractRun();
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'herhangi biri', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: TRIO, coverage: 'ANY',
      }],
    });
    run.set(res.contract);
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));
    run.record('analyze_finance_signal', { asset: 'THYAO' }, ok({ symbol: 'THYAO' }));
    const evaluated = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(evaluated.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });
});

describe('4) Üçü de gainers listesindeyse bile MARKET_MOVERS teknik gereksinimi karşılamaz', () => {
  it('KANIT GRAMERİ — MARKET_MOVERS current_leader için zorunlu kanıt yazılamaz', () => {
    // Entity eşleşmesi TESADÜFEN sağlansa bile gramer bunu baştan reddeder.
    const res = plan([{
      id: 's2', question: 'ucun relatif gucu', outputKind: 'current_leader',
      requiredEvidence: ['MARKET_MOVERS'], entities: TRIO,
    }]);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/MARKET_MOVERS/);
    expect(res.errors.join(' ')).toMatch(/SAYILMAZ/);
  });

  it('keşif kanıtı ayrı alt soruya bağlanabilir (thesis serbest)', () => {
    const res = plan([{ id: 's4', question: 'baska aday var mi', outputKind: 'thesis', requiredEvidence: ['MARKET_MOVERS'] }]);
    expect(res.ok).toBe(true);
  });
});

describe('5) BIST_ALL evreni tüm hisselerin gözlendiği anlamına gelmez', () => {
  it('evren-geneli araçlar universeScope ile işaretlenir', () => {
    expect(universeScopeFor('get_bist_gainers')).toBe('BIST_ALL_PARTIAL');
    expect(universeScopeFor('run_investment_research_scan')).toBe('BIST_ALL_PARTIAL');
    expect(universeScopeFor('get_stock_price')).toBe('ENTITY');
  });

  it('kayıt gözlenen adedi taşır — kapsam iddiası sayıyla sınırlanabilir', () => {
    const run = createResearchContractRun();
    run.record('get_bist_gainers', {}, ok({ items: [{ symbol: 'EMPAE' }, { symbol: 'GIPTA' }] }));
    const ev = run.events()[0];
    expect(ev.universeScope).toBe('BIST_ALL_PARTIAL');
    expect(ev.observedCount).toBe(2);
  });
});

describe('5b) Endeks sembolü entity sayılmaz — sözleşme duvara dönmez', () => {
  it('REGRESYON — XU100 entities\'ten ayrılır, benchmarks\'a geçer', () => {
    // Canlı vakada model XU100'ü relatif güç kıyası için entities'e koydu.
    // Endeks için LIQUIDITY/EARNINGS_PRICE_REACTION üreten araç yok →
    // s2 sonsuza kadar PARTIAL kalıyordu.
    const run = createResearchContractRun();
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'ucun relatif gucu', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL', 'LIQUIDITY'],
        entities: [...TRIO, 'XU100'], coverage: 'ALL',
      }],
    });
    expect(res.ok).toBe(true);
    const sq = res.contract.subQuestions[0];
    expect(sq.entities).toEqual(TRIO);
    expect(sq.benchmarks).toEqual(['XU100']);
    run.set(res.contract);

    // Benchmark ŞİRKET kanıtı gerektirmez ama kendi serisini gerektirir.
    expect(sq.requiredEvidence).toContain('BENCHMARK_PRICE_SERIES');

    run.record('get_bist_board', { symbols: 'THYAO,ASELS,KCHOL' }, ok({ items: TRIO.map((s) => ({ symbol: s })) }));
    run.record('analyze_finance_signal', { asset: 'THYAO' }, ok({}));
    run.record('analyze_finance_signal', { asset: 'ASELS' }, ok({}));
    run.record('analyze_finance_signal', { asset: 'KCHOL' }, ok({}));

    // Endeks serisi gelmeden tamamlanmaz — XU100'e göre relatif güç iddiası
    // ölçümsüz kalamaz.
    let evaluated = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(evaluated.subQuestions[0].missingEvidence).toContain('BENCHMARK_PRICE_SERIES');
    // Ama XU100 için LIQUIDITY istenmiyor — duvar yok.
    expect(evaluated.subQuestions[0].missingEvidence).not.toContain('LIQUIDITY');

    run.record('analyze_earnings_pricing', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    evaluated = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(evaluated.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });
});

describe('6) Piyasa seansı durumu kanıt sınıfıdır', () => {
  it('"bugün alınabilir mi" sorusu MARKET_SESSION_STATUS olmadan tamamlanmaz', () => {
    const run = createResearchContractRun();
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's3', question: 'bugun alinabilir mi', outputKind: 'investable_candidate',
        requiredEvidence: ['FUNDAMENTALS'], entities: ['THYAO'],
      }],
    });
    expect(res.ok).toBe(true);
    // Asgari set otomatik dayatılır.
    expect(res.contract.subQuestions[0].requiredEvidence).toContain('MARKET_SESSION_STATUS');
    run.set(res.contract);

    run.record('get_financial_statements', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    run.record('get_valuation_multiples', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));

    const evaluated = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(evaluated.subQuestions[0].missingEvidence).toContain('MARKET_SESSION_STATUS');
    expect(evaluated.subQuestions[0].repairTools).toContain('get_bist_board');
  });

  it('get_bist_board seans durumunu üretir', () => {
    const run = createResearchContractRun();
    run.record('get_bist_board', { symbols: 'THYAO' }, ok({ items: [{ symbol: 'THYAO' }] }));
    const ledger = buildEvidenceLedger(run.events(), Date.now());
    expect(ledger.has('MARKET_SESSION_STATUS')).toBe(true);
  });
});

describe('7) Footer\'daki MARKET_MOVERS ticker olarak algılanmaz', () => {
  it('sistem blokları taranmaz', () => {
    const answer = [
      '## KCHOL',
      'Genel görünüm olumlu.',
      '',
      '---',
      '📋 ARAŞTIRMA SÖZLEŞMESİ KAPSAMI (deterministik, plan v1): PARTIAL',
      '◐ [s2] güncel görünüm (current_leader): PARTIAL — eksik: MARKET_MOVERS',
      'Bloke alt sorular için hüküm verilmedi. giriş: 194.50 araçları: get_bist_gainers.',
    ].join('\n');
    expect([...extractQuotedPriceLevels(answer).keys()]).not.toContain('MARKET');
    expect(evaluatePriceLevelProvenanceGate('borsa', answer, [], NOW)).toBeNull();
  });

  it('"giriş kalitesi" gibi niteliksel ifade seviye sayılmaz', () => {
    const answer = '## THYAO\nBugün giriş kalitesi zayıf, teyit beklenir.';
    expect(extractQuotedPriceLevels(answer).size).toBe(0);
  });
});

describe('8) Ledger\'da olmayan gerçek sembol için sayısal stop yakalanır', () => {
  it('GARAN için ölçüm yokken somut stop verilirse kapı tetiklenir', () => {
    const answer = [
      '## GARAN',
      'Hüküm: İNCELE',
      '- Geçersizlik / stop bölgesi: ₺122.40 altı kapanış',
    ].join('\n');
    const events = [{ type: 'tool_call', tool: 'analyze_finance_signal', entities: ['THYAO'], timestamp: NOW }];
    const lock = evaluatePriceLevelProvenanceGate('borsada GARAN', answer, events, NOW);
    expect(lock).not.toBeNull();
    expect(lock.unsupportedSymbols).toEqual(['GARAN']);
  });

  it('GARAN için ölçüm varsa serbest', () => {
    const answer = '## GARAN\n- stop bölgesi: ₺122.40 altı kapanış';
    const events = [{ type: 'tool_call', tool: 'analyze_finance_signal', entities: ['GARAN'], timestamp: NOW }];
    expect(evaluatePriceLevelProvenanceGate('borsada GARAN', answer, events, NOW)).toBeNull();
  });
});
