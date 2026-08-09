// ChatGPT'nin dokuz maddelik yaşam-döngüsü test listesi + canlı testte
// yakalanan iki kusurun regresyonu. Her test adı hangi riski kapattığını yazar.
import { describe, it, expect } from 'vitest';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const {
  buildEvidenceLedger,
  hasFreshEvidence,
  hasFreshEvidenceForEntity,
  entitiesWithEvidence,
  evaluatePriceLevelProvenanceGate,
  extractQuotedPriceLevels,
} = guards;

const {
  createResearchRun,
  submitPlan,
  evaluateContract,
  extractEntities,
  CONTRACT_STATUS,
  SUB_QUESTION_STATUS,
} = contract;

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);
const ago = (min) => NOW - min * 60000;

const ok = (data = {}, source = 'test') => ({ success: true, data, source });

function planWith(subQuestions) {
  const run = createResearchRun({ userQuestion: 'test' });
  const res = submitPlan(run.get(), { subQuestions });
  expect(res.ok).toBe(true);
  run.set(res.contract);
  return run;
}

describe('1) Aynı araştırmanın retry turları kanıtı koruyor mu?', () => {
  it('koşu nesnesi turlar arasında kanıtı biriktirir', () => {
    const run = createResearchRun({ userQuestion: 'amiral gemisi' });
    // Tur 1
    run.record('get_bist_board', { symbols: 'THYAO,KCHOL' }, ok({ items: [{ symbol: 'THYAO' }, { symbol: 'KCHOL' }] }));
    expect(run.size()).toBe(1);
    // Tur 2 (onarım turu — ayrı chat() çağrısı, aynı koşu)
    run.record('get_financial_statements', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    expect(run.size()).toBe(2);

    const ledger = buildEvidenceLedger(run.events(), Date.now());
    expect(hasFreshEvidenceForEntity(ledger, 'INDEX_MEMBERSHIP', 'THYAO')).toBe(true);
    expect(hasFreshEvidenceForEntity(ledger, 'FUNDAMENTALS', 'THYAO')).toBe(true);
  });

  it('REGRESYON — get_bist_board çalıştıysa s1 bloke görünmez', () => {
    // Canlı testte "Sözleşme kapanışı: PARTIAL — cevaplanabilir: yok; bloke: s1"
    // çıkmıştı; çünkü kanıt bir önceki chat() turunda kalmıştı.
    const run = planWith([
      { id: 's1', question: 'yapisal lider', outputKind: 'structural_leader', requiredEvidence: ['INDEX_MEMBERSHIP', 'LIQUIDITY'], entities: ['THYAO'] },
    ]);
    run.record('get_bist_board', { symbols: 'THYAO' }, ok({ items: [{ symbol: 'THYAO' }] }));

    const result = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(result.status).toBe(CONTRACT_STATUS.COMPLETE);
    expect(result.blockedIds).toEqual([]);
  });
});

describe('2) Farklı kullanıcı sorgularına kanıt sızıyor mu?', () => {
  it('yeni koşu önceki koşunun kanıtını devralmaz', () => {
    const first = createResearchRun({ userQuestion: 'THYAO analiz' });
    first.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));

    const second = createResearchRun({ userQuestion: 'ASELS analiz' });
    expect(second.size()).toBe(0);
    expect(second.runId).not.toBe(first.runId);

    const ledger = buildEvidenceLedger(second.events(), Date.now());
    expect(hasFreshEvidence(ledger, 'CURRENT_EQUITY_PRICE')).toBe(false);
  });
});

describe('3) Sembol ve kanıt sınıfı doğru eşleşiyor mu?', () => {
  it('KRİTİK — THYAO fiyatı KCHOL alt sorusunu tatmin ETMEZ', () => {
    const run = planWith([
      { id: 's1', question: 'KCHOL teknik', outputKind: 'current_leader', requiredEvidence: ['CURRENT_EQUITY_PRICE'], entities: ['KCHOL'] },
    ]);
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));

    const ledger = buildEvidenceLedger(run.events(), Date.now());
    expect(hasFreshEvidence(ledger, 'CURRENT_EQUITY_PRICE')).toBe(true);          // sınıf düzeyinde var
    expect(hasFreshEvidenceForEntity(ledger, 'CURRENT_EQUITY_PRICE', 'KCHOL')).toBe(false); // ama KCHOL için yok

    const result = evaluateContract(run.get(), ledger, Date.now());
    expect(result.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.BLOCKED);
  });

  it('çok sembollü alt soruda TEK sembolün kanıtı yetmez', () => {
    const run = planWith([
      { id: 's1', question: 'ucu karsilastir', outputKind: 'comparison', requiredEvidence: ['CURRENT_EQUITY_PRICE'], entities: ['THYAO', 'ASELS', 'KCHOL'] },
    ]);
    run.record('get_stock_price', { symbols: 'THYAO,ASELS' }, ok({ stocks: [{ symbol: 'THYAO' }, { symbol: 'ASELS' }] }));
    let result = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(result.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.BLOCKED);

    run.record('get_stock_price', { symbols: 'KCHOL' }, ok({ stocks: [{ symbol: 'KCHOL' }] }));
    result = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(result.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });

  it('.IS uzantısı ve küçük harf normalize edilir', () => {
    const ledger = buildEvidenceLedger([
      { type: 'tool_call', tool: 'get_stock_price', entities: ['thyao.is'], timestamp: NOW },
    ], NOW);
    expect(hasFreshEvidenceForEntity(ledger, 'CURRENT_EQUITY_PRICE', 'THYAO', NOW)).toBe(true);
  });
});

describe('4) Eski fiyat güncel fiyat gereksinimini yanlışlıkla karşılıyor mu?', () => {
  it('REGRESYON — 40 dk önceki fiyat taze sayılmaz (TTL 15 dk)', () => {
    // Eski kod kapanışta her olaya Date.now() damgalıyordu; TTL hiç işlemiyordu.
    const ledger = buildEvidenceLedger([
      { type: 'tool_call', tool: 'get_stock_price', entities: ['THYAO'], timestamp: ago(40) },
    ], NOW);
    expect(hasFreshEvidenceForEntity(ledger, 'CURRENT_EQUITY_PRICE', 'THYAO', NOW)).toBe(false);
  });

  it('bilanço 40 dk sonra hâlâ taze (TTL 90 gün) — sınıfa göre TTL', () => {
    const ledger = buildEvidenceLedger([
      { type: 'tool_call', tool: 'get_financial_statements', entities: ['THYAO'], timestamp: ago(40) },
    ], NOW);
    expect(hasFreshEvidenceForEntity(ledger, 'FUNDAMENTALS', 'THYAO', NOW)).toBe(true);
  });
});

describe('5) Başarısız tool çağrısı kanıt olarak yazılıyor mu?', () => {
  it('success:false kanıt üretmez', () => {
    const run = createResearchRun();
    run.record('get_stock_price', { symbols: 'XXXX' }, { success: false, message: 'Sembol tanınmadı' });
    expect(run.size()).toBe(0);
  });

  it('kanıt üretmeyen araç deftere yazılmaz', () => {
    const run = createResearchRun();
    run.record('send_telegram', { text: 'x' }, ok({}));
    expect(run.size()).toBe(0);
  });
});

describe('6) Cache hit gerçek kanıt olayına dönüşüyor mu?', () => {
  it('cache isabetli sonuç da kanıt sayılır ve asOf korunur', () => {
    const run = createResearchRun();
    run.record('get_bist_board', { symbols: 'THYAO' }, ok({
      items: [{ symbol: 'THYAO' }],
      metadata: { lastTradeTime: '18:10', fetchedAt: '2026-08-07T15:10:00Z' },
    }));
    expect(run.size()).toBe(1);
    expect(run.events()[0].asOf).toBe('18:10');
  });
});

describe('7) Aynı kanıt tekrar geldiğinde ledger şişiyor mu?', () => {
  it('defter sınıf başına tek kayıt tutar, en tazesi kazanır', () => {
    const ledger = buildEvidenceLedger([
      { type: 'tool_call', tool: 'get_stock_price', entities: ['THYAO'], timestamp: ago(30) },
      { type: 'tool_call', tool: 'get_stock_price', entities: ['THYAO'], timestamp: ago(2) },
      { type: 'tool_call', tool: 'get_stock_price', entities: ['THYAO'], timestamp: ago(10) },
    ], NOW);
    expect(entitiesWithEvidence(ledger, 'CURRENT_EQUITY_PRICE')).toEqual(['THYAO']);
    // En taze kayıt (2 dk) esas alınır, en eski değil.
    expect(hasFreshEvidenceForEntity(ledger, 'CURRENT_EQUITY_PRICE', 'THYAO', NOW)).toBe(true);
  });
});

describe('8) Plan değişirse eski kanıtlar hâlâ uygun mu?', () => {
  it('amendment sonrası toplanmış kanıt geçerliliğini korur', () => {
    const run = planWith([
      { id: 's1', question: 'temel', outputKind: 'thesis', requiredEvidence: ['FUNDAMENTALS'], entities: ['THYAO'] },
    ]);
    run.record('get_financial_statements', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));

    const amended = contract.amendPlan(run.get(), {
      reason: 'KAP erisilemedi, alternatif kaynak',
      addSubQuestions: [{ id: 's2', question: 'fiyat', outputKind: 'current_leader', requiredEvidence: ['CURRENT_EQUITY_PRICE'], entities: ['THYAO'] }],
    });
    expect(amended.ok).toBe(true);
    run.set(amended.contract);

    const result = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(result.answerableIds).toEqual(['s1']);   // eski kanıt hâlâ geçerli
    expect(result.blockedIds).toEqual(['s2']);      // yeni soru henüz kanıtsız
  });
});

describe('9) Paralel iki araştırmanın ledger\'ları karışıyor mu?', () => {
  it('iki koşu birbirinin kanıtını görmez', () => {
    const a = createResearchRun({ userQuestion: 'A' });
    const b = createResearchRun({ userQuestion: 'B' });
    a.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));
    b.record('get_stock_price', { symbols: 'ASELS' }, ok({ stocks: [{ symbol: 'ASELS' }] }));

    const la = buildEvidenceLedger(a.events(), Date.now());
    const lb = buildEvidenceLedger(b.events(), Date.now());
    expect(hasFreshEvidenceForEntity(la, 'CURRENT_EQUITY_PRICE', 'THYAO')).toBe(true);
    expect(hasFreshEvidenceForEntity(la, 'CURRENT_EQUITY_PRICE', 'ASELS')).toBe(false);
    expect(hasFreshEvidenceForEntity(lb, 'CURRENT_EQUITY_PRICE', 'ASELS')).toBe(true);
    expect(hasFreshEvidenceForEntity(lb, 'CURRENT_EQUITY_PRICE', 'THYAO')).toBe(false);
    expect(a.events().every((e) => e.researchRunId === a.runId)).toBe(true);
  });
});

describe('Entity çıkarımı', () => {
  it('args ve sonuçtan sembolleri toplar', () => {
    expect(extractEntities({ symbols: 'THYAO, ASELS' })).toEqual(['THYAO', 'ASELS']);
    expect(extractEntities({ asset: 'kchol.is' })).toEqual(['KCHOL']);
    expect(extractEntities({}, ok({ items: [{ symbol: 'SISE' }, { symbol: 'BIMAS' }] }))).toEqual(['SISE', 'BIMAS']);
  });
});

describe('Seviye provenance kilidi', () => {
  const answer = [
    '## KCHOL',
    'Hüküm: İNCELE',
    '- Mantıklı giriş bölgesi: ₺194 – ₺199',
    '- Geçersizlik / stop bölgesi: ₺182.1 altı kapanış',
  ].join('\n');

  it('cevaptan sembol → seviye eşleşmesini çıkarır', () => {
    const levels = extractQuotedPriceLevels(answer);
    expect([...levels.keys()]).toContain('KCHOL');
  });

  it('REGRESYON — ölçüm yoksa seviye hükmü indirilir', () => {
    const lock = evaluatePriceLevelProvenanceGate('borsada KCHOL alım', answer, [], NOW);
    expect(lock).not.toBeNull();
    expect(lock.unsupportedSymbols).toContain('KCHOL');
    expect(lock.response).toMatch(/SEVİYE PROVENANCE KİLİDİ/);
    expect(lock.response).toMatch(/İNCELE/);
  });

  it('o sembol için ölçüm varsa seviye serbest', () => {
    const events = [{ type: 'tool_call', tool: 'analyze_finance_signal', entities: ['KCHOL'], timestamp: NOW }];
    expect(evaluatePriceLevelProvenanceGate('borsada KCHOL alım', answer, events, NOW)).toBeNull();
  });

  it('BAŞKA sembolün ölçümü seviyeyi meşrulaştırmaz', () => {
    const events = [{ type: 'tool_call', tool: 'analyze_finance_signal', entities: ['THYAO'], timestamp: NOW }];
    const lock = evaluatePriceLevelProvenanceGate('borsada KCHOL alım', answer, events, NOW);
    expect(lock).not.toBeNull();
    expect(lock.unsupportedSymbols).toEqual(['KCHOL']);
  });

  it('REGRESYON — "MARKET" gibi başlık sözcüğünü hisse kodu sanmaz', () => {
    // Canlı testte "FRESH MARKET SCAN" başlığı yüzünden kapı
    // "Kanıtsız seviye: MARKET" diyerek yanlış tetiklenmişti.
    const withHeading = [
      '## FRESH MARKET SCAN',
      '- stop bölgesi: ₺182.1 altı kapanış',
    ].join('\n');
    expect([...extractQuotedPriceLevels(withHeading).keys()]).not.toContain('MARKET');
    expect(evaluatePriceLevelProvenanceGate('borsa', withHeading, [], NOW)).toBeNull();
  });

  it('seviye içermeyen cevaba dokunmaz', () => {
    expect(evaluatePriceLevelProvenanceGate('borsa', '## KCHOL\nGenel görünüm olumlu.', [], NOW)).toBeNull();
  });
});
