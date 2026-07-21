'use strict';

/**
 * Tek kaynak (single source of truth) yatırım araştırma policy çekirdeği.
 *
 * Bu dosya hem TypeScript paketi (packages/core/investment-research/src/index.ts)
 * hem de Electron runtime (apps/desktop/electron/deterministic-agents.cjs)
 * tarafından tüketilir. Kural verisi veya mod tespiti değişecekse SADECE burası
 * değiştirilir; iki tarafta kopya tutulmaz. Electron tarafındaki fallback kopyası
 * yalnız packaged-app yol çözümlemesi bozulursa devreye girer ve
 * tests/investment-research-policy-core.test.mjs drift'i yakalar.
 */

const POLICY_CORE_VERSION = '2.0.0';

const RESEARCH_MODES = Object.freeze([
  'FRESH_MARKET_SCAN',
  'COMPANY_DEEP_DIVE',
  'PORTFOLIO_FIT',
  'WATCHLIST_REFRESH',
  'EVENT_DRIVEN_UPDATE',
  'SECTOR_RESEARCH',
  'RISK_REVIEW',
  'VALUATION_UPDATE',
]);

const RESEARCH_STATES = Object.freeze([
  'INTAKE',
  'MODE_SELECTED',
  'MANDATE_CHECK',
  'MANDATE_DEFINED',
  'RESEARCH_CHARTER_CREATED',
  'UNIVERSE_BUILDING',
  'UNIVERSE_FROZEN',
  'SOURCE_PLAN_CREATED',
  'DISCOVERY_RESEARCH',
  'CANDIDATE_SCREENING',
  'DEEP_DIVE_RESEARCH',
  'VALUATION_ANALYSIS',
  'SCENARIO_ANALYSIS',
  'RISK_ANALYSIS',
  'RED_TEAM_REVIEW',
  'SUITABILITY_REVIEW',
  'EVIDENCE_VALIDATION',
  'DECISION_READY',
  'REPORT_READY',
  'MONITORING_PLAN_CREATED',
  'POST_MORTEM_REVIEW',
  'COMPLETED',
  'BLOCKED',
  'FAILED',
]);

/**
 * Deterministik geçiş tablosu. Bir state'ten yalnız burada listelenen
 * state'lere geçilebilir. BLOCKED/FAILED/COMPLETED terminaldir; BLOCKED
 * yalnız unblock() ile kaldığı state'e döner (state machine implementasyonu).
 */
const RESEARCH_STATE_TRANSITIONS = Object.freeze({
  INTAKE: ['MODE_SELECTED', 'FAILED'],
  MODE_SELECTED: ['MANDATE_CHECK', 'FAILED'],
  MANDATE_CHECK: ['MANDATE_DEFINED', 'RESEARCH_CHARTER_CREATED', 'BLOCKED'],
  MANDATE_DEFINED: ['RESEARCH_CHARTER_CREATED'],
  RESEARCH_CHARTER_CREATED: ['UNIVERSE_BUILDING', 'SOURCE_PLAN_CREATED'],
  UNIVERSE_BUILDING: ['UNIVERSE_FROZEN', 'BLOCKED', 'FAILED'],
  UNIVERSE_FROZEN: ['SOURCE_PLAN_CREATED'],
  SOURCE_PLAN_CREATED: ['DISCOVERY_RESEARCH', 'DEEP_DIVE_RESEARCH'],
  DISCOVERY_RESEARCH: ['CANDIDATE_SCREENING', 'BLOCKED', 'FAILED'],
  CANDIDATE_SCREENING: ['DEEP_DIVE_RESEARCH', 'BLOCKED'],
  DEEP_DIVE_RESEARCH: ['VALUATION_ANALYSIS', 'BLOCKED', 'FAILED'],
  VALUATION_ANALYSIS: ['SCENARIO_ANALYSIS', 'BLOCKED'],
  SCENARIO_ANALYSIS: ['RISK_ANALYSIS'],
  RISK_ANALYSIS: ['RED_TEAM_REVIEW'],
  RED_TEAM_REVIEW: ['SUITABILITY_REVIEW', 'EVIDENCE_VALIDATION'],
  SUITABILITY_REVIEW: ['EVIDENCE_VALIDATION'],
  EVIDENCE_VALIDATION: ['DECISION_READY', 'DEEP_DIVE_RESEARCH', 'BLOCKED'],
  DECISION_READY: ['REPORT_READY', 'BLOCKED'],
  REPORT_READY: ['MONITORING_PLAN_CREATED', 'COMPLETED'],
  MONITORING_PLAN_CREATED: ['COMPLETED', 'POST_MORTEM_REVIEW'],
  POST_MORTEM_REVIEW: ['COMPLETED'],
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
});

/**
 * State bazlı capability allowlist. Tool adı yerine capability tanımlanır;
 * araç değişse de politika bozulmaz. Listede olmayan capability o state'te
 * yasaktır. REPORT_READY kasıtlı olarak yalnız doğrulanmış araştırma kaydını
 * okuyabilir: web araması, piyasa verisi ve yeni claim üretimi kapalıdır.
 */
const STATE_CAPABILITIES = Object.freeze({
  INTAKE: ['intent_classification'],
  MODE_SELECTED: ['policy_lookup'],
  MANDATE_CHECK: ['user_profile_read'],
  MANDATE_DEFINED: ['user_profile_read'],
  RESEARCH_CHARTER_CREATED: ['policy_lookup'],
  UNIVERSE_BUILDING: ['market_universe_fetch', 'kap_company_list'],
  UNIVERSE_FROZEN: ['policy_lookup'],
  SOURCE_PLAN_CREATED: ['policy_lookup'],
  DISCOVERY_RESEARCH: ['web_search', 'news_search', 'market_screener', 'market_data_fetch'],
  CANDIDATE_SCREENING: ['market_data_fetch', 'financial_calculator'],
  DEEP_DIVE_RESEARCH: [
    'official_filing_fetch',
    'financial_statement_fetch',
    'company_ir_fetch',
    'news_search',
    'web_search',
    'market_data_fetch',
  ],
  VALUATION_ANALYSIS: ['financial_calculator', 'valuation_model'],
  SCENARIO_ANALYSIS: ['financial_calculator', 'valuation_model'],
  RISK_ANALYSIS: ['financial_calculator', 'news_search'],
  RED_TEAM_REVIEW: ['evidence_read', 'news_search', 'web_search'],
  SUITABILITY_REVIEW: ['user_profile_read', 'evidence_read'],
  EVIDENCE_VALIDATION: ['source_verifier', 'claim_validator', 'calculation_validator', 'evidence_read'],
  DECISION_READY: ['evidence_read', 'gate_results_read'],
  REPORT_READY: ['verified_research_read'],
  MONITORING_PLAN_CREATED: ['monitoring_config'],
  POST_MORTEM_REVIEW: ['audit_read'],
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
});

/**
 * Kademeli freshness kuralları. STALE tek bayrağı yerine veri kategorisine
 * göre davranış: fiyat/kur gibi anlık veriler sert bloklanır, tarihsel seriler
 * doğal olarak eskidir, guidance geçerlilik penceresiyle değerlendirilir.
 * BLOCK_IF_NEWER_EXISTS: yalnız daha yeni versiyonu bilindiği halde eski
 * kullanılıyorsa bloklar.
 */
const FRESHNESS_RULES = Object.freeze({
  MARKET_PRICE: { maxAgeHours: 24, staleAction: 'BLOCK' },
  FX_RATE: { maxAgeHours: 24, staleAction: 'BLOCK' },
  MARKET_CAP: { maxAgeHours: 72, staleAction: 'BLOCK' },
  FINANCIAL_STATEMENT: { maxAgeHours: 24 * 150, staleAction: 'BLOCK_IF_NEWER_EXISTS' },
  MANAGEMENT_GUIDANCE: { maxAgeHours: 24 * 365, staleAction: 'WARN' },
  HISTORICAL_SERIES: { staleAction: 'ALLOW' },
  SECTOR_STRUCTURE: { maxAgeHours: 24 * 365, staleAction: 'WARN' },
  NEWS_EVENT: { maxAgeHours: 24 * 30, staleAction: 'WARN' },
  UNSPECIFIED: { staleAction: 'WARN_OR_BLOCK_ON_CRITICAL' },
});

const BASE_REQUIRED_STATES = Object.freeze([
  'RESEARCH_CHARTER_CREATED',
  'SOURCE_PLAN_CREATED',
  'EVIDENCE_VALIDATION',
  'REPORT_READY',
]);

const FRESH_MARKET_SCAN_REQUIRED_STATES = Object.freeze([
  'RESEARCH_CHARTER_CREATED',
  'UNIVERSE_FROZEN',
  'SOURCE_PLAN_CREATED',
  'DISCOVERY_RESEARCH',
  'CANDIDATE_SCREENING',
  'DEEP_DIVE_RESEARCH',
  'VALUATION_ANALYSIS',
  'SCENARIO_ANALYSIS',
  'RISK_ANALYSIS',
  'RED_TEAM_REVIEW',
  'EVIDENCE_VALIDATION',
  'DECISION_READY',
  'REPORT_READY',
  'MONITORING_PLAN_CREATED',
]);

const DEEP_DIVE_REQUIRED_STATES = Object.freeze([
  ...BASE_REQUIRED_STATES,
  'DEEP_DIVE_RESEARCH',
  'VALUATION_ANALYSIS',
  'RISK_ANALYSIS',
  'RED_TEAM_REVIEW',
]);

const FRESH_SCAN_FORBIDDEN_SHORTCUTS = Object.freeze([
  'select_only_recent_gainers',
  'use_search_snippet_as_evidence',
  'recommend_from_single_source',
  'skip_counter_thesis',
  'use_memory_as_evidence',
  'use_watchlist_as_seed',
]);

const WATCHLIST_FORBIDDEN_SHORTCUTS = Object.freeze([
  'use_previous_recommendations_as_evidence',
  'use_search_snippet_as_evidence',
  'recommend_from_single_source',
  'skip_counter_thesis',
]);

const DEFAULT_FINAL_DECISION = Object.freeze({
  requireMandateForPersonalizedRecommendation: true,
  requireUniverse: true,
  requirePrimaryEvidence: true,
  requireCounterThesis: true,
  requireRiskAnalysis: true,
  requireValuationAssumptions: true,
  minEvidenceConfidenceForBuy: 0.75,
});

const DEEP_DIVE_FINAL_DECISION = Object.freeze({
  ...DEFAULT_FINAL_DECISION,
  requireUniverse: false,
});

const MODE_POLICY_DATA = Object.freeze({
  FRESH_MARKET_SCAN: {
    id: 'fresh-market-scan',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: false,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: FRESH_MARKET_SCAN_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEFAULT_FINAL_DECISION,
  },
  COMPANY_DEEP_DIVE: {
    id: 'company-deep-dive',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: DEEP_DIVE_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEEP_DIVE_FINAL_DECISION,
  },
  PORTFOLIO_FIT: {
    id: 'portfolio-fit',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: DEEP_DIVE_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEEP_DIVE_FINAL_DECISION,
  },
  WATCHLIST_REFRESH: {
    id: 'watchlist-refresh',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: true,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: FRESH_MARKET_SCAN_REQUIRED_STATES,
    forbiddenShortcuts: WATCHLIST_FORBIDDEN_SHORTCUTS,
    finalDecision: DEFAULT_FINAL_DECISION,
  },
  EVENT_DRIVEN_UPDATE: {
    id: 'event-driven-update',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: DEEP_DIVE_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEEP_DIVE_FINAL_DECISION,
  },
  SECTOR_RESEARCH: {
    id: 'sector-research',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: false,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: FRESH_MARKET_SCAN_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEFAULT_FINAL_DECISION,
  },
  RISK_REVIEW: {
    id: 'risk-review',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: DEEP_DIVE_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEEP_DIVE_FINAL_DECISION,
  },
  VALUATION_UPDATE: {
    id: 'valuation-update',
    version: '1.1.0',
    memory: {
      useUserPreferences: true,
      usePreviousCandidates: true,
      useWatchlistAsSeed: false,
      usePreviousRecommendationsAsEvidence: false,
    },
    requiredStates: DEEP_DIVE_REQUIRED_STATES,
    forbiddenShortcuts: FRESH_SCAN_FORBIDDEN_SHORTCUTS,
    finalDecision: DEEP_DIVE_FINAL_DECISION,
  },
});

/**
 * Mandate'te varsayımla doldurulması kişiselleştirilmiş öneriyi geçersiz kılan
 * kritik alanlar. Bu alanlardan biri kullanıcı beyanı yerine sistem varsayımı
 * ise mandate "tamamlanmış" sayılamaz (sahte kişiselleştirme koruması).
 */
const MANDATE_CRITICAL_FIELDS = Object.freeze([
  'riskTolerance',
  'horizonMonths',
  'maxDrawdownPercent',
]);

const RETRYABLE_STATES = Object.freeze({
  DISCOVERY_RESEARCH: 2,
  DEEP_DIVE_RESEARCH: 2,
  UNIVERSE_BUILDING: 2,
  EVIDENCE_VALIDATION: 1,
});

function normalizeResearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u');
}

function detectResearchMode(message) {
  const text = normalizeResearchText(message);
  if (/watchlist|izleme listesi|takip listesi|portfoydeki|portfoyumdeki/.test(text)) {
    return 'WATCHLIST_REFRESH';
  }
  if (/sifirdan|bastan|genis tara|piyasayi tara|piyasa taramasi|hangi hisseler|sepet|aday cikar|firsat hisseleri/.test(text)) {
    return 'FRESH_MARKET_SCAN';
  }
  if (/portfoy|pozisyon buyuklugu|uygun mu|bana uygun/.test(text)) {
    return 'PORTFOLIO_FIT';
  }
  if (/degerleme|hedef fiyat|fair value|iskontolu nakit/.test(text)) {
    return 'VALUATION_UPDATE';
  }
  if (/risk|ters tez|red team/.test(text)) {
    return 'RISK_REVIEW';
  }
  if (/sektor|endustri/.test(text)) {
    return 'SECTOR_RESEARCH';
  }
  if (/bilancco|bilanco|haber|kap|olay|gelisme/.test(text)) {
    return 'EVENT_DRIVEN_UPDATE';
  }
  return 'COMPANY_DEEP_DIVE';
}

function isTransitionAllowed(fromState, toState) {
  const allowed = RESEARCH_STATE_TRANSITIONS[fromState];
  return Array.isArray(allowed) && allowed.includes(toState);
}

/**
 * Tamamlanmış state dizisinin geçiş tablosuna göre geçerli bir yol olup
 * olmadığını doğrular. Checklist'in aksine sıra ihlalini yakalar.
 */
function validateStateSequence(states) {
  const sequence = Array.isArray(states) ? states : [];
  const violations = [];
  for (let i = 1; i < sequence.length; i += 1) {
    const from = sequence[i - 1];
    const to = sequence[i];
    if (!RESEARCH_STATE_TRANSITIONS[from]) {
      violations.push(`Bilinmeyen state: ${from}`);
      continue;
    }
    if (!isTransitionAllowed(from, to)) {
      violations.push(`Gecersiz gecis: ${from} -> ${to}`);
    }
  }
  return { valid: violations.length === 0, violations };
}

function isCapabilityAllowed(state, capability) {
  const allowed = STATE_CAPABILITIES[state];
  return Array.isArray(allowed) && allowed.includes(capability);
}

/**
 * Kademeli freshness değerlendirmesi.
 * @returns {{ action: 'ALLOW'|'WARN'|'BLOCK', reason: string }}
 */
function evaluateFreshness(input) {
  const category = input.dataCategory && FRESHNESS_RULES[input.dataCategory]
    ? input.dataCategory
    : 'UNSPECIFIED';
  const rule = FRESHNESS_RULES[category];
  const ageHours = Number.isFinite(input.ageHours) ? input.ageHours : undefined;
  const isStale = input.freshnessStatus === 'STALE' ||
    (rule.maxAgeHours !== undefined && ageHours !== undefined && ageHours > rule.maxAgeHours);

  if (!isStale) {
    return { action: 'ALLOW', reason: `${category}: veri guncel.` };
  }

  switch (rule.staleAction) {
    case 'ALLOW':
      return { action: 'ALLOW', reason: `${category}: tarihsel veri, eskimesi dogal.` };
    case 'WARN':
      return { action: 'WARN', reason: `${category}: veri eski, dusuk guvenle kullanilabilir.` };
    case 'BLOCK':
      return { action: 'BLOCK', reason: `${category}: kritik guncel veri eski, karar girdisi olamaz.` };
    case 'BLOCK_IF_NEWER_EXISTS':
      return input.newerVersionKnown
        ? { action: 'BLOCK', reason: `${category}: daha yeni rapor varken eski rapor kullanilamaz.` }
        : { action: 'WARN', reason: `${category}: veri eski ama bilinen daha yeni surum yok.` };
    case 'WARN_OR_BLOCK_ON_CRITICAL':
    default:
      return input.materiality === 'HIGH' || input.materiality === 'CRITICAL'
        ? { action: 'BLOCK', reason: 'Kategorisiz eski veri HIGH/CRITICAL iddiada kullanilamaz.' }
        : { action: 'WARN', reason: 'Kategorisiz eski veri: dusuk onem, uyariyla gecti.' };
  }
}

/**
 * Kaynak ailesi anahtarı: aynı haberin kopyaları (aynı contentHash veya aynı
 * publisher+başlık normalize edilmiş hali) tek bağımsız kaynak sayılır.
 */
function evidenceFamilyKey(item) {
  if (item.contentHash) return `hash:${item.contentHash}`;
  const publisher = normalizeResearchText(item.publisher || 'unknown').replace(/[^a-z0-9]+/g, ' ').trim();
  const title = normalizeResearchText(item.title || '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Ayni ajans haberini kopyalayan farkli siteler tek aile sayilsin diye
  // yeterince ayirt edici basliklar tek basina aile anahtaridir.
  if (title.length >= 20) return `title:${title}`;
  return `meta:${publisher}|${title}`;
}

function countIndependentSources(evidenceItems) {
  const families = new Set();
  for (const item of evidenceItems || []) {
    families.add(evidenceFamilyKey(item));
  }
  return families.size;
}

module.exports = {
  POLICY_CORE_VERSION,
  RESEARCH_MODES,
  RESEARCH_STATES,
  RESEARCH_STATE_TRANSITIONS,
  STATE_CAPABILITIES,
  FRESHNESS_RULES,
  MODE_POLICY_DATA,
  MANDATE_CRITICAL_FIELDS,
  RETRYABLE_STATES,
  normalizeResearchText,
  detectResearchMode,
  isTransitionAllowed,
  validateStateSequence,
  isCapabilityAllowed,
  evaluateFreshness,
  evidenceFamilyKey,
  countIndependentSources,
};
