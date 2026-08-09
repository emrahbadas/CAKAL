const { evaluateRiskGate } = require('./decision-guards.cjs');

// Tek kaynak yatirim arastirma policy cekirdegi. Kural degisikligi yalnizca
// packages/core/investment-research/shared/policy-core.cjs icinde yapilir.
// Asagidaki inline sabitler yalnizca packaged-app yol cozumlemesi bozulursa
// devreye giren fallback'tir; drift'i tests/investment-research-policy-core
// esdegerlik testi yakalar.
let investmentPolicyCore = null;
try {
  // eslint-disable-next-line global-require
  investmentPolicyCore = require('../../../packages/core/investment-research/shared/policy-core.cjs');
} catch (err) {
  investmentPolicyCore = null;
}

const SUPPORTED_AGENT_ACTIONS = Object.freeze({
  arbitrage: ['analyze_price_gap', 'calculate_landed_cost', 'rank_arbitrage_opportunities'],
  'street-hunter': ['scan_urgency', 'generate_bargain_message', 'rank_street_deals'],
  finance: ['analyze_signal', 'generate_watchlist_signals', 'compare_assets', 'risk_assessment', 'evaluate_research_workflow'],
  travel: ['trip_budget'],
  judge: ['judge_single', 'judge_batch', 'compare', 'explain_score'],
  'commerce-vision': ['evaluate_unit_economics', 'rank_product_candidates', 'build_dropshipping_strategy'],
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 0) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function normalizeProfile(context = {}) {
  return context.userProfile || context.profile || {};
}

function getSupportedAgentActions(agentName) {
  return SUPPORTED_AGENT_ACTIONS[agentName] || [];
}

function buildInfo(agentName, label) {
  return {
    action: 'info',
    message: `${label} hazır. Aksiyonlar: ${getSupportedAgentActions(agentName).join(', ') || 'yok'}`,
    supportedActions: getSupportedAgentActions(agentName),
  };
}

function buildUnsupported(agentName, action) {
  return {
    action: 'unsupported',
    requestedAction: action || 'info',
    supportedActions: getSupportedAgentActions(agentName),
    message: `${agentName} runtime içinde "${action || 'info'}" aksiyonunu desteklemiyor.`,
  };
}

function buildRiskGateBlocked(action, payload, riskGate, extras = {}) {
  return {
    action: riskGate.status,
    requestedAction: action,
    asset: payload.asset,
    riskGate,
    ...extras,
    message: riskGate.message,
  };
}

function getShippingRatePerKg(platform) {
  const rates = {
    aliexpress: 120,
    dhgate: 150,
    '1688': 180,
    amazon: 200,
    ebay: 180,
  };
  return rates[String(platform || '').toLowerCase()] || 160;
}

function getArbitrageVerdict(netMarginPercent) {
  if (netMarginPercent >= 40) {
    return { label: 'MÜKEMMEL', emoji: '🟢', description: 'Yüksek kâr marjı, öncelikli fırsat.' };
  }
  if (netMarginPercent >= 25) {
    return { label: 'İYİ', emoji: '🟡', description: 'Sağlam arbitraj, ölçeklenebilir.' };
  }
  if (netMarginPercent >= 10) {
    return { label: 'ORTA', emoji: '🟠', description: 'Makul marj, maliyetleri yakından izle.' };
  }
  if (netMarginPercent >= 0) {
    return { label: 'DÜŞÜK', emoji: '🔴', description: 'Dar marj, sürpriz maliyet riski yüksek.' };
  }
  return { label: 'ZARAR', emoji: '⛔', description: 'Bu senaryoda para kaybedersin.' };
}

function estimateArbitrageCosts(sourcePriceTRY, platform) {
  const shipping = getShippingRatePerKg(platform) * 0.5;
  const thresholdTRY = 150 * 38;
  const customs = sourcePriceTRY > thresholdTRY ? sourcePriceTRY * 0.28 : 0;
  const commission = sourcePriceTRY * 0.12;
  return {
    shipping: Math.round(shipping),
    customs: Math.round(customs),
    commission: Math.round(commission),
    total: Math.round(shipping + customs + commission),
  };
}

function runArbitrageAgent(payload, context) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('arbitrage', 'Arbitrage Agent');
  }

  if (action === 'analyze_price_gap') {
    const product = payload.product;
    const sourcePlatform = payload.sourcePlatform || 'bilinmiyor';
    const targetPlatform = payload.targetPlatform || 'bilinmiyor';
    const sourcePrice = toNumber(payload.sourcePrice, 0);
    const targetPrice = toNumber(payload.targetPrice, 0);
    const currency = payload.currency || 'USD';
    const exchangeRate = toNumber(payload.exchangeRate, 34.5);
    const sourcePriceTRY = currency === 'TRY' ? sourcePrice : sourcePrice * exchangeRate;
    const grossGap = targetPrice - sourcePriceTRY;
    const grossMarginPercent = sourcePriceTRY > 0 ? (grossGap / sourcePriceTRY) * 100 : 0;
    const estimatedCosts = estimateArbitrageCosts(sourcePriceTRY, sourcePlatform);
    const netProfit = grossGap - estimatedCosts.total;
    const netMarginPercent = sourcePriceTRY > 0 ? (netProfit / sourcePriceTRY) * 100 : 0;

    return {
      action: 'price_gap_analysis',
      product,
      sourcePlatform,
      targetPlatform,
      sourcePrice: { original: sourcePrice, currency, tl: Math.round(sourcePriceTRY) },
      targetPrice: { tl: targetPrice },
      grossGap: Math.round(grossGap),
      grossMarginPercent: round(grossMarginPercent, 1),
      estimatedCosts,
      netProfit: Math.round(netProfit),
      netMarginPercent: round(netMarginPercent, 1),
      verdict: getArbitrageVerdict(netMarginPercent),
    };
  }

  if (action === 'calculate_landed_cost') {
    const productPriceTRY = toNumber(payload.productPriceTRY ?? payload.sourcePrice, 0);
    if (!productPriceTRY) {
      return { action, error: 'Ürün fiyatı (TL) gerekli' };
    }

    const sourcePlatform = payload.sourcePlatform || 'aliexpress';
    const weight = toNumber(payload.weightKg, 0.5);
    const quantity = Math.max(1, toNumber(payload.quantity, 1));
    const unitCost = productPriceTRY * quantity;
    const shippingCost = weight * quantity * getShippingRatePerKg(sourcePlatform);
    const thresholdTRY = 150 * 38;
    const customsDuty = unitCost > thresholdTRY ? unitCost * 0.28 : 0;
    const sellingCommission = unitCost * 0.12;
    const totalLandedCost = unitCost + shippingCost + customsDuty + sellingCommission;
    const sellingPrice = toNumber(payload.sellingPrice, 0);
    const netProfit = sellingPrice > 0 ? sellingPrice - totalLandedCost : undefined;
    const marginPercent = sellingPrice > 0 ? round((netProfit / sellingPrice) * 100, 1) : undefined;

    return {
      action: 'landed_cost',
      productPriceTRY: unitCost,
      quantity,
      weightKg: round(weight * quantity, 2),
      shippingCost: Math.round(shippingCost),
      customsDuty: Math.round(customsDuty),
      customsApplied: unitCost > thresholdTRY,
      sellingCommission: Math.round(sellingCommission),
      totalLandedCost: Math.round(totalLandedCost),
      breakEvenSellingPrice: Math.round(totalLandedCost * 1.05),
      sellingPrice: sellingPrice || undefined,
      netProfit: netProfit !== undefined ? Math.round(netProfit) : undefined,
      marginPercent,
    };
  }

  if (action === 'rank_arbitrage_opportunities') {
    const opportunities = Array.isArray(payload.opportunities) ? payload.opportunities : [];
    const profile = normalizeProfile(context);
    const riskTolerance = profile.riskTolerance || profile.risk_tolerance || 'medium';
    const ranked = opportunities
      .map((opp) => {
        const margin = toNumber(opp.netMarginPercent, 0);
        const volume = toNumber(opp.estimatedVolume, 1);
        const competitionLevel = opp.competitionLevel || 'medium';
        let score = margin * 2;
        if (volume > 10) score += 10;
        if (volume > 50) score += 20;
        if (competitionLevel === 'low') score += 15;
        if (competitionLevel === 'high') score -= 15;
        if (riskTolerance === 'low' && margin < 20) score -= 20;
        if (riskTolerance === 'high' && margin > 30) score += 10;
        return { ...opp, arbitrageScore: Math.round(score) };
      })
      .sort((a, b) => b.arbitrageScore - a.arbitrageScore);

    return {
      action: 'ranked',
      ranked,
      topPick: ranked[0] || null,
      count: ranked.length,
    };
  }

  return buildUnsupported('arbitrage', action);
}

function financeMomentum(current, previous, weeklyHigh, weeklyLow) {
  if (!current || !previous) {
    return { label: 'belirsiz', strength: 0, description: 'Yeterli veri yok' };
  }

  const change = ((current - previous) / previous) * 100;
  if (weeklyHigh && weeklyLow) {
    const range = weeklyHigh - weeklyLow;
    const position = range > 0 ? (current - weeklyLow) / range : 0.5;
    if (change > 2 && position > 0.8) return { label: 'güçlü_yükseliş', strength: 0.9, description: 'Haftalık zirve yakınında güçlü yükseliş.' };
    if (change > 0.5 && position > 0.5) return { label: 'yükseliş', strength: 0.6, description: 'Hafif yükseliş eğilimi.' };
    if (change < -2 && position < 0.2) return { label: 'güçlü_düşüş', strength: -0.9, description: 'Haftalık dip yakınında güçlü düşüş.' };
    if (change < -0.5 && position < 0.5) return { label: 'düşüş', strength: -0.6, description: 'Hafif düşüş eğilimi.' };
  }

  if (Math.abs(change) < 0.5) {
    return { label: 'yatay', strength: 0, description: 'Belirgin yön yok.' };
  }
  return {
    label: change > 0 ? 'yükseliş' : 'düşüş',
    strength: change > 0 ? 0.5 : -0.5,
    description: `%${Math.abs(change).toFixed(1)} ${change > 0 ? 'artış' : 'düşüş'}`,
  };
}

function financeVolume(volume, avgVolume) {
  const ratio = volume / avgVolume;
  if (ratio > 2) return { signal: 'çok_yüksek', ratio: round(ratio, 1), description: 'Anormal hacim artışı, kırılım olabilir.' };
  if (ratio > 1.5) return { signal: 'yüksek', ratio: round(ratio, 1), description: 'Ortalamanın üstünde hacim.' };
  if (ratio < 0.5) return { signal: 'düşük', ratio: round(ratio, 1), description: 'Düşük hacim, ilgi zayıf.' };
  return { signal: 'normal', ratio: round(ratio, 1), description: 'Normal hacim.' };
}

function financeSupportResistance(current, high, low) {
  if (!current || !high || !low) return { nearSupport: false, nearResistance: false, note: 'Veri yetersiz' };
  const range = high - low;
  if (range === 0) return { nearSupport: false, nearResistance: false, note: 'Dar bant' };
  const nearSupport = (current - low) / range < 0.1;
  const nearResistance = (high - current) / range < 0.1;
  if (nearSupport) return { nearSupport: true, nearResistance: false, note: 'Destek yakınında, dönüş olabilir.' };
  if (nearResistance) return { nearSupport: false, nearResistance: true, note: 'Direnç yakınında, satış baskısı gelebilir.' };
  return { nearSupport: false, nearResistance: false, note: 'Orta bölgede' };
}

function financeDirection(priceChange, momentum, volumeSignal) {
  let score = 0;
  if (priceChange !== undefined) score += priceChange > 0 ? 1 : -1;
  score += momentum.strength;
  if (volumeSignal === 'çok_yüksek') score += momentum.strength > 0 ? 0.5 : -0.5;
  if (score > 1) return { label: 'YUKARI', confidence: Math.min(0.9, score / 3), emoji: '📈' };
  if (score < -1) return { label: 'AŞAĞI', confidence: Math.min(0.9, Math.abs(score) / 3), emoji: '📉' };
  return { label: 'YATAY', confidence: 0.3, emoji: '➡️' };
}

function deriveFinanceVolatility(payload, currentPrice, weeklyHigh, weeklyLow) {
  const explicit = toNumber(payload.volatility, null);
  if (explicit !== null) return explicit;
  if (!currentPrice || !weeklyHigh || !weeklyLow) return null;
  return round(((weeklyHigh - weeklyLow) / currentPrice) * 100, 2);
}

function deriveFinanceSampleSize(payload, currentPrice, previousPrice, weeklyHigh, weeklyLow) {
  const explicit = toNumber(payload.sampleSize ?? payload.barCount, null);
  if (explicit !== null) return Math.max(0, explicit);
  if (Array.isArray(payload.recentCloses) && payload.recentCloses.length > 0) {
    return payload.recentCloses.length;
  }
  return currentPrice && previousPrice && weeklyHigh && weeklyLow ? 20 : 0;
}

function deriveFinanceSourceReliability(payload) {
  const explicit = toNumber(payload.sourceReliability ?? payload.sourceScore, null);
  if (explicit !== null) return explicit;
  const source = String(payload.source || '').toLowerCase();
  if (source === 'tcmb') return 90;
  if (source === 'yahoo_finance') return 85;
  return 75;
}

function deriveSignalRiskLevel(directionLabel, volatility) {
  if (directionLabel === 'YATAY') return 'low';
  if (volatility !== null && volatility > 8) return 'high';
  if (volatility !== null && volatility > 4) return 'medium';
  return 'low';
}

function financeSuggestPositionSize(amount, volatility, riskTolerance) {
  const maxRiskPercent = riskTolerance === 'high' ? 0.1 : riskTolerance === 'medium' ? 0.05 : 0.02;
  const volAdjust = Math.max(0.3, 1 - volatility / 20);
  const suggested = Math.round(amount * maxRiskPercent * volAdjust);
  const percent = amount > 0 ? Math.round((suggested / amount) * 100) : 0;
  return {
    amount: suggested,
    percent,
    reason: `Risk toleransına (${riskTolerance}) ve volatiliteye (${volatility}%) göre toplam bakiyenin %${percent}'i.`,
  };
}

function financeSuitability(volatility, riskTolerance) {
  if (riskTolerance === 'low' && volatility > 10) {
    return { suitable: false, reason: 'Düşük risk toleransın için bu varlık fazla dalgalı.' };
  }
  if (riskTolerance === 'medium' && volatility > 20) {
    return { suitable: false, reason: 'Orta risk toleransın için volatilite çok yüksek.' };
  }
  return { suitable: true, reason: 'Risk profiline uygun.' };
}

function financeChangeEmoji(change) {
  if (change > 3) return '🚀';
  if (change > 1) return '📈';
  if (change > 0) return '↗️';
  if (change > -1) return '↘️';
  if (change > -3) return '📉';
  return '💥';
}

const INVESTMENT_RESEARCH_PLANS = Object.freeze({
  FRESH_MARKET_SCAN: Object.freeze([
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
  ]),
  WATCHLIST_REFRESH: Object.freeze([
    'RESEARCH_CHARTER_CREATED',
    'SOURCE_PLAN_CREATED',
    'DISCOVERY_RESEARCH',
    'DEEP_DIVE_RESEARCH',
    'VALUATION_ANALYSIS',
    'RISK_ANALYSIS',
    'RED_TEAM_REVIEW',
    'EVIDENCE_VALIDATION',
    'DECISION_READY',
    'REPORT_READY',
    'MONITORING_PLAN_CREATED',
  ]),
  COMPANY_DEEP_DIVE: Object.freeze([
    'RESEARCH_CHARTER_CREATED',
    'SOURCE_PLAN_CREATED',
    'DEEP_DIVE_RESEARCH',
    'VALUATION_ANALYSIS',
    'RISK_ANALYSIS',
    'RED_TEAM_REVIEW',
    'EVIDENCE_VALIDATION',
    'REPORT_READY',
  ]),
});

function normalizeInvestmentResearchText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u');
}

function detectInvestmentResearchMode(message) {
  if (investmentPolicyCore) {
    return investmentPolicyCore.detectResearchMode(message);
  }
  const text = normalizeInvestmentResearchText(message);
  if (/watchlist|izleme listesi|takip listesi/.test(text)) return 'WATCHLIST_REFRESH';
  if (/sifirdan|bastan|genis tara|piyasayi tara|sepet|hangi hisseler|aday cikar|firsat hisseleri/.test(text)) return 'FRESH_MARKET_SCAN';
  return 'COMPANY_DEEP_DIVE';
}

function getInvestmentResearchPlanForMode(mode) {
  if (investmentPolicyCore && investmentPolicyCore.MODE_POLICY_DATA[mode]) {
    return investmentPolicyCore.MODE_POLICY_DATA[mode].requiredStates;
  }
  return INVESTMENT_RESEARCH_PLANS[mode] || INVESTMENT_RESEARCH_PLANS.COMPANY_DEEP_DIVE;
}

function getInvestmentResearchForbiddenShortcuts(mode) {
  if (investmentPolicyCore && investmentPolicyCore.MODE_POLICY_DATA[mode]) {
    return investmentPolicyCore.MODE_POLICY_DATA[mode].forbiddenShortcuts;
  }
  return mode === 'WATCHLIST_REFRESH'
    ? ['use_previous_recommendations_as_evidence', 'use_search_snippet_as_evidence', 'recommend_from_single_source', 'skip_counter_thesis']
    : ['select_only_recent_gainers', 'use_search_snippet_as_evidence', 'recommend_from_single_source', 'skip_counter_thesis', 'use_memory_as_evidence', 'use_watchlist_as_seed'];
}

// ── State provenance ──────────────────────────────────────────────────
// GEÇMİŞ SORUN: bu kapı `payload.completedStates`'i MODELİN BEYANINDAN
// okuyordu. Model "VALUATION_ANALYSIS tamamlandı" derse kapı onaylıyordu;
// yani deterministik görünen bir kapı aslında şeref sistemiydi.
//
// Artık iki sınıf ayrılıyor:
//   - KANITLANABİLİR state: bir aracın çalışmış olması gerekir. Beyan var
//     ama araç yoksa bu bir İHLALDİR ve bloklar.
//   - ANLATISAL state: hiçbir araçla kanıtlanamaz (charter yazmak, red team
//     yapmak). Bunlar "self-declared" olarak işaretlenir; doğrulanmış gibi
//     sunulmaz ama tek başına blok sebebi de değildir.
const STATE_PROVENANCE_TOOLS = Object.freeze({
  UNIVERSE_FROZEN: ['run_investment_research_scan', 'get_bist_board'],
  DISCOVERY_RESEARCH: ['run_investment_research_scan', 'get_bist_gainers', 'get_bist_board', 'web_search'],
  CANDIDATE_SCREENING: ['run_investment_research_scan'],
  DEEP_DIVE_RESEARCH: ['get_financial_statements', 'verify_claim'],
  VALUATION_ANALYSIS: ['get_financial_statements'],
  EVIDENCE_VALIDATION: ['verify_claim'],
  RISK_ANALYSIS: ['analyze_finance_signal', 'judge_opportunity'],
});

function extractProvenanceToolNames(events = []) {
  return new Set(
    (Array.isArray(events) ? events : [])
      .filter((event) => event && event.type === 'tool_call' && event.tool)
      .map((event) => String(event.tool)),
  );
}

function buildStateProvenance(claimedStates = [], events = []) {
  const usedTools = extractProvenanceToolNames(events);
  const attested = [];
  const unverified = [];
  const selfDeclared = [];

  for (const state of claimedStates) {
    const requiredTools = STATE_PROVENANCE_TOOLS[state];
    if (!requiredTools) {
      selfDeclared.push(state);
      continue;
    }
    if (requiredTools.some((tool) => usedTools.has(tool))) attested.push(state);
    else unverified.push({ state, expectedAnyOf: requiredTools });
  }

  return { usedTools: [...usedTools], attestedStates: attested, unverifiedStates: unverified, selfDeclaredStates: selfDeclared };
}

function runInvestmentResearchWorkflowPolicy(payload) {
  const mode = payload.mode || detectInvestmentResearchMode(payload.message);
  const requiredPlan = getInvestmentResearchPlanForMode(mode);
  const claimedStates = Array.isArray(payload.completedStates) ? payload.completedStates : [];
  const provenance = buildStateProvenance(claimedStates, payload.activityEvents || payload.events || []);
  const completed = new Set(claimedStates);
  const usedShortcuts = new Set(Array.isArray(payload.usedShortcuts) ? payload.usedShortcuts : []);
  if (payload.memoryCandidatesUsed) usedShortcuts.add('use_memory_as_evidence');
  if (payload.watchlistSeedUsed) usedShortcuts.add('use_watchlist_as_seed');
  if (payload.previousRecommendationEvidenceUsed) usedShortcuts.add('use_previous_recommendations_as_evidence');

  const forbidden = getInvestmentResearchForbiddenShortcuts(mode);

  const missingStates = requiredPlan.filter((state) => !completed.has(state));
  const forbiddenUsed = forbidden.filter((shortcut) => usedShortcuts.has(shortcut));
  const blockingReasons = [
    ...missingStates.map((state) => `Eksik state: ${state}`),
    ...forbiddenUsed.map((shortcut) => `Yasak kisa yol kullanildi: ${shortcut}`),
  ];

  if (mode === 'FRESH_MARKET_SCAN' && !payload.universe) {
    blockingReasons.push('Arastirma evreni dondurulmeden aday siralanamaz.');
  }

  // Gercek FSM gecis tarihcesi verildiyse sira ihlalini yakala.
  if (investmentPolicyCore && Array.isArray(payload.stateHistory) && payload.stateHistory.length > 0) {
    const sequence = investmentPolicyCore.validateStateSequence(payload.stateHistory);
    if (!sequence.valid) {
      blockingReasons.push(...sequence.violations);
    }
  }

  // State bazli capability denetimi: ornegin REPORT_READY icinde web_search
  // talebi ihlaldir.
  if (investmentPolicyCore && Array.isArray(payload.capabilityRequests)) {
    for (const request of payload.capabilityRequests) {
      if (!request || !request.state || !request.capability) continue;
      if (!investmentPolicyCore.isCapabilityAllowed(request.state, request.capability)) {
        blockingReasons.push(`Capability ihlali: ${request.state} icinde ${request.capability} kullanilamaz.`);
      }
    }
  }

  // Beyan edilen ama araç kanıtı olmayan state'ler ihlaldir: kapı modelin
  // sözüne değil, çalışmış araca bakar.
  for (const item of provenance.unverifiedStates) {
    blockingReasons.push(
      `State beyan edildi fakat arac kaniti yok: ${item.state} (beklenen araclardan biri: ${item.expectedAnyOf.join(', ')})`,
    );
  }

  const warnings = payload.mandate ? [] : ['Mandate eksik: kisisellestirilmis AL/SAT ve pozisyon buyuklugu uretilemez.'];
  if (provenance.selfDeclaredStates.length > 0) {
    warnings.push(
      `Su state'ler hicbir aracla dogrulanamaz, yalnizca beyandir: ${provenance.selfDeclaredStates.join(', ')}. Cevapta bunlari "dogrulandi" diye sunma.`,
    );
  }

  return {
    action: 'research_workflow_policy',
    mode,
    requiredPlan,
    provenance,
    validation: {
      passed: blockingReasons.length === 0,
      blockingReasons,
      warnings,
    },
    message: blockingReasons.length === 0
      ? 'Yatirim arastirma workflow gate kontrolden gecti.'
      : 'Yatirim arastirma workflow gate eksikleri nedeniyle nihai karar uretilemez.',
  };
}

function runFinanceAgent(payload, context) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('finance', 'Finance Watcher');
  }

  if (action === 'analyze_signal') {
    const currentPrice = toNumber(payload.currentPrice, 0);
    const previousPrice = toNumber(payload.previousPrice, 0);
    const weeklyHigh = toNumber(payload.weeklyHigh ?? payload.weekHigh, 0);
    const weeklyLow = toNumber(payload.weeklyLow ?? payload.weekLow, 0);
    const volume = toNumber(payload.volume, 0);
    const avgVolume = toNumber(payload.avgVolume, 0);
    const priceChange = currentPrice && previousPrice ? ((currentPrice - previousPrice) / previousPrice) * 100 : undefined;
    const momentum = financeMomentum(currentPrice, previousPrice, weeklyHigh, weeklyLow);
    const volumeSignal = volume && avgVolume ? financeVolume(volume, avgVolume) : { signal: 'veri_yok', ratio: null, description: 'Hacim verisi eksik.' };
    const supportResistance = financeSupportResistance(currentPrice, weeklyHigh, weeklyLow);
    const direction = financeDirection(priceChange, momentum, volumeSignal.signal);

    const riskTolerance = normalizeProfile(context).riskTolerance || normalizeProfile(context).risk_tolerance || 'medium';
    const volatility = deriveFinanceVolatility(payload, currentPrice, weeklyHigh, weeklyLow);
    const sampleSize = deriveFinanceSampleSize(payload, currentPrice, previousPrice, weeklyHigh, weeklyLow);
    const sourceReliability = deriveFinanceSourceReliability(payload);
    const confidence = round((direction.confidence || 0) * 100, 0);
    const patternAgeDays = Math.max(0, toNumber(payload.patternAgeDays ?? payload.patternAge ?? 0, 0));
    const contradictorySources = Math.max(0, toNumber(payload.contradictorySourcesCount ?? payload.contradictorySources ?? 0, 0));
    const signalRiskLevel = deriveSignalRiskLevel(direction.label, volatility);

    const riskGate = evaluateRiskGate({
      asset: payload.asset,
      assetClass: payload.assetClass,
      riskTolerance,
      volatility,
      sampleSize,
      sourceReliability,
      confidence,
      patternAgeDays,
      contradictorySources,
      signalRiskLevel,
      recentCloses: payload.recentCloses,
    });

    if (!riskGate.passed) {
      return buildRiskGateBlocked(action, payload, riskGate, {
        currentPrice,
        priceChange: priceChange !== undefined ? round(priceChange, 2) : undefined,
        momentum,
        volumeSignal,
        supportResistance,
        direction,
      });
    }

    return {
      action: 'signal',
      asset: payload.asset,
      currentPrice,
      priceChange: priceChange !== undefined ? round(priceChange, 2) : undefined,
      momentum,
      volumeSignal,
      supportResistance,
      direction,
      riskGate,
      disclaimer: 'Bu bir yatırım tavsiyesi değildir. Sadece piyasa analiz özetidir.',
    };
  }

  if (action === 'generate_watchlist_signals') {
    const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : [];
    const profile = normalizeProfile(context);
    const riskTolerance = profile.riskTolerance || profile.risk_tolerance || 'medium';
    const signals = watchlist.map((item) => {
      const current = toNumber(item.currentPrice, 0);
      const previous = toNumber(item.previousPrice, 0);
      const threshold = toNumber(item.alertThreshold, 3);
      const change = current && previous ? ((current - previous) / previous) * 100 : 0;
      const triggered = Math.abs(change) >= threshold;
      let actionLabel = 'bekle';
      if (triggered && change > 0 && riskTolerance !== 'low') actionLabel = 'yukarı_kırılım';
      else if (triggered && change < 0) actionLabel = 'aşağı_kırılım';
      else if (triggered) actionLabel = 'izle';
      return {
        asset: item.asset,
        currentPrice: current,
        change: round(change, 2),
        threshold,
        triggered,
        action: actionLabel,
        emoji: financeChangeEmoji(change),
      };
    });
    const alerts = signals.filter((item) => item.triggered);
    return {
      action: 'watchlist_signals',
      total: signals.length,
      triggeredCount: alerts.length,
      signals,
      alerts,
      summary: alerts.length > 0 ? `${alerts.length} varlıkta eşik aşıldı.` : 'Tüm varlıklar normal seyirde.',
    };
  }

  if (action === 'compare_assets') {
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const comparison = assets
      .map((asset) => {
        const dailyChange = toNumber(asset.dailyChange, 0);
        const weeklyChange = toNumber(asset.weeklyChange, 0);
        const monthlyChange = toNumber(asset.monthlyChange, 0);
        const volatility = toNumber(asset.volatility, 0);
        const performanceScore = dailyChange * 0.3 + weeklyChange * 0.4 + monthlyChange * 0.3;
        return {
          name: asset.name,
          dailyChange: round(dailyChange, 2),
          weeklyChange: round(weeklyChange, 2),
          monthlyChange: round(monthlyChange, 2),
          volatility: round(volatility, 2),
          performanceScore: round(performanceScore, 2),
          riskLevel: volatility > 10 ? 'yüksek' : volatility > 5 ? 'orta' : 'düşük',
        };
      })
      .sort((a, b) => b.performanceScore - a.performanceScore);
    return {
      action: 'comparison',
      assets: comparison,
      bestPerformer: comparison[0] || null,
      worstPerformer: comparison[comparison.length - 1] || null,
      disclaimer: 'Geçmiş performans gelecek getiriyi garanti etmez.',
    };
  }

  if (action === 'risk_assessment') {
    const amount = toNumber(payload.amount, 0);
    const volatility = toNumber(payload.volatility, 5);
    const volatilityDecimal = volatility / 100;
    const holdingDays = Math.max(1, toNumber(payload.holdingDays, 30));
    const profile = normalizeProfile(context);
    const riskTolerance = profile.riskTolerance || profile.risk_tolerance || 'medium';
    const dailyVol = volatilityDecimal / Math.sqrt(252);
    const periodVol = dailyVol * Math.sqrt(holdingDays);
    const var95 = amount * periodVol * 1.645;
    const var99 = amount * periodVol * 2.326;
    const suggestedPosition = financeSuggestPositionSize(amount, volatility, riskTolerance);
    const expectedReturn = amount * (periodVol * 0.5);
    const riskRewardRatio = var95 > 0 ? expectedReturn / var95 : 0;
    return {
      action: 'risk_assessment',
      asset: payload.asset,
      investmentAmount: amount,
      holdingPeriod: holdingDays,
      volatility,
      valueAtRisk: {
        var95: Math.round(var95),
        var99: Math.round(var99),
        description: `%95 güven aralığında ${holdingDays} günde maksimum ₺${Math.round(var95).toLocaleString('tr-TR')} kayıp beklenebilir.`,
      },
      suggestedPosition,
      riskRewardRatio: round(riskRewardRatio, 2),
      suitability: financeSuitability(volatility, riskTolerance),
      disclaimer: 'Bu hesaplama basitleştirilmiş bir modeldir. Kesin yatırım tavsiyesi değildir.',
    };
  }

  if (action === 'evaluate_research_workflow') {
    return runInvestmentResearchWorkflowPolicy(payload);
  }

  return buildUnsupported('finance', action);
}

const JUDGE_WEIGHTS = {
  profitPotential: 0.25,
  riskLevel: 0.20,
  urgency: 0.15,
  profileMatch: 0.20,
  patternConfidence: 0.10,
  sourceReliability: 0.10,
};

function judgeSourceReliability(source) {
  const reliability = {
    sahibinden: 75,
    trendyol: 80,
    letgo: 60,
    aliexpress: 50,
    perplexity: 70,
    amazon: 85,
    ebay: 65,
  };
  return reliability[String(source || '').toLowerCase()] || 50;
}

function judgeExtractFactors(opportunity, context) {
  const profile = normalizeProfile(context);
  const expectedProfit = toNumber(opportunity.expectedProfit ?? opportunity.expected_profit, 0);
  const baseScore = toNumber(opportunity.score, 50);
  const category = opportunity.category;
  const source = opportunity.source;
  const urgency = opportunity.urgency;

  let profitPotential = baseScore;
  if (expectedProfit >= 5000) profitPotential = Math.max(profitPotential, 90);
  else if (expectedProfit >= 1000) profitPotential = Math.max(profitPotential, 70);
  else if (expectedProfit >= 200) profitPotential = Math.max(profitPotential, 50);

  let riskLevel = 50;
  if (source === 'sahibinden' || source === 'trendyol') riskLevel = 30;
  if (source === 'aliexpress' || source === 'dhgate') riskLevel = 60;
  if (category === 'finans') riskLevel = 70;
  if (category === 'arbitraj') riskLevel = 55;
  if (opportunity.riskLevel !== undefined) riskLevel = toNumber(opportunity.riskLevel, riskLevel);

  let urgencyScore = 50;
  if (urgency === 'critical') urgencyScore = 95;
  else if (urgency === 'high') urgencyScore = 80;
  else if (urgency === 'medium') urgencyScore = 50;
  else if (urgency === 'low') urgencyScore = 20;

  let profileMatch = 50;
  const preferredDomains = profile.preferredDomains || profile.preferred_domains;
  if (Array.isArray(preferredDomains) && category && preferredDomains.includes(category)) {
    profileMatch = 80;
  }
  const riskTolerance = profile.riskTolerance || profile.risk_tolerance;
  if (riskTolerance === 'low' && riskLevel > 60) profileMatch -= 20;
  if (riskTolerance === 'high' && riskLevel <= 40) profileMatch += 10;
  const successfulPatterns = profile.successfulPatterns || profile.successful_patterns;
  if (Array.isArray(successfulPatterns) && category && successfulPatterns.some((item) => String(item).includes(category))) {
    profileMatch += 15;
  }

  let patternConfidence = 30;
  if (Array.isArray(context.recentPatterns)) {
    const matchingPattern = context.recentPatterns.find((pattern) => {
      const tags = Array.isArray(pattern.tags) ? pattern.tags : [];
      return tags.includes(category) && pattern.status === 'active';
    });
    if (matchingPattern) {
      patternConfidence = Math.round(toNumber(matchingPattern.confidence, 0.5) * 100);
    }
  }

  return {
    profitPotential: clamp(profitPotential, 0, 100),
    riskLevel: clamp(riskLevel, 0, 100),
    urgency: clamp(urgencyScore, 0, 100),
    profileMatch: clamp(profileMatch, 0, 100),
    patternConfidence: clamp(patternConfidence, 0, 100),
  };
}

function judgeBuildExplanation(factors, score) {
  const parts = [];
  if (factors.profitPotential >= 70) parts.push('yüksek kâr potansiyeli');
  if (factors.riskLevel <= 30) parts.push('düşük risk');
  if (factors.urgency >= 70) parts.push('acil fırsat');
  if (factors.profileMatch >= 70) parts.push('profiline uygun');
  if (factors.patternConfidence >= 70) parts.push('güvenilir pattern');
  if (parts.length === 0) return `Puan: ${score}. Ortalama bir fırsat.`;
  return `Puan: ${score}. Nedenleri: ${parts.join(', ')}.`;
}

function judgeScoreOpportunity(opportunity, context) {
  const factors = judgeExtractFactors(opportunity, context);
  const invertedRisk = 100 - factors.riskLevel;
  const totalScore = Math.round(
    factors.profitPotential * JUDGE_WEIGHTS.profitPotential +
    invertedRisk * JUDGE_WEIGHTS.riskLevel +
    factors.urgency * JUDGE_WEIGHTS.urgency +
    factors.profileMatch * JUDGE_WEIGHTS.profileMatch +
    factors.patternConfidence * JUDGE_WEIGHTS.patternConfidence +
    judgeSourceReliability(opportunity.source) * JUDGE_WEIGHTS.sourceReliability
  );
  return {
    totalScore: clamp(totalScore, 0, 100),
    factors,
    explanation: judgeBuildExplanation(factors, totalScore),
  };
}

function judgeVerdict(score) {
  if (score >= 85) return { label: 'MÜKEMMEL FIRSAT', emoji: '🔥', action: 'Hemen harekete geç' };
  if (score >= 70) return { label: 'İYİ FIRSAT', emoji: '🟢', action: 'Değerlendir, ama gecikme' };
  if (score >= 55) return { label: 'ORTA', emoji: '🟡', action: 'Detaylı araştır, hızlı karar verme' };
  if (score >= 40) return { label: 'DÜŞÜK', emoji: '🟠', action: 'Alternatif ara' };
  return { label: 'KAÇIN', emoji: '🔴', action: 'Zaman harcama' };
}

function judgeActionAdvice(scoring) {
  const advice = [];
  const factors = scoring.factors;
  if (factors.profitPotential >= 70 && factors.riskLevel <= 40) advice.push('Düşük riskli ve yüksek kârlı, öncelikli değerlendir.');
  if (factors.urgency >= 80) advice.push('Acil fırsat, pencere daralıyor.');
  if (factors.riskLevel >= 70) advice.push('Yüksek risk, küçük tutarla dene veya atla.');
  if (factors.profileMatch < 40) advice.push('Profiline tam uymuyor, ekstra dikkat gerekli.');
  if (factors.patternConfidence >= 70) advice.push('Benzer patternlerde başarı var, güven artıyor.');
  if (advice.length === 0) advice.push('Standart değerlendirme, normal prosedürle ilerle.');
  return advice;
}

function judgeRedFlags(opportunity, scoring) {
  const flags = [];
  if (scoring.factors.riskLevel >= 80) flags.push('Çok yüksek risk');
  if (scoring.factors.profitPotential < 30) flags.push('Düşük kâr potansiyeli');
  if (scoring.factors.profileMatch < 30) flags.push('Profile uyumsuz');
  if (!opportunity.source || opportunity.source === 'unknown') flags.push('Kaynak belirsiz');
  return flags;
}

function judgeGreenFlags(scoring) {
  const flags = [];
  if (scoring.factors.profitPotential >= 80) flags.push('Yüksek kâr potansiyeli');
  if (scoring.factors.riskLevel <= 30) flags.push('Düşük risk');
  if (scoring.factors.profileMatch >= 80) flags.push('Profiline çok uygun');
  if (scoring.factors.patternConfidence >= 70) flags.push('Başarılı pattern eşleşmesi');
  if (scoring.factors.urgency >= 80) flags.push('Acil hareket avantajı');
  return flags;
}

function judgeInterpretFactor(key, value) {
  const labels = {
    profitPotential: { high: 'Yüksek kazanç beklentisi', mid: 'Orta seviye kazanç', low: 'Düşük kazanç beklentisi' },
    riskLevel: { high: 'Yüksek risk', mid: 'Makul risk', low: 'Düşük risk' },
    urgency: { high: 'Acil aksiyon gerekli', mid: 'Zaman var ama gecikme', low: 'Aciliyet düşük' },
    profileMatch: { high: 'Profiline çok uygun', mid: 'Kısmen uygun', low: 'Profiline uymuyor' },
    patternConfidence: { high: 'Güçlü pattern desteği', mid: 'Kısmi pattern desteği', low: 'Pattern desteği zayıf' },
  };
  const level = value >= 70 ? 'high' : value >= 40 ? 'mid' : 'low';
  return labels[key] ? labels[key][level] : `Değer: ${value}`;
}

function judgeScoreSummary(totalScore, factors) {
  const strongPoints = [];
  const weakPoints = [];
  if (factors.profitPotential >= 70) strongPoints.push('kâr potansiyeli');
  else if (factors.profitPotential < 40) weakPoints.push('kâr potansiyeli');
  if (factors.riskLevel <= 30) strongPoints.push('düşük risk');
  else if (factors.riskLevel >= 70) weakPoints.push('yüksek risk');
  if (factors.profileMatch >= 70) strongPoints.push('profil uyumu');
  else if (factors.profileMatch < 40) weakPoints.push('profil uyumsuzluğu');
  let summary = `Toplam puan: ${totalScore}/100.`;
  if (strongPoints.length > 0) summary += ` Güçlü yönler: ${strongPoints.join(', ')}.`;
  if (weakPoints.length > 0) summary += ` Zayıf yönler: ${weakPoints.join(', ')}.`;
  return summary;
}

function judgeComparisonRecommendation(scoreA, scoreB, oppA, oppB) {
  const diff = Math.abs(scoreA.totalScore - scoreB.totalScore);
  const winner = scoreA.totalScore >= scoreB.totalScore ? oppA : oppB;
  const loser = scoreA.totalScore >= scoreB.totalScore ? oppB : oppA;
  if (diff >= 20) return `"${winner.title}" açık ara daha iyi. "${loser.title}" yerine bunu öne al.`;
  if (diff >= 10) return `"${winner.title}" biraz daha avantajlı ama diğeri de izlenebilir.`;
  return 'İki fırsat birbirine yakın, risk toleransı ve zamanlama belirleyici olur.';
}

function runJudgeAgent(payload, context) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('judge', 'Opportunity Judge');
  }

  if (action === 'judge_single') {
    const opportunity = payload.opportunity || payload;
    const scoring = judgeScoreOpportunity(opportunity, context);
    return {
      action: 'judgement',
      opportunity: {
        title: opportunity.title,
        category: opportunity.category,
        source: opportunity.source,
      },
      scoring,
      verdict: judgeVerdict(scoring.totalScore),
      actionAdvice: judgeActionAdvice(scoring),
      redFlags: judgeRedFlags(opportunity, scoring),
      greenFlags: judgeGreenFlags(scoring),
    };
  }

  if (action === 'judge_batch') {
    const opportunities = Array.isArray(payload.opportunities) ? payload.opportunities : [];
    const limit = Math.max(1, toNumber(payload.limit, 5));
    const judged = opportunities
      .map((opportunity) => {
        const scoring = judgeScoreOpportunity(opportunity, context);
        return {
          opportunity: {
            id: opportunity.id,
            title: opportunity.title,
            category: opportunity.category,
            source: opportunity.source,
            expectedProfit: opportunity.expectedProfit ?? opportunity.expected_profit,
          },
          totalScore: scoring.totalScore,
          verdict: judgeVerdict(scoring.totalScore),
          factors: scoring.factors,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);
    const ranked = judged.slice(0, limit);
    const averageScore = judged.length > 0 ? Math.round(judged.reduce((sum, item) => sum + item.totalScore, 0) / judged.length) : 0;
    return {
      action: 'batch_judgement',
      totalJudged: opportunities.length,
      returned: ranked.length,
      results: ranked,
      topPick: ranked[0] || null,
      averageScore,
    };
  }

  if (action === 'compare') {
    const opportunityA = payload.opportunityA;
    const opportunityB = payload.opportunityB;
    if (!opportunityA || !opportunityB) {
      return { action, error: 'opportunityA ve opportunityB gerekli' };
    }
    const scoreA = judgeScoreOpportunity(opportunityA, context);
    const scoreB = judgeScoreOpportunity(opportunityB, context);
    const factorNames = [
      { key: 'profitPotential', label: 'Kâr Potansiyeli' },
      { key: 'riskLevel', label: 'Risk (düşük=iyi)' },
      { key: 'urgency', label: 'Aciliyet' },
      { key: 'profileMatch', label: 'Profil Uyumu' },
      { key: 'patternConfidence', label: 'Pattern Güveni' },
    ];
    const factorComparison = factorNames.map(({ key, label }) => {
      const aVal = scoreA.factors[key];
      const bVal = scoreB.factors[key];
      const winner = key === 'riskLevel'
        ? (aVal < bVal ? 'A' : aVal > bVal ? 'B' : 'eşit')
        : (aVal > bVal ? 'A' : aVal < bVal ? 'B' : 'eşit');
      return { factor: label, a: aVal, b: bVal, winner };
    });
    return {
      action: 'comparison',
      a: { title: opportunityA.title, totalScore: scoreA.totalScore, verdict: judgeVerdict(scoreA.totalScore) },
      b: { title: opportunityB.title, totalScore: scoreB.totalScore, verdict: judgeVerdict(scoreB.totalScore) },
      factorComparison,
      overallWinner: scoreA.totalScore > scoreB.totalScore ? 'A' : scoreA.totalScore < scoreB.totalScore ? 'B' : 'eşit',
      recommendation: judgeComparisonRecommendation(scoreA, scoreB, opportunityA, opportunityB),
    };
  }

  if (action === 'explain_score') {
    const factors = payload.factors;
    const totalScore = toNumber(payload.totalScore, null);
    if (!factors || totalScore === null) {
      return { action, error: 'factors ve totalScore gerekli' };
    }
    const factorDetails = [
      { key: 'profitPotential', label: 'Kâr Potansiyeli', weight: JUDGE_WEIGHTS.profitPotential },
      { key: 'riskLevel', label: 'Risk Seviyesi', weight: JUDGE_WEIGHTS.riskLevel },
      { key: 'urgency', label: 'Aciliyet', weight: JUDGE_WEIGHTS.urgency },
      { key: 'profileMatch', label: 'Profil Uyumu', weight: JUDGE_WEIGHTS.profileMatch },
      { key: 'patternConfidence', label: 'Pattern Güveni', weight: JUDGE_WEIGHTS.patternConfidence },
    ].map((item) => {
      const value = toNumber(factors[item.key], 0);
      const effectiveValue = item.key === 'riskLevel' ? 100 - value : value;
      return {
        factor: item.label,
        value,
        weight: item.weight,
        contribution: Math.round(effectiveValue * item.weight),
        interpretation: judgeInterpretFactor(item.key, value),
      };
    });
    return {
      action: 'explanation',
      totalScore,
      verdict: judgeVerdict(totalScore),
      factors: factorDetails,
      summary: judgeScoreSummary(totalScore, factors),
    };
  }

  return buildUnsupported('judge', action);
}

const STREET_URGENCY_SIGNALS = [
  { pattern: /acil\s*(sat[ıi]l[ıi]k|sat[ıi]ş)/i, weight: 0.9, label: 'acil satılık' },
  { pattern: /nakit\s*(lazım|ihtiyac|gerek)/i, weight: 0.95, label: 'nakit ihtiyacı' },
  { pattern: /hemen\s*(teslim|al|sat)/i, weight: 0.8, label: 'hemen teslim' },
  { pattern: /bugün\s*(sat[ıi]l[ıi]r|verilir|gider)/i, weight: 0.85, label: 'bugün satılır' },
  { pattern: /fiyat\s*(düş|indirdim|kırdım)/i, weight: 0.7, label: 'fiyat indirimi' },
  { pattern: /taşın(ıyorum|ma|acağım)/i, weight: 0.75, label: 'taşınma' },
  { pattern: /yurt\s*dışı/i, weight: 0.7, label: 'yurt dışı çıkışı' },
  { pattern: /son\s*(fiyat|gün|hafta)/i, weight: 0.65, label: 'son teklif' },
  { pattern: /çok\s*(uygun|ucuz|hesaplı)/i, weight: 0.5, label: 'uygun fiyat' },
  { pattern: /değerinin\s*altında/i, weight: 0.85, label: 'değerinin altında' },
  { pattern: /adet\s*kald[ıi]/i, weight: 0.6, label: 'sınırlı stok' },
  { pattern: /pazarl[ıi]k\s*(yap[ıi]l[ıi]r|var|olur)/i, weight: 0.55, label: 'pazarlığa açık' },
  { pattern: /kelepir/i, weight: 0.9, label: 'kelepir' },
];

function streetDetectSignals(text) {
  return STREET_URGENCY_SIGNALS.filter((signal) => signal.pattern.test(text)).map((signal) => ({ label: signal.label, weight: signal.weight }));
}

function streetUrgencyScore(signals) {
  if (signals.length === 0) return 0;
  const maxWeight = Math.max(...signals.map((signal) => signal.weight));
  const bonus = signals.filter((signal) => signal.weight !== maxWeight).reduce((sum, signal) => sum + signal.weight * 0.1, 0);
  return Math.min(1, maxWeight + bonus);
}

function streetBargainPotential(signals, listing) {
  let potential = 0.3;
  if (signals.some((signal) => signal.weight >= 0.8)) potential += 0.3;
  if (signals.some((signal) => signal.label === 'pazarlığa açık' || signal.label === 'fiyat indirimi')) potential += 0.2;
  if (listing && listing.createdAt) {
    const days = (Date.now() - new Date(listing.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (days > 14) potential += 0.15;
    if (days > 30) potential += 0.1;
  }
  return Math.min(1, potential);
}

function streetRecommendation(urgencyScore, bargainPotential) {
  if (urgencyScore >= 0.85 && bargainPotential >= 0.7) return 'HEMEN TEKLİF VER';
  if (urgencyScore >= 0.7) return 'HIZLI HAREKET ET';
  if (bargainPotential >= 0.6) return 'PAZARLIK YAP';
  if (urgencyScore >= 0.5) return 'TAKİP ET';
  return 'İZLE';
}

function runStreetHunterAgent(payload, context) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('street-hunter', 'Street Hunter');
  }

  if (action === 'scan_urgency') {
    if (Array.isArray(payload.listings)) {
      const results = payload.listings.map((listing) => {
        const fullText = `${listing.title || ''} ${listing.description || ''}`;
        const signals = streetDetectSignals(fullText);
        const urgencyScore = streetUrgencyScore(signals);
        const bargainPotential = streetBargainPotential(signals, listing);
        return {
          listingId: listing.id,
          title: listing.title,
          source: listing.source,
          price: listing.price,
          signals,
          urgencyScore,
          bargainPotential,
          recommendation: streetRecommendation(urgencyScore, bargainPotential),
        };
      }).sort((a, b) => b.urgencyScore - a.urgencyScore);
      return {
        action: 'scanned',
        totalScanned: payload.listings.length,
        urgentCount: results.filter((result) => result.urgencyScore >= 0.7).length,
        bargainCount: results.filter((result) => result.bargainPotential >= 0.6).length,
        results,
      };
    }

    const listing = {
      title: payload.title || '',
      description: payload.listingText || '',
      createdAt: payload.createdAt,
    };
    const signals = streetDetectSignals(`${listing.title} ${listing.description}`);
    const urgencyScore = Math.round(streetUrgencyScore(signals) * 100);
    const bargainPotential = streetBargainPotential(signals, listing);
    return {
      action,
      urgencyScore,
      detectedSignals: signals.map((signal) => signal.label),
      bargainPotential: bargainPotential >= 0.7 ? 'YÜKSEK' : bargainPotential >= 0.4 ? 'ORTA' : 'DÜŞÜK',
    };
  }

  if (action === 'generate_bargain_message') {
    const listing = payload.listing || payload;
    const title = listing.title || 'ürün';
    const price = toNumber(listing.price, 0);
    const targetDiscount = toNumber(payload.targetDiscount, 15);
    const targetPrice = price > 0 ? Math.round(price * (1 - targetDiscount / 100)) : undefined;
    const signals = streetDetectSignals(`${listing.title || ''} ${listing.description || ''}`);
    const profile = normalizeProfile(context);
    const negotiationStyle = profile.negotiationStyle || 'direct';
    const message = negotiationStyle === 'direct'
      ? `Merhaba, ${title} için ₺${(targetPrice || price).toLocaleString('tr-TR')} teklif edebilirim. Nakit ödeme ile hızlıca alabilirim.`
      : `Merhaba, ${title} ilanınız ilgimi çekti. Fiyatta biraz esneklik varsa ₺${(targetPrice || price).toLocaleString('tr-TR')} civarında düşünebilirim.`;
    return {
      action: 'bargain_message',
      listing: { title, price },
      targetDiscount,
      targetPrice,
      message,
      negotiationTips: signals.map((signal) => `${signal.label} sinyali pazarlık alanı açabilir.`),
    };
  }

  if (action === 'rank_street_deals') {
    const deals = Array.isArray(payload.deals) ? payload.deals : [];
    const ranked = deals.map((deal) => {
      const signals = streetDetectSignals(`${deal.title || ''} ${deal.description || ''}`);
      const urgencyScore = streetUrgencyScore(signals);
      const bargainPotential = streetBargainPotential(signals, deal);
      const streetScore = Math.round((urgencyScore * 0.6 + bargainPotential * 0.4) * 100);
      return { ...deal, signals: signals.map((signal) => signal.label), urgencyScore, bargainPotential, streetScore };
    }).sort((a, b) => b.streetScore - a.streetScore);
    return { action: 'ranked', ranked, topPick: ranked[0] || null, count: ranked.length };
  }

  return buildUnsupported('street-hunter', action);
}

function normalizeRate(value, fallback) {
  const parsed = toNumber(value, fallback);
  if (parsed > 1) return parsed / 100;
  return parsed;
}

function mapCompetitionScore(value) {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'low' || normalized === 'düşük') return 25;
    if (normalized === 'medium' || normalized === 'orta') return 50;
    if (normalized === 'high' || normalized === 'yüksek') return 80;
  }
  return clamp(toNumber(value, 50), 0, 100);
}

function ecomBuildUnitEconomics(rawInput = {}) {
  const productName = rawInput.productName || rawInput.product || 'Ürün';
  const sourcePlatform = rawInput.sourcePlatform || rawInput.supplier || 'aliexpress';
  const targetPlatform = rawInput.targetPlatform || rawInput.marketplace || 'trendyol';
  const sourceCurrency = (rawInput.sourceCurrency || rawInput.currency || 'USD').toUpperCase();
  const fxRate = toNumber(rawInput.fxRate ?? rawInput.exchangeRate ?? rawInput.usdTry, 38);
  const quantity = Math.max(1, Math.round(toNumber(rawInput.quantity, 1)));
  const sourceUnitPrice = toNumber(rawInput.sourcePrice ?? rawInput.productPrice ?? rawInput.unitCost, 0);
  const sourceCostTRY = sourceCurrency === 'TRY' ? sourceUnitPrice * quantity : sourceUnitPrice * fxRate * quantity;

  const shippingWeightKg = Math.max(0.05, toNumber(rawInput.weightKg ?? rawInput.shippingWeightKg, 0.4));
  const shippingRatePerKg = toNumber(rawInput.shippingRatePerKg, getShippingRatePerKg(sourcePlatform));
  const shippingCostTRY = toNumber(rawInput.shippingCostTRY, shippingWeightKg * quantity * shippingRatePerKg);

  const customsRate = normalizeRate(rawInput.customsRate, 0.2);
  const vatRate = normalizeRate(rawInput.vatRate, 0.2);
  const customsDutyTRY = sourceCostTRY * customsRate;
  const vatTRY = (sourceCostTRY + shippingCostTRY + customsDutyTRY) * vatRate;

  const customsFixedTRY = toNumber(rawInput.customsFixedTRY, 0);
  const importBrokerTRY = toNumber(rawInput.importBrokerTRY, 0);
  const complianceCostTRY = toNumber(rawInput.complianceCostTRY, 0);

  const landedBaseTRY = sourceCostTRY + shippingCostTRY + customsDutyTRY + vatTRY + customsFixedTRY + importBrokerTRY + complianceCostTRY;

  const packagingTRY = toNumber(rawInput.packagingCostTRY ?? rawInput.packagingTRY, 15 * quantity);
  const adCostTRY = toNumber(rawInput.adCostTRY ?? rawInput.marketingCostTRY ?? rawInput.cacTRY, 0);
  const miscTRY = toNumber(rawInput.miscCostTRY ?? rawInput.miscTRY, 0);
  const returnRate = normalizeRate(rawInput.returnRate, 0.05);
  const returnCostTRY = toNumber(rawInput.returnCostTRY, 45);
  const returnsProvisionTRY = quantity * returnRate * returnCostTRY;

  const platformFeeRate = normalizeRate(rawInput.platformCommissionRate ?? rawInput.platformFeeRate, 0.13);
  const paymentFeeRate = normalizeRate(rawInput.paymentProcessingRate ?? rawInput.paymentFeeRate, 0.035);
  const targetSellPriceTRY = toNumber(rawInput.targetSellPriceTRY ?? rawInput.sellPriceTRY ?? rawInput.sellingPrice, 0);
  const grossRevenueTRY = targetSellPriceTRY > 0 ? targetSellPriceTRY * quantity : 0;
  const platformFeeTRY = grossRevenueTRY * platformFeeRate;
  const paymentFeeTRY = grossRevenueTRY * paymentFeeRate;

  const totalCostTRY = landedBaseTRY + packagingTRY + adCostTRY + miscTRY + returnsProvisionTRY + platformFeeTRY + paymentFeeTRY;
  const netProfitTRY = grossRevenueTRY - totalCostTRY;
  const netMarginPercent = grossRevenueTRY > 0 ? (netProfitTRY / grossRevenueTRY) * 100 : null;
  const roiPercent = totalCostTRY > 0 ? (netProfitTRY / totalCostTRY) * 100 : null;

  const denominator = quantity * Math.max(0.05, 1 - platformFeeRate - paymentFeeRate);
  const breakEvenSellPriceTRY = denominator > 0
    ? (landedBaseTRY + packagingTRY + adCostTRY + miscTRY + returnsProvisionTRY) / denominator
    : null;
  const targetMarginRate = normalizeRate(rawInput.targetMarginRate ?? rawInput.targetMarginPercent, 0.25);
  const recommendedSellPriceTRY = breakEvenSellPriceTRY !== null
    ? breakEvenSellPriceTRY * (1 + targetMarginRate)
    : null;

  const demandTrendScore = clamp(toNumber(rawInput.demandTrendScore ?? rawInput.trendScore, 55), 0, 100);
  const competitionScore = mapCompetitionScore(rawInput.competitionScore ?? rawInput.competitionLevel);
  const sourceReliability = clamp(toNumber(rawInput.sourceReliability, 70), 0, 100);
  const logisticsRiskScore = clamp(toNumber(rawInput.logisticsRiskScore, 40), 0, 100);

  const marginHealthScore = netMarginPercent === null
    ? 40
    : clamp((netMarginPercent + 10) * 2.5, 0, 100);

  const opportunityScore = round(
    marginHealthScore * 0.35 +
    demandTrendScore * 0.25 +
    (100 - competitionScore) * 0.2 +
    sourceReliability * 0.1 +
    (100 - logisticsRiskScore) * 0.1,
    1
  );

  const verdict = opportunityScore >= 80
    ? 'ÇOK_GÜÇLÜ'
    : opportunityScore >= 65
      ? 'GÜÇLÜ'
      : opportunityScore >= 50
        ? 'ORTA'
        : 'ZAYIF';

  const riskFlags = [];
  if (netMarginPercent !== null && netMarginPercent < 10) riskFlags.push('Net marj dar (<%10)');
  if (competitionScore >= 75) riskFlags.push('Rekabet yüksek');
  if (logisticsRiskScore >= 70) riskFlags.push('Lojistik operasyon riski yüksek');
  if (returnRate >= 0.08) riskFlags.push('İade oranı yüksek varsayımı');
  if (targetSellPriceTRY > 0 && breakEvenSellPriceTRY !== null && targetSellPriceTRY < breakEvenSellPriceTRY) {
    riskFlags.push('Hedef satış fiyatı break-even altı');
  }

  const strengths = [];
  if (netMarginPercent !== null && netMarginPercent >= 20) strengths.push('Sağlıklı net marj');
  if (demandTrendScore >= 70) strengths.push('Talep trendi güçlü');
  if (competitionScore <= 40) strengths.push('Rekabet yönetilebilir');
  if (sourceReliability >= 75) strengths.push('Kaynak güvenilirliği iyi');

  return {
    productName,
    sourcePlatform,
    targetPlatform,
    assumptions: {
      quantity,
      sourceCurrency,
      fxRate,
      sourceUnitPrice,
      shippingWeightKg,
      shippingRatePerKg,
      customsRate: round(customsRate * 100, 2),
      vatRate: round(vatRate * 100, 2),
      platformFeeRate: round(platformFeeRate * 100, 2),
      paymentFeeRate: round(paymentFeeRate * 100, 2),
      returnRate: round(returnRate * 100, 2),
      demandTrendScore,
      competitionScore,
      sourceReliability,
      logisticsRiskScore,
    },
    costTable: {
      sourceCostTRY: Math.round(sourceCostTRY),
      shippingCostTRY: Math.round(shippingCostTRY),
      customsDutyTRY: Math.round(customsDutyTRY),
      vatTRY: Math.round(vatTRY),
      customsFixedTRY: Math.round(customsFixedTRY),
      importBrokerTRY: Math.round(importBrokerTRY),
      complianceCostTRY: Math.round(complianceCostTRY),
      landedBaseTRY: Math.round(landedBaseTRY),
      packagingTRY: Math.round(packagingTRY),
      adCostTRY: Math.round(adCostTRY),
      miscTRY: Math.round(miscTRY),
      returnsProvisionTRY: Math.round(returnsProvisionTRY),
      platformFeeTRY: Math.round(platformFeeTRY),
      paymentFeeTRY: Math.round(paymentFeeTRY),
      totalCostTRY: Math.round(totalCostTRY),
    },
    pricing: {
      targetSellPriceTRY: targetSellPriceTRY > 0 ? Math.round(targetSellPriceTRY) : null,
      breakEvenSellPriceTRY: breakEvenSellPriceTRY !== null ? Math.round(breakEvenSellPriceTRY) : null,
      recommendedSellPriceTRY: recommendedSellPriceTRY !== null ? Math.round(recommendedSellPriceTRY) : null,
      grossRevenueTRY: Math.round(grossRevenueTRY),
    },
    unitEconomics: {
      netProfitTRY: Math.round(netProfitTRY),
      netMarginPercent: netMarginPercent !== null ? round(netMarginPercent, 2) : null,
      roiPercent: roiPercent !== null ? round(roiPercent, 2) : null,
      opportunityScore,
      verdict,
    },
    riskFlags,
    strengths,
  };
}

function buildScenario(base, multiplierLabel, priceMultiplier, adMultiplier, returnDelta) {
  const assumptions = {
    ...base.assumptions,
    returnRate: clamp(base.assumptions.returnRate + returnDelta, 0, 40),
  };

  const simulated = ecomBuildUnitEconomics({
    productName: base.productName,
    sourcePlatform: base.sourcePlatform,
    targetPlatform: base.targetPlatform,
    quantity: base.assumptions.quantity,
    sourceCurrency: base.assumptions.sourceCurrency,
    fxRate: base.assumptions.fxRate,
    sourcePrice: base.assumptions.sourceUnitPrice,
    shippingWeightKg: base.assumptions.shippingWeightKg,
    shippingRatePerKg: base.assumptions.shippingRatePerKg,
    customsRate: base.assumptions.customsRate,
    vatRate: base.assumptions.vatRate,
    platformCommissionRate: base.assumptions.platformFeeRate,
    paymentProcessingRate: base.assumptions.paymentFeeRate,
    returnRate: assumptions.returnRate,
    returnCostTRY: base.costTable.returnsProvisionTRY / Math.max(1, base.assumptions.quantity * (base.assumptions.returnRate / 100 || 0.05)),
    packagingTRY: base.costTable.packagingTRY,
    adCostTRY: base.costTable.adCostTRY * adMultiplier,
    miscTRY: base.costTable.miscTRY,
    customsFixedTRY: base.costTable.customsFixedTRY,
    importBrokerTRY: base.costTable.importBrokerTRY,
    complianceCostTRY: base.costTable.complianceCostTRY,
    targetSellPriceTRY: (base.pricing.targetSellPriceTRY || base.pricing.recommendedSellPriceTRY || 0) * priceMultiplier,
    demandTrendScore: base.assumptions.demandTrendScore,
    competitionScore: base.assumptions.competitionScore,
    sourceReliability: base.assumptions.sourceReliability,
    logisticsRiskScore: base.assumptions.logisticsRiskScore,
  });

  return {
    scenario: multiplierLabel,
    targetSellPriceTRY: simulated.pricing.targetSellPriceTRY,
    netProfitTRY: simulated.unitEconomics.netProfitTRY,
    netMarginPercent: simulated.unitEconomics.netMarginPercent,
    opportunityScore: simulated.unitEconomics.opportunityScore,
  };
}

function runCommerceVisionAgent(payload, context) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('commerce-vision', 'Commerce Vision Agent');
  }

  if (action === 'evaluate_unit_economics') {
    const economics = ecomBuildUnitEconomics(payload);
    return {
      action: 'unit_economics',
      economics,
      summary: `${economics.productName} için fırsat skoru ${economics.unitEconomics.opportunityScore}/100 (${economics.unitEconomics.verdict}).`,
    };
  }

  if (action === 'rank_product_candidates') {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const evaluations = candidates
      .map((candidate) => ({
        product: candidate.productName || candidate.product || 'Ürün',
        ...ecomBuildUnitEconomics(candidate),
      }))
      .sort((a, b) => b.unitEconomics.opportunityScore - a.unitEconomics.opportunityScore);

    return {
      action: 'ranked_candidates',
      total: evaluations.length,
      ranked: evaluations.map((item, index) => ({
        rank: index + 1,
        productName: item.productName,
        opportunityScore: item.unitEconomics.opportunityScore,
        verdict: item.unitEconomics.verdict,
        netMarginPercent: item.unitEconomics.netMarginPercent,
        breakEvenSellPriceTRY: item.pricing.breakEvenSellPriceTRY,
        recommendedSellPriceTRY: item.pricing.recommendedSellPriceTRY,
        riskFlags: item.riskFlags,
      })),
      topPick: evaluations[0] || null,
    };
  }

  if (action === 'build_dropshipping_strategy') {
    const profile = normalizeProfile(context);
    const riskTolerance = profile.riskTolerance || profile.risk_tolerance || 'medium';
    const candidates = Array.isArray(payload.candidates) && payload.candidates.length > 0
      ? payload.candidates
      : [payload];

    const evaluations = candidates
      .map((candidate) => ecomBuildUnitEconomics(candidate))
      .sort((a, b) => b.unitEconomics.opportunityScore - a.unitEconomics.opportunityScore);

    const top = evaluations[0];
    const minMarginTarget = riskTolerance === 'low' ? 20 : riskTolerance === 'high' ? 12 : 16;

    const phases = [
      { phase: 'A', title: 'Ürün/Niş Seçimi', deliverable: 'Skor >= 65 ve trend >= 60 aday listesi', kpi: '3 ürün shortlist' },
      { phase: 'B', title: 'Tedarikçi Doğrulama', deliverable: 'MOQ, teslim süresi, iade koşulu, numune', kpi: 'En az 2 doğrulanmış tedarikçi' },
      { phase: 'C', title: 'Birim Ekonomi', deliverable: 'A-Z masraf tablosu + break-even fiyatı', kpi: `Net marj >= %${minMarginTarget}` },
      { phase: 'D', title: 'Listeleme ve İçerik', deliverable: 'Pazar yeri listing + kreatif + varyant', kpi: 'CTR > %1.5' },
      { phase: 'E', title: 'Pilot Lansman', deliverable: '50-100 siparişlik test bütçesi', kpi: 'ROAS >= 2.0' },
      { phase: 'F', title: 'Ölçekleme', deliverable: 'Kazanan SKU için bütçe/artırılmış stok', kpi: 'Haftalık kâr artışı >= %15' },
      { phase: 'G', title: 'Operasyon', deliverable: 'Kargo SLA, iade otomasyonu, müşteri hizmetleri', kpi: 'İade oranı <= %6' },
      { phase: 'Z', title: 'Portföy Stratejisi', deliverable: 'Tek üründen çok ürüne geçiş + risk dağıtımı', kpi: 'Top 3 SKU toplam ciro payı >= %70' },
    ];

    const scenarios = top
      ? [
          buildScenario(top, 'Conservative', 0.95, 1.15, 2),
          buildScenario(top, 'Base', 1, 1, 0),
          buildScenario(top, 'Aggressive', 1.1, 0.9, -1),
        ]
      : [];

    const strategyVerdict = !top
      ? 'ADAY_YOK'
      : (top.unitEconomics.netMarginPercent !== null && top.unitEconomics.netMarginPercent >= minMarginTarget)
        ? 'GO'
        : 'REWORK';

    const recommendations = [];
    if (top) {
      if ((top.unitEconomics.netMarginPercent || 0) < minMarginTarget) {
        recommendations.push(`Marj düşük: satış fiyatını veya tedarik maliyetini optimize et (hedef >= %${minMarginTarget}).`);
      }
      if (top.assumptions.competitionScore > 70) {
        recommendations.push('Rekabet yüksek: farklılaştırılmış paket/bundle veya alt niş seç.');
      }
      if (top.assumptions.demandTrendScore < 55) {
        recommendations.push('Trend zayıf: seasonal ürün yerine evergreen kategoriye kay.');
      }
      recommendations.push('İlk 2 hafta günlük P&L takibi yap; CAC, iade ve kargo SLA sapmasını anlık izle.');
    }

    return {
      action: 'dropshipping_strategy',
      riskTolerance,
      strategyVerdict,
      topOpportunity: top || null,
      candidateSummary: evaluations.map((item, index) => ({
        rank: index + 1,
        productName: item.productName,
        opportunityScore: item.unitEconomics.opportunityScore,
        verdict: item.unitEconomics.verdict,
        netMarginPercent: item.unitEconomics.netMarginPercent,
        breakEvenSellPriceTRY: item.pricing.breakEvenSellPriceTRY,
      })),
      phases,
      scenarios,
      recommendations,
      disclaimer: 'Bu çıktı stratejik simülasyondur; gerçek verilerle sürekli güncellenmelidir.',
    };
  }

  return buildUnsupported('commerce-vision', action);
}

function runTravelAgent(payload) {
  const action = payload.action;
  if (!action || action === 'info') {
    return buildInfo('travel', 'Travel Hunter');
  }

  if (action !== 'trip_budget') {
    return buildUnsupported('travel', action);
  }

  const days = Math.max(1, toNumber(payload.days, 3));
  const travelers = Math.max(1, toNumber(payload.travelers, 1));
  const multiplier = { budget: 0.5, medium: 1, luxury: 2.5 }[payload.style || 'medium'] || 1;
  const hotel = Math.round(600 * multiplier) * Math.max(1, days - 1) * travelers;
  const food = Math.round(250 * multiplier) * days * travelers;
  const transport = Math.round(150 * multiplier) * days * travelers;
  const activities = Math.round(200 * multiplier) * days * travelers;
  const flights = (payload.flightPrice || Math.round(1500 * multiplier)) * travelers;
  const misc = Math.round((hotel + food) * 0.1);
  const total = flights + hotel + food + transport + activities + misc;
  return {
    action: 'trip_budget',
    destination: payload.destination,
    grandTotal: total,
    perPerson: Math.round(total / travelers),
    breakdown: { flights, hotel, food, transport, activities, misc },
  };
}

function runDeterministicAgent(agentName, payload, context = {}) {
  switch (agentName) {
    case 'arbitrage':
      return runArbitrageAgent(payload, context);
    case 'street-hunter':
      return runStreetHunterAgent(payload, context);
    case 'finance':
      return runFinanceAgent(payload, context);
    case 'travel':
      return runTravelAgent(payload, context);
    case 'judge':
      return runJudgeAgent(payload, context);
    case 'commerce-vision':
      return runCommerceVisionAgent(payload, context);
    default:
      return null;
  }
}

module.exports = {
  getSupportedAgentActions,
  runDeterministicAgent,
};
