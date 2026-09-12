import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const { buildEvidenceLedger, evaluateVerdictEvidenceLock, describeContractOwnedLock } = guards;
const {
  createResearchRun, submitPlan, evaluateContract, SUB_QUESTION_STATUS, buildContractRepairRequest,
  detectUniverseClaim, evaluateUniverseCoverage,
} = contract;

/**
 * CANLI OTURUM — 12 Eylül 2026, 03:40
 *
 * Soru: "bist 100 hisselerinden kanıtları tam olan ve al sat hükmü
 * verebileceğin bir hisse var mı"
 *
 * Cevap: "BIST100 içindeki tek temiz aday AKBNK" + altında iki zıt sistem:
 *
 *   📋 SÖZLEŞME       : [s1] (investable_candidate): COMPLETE
 *   ⚖️ KARAR KİLİDİ   : Eksik kanıtlar: Değerleme çarpanı
 *
 * İki ayrı kusur:
 *   (1) Evren iddiası denetlenmiyordu — plan "BIST100 evreninde" dedi, entities
 *       alanına önceki turdan taşınan 5 sembol yazıldı, beşinin kanıtı tam
 *       olduğu için COMPLETE kapandı. BIST100'ün 95'ine hiç bakılmamıştı.
 *   (2) "Kanıt yok" ile "kanıt gösterilmedi" ayrımı yoktu — VALUATION deftere
 *       girmişti (yoksa s1 COMPLETE olamazdı), model yalnızca çarpanı cevaba
 *       yazmamıştı. Kilit bunu "eksik kanıt" diye raporladı ve onarım turu
 *       modele elindeki veriyi yeniden çektirdi.
 */

const now = Date.now();
const BIST5 = ['THYAO', 'ASELS', 'TUPRS', 'AKBNK', 'KCHOL'];

/** get_bist_board `observedCount` satır sayısıyla gelir — o turda 25'ti. */
function boardEvent(observedCount) {
  return {
    type: 'tool_call',
    tool: 'get_bist_board',
    entities: BIST5,
    timestamp: now - 60_000,
    success: true,
    data: { items: new Array(observedCount).fill({}) },
    source: 'mynet_finans_canli_borsa',
    universeScope: 'BIST_ALL_SNAPSHOT',
    observedCount,
  };
}

function entityEvents(tools, entities = BIST5) {
  const out = [];
  for (const entity of entities) {
    for (const tool of tools) {
      out.push({
        type: 'tool_call', tool, entities: [entity], timestamp: now - 60_000,
        success: true, data: { price: 1, rows: [1] }, source: 'test',
      });
    }
  }
  return out;
}

describe('evren iddiası tespiti', () => {
  const cases = [
    ['BIST100 evrenindeki adaylar hangileri?', 'BIST100'],
    ['bist 100 hisselerinden biri', 'BIST100'],
    ['XU100 içinde en güçlü', 'BIST100'],
    ['BIST30 içinde', 'BIST30'],
    ['piyasa genelinde ne var', 'BIST_ALL'],
    ['tüm BIST taransın', 'BIST_ALL'],
    ['AKBNK ve THYAO karşılaştır', null],
    ['THYAO bilançosu nasıl', null],
  ];

  for (const [soru, beklenen] of cases) {
    it(`"${soru}" → ${beklenen ?? 'iddia yok'}`, () => {
      const claim = detectUniverseClaim(soru);
      expect(claim ? claim.key : null).toBe(beklenen);
    });
  }
});

describe('evren kapsamı — defterden ölçülür', () => {
  it('REGRESYON — 25 gözlem BIST100 iddiasını karşılamaz', () => {
    const ledger = buildEvidenceLedger([boardEvent(25)], now);
    const u = evaluateUniverseCoverage('BIST100 evrenindeki adaylar', ledger);
    expect(u.observed).toBe(25);
    expect(u.claim.size).toBe(100);
    expect(u.covered).toBe(false);
  });

  it('evren yeterince gözlenmişse kapsanır', () => {
    const ledger = buildEvidenceLedger([boardEvent(628)], now);
    expect(evaluateUniverseCoverage('BIST100 evrenindeki adaylar', ledger).covered).toBe(true);
  });

  it('entity-kapsamlı araçlar evren gözlemi SAYILMAZ', () => {
    // Beş sembolün fiyatını çekmek "BIST100'e baktım" demek değildir.
    const ledger = buildEvidenceLedger(entityEvents(['get_stock_price']), now);
    const u = evaluateUniverseCoverage('BIST100 içinde en iyi hangisi', ledger);
    expect(u.observed).toBeNull();
    expect(u.covered).toBe(false);
  });

  it('evren iddiası yoksa kapı hiç çalışmaz', () => {
    const ledger = buildEvidenceLedger([boardEvent(25)], now);
    expect(evaluateUniverseCoverage('AKBNK alınır mı', ledger)).toBeNull();
  });
});

describe('sözleşme kapanışı — evren iddiası COMPLETE engelleyebilir', () => {
  function planWith(question, outputKind, requiredEvidence) {
    const run = createResearchRun({ userQuestion: 'bist 100 hisselerinden hangisi' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's1', question, outputKind, entities: BIST5, coverage: 'ALL', requiredEvidence,
      }],
    });
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
    run.set(res.contract);
    return run;
  }

  it('REGRESYON — 5 sembolün tam kanıtı "BIST100" alt sorusunu KAPATMAZ', () => {
    const run = planWith(
      'BIST100 içinden yatırım açısından girişe uygun adaylar hangileri?',
      'investable_candidate',
      ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'MARKET_SESSION_STATUS'],
    );
    const ledger = buildEvidenceLedger([
      boardEvent(25),
      ...entityEvents(['get_stock_price', 'get_valuation_multiples', 'get_financial_statements']),
    ], now);

    const coverage = evaluateContract(run.get(), ledger, now);
    const s1 = coverage.subQuestions[0];

    expect(s1.status).not.toBe(SUB_QUESTION_STATUS.COMPLETE);
    expect(s1.missingEvidence).toContain('UNIVERSE_COVERAGE:BIST100');
    expect(s1.universeClaim).toMatchObject({ key: 'BIST100', required: 100, observed: 25, covered: false });
  });

  it('evren gerçekten tarandıysa COMPLETE olur', () => {
    const run = planWith(
      'BIST100 içinden yatırım açısından girişe uygun adaylar hangileri?',
      'investable_candidate',
      ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'MARKET_SESSION_STATUS'],
    );
    const ledger = buildEvidenceLedger([
      boardEvent(628),
      ...entityEvents(['get_stock_price', 'get_valuation_multiples', 'get_financial_statements']),
    ], now);

    const s1 = evaluateContract(run.get(), ledger, now).subQuestions[0];
    expect(s1.status).toBe(SUB_QUESTION_STATUS.COMPLETE);
    expect(s1.universeClaim.covered).toBe(true);
  });

  it('KAPSAM AŞMIYOR — evren iddiası olmayan alt soru etkilenmez', () => {
    const run = planWith('AKBNK ve THYAO için fiyat karşılaştırması', 'comparison', ['CURRENT_EQUITY_PRICE']);
    const ledger = buildEvidenceLedger(entityEvents(['get_stock_price']), now);
    const s1 = evaluateContract(run.get(), ledger, now).subQuestions[0];
    expect(s1.universeClaim).toBeNull();
    expect(s1.status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });
});

describe('karar kilidi — "kanıt yok" ile "kanıt gösterilmedi" ayrımı', () => {
  const cevap = ['## Karar: AL', 'AKBNK trend yukarı, hacim destekli.'].join('\n');

  it('REGRESYON — defterdeki çarpan "toplanmadı" diye raporlanmaz', () => {
    const ledger = buildEvidenceLedger(
      entityEvents(['get_valuation_multiples'], ['AKBNK']),
      now,
    );
    const lock = evaluateVerdictEvidenceLock('AKBNK alınır mı', cevap, { ledger, now });

    expect(lock.notShown).toContain('Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)');
    expect(lock.notCollected).not.toContain('Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)');
    expect(lock.response).toContain('Toplandı ama cevapta gösterilmedi');
  });

  it('gerçekten toplanmamış kanıt "toplanmadı" kalır', () => {
    const ledger = buildEvidenceLedger(entityEvents(['get_stock_price'], ['AKBNK']), now);
    const lock = evaluateVerdictEvidenceLock('AKBNK alınır mı', cevap, { ledger, now });
    expect(lock.notCollected).toContain('Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)');
  });

  it('risk/stop bir ÖLÇÜM değildir — defter dolu olsa da "toplanmadı"', () => {
    // Defterde karşılığı yok; bunu üretmek modelin işi. "Toplandı" demek
    // modele "zaten var, yaz" dedirtirdi — olmayan bir şeyi yazamaz.
    const ledger = buildEvidenceLedger(
      entityEvents(['get_valuation_multiples', 'get_financial_statements'], ['AKBNK']),
      now,
    );
    const lock = evaluateVerdictEvidenceLock('AKBNK alınır mı', cevap, { ledger, now });
    expect(lock.notCollected).toContain('Risk seviyesi + giriş/stop veya geçersizlik koşulu');
  });

  it('GERİYE UYUMLU — defter verilmezse hepsi "toplanmadı"', () => {
    const lock = evaluateVerdictEvidenceLock('AKBNK alınır mı', cevap);
    expect(lock.notShown).toEqual([]);
    expect(lock.notCollected).toEqual(lock.missing);
    expect(lock.response).not.toContain('Toplandı ama cevapta gösterilmedi');
  });

  it('kanıt tamsa kilit hiç ateşlemez', () => {
    const tamCevap = [
      '## Karar: AL',
      'F/K 4,2 (İş Yatırım, 2026/6 ↔ 2025/6 karşılaştırması).',
      'Veri zamanı: kapanış verisi, saat 18:10.',
      'Risk seviyesi: orta. Stop: MA20 altı.',
    ].join('\n');
    const ledger = buildEvidenceLedger(entityEvents(['get_valuation_multiples'], ['AKBNK']), now);
    expect(evaluateVerdictEvidenceLock('AKBNK alınır mı', tamCevap, { ledger, now })).toBeNull();
  });
});

describe('KAPSAM AŞMIYOR — endeks adı tek başına evren iddiası değildir', () => {
  it('REGRESYON — "XU100 gore relatif guc" bir BENCHMARK referansıdır', () => {
    // İlk sürüm yalnız "XU100" geçmesine baktı ve mevcut bir testi düşürdü.
    // THYAO'nun endekse KIYASLA gücünü ölçmek, 100 üyeyi gözlemeyi
    // gerektirmez. Ayrım: kümeden SEÇİYOR muyuz, kümeye KARŞI mı ölçüyoruz?
    expect(detectUniverseClaim('XU100 gore relatif guc')).toBeNull();
    expect(detectUniverseClaim('THYAO XU100 karşısında nasıl')).toBeNull();
    expect(detectUniverseClaim('BIST100 endeksine göre performans')).toBeNull();
  });

  it('seçim dili varsa evren iddiasıdır', () => {
    for (const soru of [
      'BIST100 içinden aday seç',
      'BIST100 hisselerinden hangisi',
      'XU100 arasında en güçlü',
      'BIST100 evrenindeki likit adaylar',
    ]) {
      expect(detectUniverseClaim(soru)?.key, soru).toBe('BIST100');
    }
  });
});

/**
 * CANLI HATA REGRESYONU — sessiz fren (12 Eylül 2026)
 *
 * Araştırma sözleşmesi onarımı sahipken kapılar KENDİ tamamlama turlarını
 * açmaz — bu doğru, yoksa iki sistem aynı anda onarım yapar ve aynı cevapta
 * farklı asOf'lar karışır. Ama bu yolda hüküm indiriliyor ve HİÇ OLAY
 * YAYILMIYORDU: cevabın altında "hüküm İNCELE seviyesine indirildi" notu,
 * monitörde o saniyede hiçbir 🛑 yok.
 *
 * Kullanıcının "makine dairesi frene basmış ama LLM dinlememiş mi ne?"
 * şüphesinin bir sebebi buydu — fren çekiliyordu, izi yoktu.
 *
 * Kör nokta ÜÇ kapıdaydı (sıralama, fiyatlanma, karar kilidi); birini
 * düzeltip diğerlerini bırakmak hatanın üçte ikisini yerinde bırakırdı.
 */
describe('sessiz fren — sözleşme sahipken uygulanan kilit iz bırakır', () => {
  it('karar kilidi satırı "toplandı ama yazılmadı" ayrımını taşır', () => {
    const satir = describeContractOwnedLock('verdict', {
      missing: ['Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)'],
      notCollected: [],
      notShown: ['Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)'],
    });
    expect(satir).toContain('KARAR KİLİDİ uygulandı');
    expect(satir).toContain('toplandı ama yazılmadı');
    // Kullanıcı neden ikinci bir LLM turu görmediğini de anlamalı.
    expect(satir).toContain('ek tur AÇILMADI');
  });

  it('sıralama ve fiyatlanma kilitleri kendi etiketlerini alır', () => {
    expect(describeContractOwnedLock('ranking', { reason: 'x' })).toContain('YÖNETİLMEMİŞ SIRALAMA');
    expect(describeContractOwnedLock('pricing', { reason: 'y' })).toContain('FİYATLANMA KİLİDİ');
  });

  it('gerekçesiz kilitte bile satır üretilir (sessiz kalmaz)', () => {
    const satir = describeContractOwnedLock('bilinmeyen', {});
    expect(satir).toContain('KARAR KAPISI uygulandı');
    expect(satir).toContain('gerekçe bildirilmedi');
  });

  it('notCollected ve notShown birlikte raporlanır', () => {
    const satir = describeContractOwnedLock('verdict', {
      notCollected: ['Risk seviyesi'],
      notShown: ['Değerleme çarpanı'],
    });
    expect(satir).toContain('toplanmadı: Risk seviyesi');
    expect(satir).toContain('toplandı ama yazılmadı: Değerleme çarpanı');
  });

  it('KAYNAK KAPISI — sözleşme sahipken hiçbir kilit sessizce uygulanamaz', () => {
    // Bu test yeni bir kapının aynı kör noktayla eklenmesini engeller.
    // Eski (hatalı) kalıp: `{ response = xLock.response; xLock = null; }`
    const src = readFileSync(new URL('../apps/desktop/electron/main.cjs', import.meta.url), 'utf-8');
    const kisaDevreler = src.split(/\r?\n/).filter((l) => /&& contractOwnsRepair\) \{/.test(l));

    expect(kisaDevreler.length).toBeGreaterThan(0);
    for (const satir of kisaDevreler) {
      expect(satir, `sessiz fren: ${satir.trim()}`).toMatch(/applyContractOwnedLock\(/);
    }
  });
});

/**
 * CANLI HATA REGRESYONU — 12 Eylül 2026, 04:53 (düzeltmenin KENDİ hatası)
 *
 * Evren kapısı doğru çalıştı, s1/s2 PARTIAL kaldı — ama onarım satırı
 * "Eksik kanıtı toplayacak araçlar: yok" dedi. Kapı kapandı, anahtar
 * verilmedi.
 *
 * Sebep: UNIVERSE_COVERAGE:* bir kanıt SINIFI değil; toolsProducing onu
 * bulamıyor ve buildContractRepairRequest null dönüyordu. Kod tabanının
 * kendi uyardığı tuzağın (üreticisi olmayan zorunluluk = duvar) aynısı.
 *
 * İkinci ölçüm: aynı turda get_bist_board ZATEN çağrılmıştı — ama
 * [ASELS, THYAO, TUPRS] sembol listesiyle, observedCount=3. Talimat aracı
 * adıyla söylemekle yetinemez; NASIL çağrılacağını da söylemeli.
 */
describe('REGRESYON — evren eksiği onarılabilir olmalı', () => {
  function coverageWithUniverseGap(observed) {
    const run = createResearchRun({ userQuestion: 'bist 100 hisselerinden hangisi' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2',
        question: 'BIST100 içinde bugün alınabilir aday var mı?',
        outputKind: 'investable_candidate',
        entities: ['ASELS', 'THYAO', 'TUPRS'],
        coverage: 'ALL',
        requiredEvidence: ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'MARKET_SESSION_STATUS'],
      }],
    });
    run.set(res.contract);

    const events = [{
      type: 'tool_call', tool: 'get_bist_board', entities: ['ASELS', 'THYAO', 'TUPRS'],
      timestamp: now - 60_000, success: true, data: { items: new Array(observed).fill({}) },
      source: 'mynet', universeScope: 'BIST_ALL_SNAPSHOT', observedCount: observed,
    }];
    for (const e of ['ASELS', 'THYAO', 'TUPRS']) {
      for (const t of ['get_stock_price', 'get_valuation_multiples', 'get_financial_statements']) {
        events.push({ type: 'tool_call', tool: t, entities: [e], timestamp: now - 60_000, success: true, data: { price: 1, rows: [1] }, source: 'test' });
      }
    }
    return evaluateContract(run.get(), buildEvidenceLedger(events, now), now);
  }

  it('REGRESYON — onarım isteği ÜRETİLİR (eskiden null dönüyordu)', () => {
    const repair = buildContractRepairRequest('bist 100 hisselerinden hangisi', coverageWithUniverseGap(3));
    expect(repair, 'evren eksiği için onarım üretilmedi — kapı anahtarsız').not.toBeNull();
  });

  it('talimat NASIL çağrılacağını söyler — endeks filtresi, sembol listesi değil', () => {
    const repair = buildContractRepairRequest('bist 100 hisselerinden hangisi', coverageWithUniverseGap(3));
    expect(repair.message).toContain('index:"XU100"');
    expect(repair.message).toContain('limit:100');
    expect(repair.message).toContain('SEMBOL LİSTESİ VERME');
    // Gözlenen/gereken sayı da geçmeli: model neyin eksik olduğunu görsün.
    expect(repair.message).toMatch(/gözlenen 3, gereken 100/);
  });

  it('EŞİK ULAŞILABİLİR OLMALI — aracın limit tavanını aşamaz', () => {
    // get_bist_board limit'i ai-service.cjs'te 200'e kırpılıyor. Eşiği
    // bunun üstüne koymak, hiçbir zaman kapanmayan bir zorunluluk yaratır.
    const TOOL_MAX_LIMIT = 200;
    for (const soru of ['BIST100 içinden aday', 'BIST30 içinde', 'BIST50 arasında', 'piyasa genelinde']) {
      const claim = detectUniverseClaim(soru);
      expect(claim.size, `${claim.key} eşiği araç tavanını aşıyor`).toBeLessThanOrEqual(TOOL_MAX_LIMIT);
    }
  });

  it('evren gözlendiğinde eksik kalmaz', () => {
    const cov = coverageWithUniverseGap(100);
    expect(cov.subQuestions[0].missingEvidence).not.toContain('UNIVERSE_COVERAGE:BIST100');
  });
});
