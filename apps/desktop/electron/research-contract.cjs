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
  EVIDENCE_TTL_MS,
  hasFreshEvidence,
  hasFreshEvidenceForEntity,
  isCommanderFinanceMessage,
  isCommanderActionableFinanceRequest,
  isCommanderFreshMarketScanRequest,
  COMMANDER_RANKING_REQUEST_RE,
  containsBistTicker,
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
  investable_candidate: ['FUNDAMENTALS', 'VALUATION', 'CURRENT_EQUITY_PRICE', 'EARNINGS_PRICE_REACTION', 'TECHNICAL_SIGNAL', 'RESEARCH_EVIDENCE', 'MARKET_SESSION_STATUS'],
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
      // Hangi sembolün hangi kanıtı eksik — onarım isteğinde adıyla istenir.
      missingByEntity: [...entityMiss.entries()].map(([klass, ents]) => ({ evidenceClass: klass, entities: ents })),
      // Onarım ipucu: hangi aracın çağrılacağı tahmin edilmez, haritadan gelir.
      repairTools: [...new Set(missing.flatMap(toolsProducing))],
    };
  });

  const complete = evaluated.filter((sq) => sq.status === SUB_QUESTION_STATUS.COMPLETE);
  const blocked = evaluated.filter((sq) => sq.status === SUB_QUESTION_STATUS.BLOCKED);

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
const TICKER_STOPWORDS = new Set([
  // borsa / kurum / endeks
  'BIST', 'BORSA', 'VIOP', 'TEFAS', 'TCMB', 'BDDK', 'TUIK', 'IMKB', 'ENDEKS',
  // yaygın büyükharf yazılan Türkçe sözcükler
  'KAPS', 'ANCAK', 'FAKAT', 'VERI', 'ANALIZ', 'RAPOR', 'TOPLAM', 'ORTALAMA',
  'HISSE', 'PIYASA', 'FIYAT', 'HEDEF', 'YATIRIM', 'PORTFOY', 'BILANCO',
]);

function countDistinctTickers(message) {
  const found = new Set();
  const text = String(message || '');
  let match;
  TICKER_RE.lastIndex = 0;
  while ((match = TICKER_RE.exec(text)) !== null) {
    const token = match[2];
    if (!TICKER_STOPWORDS.has(token)) found.add(token);
  }
  return found.size;
}

/**
 * Bu istek araştırma sözleşmesi gerektiriyor mu?
 * Dönen skor ve sinyaller log'a yazılır — kararın neden verildiği görünür olur.
 */
function requiresResearchContract(message = '') {
  const text = String(message || '');
  const signals = [];
  let score = 0;

  if (!isCommanderFinanceMessage(text)) {
    return { required: false, score: 0, signals: ['finans baglami yok'], threshold: CONTRACT_COMPLEXITY_THRESHOLD };
  }

  const tickerCount = countDistinctTickers(text);
  if (tickerCount >= 2) { score += 2; signals.push(`coklu sirket (${tickerCount})`); }

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
  if (isCommanderActionableFinanceRequest(text)) {
    const equityTrade = containsBistTicker(text);
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
  return [...out];
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

function createResearchRun(opts = {}) {
  const runId = opts.runId || `R-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const userQuestion = String(opts.userQuestion || '');
  let contract = createResearchContract({ runId, userQuestion });
  const evidence = [];

  // Karmaşıklık ve semboller YALNIZ orijinal kullanıcı mesajından, BİR KEZ.
  // GEÇMİŞ HATA: her onarım turunda yeniden hesaplanıyordu ve onarım
  // promptuna eklenen metin yüzünden sembol sayısı sürükleniyordu
  // ("coklu sirket (3)" → "(4)").
  const complexity = requiresResearchContract(userQuestion);

  return {
    runId,
    userQuestion,
    complexity,
    get: () => contract,
    set: (next) => { contract = next; },
    /** Araç GERÇEKTEN çalıştığında çağrılır. Performans kaydından bağımsızdır. */
    record(toolName, args, result) {
      if (!TOOL_EVIDENCE_CLASSES[toolName]) return;
      if (!result || result.success === false) return; // başarısız çağrı kanıt değildir
      evidence.push({
        researchRunId: runId,
        type: 'tool_call',
        tool: toolName,
        entities: extractEntities(args, result),
        evidenceClasses: TOOL_EVIDENCE_CLASSES[toolName],
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
  createResearchRun,
  universeScopeFor,
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
