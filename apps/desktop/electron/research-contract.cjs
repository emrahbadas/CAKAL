// ============================================================
// Research Contract — plan-güdümlü, kanıt-denetimli araştırma
// ============================================================
// execution-contract.cjs'in finans ikizi. Orada:
//   plan → uygula → geri oku → planla karşılaştır → sınırlı düzelt
// Burada:
//   plan → kanıt topla → kanıt defterini oku → planla karşılaştır → onar
//
// TASARIM KARARI — neden "strateji ajanı" değil "sözleşme":
// Bir LLM'in seçtiği araçları başka bir LLM'e seçtirmek determinizm katmaz,
// aynı hata modunu ikinci kez satın alır. Muhakemeyi yine model yapar; bu
// modülün işi o muhakemeyi MAKİNE TARAFINDAN DENETLENEBİLİR hale getirmektir.
// Stratejist düşünür, sözleşme düşündüğünü kilitler.
//
// ÜÇ SERT KURAL:
// 1. requiredEvidence yalnız GERÇEKTEN ÜRETİLEBİLEN sınıflardan seçilebilir.
//    Üreticisi olmayan bir kanıt sınıfı (ör. INDEX_WEIGHT — hiçbir araç endeks
//    ağırlığı vermiyor) sözleşmeyi doğuştan tatmin edilemez yapar ve o alt
//    soruyu sonsuza kadar bloke eder. Bu, sözleşmeyi duvara çevirir. Bu yüzden
//    doğrulama plan SUNULURKEN yapılır, verdict aşamasında değil.
// 2. Kanıt sınıfı kilitli, kanıta giden YOL serbest. Araştırma sırasında
//    keşif olur (KAP erişilemez, şirket yanlış sektörde, yeni bildirim çıkar);
//    fallback kaynağı değişebilmeli. Ama çıta İNDİRİLEMEZ — amendment bir
//    requiredEvidence'ı kaldıramaz veya zayıflatamaz.
// 3. Tamamlanma modelin beyanından DEĞİL, kanıt defterinden hesaplanır.
//    "Yaptım" demek kanıt değildir.
//
// Saf mantık: fs/openai bağımlılığı yok. Kanıt defteri dışarıdan verilir.

const {
  TOOL_EVIDENCE_CLASSES,
  resolveEvidenceClasses,
  COMMANDER_ACTIONABLE_FINANCE_RE,
  EVIDENCE_TTL_MS,
  hasFreshEvidence,
  hasFreshEvidenceForEntity,
  isCommanderFinanceMessage,
  isCommanderActionableFinanceRequest,
  isCommanderFreshMarketScanRequest,
  COMMANDER_RANKING_REQUEST_RE,
  containsBistTicker,
  extractBistTickers,
} = require('./decision-guards.cjs');

// Kapalı kanıt sözlüğü: yalnız bir aracın gerçekten emit ettiği sınıflar.
const PRODUCIBLE_EVIDENCE_CLASSES = Object.freeze(
  [...new Set(Object.values(TOOL_EVIDENCE_CLASSES).flat())].sort(),
);

/** Bir kanıt sınıfını üretebilen araçlar — onarım ipucu için. */
function toolsProducing(evidenceClass) {
  return Object.entries(TOOL_EVIDENCE_CLASSES)
    .filter(([, classes]) => classes.includes(evidenceClass))
    .map(([tool]) => tool);
}

// Alt sorunun ürettiği hüküm türü. "Amiral gemisi" sorusunun üç ayrı çıktı
// sınıfına bölünmesi tam olarak buradan gelir: yapısal lider ile bugün
// alınabilir hisse aynı skor uzayında birleşemez.
const OUTPUT_KINDS = Object.freeze([
  'structural_leader',    // endeks üyeliği + likidite — yapısal büyüklük
  'current_leader',       // relatif güç + momentum — güncel liderlik
  'investable_candidate', // temel + değerleme + fiyat uzaması — bugün alınabilirlik
  'single_fact',          // tek rakam / tek bildirim
  'comparison',           // iki+ varlık karşılaştırması
  'thesis',               // yatırım tezi / senaryo
]);

// Çıktı türü başına ASGARİ kanıt seti.
// GEÇMİŞ HATA: model "bugün alınabilir mi" alt sorusuna zorunlu kanıt olarak
// yalnız FUNDAMENTALS + EARNINGS_PRICE_REACTION yazdı; mali tablo gelince
// sözleşme COMPLETE dedi, ama cevabın kendisi "değerleme katmanı tam değil"
// diyordu. Sözleşme ile cevabın anlamı çelişiyordu. Artık outputKind kendi
// asgarisini dayatır: modelin çıtayı düşük tutması engellenir.
const OUTPUT_KIND_MINIMUM_EVIDENCE = Object.freeze({
  structural_leader: ['INDEX_MEMBERSHIP', 'LIQUIDITY'],
  current_leader: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
  // "Bugün alınabilir mi" sorusu piyasa açık mı bilmeden cevaplanamaz.
  investable_candidate: ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'MARKET_SESSION_STATUS'],
  single_fact: [],
  comparison: [],
  thesis: [],
});

// KANIT GRAMERİ — hangi kanıt sınıfı hangi çıktı türünü tamamlamaya SAYILIR.
// GEÇMİŞ HATA: plan s2'ye (current_leader) MARKET_MOVERS'ı zorunlu yazdı;
// onarım en çok artanlar listesini getirdi (EMPAE, GIPTA, MRSHL) ve sözleşme
// s2'yi COMPLETE saydı. Oysa genel yükselenler listesi THYAO/ASELS/KCHOL'ün
// relatif gücü hakkında hiçbir şey söylemez.
//
// Entity kapsamı bu deliği kapatır ama YETMEZ: üç sembol tesadüfen listede
// olsaydı eşleşme sağlanır ve aynı yanlış sonuç çıkardı. Gramer, yanlış planı
// KURULURKEN reddeder — koruma tesadüfe bırakılmaz.
const OUTPUT_KIND_ADMISSIBLE_EVIDENCE = Object.freeze({
  structural_leader: ['INDEX_MEMBERSHIP', 'LIQUIDITY', 'CURRENT_EQUITY_PRICE', 'FUNDAMENTALS'],
  current_leader: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL', 'LIQUIDITY', 'EARNINGS_PRICE_REACTION', 'BENCHMARK_PRICE_SERIES'],
  // CASH_FLOW_BREAKDOWN kabul edilir ama ZORUNLU DEĞİLDİR: her yatırım
  // sorusu borçluluk yorumu içermez, zorunlu kılmak kapanamayan duvar üretir.
  // Borç yorumu YAPILDIĞINDA devreye giren ayrı bir kapı var (borç kalite kapısı).
  investable_candidate: ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'EARNINGS_PRICE_REACTION', 'TECHNICAL_SIGNAL', 'RESEARCH_EVIDENCE', 'MARKET_SESSION_STATUS', 'CASH_FLOW_BREAKDOWN'],
  // Aşağıdakiler serbest: keşif ve tek-olgu soruları her sınıfı kullanabilir.
  single_fact: null,
  comparison: null,
  thesis: null,
});

// Belirli sembollere bağlı çıktı türleri: entities BOŞ BIRAKILAMAZ.
// GEÇMİŞ HATA: entities alanı opsiyoneldi, model doldurmadı, kontrol sınıf
// düzeyine düştü ve başka şirketlerin kanıtı soruyu kapattı.
const ENTITY_SCOPED_OUTPUT_KINDS = Object.freeze(['current_leader', 'investable_candidate', 'comparison']);

const COVERAGE_MODES = Object.freeze(['ALL', 'ANY']);

// Bu sınıflar ÖZNE sembollere değil, kıyas ölçütüne aittir; sınıf düzeyinde
// aranır. Aksi hâlde "XU100 serisi ASELS için yok" gibi anlamsız eksikler çıkar.
const BENCHMARK_SCOPED_CLASSES = new Set(['BENCHMARK_PRICE_SERIES', 'MARKET_SESSION_STATUS']);

const SUB_QUESTION_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
});

const CONTRACT_STATUS = Object.freeze({
  PLAN_REQUIRED: 'PLAN_REQUIRED',
  PLANNED: 'PLANNED',
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
});

function createResearchContract(opts = {}) {
  return {
    runId: opts.runId || `research-${Date.now()}`,
    createdAt: new Date().toISOString(),
    userQuestion: String(opts.userQuestion || ''),
    planned: false,
    planVersion: 0,
    subQuestions: [],
    amendments: [],
    successCriteria: [],
  };
}

function normalizeEvidenceList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean))];
}

/**
 * Planı doğrular ve KİLİTLER. İkinci kez submit edilemez — sonradan yeniden
 * planlamak, eksik veriyi görünce çıtayı indirmenin en kolay yoludur.
 */
function submitPlan(contract, plan = {}) {
  const errors = [];

  if (contract.planned) {
    return {
      ok: false,
      errors: ['Bu arastirma icin plan zaten kilitlendi; yeniden planlama yok. Yol degisikligi icin amendPlan kullan.'],
      contract,
    };
  }

  const rawSubQuestions = Array.isArray(plan.subQuestions) ? plan.subQuestions : [];
  if (rawSubQuestions.length === 0) {
    errors.push('En az bir alt soru gerekli.');
  }

  const seenIds = new Set();
  const subQuestions = [];

  for (const [index, raw] of rawSubQuestions.entries()) {
    const id = String(raw?.id || `s${index + 1}`).trim();
    const label = `Alt soru ${id}`;

    if (seenIds.has(id)) {
      errors.push(`${label}: id tekrar ediyor.`);
      continue;
    }
    seenIds.add(id);

    const question = String(raw?.question || '').trim();
    if (!question) errors.push(`${label}: question bos olamaz.`);

    const outputKind = String(raw?.outputKind || '').trim();
    if (!OUTPUT_KINDS.includes(outputKind)) {
      errors.push(`${label}: outputKind gecersiz ("${outputKind}"). Gecerli: ${OUTPUT_KINDS.join(', ')}.`);
    }

    const requiredEvidence = normalizeEvidenceList(raw?.requiredEvidence);
    if (requiredEvidence.length === 0) {
      errors.push(`${label}: requiredEvidence bos olamaz.`);
    }

    // SERT KURAL 1 — üreticisi olmayan kanıt sınıfı reddedilir.
    const unproducible = requiredEvidence.filter((klass) => !PRODUCIBLE_EVIDENCE_CLASSES.includes(klass));
    for (const klass of unproducible) {
      errors.push(
        `${label}: "${klass}" kanit sinifini ureten hicbir arac yok, bu alt soru asla tamamlanamaz. `
        + `Gecerli siniflar: ${PRODUCIBLE_EVIDENCE_CLASSES.join(', ')}.`,
      );
    }

    // KANIT GRAMERİ: bu çıktı türünü tamamlamaya sayılmayan sınıf zorunlu
    // kanıt olarak yazılamaz. Yanlış plan kurulurken reddedilir.
    const admissible = OUTPUT_KIND_ADMISSIBLE_EVIDENCE[outputKind];
    if (admissible) {
      const inadmissible = requiredEvidence.filter((klass) => !admissible.includes(klass));
      for (const klass of inadmissible) {
        errors.push(
          `${label}: "${klass}" kanit sinifi "${outputKind}" ciktisini tamamlamaya SAYILMAZ. `
          + `Gecerli: ${admissible.join(', ')}. Kesif kanitini ayri bir alt soruya bagla.`,
        );
      }
    }

    // ENTITY KAPSAMI: sembole bağlı çıktı türlerinde entities zorunludur.
    const rawEntities = [...new Set((Array.isArray(raw?.entities) ? raw.entities : [])
      .map((e) => String(e || '').trim().toUpperCase().replace(/\.IS$/i, ''))
      .filter(Boolean))];

    // ENDEKS ≠ ŞİRKET. Model XU100'ü relatif güç kıyası için entities'e koydu;
    // endeks için LIQUIDITY veya EARNINGS_PRICE_REACTION üreten araç YOKTUR,
    // dolayısıyla o alt soru sonsuza kadar PARTIAL kalıyordu. Bu, kanıt
    // sınıflarında engellediğim "sözleşme duvara döner" hatasının entity
    // tarafındaki eşi. Endeksler kıyas ölçütüdür; ayrı alanda tutulur.
    const benchmarks = rawEntities.filter((e) => /^XU\d{2,3}$/.test(e));
    const entities = rawEntities.filter((e) => !benchmarks.includes(e));

    // AMA benchmark tamamen kanıtsız da bırakılmaz: "XU100'e göre +%6,7"
    // iddiası endeks serisi olmadan kurulamaz. Benchmark, ŞİRKET kanıtı
    // gerektirmez; yalnız kendi serisini gerektirir.
    if (benchmarks.length > 0 && !requiredEvidence.includes('BENCHMARK_PRICE_SERIES')) {
      requiredEvidence.push('BENCHMARK_PRICE_SERIES');
    }
    if (ENTITY_SCOPED_OUTPUT_KINDS.includes(outputKind) && entities.length === 0) {
      errors.push(
        `${label}: "${outputKind}" belirli sembollere bagli bir ciktidir; entities BOS BIRAKILAMAZ. `
        + 'Sorudaki sembolleri yaz, yoksa baska sirketlerin kaniti bu soruyu kapatir.',
      );
    }

    // coverage: uc hisselik karsilastirmada BIR hissenin kaniti yetmez.
    const coverage = String(raw?.coverage || 'ALL').toUpperCase();
    if (!COVERAGE_MODES.includes(coverage)) {
      errors.push(`${label}: coverage gecersiz ("${coverage}"). Gecerli: ALL, ANY.`);
    }

    // outputKind asgarisi otomatik eklenir — model çıtayı düşüremez.
    const minimum = OUTPUT_KIND_MINIMUM_EVIDENCE[outputKind] || [];
    const enforced = minimum.filter((klass) => !requiredEvidence.includes(klass));
    if (enforced.length > 0) requiredEvidence.push(...enforced);

    const optionalEvidence = normalizeEvidenceList(raw?.optionalEvidence)
      .filter((klass) => PRODUCIBLE_EVIDENCE_CLASSES.includes(klass));

    subQuestions.push({
      id,
      question,
      outputKind,
      requiredEvidence,
      optionalEvidence,
      entities,
      benchmarks,
      coverage,
      // Yol bilgisi: amendment ile değişebilir, çıta değil.
      preferredTools: Array.isArray(raw?.preferredTools) ? raw.preferredTools.map(String) : [],
      fallbackTools: Array.isArray(raw?.fallbackTools) ? raw.fallbackTools.map(String) : [],
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, contract };
  }

  const locked = {
    ...contract,
    planned: true,
    planVersion: 1,
    plannedAt: new Date().toISOString(),
    subQuestions,
    successCriteria: Array.isArray(plan.successCriteria) ? plan.successCriteria.map(String) : [],
  };

  return { ok: true, errors: [], contract: locked };
}

/**
 * Kontrollü değişiklik. Kanıta giden yol değişebilir; çıta inemez.
 * Yeni alt soru EKLENEBİLİR (keşif yeni soru doğurabilir) fakat mevcut bir
 * alt sorunun requiredEvidence'ı daraltılamaz.
 */
function amendPlan(contract, amendment = {}) {
  if (!contract.planned) {
    return { ok: false, errors: ['Once plan sunulmali (submitPlan).'], contract };
  }

  const reason = String(amendment.reason || '').trim();
  if (!reason) {
    return { ok: false, errors: ['amendmentReason zorunlu: neden degistigi kayda gecmeli.'], contract };
  }

  const errors = [];
  const next = contract.subQuestions.map((sq) => ({ ...sq }));

  if (amendment.subQuestionId) {
    const target = next.find((sq) => sq.id === String(amendment.subQuestionId));
    if (!target) {
      return { ok: false, errors: [`Alt soru bulunamadi: ${amendment.subQuestionId}`], contract };
    }

    // SERT KURAL 2 — çıta indirilemez.
    if (Array.isArray(amendment.requiredEvidence)) {
      const proposed = normalizeEvidenceList(amendment.requiredEvidence);
      const dropped = target.requiredEvidence.filter((klass) => !proposed.includes(klass));
      if (dropped.length > 0) {
        errors.push(
          `Zorunlu kanit kaldirilamaz: ${dropped.join(', ')}. `
          + 'Kaynaga erisilemiyorsa fallback ekle; citayi indirme.',
        );
      }
      const unproducible = proposed.filter((klass) => !PRODUCIBLE_EVIDENCE_CLASSES.includes(klass));
      if (unproducible.length > 0) {
        errors.push(`Uretilemeyen kanit sinifi eklenemez: ${unproducible.join(', ')}.`);
      }
      if (errors.length === 0) target.requiredEvidence = proposed;
    }

    if (Array.isArray(amendment.fallbackTools)) {
      target.fallbackTools = [...new Set([...target.fallbackTools, ...amendment.fallbackTools.map(String)])];
    }
  }

  if (Array.isArray(amendment.addSubQuestions) && amendment.addSubQuestions.length > 0) {
    const draft = submitPlan(
      { ...createResearchContract({ runId: contract.runId }), planned: false },
      { subQuestions: amendment.addSubQuestions },
    );
    if (!draft.ok) {
      errors.push(...draft.errors);
    } else {
      for (const sq of draft.contract.subQuestions) {
        if (next.some((existing) => existing.id === sq.id)) {
          errors.push(`Eklenen alt soru id'si zaten var: ${sq.id}`);
        } else {
          next.push(sq);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, contract };
  }

  return {
    ok: true,
    errors: [],
    contract: {
      ...contract,
      planVersion: contract.planVersion + 1,
      subQuestions: next,
      amendments: [
        ...contract.amendments,
        { at: new Date().toISOString(), planVersion: contract.planVersion + 1, reason, change: amendment },
      ],
    },
  };
}

/**
 * SERT KURAL 3 — tamamlanma kanıt defterinden hesaplanır.
 * ledger: buildEvidenceLedger(events) çıktısı (Map<class, {at, tool}>).
 */
function evaluateContract(contract, ledger, now = Date.now()) {
  if (!contract.planned) {
    return {
      status: CONTRACT_STATUS.PLAN_REQUIRED,
      subQuestions: [],
      repairPlan: [],
      answerableIds: [],
      blockedIds: [],
      // Şekil tutarlılığı: tüketen taraf her kapanışta aynı alanları bulmalı,
      // yoksa `coverage.unresolvedIds.length` gibi okumalar patlar.
      partialIds: [],
      unresolvedIds: [],
      capabilityGaps: [],
    };
  }

  const evaluated = contract.subQuestions.map((sq) => {
    const satisfied = [];
    const missing = [];
    // Alt soru belirli sembollerle ilgiliyse kanıt O SEMBOLLER için aranır.
    // GEÇMİŞ HATA: defter yalnız sınıfa göre anahtarlanıyordu, THYAO için
    // çekilen fiyat KCHOL alt sorusunu tatmin ediyordu.
    const entities = Array.isArray(sq.entities) ? sq.entities.filter(Boolean) : [];
    // coverage=ALL → her sembol için kanıt şart (üç hisselik karşılaştırmada
    // tek hissenin verisi soruyu kapatmaz). ANY → en az biri yeterli.
    const requireAll = String(sq.coverage || 'ALL').toUpperCase() !== 'ANY';
    const entityMiss = new Map();
    for (const klass of sq.requiredEvidence) {
      let ok;
      // BENCHMARK KAPSAMI ÖZNE KAPSAMINDAN AYRIDIR. Endeks serisi her hisse
      // için ayrı ayrı çekilmez; bir kez çekilir ve hepsine hizmet eder.
      // Özne sembollere göre aramak, üç hisselik bir soruda "XU100 serisi
      // ASELS için yok" gibi anlamsız bir eksik üretiyordu.
      if (BENCHMARK_SCOPED_CLASSES.has(klass)) {
        ok = hasFreshEvidence(ledger, klass, now);
      } else if (entities.length > 0) {
        const covered = entities.filter((entity) => hasFreshEvidenceForEntity(ledger, klass, entity, now));
        ok = requireAll ? covered.length === entities.length : covered.length > 0;
        if (!ok) entityMiss.set(klass, entities.filter((e) => !covered.includes(e)));
      } else {
        ok = hasFreshEvidence(ledger, klass, now);
      }
      if (ok) satisfied.push(klass);
      else missing.push(klass);
    }

    // EVREN İDDİASI SEMBOL KAPSAMINDAN AYRIDIR.
    // Beş sembolün kanıtı tam olabilir; alt soru "BIST100 içinde" diyorsa
    // o beş sembol evreni temsil etmez. Bu kontrol olmadan sözleşme
    // COMPLETE kapanıyor ve cevap evren-geneli üstünlük hükmü kurabiliyordu.
    const universe = evaluateUniverseCoverage(sq.question, ledger);
    if (universe && !universe.covered) {
      missing.push(`UNIVERSE_COVERAGE:${universe.claim.key}`);
    }

    const status = missing.length === 0
      ? SUB_QUESTION_STATUS.COMPLETE
      : satisfied.length > 0
        ? SUB_QUESTION_STATUS.PARTIAL
        : SUB_QUESTION_STATUS.BLOCKED;

    return {
      id: sq.id,
      question: sq.question,
      outputKind: sq.outputKind,
      entities,
      coverage: requireAll ? 'ALL' : 'ANY',
      status,
      satisfiedEvidence: satisfied,
      missingEvidence: missing,
      universeClaim: universe
        ? { key: universe.claim.key, required: universe.claim.size, observed: universe.observed, covered: universe.covered }
        : null,
      // Hangi sembolün hangi kanıtı eksik — onarım isteğinde adıyla istenir.
      missingByEntity: [...entityMiss.entries()].map(([klass, ents]) => ({ evidenceClass: klass, entities: ents })),
      // Onarım ipucu: hangi aracın çağrılacağı tahmin edilmez, haritadan gelir.
      repairTools: [...new Set(missing.flatMap(toolsProducing))],
    };
  });

  const complete = evaluated.filter((sq) => sq.status === SUB_QUESTION_STATUS.COMPLETE);
  const blocked = evaluated.filter((sq) => sq.status === SUB_QUESTION_STATUS.BLOCKED);
  // PARTIAL HİÇBİR LİSTEYE DÜŞMÜYORDU.
  // ÖLÇÜLEN VAKA: üç alt soru da PARTIAL iken kapanış "cevaplanabilir: yok;
  // bloke: yok" diyordu. İki liste de boş olduğu için tüketen taraf ortada
  // hiçbir sorun yokmuş gibi davranıyordu — oysa hiçbir alt soru tam değildi.
  const partial = evaluated.filter((sq) => sq.status === SUB_QUESTION_STATUS.PARTIAL);

  const status = complete.length === contract.subQuestions.length
    ? CONTRACT_STATUS.COMPLETE
    : complete.length > 0 || evaluated.some((sq) => sq.status === SUB_QUESTION_STATUS.PARTIAL)
      ? CONTRACT_STATUS.PARTIAL
      : CONTRACT_STATUS.BLOCKED;

  // Yetenek boşluğu: eksik kanıt sınıfını üreten HİÇBİR araç yoksa bu onarımla
  // kapanmaz. Körlemesine "bir araştırma aracı daha çalıştır" demek yerine
  // durumu açıkça bildir — aksi halde onarım turu boşa harcanır.
  const capabilityGaps = [...new Set(
    evaluated.flatMap((sq) => sq.missingEvidence.filter((klass) => toolsProducing(klass).length === 0)),
  )];

  return {
    status,
    capabilityGaps,
    subQuestions: evaluated,
    // Kısmi cevap için: hangi alt sorular cevaplanabilir, hangileri susmalı.
    answerableIds: complete.map((sq) => sq.id),
    blockedIds: blocked.map((sq) => sq.id),
    // Kısmen kanıtlı alt sorular: bulguları geçerlidir, HÜKMÜ değildir.
    partialIds: partial.map((sq) => sq.id),
    // Hüküm indirmesi gereken alt sorular = tam olmayan her şey.
    // Tek bir yerden hesaplanır ki tüketen taraf yeniden türetmesin.
    unresolvedIds: [...partial, ...blocked].map((sq) => sq.id),
    repairPlan: [...new Set(evaluated.flatMap((sq) => sq.repairTools))],
  };
}

// ── Koşullu tetikleme ─────────────────────────────────────────────────
// "THYAO kaç TL" sorusuna sözleşme kurmak saf israftır. Sözleşme yalnız
// çok parçalı / karar seviyesi sorularda zorunlu olmalı. Skor deterministik
// ve test edilebilir tutulur; tek bir regex'e bırakılmaz.
const CONTRACT_COMPLEXITY_THRESHOLD = 4;

const MULTI_HORIZON_RE = /(kısa vade|kisa vade|uzun vade|orta vade|\d+\s*(ay|yıl|yil)lık|vadeye göre|vadeye gore)/i;
const ALL_DATA_RE = /(tüm veri|tum veri|bütün veri|butun veri|her açıdan|her acidan|kapsamlı|kapsamli|derinlemesine|tam analiz)/i;
const MARKET_WIDE_RE = /(piyasa geneli|borsa geneli|tüm bist|tum bist|bist100|bist 100|xu100|endeks genel|sektör genel|sektor genel)/i;
const PORTFOLIO_RE = /(portföy|portfoy|sepet|dağılım|dagilim|ağırlıklandır|agirliklandir)/i;
const TICKER_RE = /(^|[^A-ZÇĞİÖŞÜ0-9])([A-Z]{4,6})(?![A-ZÇĞİÖŞÜ])/g;

// Hisse kodu gibi görünen ama olmayan büyük harfli tokenlar.
// DİKKAT: borsa/kurum/endeks adları buraya ŞART. "BIST" tam olarak 4 büyük
// harftir ve şirket kodu deseni ile birebir eşleşir; listede olmazsa her
// "BIST" geçen mesaj bir şirket daha saymış olur ve karmaşıklık skoru şişer.
// Çok şirketli karşılaştırma talebi. Sıralama/üstünlük talebinden AYRIDIR.
const MULTI_COMPANY_COMPARISON_RE = /karşılaştır|karsilastir|kıyasla|kiyasla|hangisi|farkı\s*ne|arasındaki\s*fark|\bvs\b/i;

const TICKER_STOPWORDS = new Set([
  // borsa / kurum / endeks
  'BIST', 'BORSA', 'VIOP', 'TEFAS', 'TCMB', 'BDDK', 'TUIK', 'IMKB', 'ENDEKS',
  // DÖVİZ/KRİPTO PARİTELERİ ŞİRKET DEĞİLDİR.
  // "USDTRY ve EURTRY karşılaştır" iki şirket sayılıp sözleşme açtırıyordu;
  // oysa investable_candidate MARKET_SESSION_STATUS istiyor ve tek üreticisi
  // BIST'e özgü get_bist_board — sözleşme kapanamaz, duvar üretir.
  'USDTRY', 'EURTRY', 'GBPTRY', 'CHFTRY', 'JPYTRY', 'EURUSD', 'GBPUSD',
  'USDJPY', 'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'BTCTRY', 'ETHTRY',
  // yaygın büyükharf yazılan Türkçe sözcükler
  'KAPS', 'ANCAK', 'FAKAT', 'VERI', 'ANALIZ', 'RAPOR', 'TOPLAM', 'ORTALAMA',
  'HISSE', 'PIYASA', 'FIYAT', 'HEDEF', 'YATIRIM', 'PORTFOY', 'BILANCO',
]);

/**
 * Mesajda kaç FARKLI şirket geçiyor?
 *
 * ÖNCEDEN BURADA AYRI BİR UYGULAMA VARDI ve bu, sistemdeki ÜÇÜNCÜ sembol
 * dedektörüydü (decision-guards `extractBistTickers`, seviye kapısındaki
 * başlık tarayıcısı ve bu). Üçü ayrı stopword listesi taşıyordu; biri
 * düzelince diğerleri eski davranışta kalıyordu.
 *
 * ÖLÇÜLEN CANLI HATA (13 Ağustos 2026): `extractBistTickers` sicile bağlandı
 * ve ['BRSAN'] döndürmeye başladı, ama skor HÂLÂ "coklu sirket (3)" diyordu —
 * çünkü sayım buradan geçiyordu ve burası hâlâ kara liste kullanıyordu.
 * Tek doğruluk kaynağı: decision-guards.
 */
function countDistinctTickers(message) {
  return extractBistTickers(message).length;
}

/**
 * Bu istek araştırma sözleşmesi gerektiriyor mu?
 * Dönen skor ve sinyaller log'a yazılır — kararın neden verildiği görünür olur.
 */
function requiresResearchContract(message = '', opts = {}) {
  const text = String(message || '');
  const signals = [];
  let score = 0;

  // KAPSAM KONUŞMADAN TAŞINIR, KANIT TAŞINMAZ.
  // ÖLÇÜLEN VAKA: "bilanço + fiyatlama karşılaştırması da yap" mesajında BRSAN
  // ve MEYSU yazmıyordu; semboller bir önceki turdan geliyordu. Skor yalnız
  // mesaja baktığı için iki şirketi hiç görmedi ve sözleşme açılmadı.
  //
  // DİKKAT — bu KANIT taşıması DEĞİLDİR (bkz. main.cjs araştırma koşusu notu):
  // "hangi şirketler konuşuluyor" bilgisi taşınır, "hangi ölçümler elimizde"
  // bilgisi taşınmaz. Aksi hâlde ilk sorgunun kanıtı üçüncü sorgunun
  // gereksinimini sessizce tatmin ederdi.
  //
  // Mesaj kendi sembolünü SÖYLÜYORSA devralma yapılmaz: kullanıcı kapsamı
  // açıkça yeniden çizmiştir ("şimdi sadece ASELS").
  const ownTickers = countDistinctTickers(text);
  const inherited = ownTickers > 0
    ? []
    : [...new Set((Array.isArray(opts.priorEntities) ? opts.priorEntities : [])
      .map((e) => String(e || '').trim().toUpperCase().replace(/\.IS$/i, ''))
      .filter((e) => e && !TICKER_STOPWORDS.has(e)))];

  // FİNANS BAĞLAMI MESAJDAN VEYA DEVRALINAN KAPSAMDAN GELİR.
  // "peki bugün alınır mı?" mesajında tek bir finans SÖZCÜĞÜ yok; niyet var ve
  // konuşulan şey bir hisse. Erken çıkış bunu eskiden "finans değil" sayıyordu.
  // Devralma tek başına yetmez — yanına işlem/karşılaştırma/sıralama NİYETİ
  // şart, yoksa "teşekkürler" de finans mesajı olurdu.
  const contextIntent = inherited.length > 0 && (
    COMMANDER_ACTIONABLE_FINANCE_RE.test(text)
    || MULTI_COMPANY_COMPARISON_RE.test(text)
    || COMMANDER_RANKING_REQUEST_RE.test(text)
  );
  if (!isCommanderFinanceMessage(text) && !contextIntent) {
    return { required: false, score: 0, signals: ['finans baglami yok'], threshold: CONTRACT_COMPLEXITY_THRESHOLD };
  }

  const tickerCount = ownTickers > 0 ? ownTickers : inherited.length;
  if (tickerCount >= 2) {
    score += 2;
    signals.push(inherited.length > 0 ? `coklu sirket (${tickerCount}, baglamdan)` : `coklu sirket (${tickerCount})`);
  }

  // ÇOK ŞİRKETLİ KARŞILAŞTIRMA KARAR SEVİYESİDİR.
  // "karşılaştır" BİLEREK sıralama talebi sayılmaz (COMMANDER_RANKING_REQUEST_RE'ye
  // eklenmez): kullanıcının adıyla verdiği iki sembolü kıyaslamak bir aday
  // seçimi değildir ve sıralama kapısının kaçışını bozardı. Ama iki şirketin
  // kıyaslanması kanıt disiplini gerektirir; sinyal ayrı tutulur.
  if (tickerCount >= 2 && MULTI_COMPANY_COMPARISON_RE.test(text)) {
    score += 2;
    signals.push('coklu sirket karsilastirmasi');
  }

  if (COMMANDER_RANKING_REQUEST_RE.test(text)) { score += 2; signals.push('siralama/karsilastirma'); }
  // Açık işlem kararı + belirli bir hisse = tanımı gereği karar seviyesi soru;
  // sözleşme tam olarak bunun için var. Tek başına eşiği geçirir.
  // CANLI KANIT: "THYAO bugün alınır mı?" skor 3 ile eşiğin altında kaldı,
  // sözleşme açılmadı ve get_valuation_multiples hiç çağrılmadı — cevabın
  // kendisi "değerleme çarpanları yok" diye itiraf etti.
  //
  // Hisse şartı ÖNEMLİ: "USD/TRY alınır mı" için sözleşme açmak duvar üretir,
  // çünkü investable_candidate MARKET_SESSION_STATUS istiyor ve onun tek
  // üreticisi get_bist_board (BIST'e özgü). Döviz/kripto tarafında karar
  // kapısı zaten koruyor.
  // isCommanderActionableFinanceRequest kendi içinde finans SÖZCÜĞÜ arar;
  // devralınan kapsamı göremez. Burada niyet ile bağlam ayrı değerlendirilir.
  const actionable = COMMANDER_ACTIONABLE_FINANCE_RE.test(text)
    && (isCommanderFinanceMessage(text) || inherited.length > 0);
  if (actionable) {
    // Devralınan kapsam da hisse bağlamıdır: "peki bugün alınır mı?" mesajında
    // kod yazmaz ama konuşulan şey bir hissedir.
    const equityTrade = containsBistTicker(text) || inherited.length > 0;
    score += equityTrade ? 4 : 3;
    signals.push(equityTrade ? 'hisse islem karari' : 'islem karari');
  }
  if (isCommanderFreshMarketScanRequest(text) || MARKET_WIDE_RE.test(text)) { score += 2; signals.push('piyasa geneli'); }
  if (MULTI_HORIZON_RE.test(text)) { score += 1; signals.push('coklu zaman ufku'); }
  if (ALL_DATA_RE.test(text)) { score += 2; signals.push('tum veriler'); }
  if (PORTFOLIO_RE.test(text)) { score += 2; signals.push('portfoy/sepet'); }

  return {
    required: score >= CONTRACT_COMPLEXITY_THRESHOLD,
    score,
    signals,
    threshold: CONTRACT_COMPLEXITY_THRESHOLD,
  };
}

/**
 * Dispatcher kapısı. Sözleşme gerekiyorsa ve yoksa araştırma araçlarını
 * çalıştırma — önce plan iste. Bu kapı tool listesine güvenmez; çağrı
 * noktasında zorunludur (runInvestmentResearchWorkflowPolicy'nin hatası:
 * model tool'u hiç çağırmazsa politika hiç çalışmıyordu).
 */
const CONTRACT_EXEMPT_TOOLS = new Set(['submit_research_plan', 'amend_research_plan']);

function checkContractGate(toolName, contract, complexity) {
  if (CONTRACT_EXEMPT_TOOLS.has(toolName)) return null;
  if (!TOOL_EVIDENCE_CLASSES[toolName]) return null; // kanıt üretmeyen araç serbest
  if (!complexity || !complexity.required) return null;
  if (contract && contract.planned) return null;

  return {
    status: CONTRACT_STATUS.PLAN_REQUIRED,
    allowedNextAction: 'submit_research_plan',
    reason:
      `Bu istek arastirma sozlesmesi gerektiriyor (karmasiklik ${complexity.score}/${complexity.threshold}: ${complexity.signals.join(', ')}). `
      + `${toolName} calistirilmadan once submit_research_plan ile alt sorulari ve her birinin zorunlu kanit siniflarini bildir.`,
    producibleEvidenceClasses: PRODUCIBLE_EVIDENCE_CLASSES,
    outputKinds: OUTPUT_KINDS,
  };
}

// ── Araştırma koşusu (research run) ───────────────────────────────────
// KAPSAM KURALI: bir KULLANICI İSTEĞİ = bir koşu. Onarım/tamamlama turları
// (main.cjs birden çok kez chat() çağırır) aynı koşuyu paylaşır; farklı bir
// kullanıcı isteği YENİ koşu açar.
//
// Neden oturum geneli DEĞİL: "THYAO analiz et" → "ASELS analiz et" →
// "hangisi?" dizisinde, ilk sorgunun THYAO fiyatı üçüncü sorgunun kanıt
// gereksinimini örtük olarak tatmin ederdi. Kanıtın koşular arası yeniden
// kullanımı ancak sembol + sınıf + TTL doğrulamasından geçen açık bir yolla
// olmalıdır, sessiz devralma ile değil.

/** Araç sonucundan gerçek veri zamanını (asOf) çıkarır. */
function extractAsOf(result) {
  const data = result && result.data ? result.data : null;
  if (!data) return null;
  return (
    data.metadata?.lastTradeTime ||
    data.metadata?.retrievedAt ||
    data.metadata?.fetchedAt ||
    data.referenceDate ||
    data.assessedAt ||
    null
  );
}

/** Araç çağrısının hangi sembolleri kapsadığını çıkarır. */
/**
 * Bir araç çağrısının HANGİ ŞİRKETLER hakkında kanıt ürettiğini çıkarır.
 *
 * GEÇMİŞ HATA (10 Ağustos 2026): yalnız `symbol/asset/symbols` argümanlarına ve
 * `result.data.items|stocks|symbol` alanlarına bakılıyordu. Ama `web_search`,
 * `search_youtube_insights` ve `verify_claim` sembolü argümanda değil `query`/
 * `claim` METNİNDE taşır — bu araçların kanıt olayları ENTITY'SİZ yazılıyordu.
 * Dört hisse için sekiz araç gerçekten çalıştığı halde sözleşme hiçbirini
 * bulamıyor, sosyal kanıt alt sorusu BLOCKED kalıyordu.
 *
 * ÇÖZÜM: okuyucu GENEL, üretici DAR. Burada opsiyonel `coveredEntities` alanı
 * okunur; onu şimdilik yalnız o üç araç üretir (bkz. bist-entity-resolver.cjs).
 * Bu alan opsiyonel olduğu için diğer araçların dönüş şekli değişmez.
 *
 * Sorgu metnini burada körlemesine ayrıştırmıyoruz: "NET", "FOR", "IS" gibi
 * sözcükleri hisse sanan yanlış pozitifler doğar. Çözümleme, bilinen sembol
 * kümesine sahip olan aracın kendi sınırında yapılır.
 */
// Bir aracın ürettiği SAYISAL ölçümler, sembol bazında.
// NEDEN: kanıt defteri "ölçüm YAPILDI MI" sorusunu cevaplıyordu; "cevaptaki bu
// RAKAM o ölçümden mi geldi" sorusunu cevaplayamıyordu. Canlı vakada 555 TL'ye
// "MA20 altı" dendi; MA50 ≈ 553'tü ve o turda MA20 hiç ölçülmemişti. Ölçüm
// vardı, rakam ondan türememişti — kapı geçirdi. Değerler kaydedilmeden bu
// ayrım yapılamaz.
const MEASUREMENT_FIELDS = Object.freeze([
  'price', 'currentPrice', 'lastPrice', 'last', 'close', 'previousClose',
  'ma20', 'ma50', 'periodHigh', 'periodLow', 'high', 'low',
]);

function extractMeasurements(args = {}, result = null) {
  const out = {};
  const push = (symbol, value) => {
    const s = String(symbol || '').trim().toUpperCase().replace(/\.IS$/i, '');
    const n = Number(value);
    if (!/^[A-Z0-9]{3,8}$/.test(s)) return;
    if (!Number.isFinite(n) || n <= 0) return;
    (out[s] = out[s] || []).push(n);
  };

  const data = result?.data || {};
  // Tek sembollü sonuçta üst düzey ölçümler o sembole aittir.
  const single = data.symbol || args.symbol || args.asset;
  if (single) {
    for (const field of MEASUREMENT_FIELDS) push(single, data[field]);
    if (Array.isArray(data.recentCloses)) data.recentCloses.forEach((c) => push(single, c));
    if (Array.isArray(data.levels)) data.levels.forEach((l) => push(single, l?.price));
  }
  // Pano/çoklu sonuçta her satır KENDİ sembolüne yazılır — entity boyutunun
  // kanıt defterinde olduğu gibi, ölçüm de sembolüne bağlı olmalı.
  const items = data.items || data.stocks;
  if (Array.isArray(items)) {
    for (const item of items) {
      for (const field of MEASUREMENT_FIELDS) push(item?.symbol, item?.[field]);
    }
  }
  return out;
}

function extractEntities(args = {}, result = null) {
  const out = new Set();
  const push = (v) => {
    const s = String(v || '').trim().toUpperCase().replace(/\.IS$/i, '');
    if (/^[A-Z0-9]{3,8}$/.test(s)) out.add(s);
  };
  for (const key of ['symbol', 'asset', 'symbols']) {
    const val = args[key];
    if (typeof val === 'string') val.split(/[,;\s]+/).forEach(push);
  }
  // Aracın açıkça bildirdiği kapsam (opsiyonel alan).
  const covered = result?.data?.coveredEntities ?? result?.coveredEntities;
  if (Array.isArray(covered)) covered.forEach(push);
  // Gelecekte argümandan da bildirilebilsin.
  if (Array.isArray(args.entities)) args.entities.forEach(push);

  const items = result?.data?.items || result?.data?.stocks;
  if (Array.isArray(items)) items.forEach((item) => push(item.symbol));
  // Tarayıcının araştırılabilir listesi: bu semboller taramaca KAPSANDI —
  // "araştırıldı" demek DEĞİLDİR, kanıt sınıfı bunu ayrıca belirler.
  if (Array.isArray(result?.data?.researchable)) {
    result.data.researchable.forEach((item) => push(item?.symbol ?? item));
  }
  if (result?.data?.symbol) push(result.data.symbol);

  // İSTENEN ≠ BULUNAN.
  // ÖLÇÜLEN VAKA (11 Ağustos 2026): get_bist_board'a [BRSAN, MEYSU, XU100]
  // istendi, pano 2 satır döndü ve `notFound: ['XU100']` bildirdi. Buna rağmen
  // XU100 args.symbols'da geçtiği için CURRENT_EQUITY_PRICE, LIQUIDITY,
  // INDEX_MEMBERSHIP ve MARKET_SESSION_STATUS kanıtı ALMIŞ sayılıyordu.
  // Bu, Adım 2'nin sınıf düzeyinde kapattığı hastalığın entity düzeyindeki
  // hâlidir: aracın çağrılması o sembolün ölçüldüğü anlamına gelmez.
  const notFound = new Set();
  for (const key of ['notFound', 'missingEntities']) {
    const val = result?.data?.[key] ?? result?.[key];
    if (!Array.isArray(val)) continue;
    for (const v of val) {
      const s = String(v || '').trim().toUpperCase().replace(/\.IS$/i, '');
      if (s) notFound.add(s);
    }
  }
  return [...out].filter((entity) => !notFound.has(entity));
}

// Evren kapsamı: araç belirli sembolleri mi ölçtü, yoksa evrenden bir kesit mi
// getirdi? "BIST_ALL" evreninden gelen bir liste, o evrendeki HER hissenin
// gözlemlendiği anlamına GELMEZ — yalnız listeye girenler görülmüştür.
const UNIVERSE_SCOPED_TOOLS = Object.freeze({
  get_bist_gainers: 'BIST_ALL_PARTIAL',
  get_bist_board: 'BIST_ALL_SNAPSHOT',
  run_investment_research_scan: 'BIST_ALL_PARTIAL',
});

function universeScopeFor(toolName) {
  return UNIVERSE_SCOPED_TOOLS[toolName] || 'ENTITY';
}

// ── Evren kapsamı kapısı ───────────────────────────────────────────────
//
// ÖLÇÜLEN CANLI HATA (12 Eylül 2026): plan üç alt soruyu "BIST100 evreninde…"
// diye kurdu, `entities` alanına önceki turdan taşınan 5 sembol yazıldı
// (THYAO, ASELS, TUPRS, AKBNK, KCHOL) ve beşinin de kanıtı toplandığı için
// sözleşme COMPLETE kapandı. Cevap da "BIST100 içindeki tek temiz aday"
// dedi — oysa BIST100'ün 95'ine hiç bakılmamıştı.
//
// Sözleşme kapsamı BEYAN EDİLEN SEMBOL LİSTESİ üzerinden doğruluyordu; alt
// sorunun kendi metnindeki EVREN iddiasını kimse okumuyordu. `universeScope`
// alanı tam bu iş için yazılıyordu ve hiçbir kapı onu OKUMUYORDU (ölçüm:
// 3 geçiş — tanım, yazım, export; 0 tüketici).
//
// Kural: alt soru bir evren iddia ediyorsa, o evrenden gözlenen enstrüman
// sayısı evrenin boyutunu karşılamadan alt soru COMPLETE olamaz.
const UNIVERSE_CLAIMS = Object.freeze([
  { key: 'BIST100', size: 100, requiresMembership: true, re: /(bist\s*[-–]?\s*100|xu\s*100|bist100)/i },
  { key: 'BIST30', size: 30, requiresMembership: true, re: /(bist\s*[-–]?\s*30|xu\s*030|xu\s*30)/i },
  { key: 'BIST50', size: 50, requiresMembership: true, re: /(bist\s*[-–]?\s*50|xu\s*050|xu\s*50)/i },
  // "BIST geneli" / "tüm piyasa": kapalı bir sayı yok; panonun tamamı
  // beklenir. Eşik muhafazakâr tutuldu — amaç 5 sembollük bir kesitin
  // "piyasa geneli" diye satılmasını engellemek. Kalıbın kendisi zaten
  // kapsam dilidir, ayrıca üyelik kelimesi aranmaz.
  { key: 'BIST_ALL', size: 300, requiresMembership: false, re: /(bist\s*genel|piyasa\s*genel|tüm\s*piyasa|tum\s*piyasa|borsa\s*genel|tüm\s*bist|tum\s*bist)/i },
]);

// ENDEKS ADI TEK BAŞINA EVREN İDDİASI DEĞİLDİR.
// İlk sürüm yalnız "XU100" geçmesine bakıyordu ve mevcut bir testi düşürdü:
//   "XU100 gore relatif guc"  → THYAO'nun endekse KIYASLA gücü
// Bu bir BENCHMARK referansıdır; 100 üyeyi gözlemeyi gerektirmez. Evren
// iddiası SEÇİM dili ister: "içinde", "içinden", "arasında", "evreninde",
// "hisselerinden". Ayrım tam olarak şu: kümeden SEÇİYOR muyuz, yoksa
// kümeye KARŞI mı ölçüyoruz?
const UNIVERSE_MEMBERSHIP_RE = /(i[çc]inde|i[çc]inden|aras[ıi]nda|evrenin|hisselerinden|hisseleri|genelinde|kapsam[ıi]nda|dahilinde|listesinden|tamam[ıi]nda)/i;

/** Alt sorunun metni bir evren iddia ediyor mu? */
function detectUniverseClaim(question = '') {
  const text = String(question || '');
  return UNIVERSE_CLAIMS.find((claim) => {
    if (!claim.re.test(text)) return false;
    if (!claim.requiresMembership) return true;
    return UNIVERSE_MEMBERSHIP_RE.test(text);
  }) || null;
}

/**
 * Defterde bu evreni karşılayacak kadar geniş bir gözlem var mı?
 * @returns {{claim: object, observed: number|null, covered: boolean}|null}
 */
function evaluateUniverseCoverage(question, ledger) {
  const claim = detectUniverseClaim(question);
  if (!claim) return null;

  let observed = null;
  if (ledger instanceof Map) {
    for (const entry of ledger.values()) {
      if (!entry || !entry.universeScope) continue;
      const seen = Number(entry.observedCount);
      if (Number.isFinite(seen)) observed = Math.max(observed ?? 0, seen);
    }
  }

  return { claim, observed, covered: (observed ?? 0) >= claim.size };
}

function createResearchRun(opts = {}) {
  const runId = opts.runId || `R-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const userQuestion = String(opts.userQuestion || '');
  let contract = createResearchContract({ runId, userQuestion });
  const evidence = [];

  // Karmaşıklık ve semboller YALNIZ orijinal kullanıcı mesajından, BİR KEZ.
  // GEÇMİŞ HATA: her onarım turunda yeniden hesaplanıyordu ve onarım
  // promptuna eklenen metin yüzünden sembol sayısı sürükleniyordu
  // ("coklu sirket (3)" → "(4)").
  // priorEntities = konuşmanın çözülmüş sembol kapsamı (KANIT DEĞİL).
  // Bu da bir kez hesaplanır; onarım turları koşuyu yeniden kurmaz.
  const complexity = requiresResearchContract(userQuestion, { priorEntities: opts.priorEntities });

  return {
    runId,
    userQuestion,
    complexity,
    get: () => contract,
    set: (next) => { contract = next; },
    /** Araç GERÇEKTEN çalıştığında çağrılır. Performans kaydından bağımsızdır. */
    record(toolName, args, result) {
      if (!TOOL_EVIDENCE_CLASSES[toolName]) return;
      // SONUCA BAK, ADA DEĞİL.
      // GEÇMİŞ HATA: burada yalnız `success === false` eleniyordu. Tarayıcı
      // `status: 'BLOCKED'` iken bile `success: true` döndüğü için bloke tarama
      // statik tablonun tüm kanıt sınıflarını damgalayıp deftere giriyordu.
      const evidenceClasses = resolveEvidenceClasses(toolName, { ...result, result });
      if (evidenceClasses.length === 0) return;
      evidence.push({
        researchRunId: runId,
        type: 'tool_call',
        tool: toolName,
        entities: extractEntities(args, result),
        measurements: extractMeasurements(args, result),
        evidenceClasses,
        universeScope: universeScopeFor(toolName),
        observedCount: Array.isArray(result?.data?.items) ? result.data.items.length : null,
        asOf: extractAsOf(result),
        timestamp: Date.now(), // gerçek çekim anı — sonradan uydurulmaz
        source: result.source || null,
      });
    },
    events: () => [...evidence],
    size: () => evidence.length,
  };
}

/**
 * Sözleşme kapsamı eksikse HEDEFLİ onarım isteği üretir.
 * GEÇMİŞ HATA: eksik kanıt MARKET_MOVERS iken onarım turu
 * run_investment_research_scan çalıştırdı — o araç MARKET_MOVERS üretmiyor.
 * Sözleşme doğru hedefi hesaplıyordu ama kimse okumuyordu; artık okunuyor.
 */
/**
 * Composer'a cevabı YAZMADAN ÖNCE verilecek kapsam brifingi.
 *
 * NEDEN: kapsam eskiden yalnız cevaptan SONRA hesaplanıyordu. Model bloke alt
 * soru hakkında rahatça hüküm kuruyor, deterministik kapı sonra o hükmü
 * indiriyordu; aynı cevapta "sosyal kanıtı kapattım" ile "sosyal kanıt
 * BLOCKED" yan yana durabiliyordu.
 *
 * SINIR: brifing bir kapı DEĞİLDİR, bir bilgilendirmedir. Modelin uymasını
 * umar; garanti etmez. Deterministik indirme (neutralizeEquityVerdicts) ve
 * seviye kapısı yerinde kalır. Model sözü kanıt değildir.
 */
function buildCoverageBriefing(coverage) {
  const describe = (sq) => {
    const missing = (sq.missingEvidence || []).length > 0
      ? ` — eksik: ${sq.missingEvidence.join(', ')}`
      : '';
    return `- [${sq.id}] ${sq.question} → ${sq.status}${missing}`;
  };

  const complete = (coverage.subQuestions || []).filter((sq) => sq.status === 'COMPLETE');
  const partial = (coverage.subQuestions || []).filter((sq) => sq.status === 'PARTIAL');
  const blocked = (coverage.subQuestions || []).filter((sq) => sq.status === 'BLOCKED');

  return [
    '[ÇEKİRDEK ZORUNLULUK — KAPSAM BRİFİNGİ]',
    `Araştırma sözleşmesi ${coverage.status} durumunda. Bu bilgi kanıt defterinden`,
    'deterministik olarak hesaplandı; senin beyanın değil, araçların gerçekte ürettiği kanıt.',
    '',
    complete.length ? 'KANITI TAM olan alt sorular (bunlarda hüküm kurabilirsin):' : 'KANITI TAM alt soru YOK.',
    ...complete.map(describe),
    '',
    partial.length ? 'KANITI KISMİ alt sorular (bulguyu yaz, KESİN hüküm kurma):' : '',
    ...partial.map(describe),
    '',
    blocked.length ? 'KANITI BLOKE alt sorular (bu konuda hüküm kurma, eksikliği açıkça yaz):' : '',
    ...blocked.map(describe),
    '',
    'Cevabını bu kapsamla YENİDEN yaz:',
    '1. Kanıtı tam olmayan alt soru için kesin AL/SAT hükmü kurma.',
    '2. Kanıtı tam olmayan sembol için somut giriş/stop/hedef RAKAMI verme.',
    '   ("AL demedim ama stop 553 yaz" da uygulanabilir bir işlem talimatıdır.)',
    '3. Kanıtı tam olan alt sorulardaki bulguları OLDUĞU GİBİ koru — eksik bir',
    '   katman yüzünden tüm araştırmayı çöpe atma.',
    '4. Eksik olanı sakla değil, açıkça söyle: hangi kanıt yok, neden hüküm yok.',
    '5. Yeni araç çağırma; bu bir yeniden yazım turu.',
  ].filter((line) => line !== '').join('\n');
}

function buildContractRepairRequest(userMessage, coverage) {
  if (!coverage || coverage.status === CONTRACT_STATUS.COMPLETE || coverage.status === CONTRACT_STATUS.PLAN_REQUIRED) return null;

  const gaps = coverage.subQuestions.filter((sq) => sq.missingEvidence.length > 0);
  if (gaps.length === 0) return null;

  const actionable = gaps
    .map((sq) => {
      const producible = sq.missingEvidence.filter((klass) => toolsProducing(klass).length > 0);
      if (producible.length === 0) return null;
      return `- [${sq.id}] eksik: ${producible.join(', ')} → çağır: ${[...new Set(producible.flatMap(toolsProducing))].join(' veya ')}`;
    })
    .filter(Boolean);

  if (actionable.length === 0) return null;

  return {
    missingBySubQuestion: gaps.map((sq) => ({ id: sq.id, missing: sq.missingEvidence, tools: sq.repairTools })),
    capabilityGaps: coverage.capabilityGaps,
    message: [
      String(userMessage || ''),
      '',
      '[ÇEKİRDEK ZORUNLULUK — SÖZLEŞME ONARIMI]',
      'Araştırma planın kilitli ve GEÇERLİ. Yeniden plan sunma (submit_research_plan reddedilir).',
      'Şu alt soruların zorunlu kanıtı eksik; SADECE aşağıda yazan araçları çağır:',
      ...actionable,
      coverage.capabilityGaps.length > 0
        ? `Şu kanıt sınıflarını üreten araç YOK, onları toplamaya çalışma ve cevapta yetenek boşluğu olarak bildir: ${coverage.capabilityGaps.join(', ')}.`
        : '',
      'Başka araç çalıştırma; eksik kanıt kapanmıyorsa ilgili alt soruda hüküm verme.',
    ].filter(Boolean).join('\n'),
  };
}

module.exports = {
  buildContractRepairRequest,
  buildCoverageBriefing,
  createResearchRun,
  universeScopeFor,
  detectUniverseClaim,
  evaluateUniverseCoverage,
  OUTPUT_KIND_ADMISSIBLE_EVIDENCE,
  OUTPUT_KIND_MINIMUM_EVIDENCE,
  ENTITY_SCOPED_OUTPUT_KINDS,
  extractEntities,
  extractAsOf,
  CONTRACT_STATUS,
  SUB_QUESTION_STATUS,
  OUTPUT_KINDS,
  PRODUCIBLE_EVIDENCE_CLASSES,
  CONTRACT_COMPLEXITY_THRESHOLD,
  CONTRACT_EXEMPT_TOOLS,
  createResearchContract,
  submitPlan,
  amendPlan,
  evaluateContract,
  requiresResearchContract,
  checkContractGate,
  countDistinctTickers,
  toolsProducing,
};
