import { describe, it, expect } from 'vitest';
import contractModule from '../apps/desktop/electron/research-contract.cjs';
import guardsModule from '../apps/desktop/electron/decision-guards.cjs';

const {
  CONTRACT_STATUS,
  SUB_QUESTION_STATUS,
  PRODUCIBLE_EVIDENCE_CLASSES,
  createResearchContract,
  submitPlan,
  amendPlan,
  evaluateContract,
  requiresResearchContract,
  checkContractGate,
  countDistinctTickers,
  toolsProducing,
} = contractModule;

const { buildEvidenceLedger } = guardsModule;

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

/** "Amiral gemisi" sorusunun üç çıktı sınıfına bölünmüş hali. */
const TRIO = ['THYAO', 'ASELS', 'KCHOL'];

const FLAGSHIP_PLAN = {
  subQuestions: [
    { id: 's1', question: 'Yapisal endeks liderleri hangileri?', outputKind: 'structural_leader', requiredEvidence: ['INDEX_MEMBERSHIP', 'LIQUIDITY'] },
    // Sembole bağlı çıktı türlerinde entities ZORUNLU (bkz evidence-semantics).
    { id: 's2', question: 'Guncel relatif guclu liderler hangileri?', outputKind: 'current_leader', requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'], entities: TRIO },
    { id: 's3', question: 'Bugun yatirim icin dengeli olanlar hangileri?', outputKind: 'investable_candidate', requiredEvidence: ['FUNDAMENTALS', 'EARNINGS_PRICE_REACTION'], entities: TRIO },
  ],
  successCriteria: ['Her alt soru ayri sunulur', 'Yapisal lider ile alinabilirlik karistirilmaz'],
};

function planned(plan = FLAGSHIP_PLAN) {
  const result = submitPlan(createResearchContract({ userQuestion: 'BIST amiral gemileri' }), plan);
  expect(result.ok).toBe(true);
  return result.contract;
}

// Sembole bağlı alt sorular entity kanıtı ister; test olayları varsayılan
// olarak üçlünün tamamını kapsar.
function ledgerOf(entries) {
  return buildEvidenceLedger(
    entries.map(([tool, minutesAgo = 0, entities = TRIO]) => ({
      type: 'tool_call', tool, entities, timestamp: NOW - minutesAgo * 60000,
    })),
    NOW,
  );
}

describe('research-contract — plan doğrulama', () => {
  it('üreticisi olmayan kanıt sınıfını plan sunulurken reddeder', () => {
    // INDEX_WEIGHT hiçbir araç tarafından üretilmiyor. Kabul edilseydi s1
    // sonsuza kadar BLOCKED kalırdı — sözleşme duvara dönüşürdü.
    const result = submitPlan(createResearchContract(), {
      subQuestions: [
        { id: 's1', question: 'Endekste en agirlikli sirket?', outputKind: 'structural_leader', requiredEvidence: ['INDEX_WEIGHT'] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/INDEX_WEIGHT/);
    expect(result.errors.join(' ')).toMatch(/ureten hicbir arac yok/);
    expect(result.contract.planned).toBe(false);
  });

  it('MARKET_REGIME gibi üretilemeyen sınıfı da reddeder', () => {
    const result = submitPlan(createResearchContract(), {
      subQuestions: [
        { id: 's1', question: 'Piyasa rejimi ne?', outputKind: 'thesis', requiredEvidence: ['MARKET_REGIME'] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/MARKET_REGIME/);
  });

  it('üretilebilir sınıflardan kurulu planı kilitler', () => {
    const contract = planned();
    expect(contract.planned).toBe(true);
    expect(contract.planVersion).toBe(1);
    expect(contract.subQuestions).toHaveLength(3);
    expect(contract.subQuestions.map((s) => s.outputKind)).toEqual([
      'structural_leader', 'current_leader', 'investable_candidate',
    ]);
  });

  it('geçersiz outputKind reddedilir — üç çıktı sınıfı serbest metin değildir', () => {
    const result = submitPlan(createResearchContract(), {
      subQuestions: [{ id: 's1', question: 'x', outputKind: 'en_iyi_hisse', requiredEvidence: ['CURRENT_EQUITY_PRICE'] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/outputKind gecersiz/);
  });

  it('boş requiredEvidence reddedilir', () => {
    const result = submitPlan(createResearchContract(), {
      subQuestions: [{ id: 's1', question: 'x', outputKind: 'single_fact', requiredEvidence: [] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/requiredEvidence bos/);
  });

  it('plan ikinci kez sunulamaz — eksik veri görünce yeniden planlama yok', () => {
    const contract = planned();
    const again = submitPlan(contract, FLAGSHIP_PLAN);
    expect(again.ok).toBe(false);
    expect(again.errors.join(' ')).toMatch(/zaten kilitlendi/);
  });
});

describe('research-contract — kontrollü amendment', () => {
  it('gerekçesiz değişikliği reddeder', () => {
    const result = amendPlan(planned(), { subQuestionId: 's1', fallbackTools: ['web_search'] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/amendmentReason zorunlu/);
  });

  it('zorunlu kanıt kaldırılamaz — çıta indirilemez', () => {
    const result = amendPlan(planned(), {
      subQuestionId: 's3',
      reason: 'Bilanco kaynagina erisilemedi',
      requiredEvidence: ['FUNDAMENTALS'], // EARNINGS_PRICE_REACTION düşürülüyor
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Zorunlu kanit kaldirilamaz/);
    expect(result.errors.join(' ')).toMatch(/EARNINGS_PRICE_REACTION/);
  });

  it('aynı çıtaya farklı yoldan gitmeye izin verir', () => {
    const result = amendPlan(planned(), {
      subQuestionId: 's3',
      reason: 'KAP erisilemedi, sirket yatirimci iliskileri denenecek',
      fallbackTools: ['web_search', 'verify_claim'],
    });
    expect(result.ok).toBe(true);
    expect(result.contract.planVersion).toBe(2);
    expect(result.contract.subQuestions.find((s) => s.id === 's3').fallbackTools).toContain('verify_claim');
    expect(result.contract.amendments[0].reason).toMatch(/KAP erisilemedi/);
    // Çıta aynı kaldı (outputKind asgarisi dahil).
    expect(result.contract.subQuestions.find((s) => s.id === 's3').requiredEvidence)
      .toEqual(expect.arrayContaining(['FUNDAMENTALS', 'EARNINGS_PRICE_REACTION', 'VALUATION']));
  });

  it('keşif sırasında yeni alt soru eklenebilir', () => {
    const result = amendPlan(planned(), {
      reason: 'Yeni KAP bildirimi sermaye artirimi acikladi',
      addSubQuestions: [
        { id: 's4', question: 'Sermaye artiriminin seyrelme etkisi?', outputKind: 'thesis', requiredEvidence: ['FUNDAMENTALS'] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.contract.subQuestions).toHaveLength(4);
    expect(result.contract.planVersion).toBe(2);
  });

  it('eklenen alt soru da kanıt sınıfı doğrulamasından geçer', () => {
    const result = amendPlan(planned(), {
      reason: 'yeni soru',
      addSubQuestions: [{ id: 's4', question: 'x', outputKind: 'thesis', requiredEvidence: ['INDEX_WEIGHT'] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/INDEX_WEIGHT/);
  });
});

describe('research-contract — kanıt defterinden değerlendirme', () => {
  it('plan yoksa PLAN_REQUIRED döner', () => {
    const result = evaluateContract(createResearchContract(), ledgerOf([]), NOW);
    expect(result.status).toBe(CONTRACT_STATUS.PLAN_REQUIRED);
  });

  it('tüm kanıtlar tazeyse COMPLETE', () => {
    const ledger = ledgerOf([
      ['get_bist_board', 1],           // INDEX_MEMBERSHIP + LIQUIDITY + CURRENT_EQUITY_PRICE
      ['analyze_finance_signal', 1],   // TECHNICAL_SIGNAL
      ['get_financial_statements', 1], // FUNDAMENTALS
      ['analyze_earnings_pricing', 1], // EARNINGS_PRICE_REACTION
      ['get_valuation_multiples', 1],  // VALUATION (outputKind asgarisi)
    ]);
    const result = evaluateContract(planned(), ledger, NOW);
    expect(result.status).toBe(CONTRACT_STATUS.COMPLETE);
    expect(result.blockedIds).toEqual([]);
  });

  it('KRİTİK — mali tablo VALUATION yerine geçmez, investable_candidate COMPLETE olmaz', () => {
    // Canlı testte s3 "değerleme" istiyordu, kanıt olarak FUNDAMENTALS yazılmıştı
    // ve mali tablo gelince COMPLETE sayıldı — cevabın kendisi ise
    // "değerleme katmanı tam değil" diyordu.
    const contract = planned();
    const s3 = contract.subQuestions.find((s) => s.id === 's3');
    expect(s3.requiredEvidence).toContain('VALUATION');

    const ledger = ledgerOf([
      ['get_bist_board', 1], ['analyze_finance_signal', 1],
      ['get_financial_statements', 1], ['analyze_earnings_pricing', 1],
    ]);
    const result = evaluateContract(contract, ledger, NOW);
    const evaluated = result.subQuestions.find((s) => s.id === 's3');
    expect(evaluated.status).not.toBe(SUB_QUESTION_STATUS.COMPLETE);
    expect(evaluated.missingEvidence).toContain('VALUATION');
    expect(evaluated.repairTools).toContain('get_valuation_multiples');
  });

  it('KRİTİK — eksik kanıt yalnız ilgili alt soruyu bloke eder, diğerleri cevaplanır', () => {
    // Yapısal ve güncel lider kanıtı var; temel/fiyatlanma yok.
    const ledger = ledgerOf([['get_bist_board', 1], ['analyze_finance_signal', 1]]);
    const result = evaluateContract(planned(), ledger, NOW);

    expect(result.status).toBe(CONTRACT_STATUS.PARTIAL);
    expect(result.answerableIds).toEqual(['s1', 's2']);

    // s3 kısmen karşılandı (fiyat var, temel/değerleme yok) → PARTIAL.
    // Önemli olan COMPLETE OLMAMASI: eksik katman hükmü serbest bırakmamalı.
    const s3 = result.subQuestions.find((s) => s.id === 's3');
    expect(s3.status).toBe(SUB_QUESTION_STATUS.PARTIAL);
    expect(s3.missingEvidence).toEqual(expect.arrayContaining(['FUNDAMENTALS', 'EARNINGS_PRICE_REACTION', 'VALUATION']));
    expect(result.answerableIds).not.toContain('s3');
  });

  it('onarım ipucunu tahmin etmez, kanıt haritasından türetir', () => {
    const ledger = ledgerOf([['get_bist_board', 1], ['analyze_finance_signal', 1]]);
    const result = evaluateContract(planned(), ledger, NOW);
    expect(result.repairPlan).toContain('get_financial_statements');
    expect(result.repairPlan).toContain('analyze_earnings_pricing');
    expect(toolsProducing('FUNDAMENTALS')).toEqual(['get_financial_statements']);
  });

  it('bayat fiyat kanıtı taze sayılmaz (TTL kanıt sınıfına göre)', () => {
    // CURRENT_EQUITY_PRICE TTL 15 dk; 40 dk önceki kayıt bayattır.
    // FUNDAMENTALS TTL 90 gün; aynı yaşta taze kalır.
    const ledger = ledgerOf([
      ['get_bist_board', 40],
      ['analyze_finance_signal', 40],
      ['get_financial_statements', 40],
      ['analyze_earnings_pricing', 40],
      ['get_valuation_multiples', 40],
    ]);
    const result = evaluateContract(planned(), ledger, NOW);
    const s2 = result.subQuestions.find((s) => s.id === 's2');
    const s3 = result.subQuestions.find((s) => s.id === 's3');
    // Fiyat bayat (TTL 15 dk) → hem s2 hem s3'te eksik sayılır.
    expect(s2.missingEvidence).toContain('CURRENT_EQUITY_PRICE');
    expect(s3.missingEvidence).toContain('CURRENT_EQUITY_PRICE');
    // Bilanço (90 gün) ve değerleme (6 saat) aynı yaşta hâlâ taze.
    expect(s3.satisfiedEvidence).toEqual(expect.arrayContaining(['FUNDAMENTALS', 'VALUATION']));
  });

  it('hiçbir kanıt yoksa BLOCKED', () => {
    const result = evaluateContract(planned(), ledgerOf([]), NOW);
    expect(result.status).toBe(CONTRACT_STATUS.BLOCKED);
    expect(result.answerableIds).toEqual([]);
  });
});

describe('research-contract — koşullu tetikleme', () => {
  it('tek fiyat sorusu sözleşme gerektirmez', () => {
    const result = requiresResearchContract('THYAO hissesi kaç TL?');
    expect(result.required).toBe(false);
    expect(result.score).toBeLessThan(result.threshold);
  });

  it('finans dışı mesaj hiç puanlanmaz', () => {
    const result = requiresResearchContract('bugün hava nasıl olacak');
    expect(result.required).toBe(false);
    expect(result.signals).toContain('finans baglami yok');
  });

  it('çok şirketli sıralama sorusu sözleşme gerektirir', () => {
    const result = requiresResearchContract('BIST hisseleri arasında THYAO ASELS KCHOL en sağlam 3 tanesini sırala');
    expect(result.required).toBe(true);
    expect(result.signals).toEqual(expect.arrayContaining(['coklu sirket (3)', 'siralama/karsilastirma']));
  });

  it('işlem kararı isteği tek başına eşiğe yaklaşır, piyasa geneliyle aşar', () => {
    const result = requiresResearchContract('borsada piyasayı tara ve alım fırsatı olan hisseleri ver');
    expect(result.required).toBe(true);
    expect(result.signals).toContain('islem karari');
  });

  it('portföy sorusu sözleşme gerektirir', () => {
    const result = requiresResearchContract('borsa portföyümü uzun vade için tüm verilerle değerlendir');
    expect(result.required).toBe(true);
    expect(result.signals).toEqual(expect.arrayContaining(['portfoy/sepet', 'tum veriler', 'coklu zaman ufku']));
  });

  it('sembol sayımı yaygın büyük harfli kelimeleri hisse sanmaz', () => {
    expect(countDistinctTickers('THYAO ve ASELS')).toBe(2);
    expect(countDistinctTickers('ANCAK FAKAT TOPLAM')).toBe(0);
  });
});

describe('research-contract — dispatcher kapısı', () => {
  const complex = requiresResearchContract('borsada THYAO ASELS KCHOL en iyi 3 hisseyi sırala ve alım fırsatı ver');

  it('sözleşme gerekliyken kanıt aracını plan olmadan geçirmez', () => {
    const gate = checkContractGate('get_stock_price', createResearchContract(), complex);
    expect(gate).not.toBeNull();
    expect(gate.status).toBe(CONTRACT_STATUS.PLAN_REQUIRED);
    expect(gate.allowedNextAction).toBe('submit_research_plan');
    expect(gate.producibleEvidenceClasses).toEqual(PRODUCIBLE_EVIDENCE_CLASSES);
  });

  it('planlama araçlarının kendisini engellemez — kilitlenme olmaz', () => {
    expect(checkContractGate('submit_research_plan', createResearchContract(), complex)).toBeNull();
    expect(checkContractGate('amend_research_plan', createResearchContract(), complex)).toBeNull();
  });

  it('plan kilitlendikten sonra araçlar serbest', () => {
    expect(checkContractGate('get_stock_price', planned(), complex)).toBeNull();
  });

  it('basit soruda kapı hiç devreye girmez', () => {
    const simple = requiresResearchContract('THYAO kaç TL?');
    expect(checkContractGate('get_stock_price', createResearchContract(), simple)).toBeNull();
  });

  it('kanıt üretmeyen araçları kapıya takmaz', () => {
    expect(checkContractGate('send_telegram', createResearchContract(), complex)).toBeNull();
    expect(checkContractGate('remember_user_fact', createResearchContract(), complex)).toBeNull();
  });
});
