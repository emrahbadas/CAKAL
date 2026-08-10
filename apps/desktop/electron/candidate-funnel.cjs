'use strict';

/**
 * ADAY HUNİSİ SÖZLEŞMESİ — `research-contract.cjs`in tarama ikizi.
 *
 * Tasarım kararı: huni bir AJAN değildir. Sembol seçimini KOD yapar; modelin
 * işi yalnız çıkan tabloyu yorumlamaktır. Bu modül o kuralı beyanla değil
 * yapısal olarak uygular — model listeye sembol ekleyemez, çıkaramaz,
 * sıralamayı değiştiremez (`verifyAnswerSymbols`).
 *
 * NEDEN AYRI BİR TARAYICI DEĞİL: kademe 1–4 zaten `run_investment_research_scan`
 * içinde çalışıyor (evren → hard filter → soft ranking) ve o aracın çıktısında
 * `nextRequiredStates: [DEEP_DIVE_RESEARCH, VALUATION_ANALYSIS, RISK_ANALYSIS,
 * RED_TEAM_REVIEW, EVIDENCE_VALIDATION, DECISION_READY]` yazıyor. Huni o
 * kademelerin gövdesidir, ikinci bir tarayıcı değildir. Bu projede paralel
 * sistemin bedeli ölçüldü: iki ayrı onarım motoru tek soruda 4 iterasyon /
 * 103 saniye harcıyordu (`contractOwnsRepair` ile tek motora indirildi).
 *
 * EŞİK YOKTUR — BİLEREK. Bu modül şema, kademe grameri ve gerekçe kodudur.
 * Likidite tabanı, havuz boyutu, skor ağırlıkları ve geçme notu politika
 * dosyasından gelir (`packages/core/investment-research/policies/*.json`) ve
 * geriye dönük testle kalibre edilir. Buraya sabit sayı gömmek, bilimsel
 * tasarım görüntüsü altında kahve falı katsayısı kodlamak olurdu.
 */

// ── Kademeler ──
// Sıra bağlayıcıdır: her kademe bir öncekinin çıktısını daraltır.
const FUNNEL_STAGES = Object.freeze([
  'REQUEST_GATE',    // 0 — bu sorgu gerçekten piyasa-geneli aday araması mı?
  'UNIVERSE',        // 1 — pano anlık görüntüsü, zaman damgası + seans
  'ELIGIBILITY',     // 2 — veri kalitesi ve işlem yapılabilirlik
  'CHEAP_SCREEN',    // 3 — ucuz ön tarama (likidite, momentum, göreceli güç)
  'RESEARCH_POOL',   // 4 — derin araştırmaya girecek üst grup
  'DEEP_RESEARCH',   // 5 — temel, değerleme, katalizör, risk
  'FINAL_GATE',      // 6 — skor + kanıt güveni
]);

// Sembol daraltan kademeler. REQUEST_GATE sembol üzerinde çalışmaz.
const NARROWING_STAGES = Object.freeze(
  FUNNEL_STAGES.filter((stage) => stage !== 'REQUEST_GATE'),
);

/**
 * ELENME GEREKÇE KODLARI — kademeye bağlıdır.
 *
 * Kod kademeye bağlı, çünkü `research-contract.cjs`teki kanıt grameriyle aynı
 * hata sınıfını önlüyor: yanlış kademede kullanılan doğru görünüşlü kod, huniyi
 * denetlenemez hale getirir. "INSUFFICIENT_LIQUIDITY" derin araştırma kademesinde
 * yazılamaz — orada likiditeye zaten bakılmadı.
 */
const STAGE_REJECTION_REASONS = Object.freeze({
  ELIGIBILITY: Object.freeze([
    'INSUFFICIENT_LIQUIDITY',    // 20g medyan TL hacmi politika tabanının altında
    'INSUFFICIENT_HISTORY',      // yeterli seans geçmişi yok
    'INSUFFICIENT_DATA',         // veri bütünlüğü politika eşiğinin altında
    'NOT_CONTINUOUS_TRADING',    // tek fiyat yöntemi / sürekli işlem dışı
    'NEW_IPO',                   // yeni halka arz — ayrı huniye
    'SPECIAL_SITUATION',         // tedbir, birleşme, gözaltı pazarı vb.
    'STALE_QUOTE',               // pano kaydı seans saatiyle tutarsız
  ]),
  CHEAP_SCREEN: Object.freeze([
    'BELOW_SCREEN_CUTOFF',       // ön tarama sıralamasında havuz dışında kaldı
  ]),
  RESEARCH_POOL: Object.freeze([
    'POOL_BUDGET_EXCEEDED',      // havuz bütçesi doldu (kalite değil, maliyet)
  ]),
  DEEP_RESEARCH: Object.freeze([
    'FUNDAMENTALS_UNAVAILABLE',  // mali tablo alınamadı
    'VALUATION_UNAVAILABLE',     // değerleme girdileri üretilemedi
    'SOURCE_FAILED',             // kaynak hata/limit verdi — kalite hükmü DEĞİL
    'SECTOR_RULER_MISSING',      // sektöre uygun değerleme cetveli yok
  ]),
  FINAL_GATE: Object.freeze([
    'SCORE_BELOW_THRESHOLD',
    'CONFIDENCE_BELOW_THRESHOLD',
    'CRITICAL_EVIDENCE_MISSING',
    'OVEREXTENDED',              // fiyat uzaması cezası geçme notunu düşürdü
  ]),
});

// UNIVERSE kademesi kimseyi elemez: evrenin kendisidir.
const ALL_REJECTION_REASONS = Object.freeze(
  Object.values(STAGE_REJECTION_REASONS).flat(),
);

/**
 * Veri yokluğu ile kalite hükmü AYRI şeylerdir.
 *
 * Kaynak çöktüğü için elenen hisse "kötü şirket" değildir. Bu ayrım raporda
 * korunmazsa, İş Yatırım'ın limit vermesi sessizce "bu hisse elendi"ye dönüşür.
 * Bu kodlarla elenenler `dataGapDropouts` altında ayrı sayılır.
 */
const DATA_GAP_REASONS = Object.freeze(new Set([
  'INSUFFICIENT_DATA',
  'FUNDAMENTALS_UNAVAILABLE',
  'VALUATION_UNAVAILABLE',
  'SOURCE_FAILED',
  'SECTOR_RULER_MISSING',
]));

/** Huninin nihai hükmü. Aday bulunamaması BAŞARISIZLIK DEĞİLDİR. */
const FUNNEL_VERDICTS = Object.freeze({
  CANDIDATES_FOUND: 'CANDIDATES_FOUND',
  NO_CANDIDATE: 'NO_CANDIDATE',       // kriterleri karşılayan çıkmadı
  BLOCKED: 'BLOCKED',                 // huni tamamlanamadı (evren/kaynak)
});

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.IS$/i, '');
}

function uniqueSymbols(symbols) {
  return [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
}

/**
 * Yeni huni açar. `configVersion` ve `universeHash` zorunludur: sonuç ancak
 * hangi kural setiyle ve hangi evren anlık görüntüsüyle üretildiği bilinirse
 * yeniden üretilebilir.
 */
function createFunnel({
  funnelId,
  configVersion,
  strategyProfile,
  asOf,
  marketSession,
  universeHash,
  requestIntent = null,
  maxCandidates = null,
} = {}) {
  const missing = [];
  if (!funnelId) missing.push('funnelId');
  if (!configVersion) missing.push('configVersion');
  if (!strategyProfile) missing.push('strategyProfile');
  if (!asOf) missing.push('asOf');
  if (!marketSession) missing.push('marketSession');
  if (!universeHash) missing.push('universeHash');
  if (missing.length > 0) {
    throw new Error(`Huni açılamaz, zorunlu alanlar eksik: ${missing.join(', ')}`);
  }

  return {
    funnelId,
    configVersion,
    strategyProfile,
    asOf,
    marketSession,
    universeHash,
    requestIntent,
    maxCandidates,
    stages: [],
    evidenceRefs: {},
    scores: {},
    finalCandidates: [],
    reserveCandidates: [],
    verdict: null,
    finalizedAt: null,
  };
}

function lastStage(funnel) {
  return funnel.stages.length > 0 ? funnel.stages[funnel.stages.length - 1] : null;
}

/** Bir kademeyi kaydeder ve soy zinciri kurallarını uygular. */
function recordStage(funnel, { stage, kept, dropped = [], notes = null } = {}) {
  if (!NARROWING_STAGES.includes(stage)) {
    throw new Error(`Bilinmeyen kademe: ${stage}`);
  }
  const previous = lastStage(funnel);
  const expectedIndex = previous ? NARROWING_STAGES.indexOf(previous.stage) + 1 : 0;
  if (NARROWING_STAGES.indexOf(stage) !== expectedIndex) {
    throw new Error(
      `Kademe sırası bozuk: ${stage} beklenen ${NARROWING_STAGES[expectedIndex] || '(son)'} yerine geldi.`,
    );
  }

  const keptSymbols = uniqueSymbols(kept);
  const droppedEntries = (dropped || []).map((entry) => ({
    symbol: normalizeSymbol(entry.symbol),
    reason: String(entry.reason || ''),
    detail: entry.detail ?? null,
  }));

  // Gerekçe kodu kademeye ait olmalı.
  const allowed = STAGE_REJECTION_REASONS[stage] || [];
  for (const entry of droppedEntries) {
    if (!entry.reason) {
      throw new Error(`${stage}: ${entry.symbol} gerekçesiz elendi — sessiz eleme yasak.`);
    }
    if (!allowed.includes(entry.reason)) {
      throw new Error(
        `${stage} kademesinde geçersiz gerekçe: ${entry.reason}. İzinli: ${allowed.join(', ') || '(yok)'}`,
      );
    }
  }

  // SESSİZ KAYIP YASAĞI: önceki kademeden gelen her sembol ya bu kademede
  // duruyordur ya da gerekçesiyle elenmiştir. Üçüncü ihtimal yoktur.
  if (previous) {
    const droppedSet = new Set(droppedEntries.map((entry) => entry.symbol));
    const keptSet = new Set(keptSymbols);
    const lost = previous.kept.filter((symbol) => !keptSet.has(symbol) && !droppedSet.has(symbol));
    if (lost.length > 0) {
      throw new Error(
        `${stage}: ${lost.length} sembol gerekçesiz kayboldu (${lost.slice(0, 5).join(', ')}). ` +
        'Her elenen sembol gerekçe koduyla raporlanmalı.',
      );
    }
    const intruders = keptSymbols.filter((symbol) => !previous.kept.includes(symbol));
    if (intruders.length > 0) {
      throw new Error(
        `${stage}: önceki kademede olmayan sembol eklendi (${intruders.slice(0, 5).join(', ')}). ` +
        'Huni yalnız daraltır.',
      );
    }
  }

  funnel.stages.push({
    stage,
    kept: keptSymbols,
    dropped: droppedEntries,
    notes,
    recordedAt: new Date().toISOString(),
  });
  return funnel;
}

/** Bir sembol için kanıt referansı bağlar (hangi araç, ne zaman, hangi sınıf). */
function recordEvidence(funnel, symbol, { evidenceClass, toolName, retrievedAt, ref = null } = {}) {
  const key = normalizeSymbol(symbol);
  if (!key) throw new Error('Kanıt için sembol gerekli.');
  if (!evidenceClass || !toolName) {
    throw new Error(`${key}: kanıt referansı evidenceClass ve toolName ister.`);
  }
  if (!funnel.evidenceRefs[key]) funnel.evidenceRefs[key] = [];
  funnel.evidenceRefs[key].push({
    evidenceClass,
    toolName,
    retrievedAt: retrievedAt || new Date().toISOString(),
    ref,
  });
  return funnel;
}

/** Bir sembolün kademe skorlarını kaydeder (teknik, temel, değerleme, güven...). */
function recordScores(funnel, symbol, scores = {}) {
  const key = normalizeSymbol(symbol);
  if (!key) throw new Error('Skor için sembol gerekli.');
  funnel.scores[key] = { ...(funnel.scores[key] || {}), ...scores };
  return funnel;
}

/**
 * Huniyi kapatır ve nihai listeyi belirler.
 *
 * KOTA DOLDURMA YOKTUR: nihai liste FINAL_GATE'ten geçenlerin tamamıdır,
 * `maxCandidates` yalnız TAVANDIR. İki hisse geçtiyse iki tane döner; hiçbiri
 * geçmediyse NO_CANDIDATE döner ve bu geçerli bir sonuçtur.
 */
function finalizeFunnel(funnel, { reserveSymbols = [] } = {}) {
  const final = lastStage(funnel);
  if (!final || final.stage !== 'FINAL_GATE') {
    funnel.verdict = FUNNEL_VERDICTS.BLOCKED;
    funnel.finalizedAt = new Date().toISOString();
    return funnel;
  }

  let candidates = [...final.kept];
  if (Number.isFinite(funnel.maxCandidates) && funnel.maxCandidates > 0) {
    candidates = candidates.slice(0, funnel.maxCandidates);
  }
  funnel.finalCandidates = candidates;

  // Yedekler nihai listede olmayan ama son kademeye kadar gelmiş semboller.
  const finalSet = new Set(candidates);
  funnel.reserveCandidates = uniqueSymbols(reserveSymbols).filter((symbol) => !finalSet.has(symbol));

  funnel.verdict = candidates.length > 0
    ? FUNNEL_VERDICTS.CANDIDATES_FOUND
    : FUNNEL_VERDICTS.NO_CANDIDATE;
  funnel.finalizedAt = new Date().toISOString();
  return funnel;
}

/** Kademe sayıları — rapor ve denetim için (600 → 214 → 13 → 5). */
function stageCounts(funnel) {
  return funnel.stages.map((entry) => ({
    stage: entry.stage,
    kept: entry.kept.length,
    dropped: entry.dropped.length,
  }));
}

/** Gerekçe kodu bazında elenme sayıları. */
function rejectionReasonCodes(funnel) {
  const counts = {};
  for (const entry of funnel.stages) {
    for (const drop of entry.dropped) {
      const key = `${entry.stage}:${drop.reason}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Veri yokluğundan elenenler — kalite hükmüyle KARIŞTIRILMAMALI.
 * Bu sayı yüksekse huninin sonucu değil, kaynak erişimi sorgulanır.
 */
function dataGapDropouts(funnel) {
  const out = [];
  for (const entry of funnel.stages) {
    for (const drop of entry.dropped) {
      if (DATA_GAP_REASONS.has(drop.reason)) {
        out.push({ symbol: drop.symbol, stage: entry.stage, reason: drop.reason, detail: drop.detail });
      }
    }
  }
  return out;
}

/** Tek sembolün huni boyunca soy zinciri (rapordaki BRSAN dökümü). */
function candidateLineage(funnel, symbol) {
  const key = normalizeSymbol(symbol);
  const path = [];
  for (const entry of funnel.stages) {
    const drop = entry.dropped.find((item) => item.symbol === key);
    if (drop) {
      path.push({ stage: entry.stage, result: 'DROPPED', reason: drop.reason, detail: drop.detail });
      break;
    }
    if (entry.kept.includes(key)) {
      path.push({ stage: entry.stage, result: 'PASS' });
    }
  }
  return {
    symbol: key,
    path,
    scores: funnel.scores[key] || null,
    evidence: funnel.evidenceRefs[key] || [],
  };
}

/**
 * CANDIDATE_FUNNEL kanıt nesnesi. Kanıt sınıfı ANCAK bu nesne eksiksizse
 * geçerlidir — beyan yeterli değildir (araştırma sözleşmesiyle aynı ilke).
 */
function buildFunnelEvidence(funnel) {
  return {
    funnelId: funnel.funnelId,
    configVersion: funnel.configVersion,
    strategyProfile: funnel.strategyProfile,
    asOf: funnel.asOf,
    marketSession: funnel.marketSession,
    universeHash: funnel.universeHash,
    verdict: funnel.verdict,
    stageCounts: stageCounts(funnel),
    rejectionReasonCodes: rejectionReasonCodes(funnel),
    dataGapDropouts: dataGapDropouts(funnel),
    finalCandidates: funnel.finalCandidates,
    reserveCandidates: funnel.reserveCandidates,
    candidateLineage: funnel.finalCandidates.map((symbol) => candidateLineage(funnel, symbol)),
    evidenceRefs: funnel.evidenceRefs,
  };
}

/** Kanıt nesnesi eksiksiz mi? Eksik alan varsa CANDIDATE_FUNNEL üretilmez. */
function validateFunnelEvidence(evidence) {
  const required = [
    'funnelId', 'configVersion', 'strategyProfile', 'asOf', 'marketSession',
    'universeHash', 'verdict', 'stageCounts', 'rejectionReasonCodes',
    'finalCandidates', 'candidateLineage', 'evidenceRefs',
  ];
  const errors = [];
  for (const field of required) {
    const value = evidence?.[field];
    if (value === undefined || value === null) errors.push(`eksik alan: ${field}`);
  }
  if (evidence?.verdict && !FUNNEL_VERDICTS[evidence.verdict]) {
    errors.push(`geçersiz verdict: ${evidence.verdict}`);
  }
  // Nihai aday varsa her birinin soy zinciri görülebilmeli.
  if (Array.isArray(evidence?.finalCandidates) && Array.isArray(evidence?.candidateLineage)) {
    const traced = new Set(evidence.candidateLineage.map((item) => item.symbol));
    const untraced = evidence.finalCandidates.filter((symbol) => !traced.has(symbol));
    if (untraced.length > 0) errors.push(`soy zinciri yok: ${untraced.join(', ')}`);
  }
  return { valid: errors.length === 0, errors };
}

// Cevap metninden sembol çıkarırken büyük harfli her dizi sembol değildir.
// (Projede aynı tuzak iki kez yaşandı: "BIST" 4 harfli diye ticker sanıldı;
// "FRESH MARKET SCAN" başlığındaki MARKET sembol sanıldı.)
const DEFAULT_SYMBOL_STOPWORDS = Object.freeze(new Set([
  'BIST', 'XU030', 'XU050', 'XU100', 'KAP', 'TCMB', 'USD', 'EUR', 'TRY', 'TL',
  'AL', 'SAT', 'FAVÖK', 'FAVOK', 'NAD', 'ROE', 'MARKET', 'SCAN', 'FRESH',
]));

function extractCandidateSymbols(text, stopwords = DEFAULT_SYMBOL_STOPWORDS) {
  const matches = String(text || '').match(/\b[A-ZÇĞİÖŞÜ]{3,8}\b/g) || [];
  return [...new Set(matches.filter((token) => !stopwords.has(token)))];
}

/**
 * MODEL LİSTEYİ DEĞİŞTİREMEZ KAPISI.
 *
 * Huninin tüm değeri buradadır: seçim kodda yapıldıysa, cevabın da o seçimi
 * anlatması gerekir. Model huniden geçmemiş bir sembolü aday gibi sunuyorsa
 * (`invented`) ya da geçmiş bir adayı yutuyorsa (`omitted`) cevap hükümsüzdür.
 *
 * `invented` yalnız huninin EVRENİNDE olup nihai listede olmayan semboller
 * üzerinden hesaplanır; metinde geçen alakasız büyük harfli kelime aday
 * iddiası sayılmaz.
 */
function verifyAnswerSymbols(funnel, answerText, { stopwords = DEFAULT_SYMBOL_STOPWORDS } = {}) {
  const mentioned = new Set(extractCandidateSymbols(answerText, stopwords));
  const finalSet = new Set(funnel.finalCandidates);
  const universe = new Set(funnel.stages[0]?.kept || []);
  const reserve = new Set(funnel.reserveCandidates);

  const invented = [...mentioned].filter(
    (symbol) => universe.has(symbol) && !finalSet.has(symbol) && !reserve.has(symbol),
  );
  const omitted = funnel.finalCandidates.filter((symbol) => !mentioned.has(symbol));

  return {
    valid: invented.length === 0 && omitted.length === 0,
    invented,
    omitted,
  };
}

module.exports = {
  FUNNEL_STAGES,
  NARROWING_STAGES,
  STAGE_REJECTION_REASONS,
  ALL_REJECTION_REASONS,
  DATA_GAP_REASONS,
  FUNNEL_VERDICTS,
  DEFAULT_SYMBOL_STOPWORDS,
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
  extractCandidateSymbols,
  verifyAnswerSymbols,
};
