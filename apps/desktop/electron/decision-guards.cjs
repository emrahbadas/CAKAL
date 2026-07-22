const COMMANDER_FINANCE_DOMAIN_RE = /borsa|hisse|xu100|bist|kripto|bitcoin|ethereum|döviz|usd|eur|altın|ons|emtia|trade|trading|pozisyon|portföy|al\s*sat/i;
const COMMANDER_ACTIONABLE_FINANCE_RE = /\bal\s*sat\b|(?:^|[\s,.;:!?])alım(?:$|[\s,.;:!?])|(?:^|[\s,.;:!?])satış(?:$|[\s,.;:!?])|almalı mıyım|satmalı mıyım|alınır mı|satılır mı|giriş|entry|stop|hedef|target|trade plan|trade edilecek|hangi hisse\s*(alınır|satılır)|kaç lot|işlem aç|işlem kapat|pozisyon aç|pozisyon kapat|al\/sat sinyali|trade sinyali|izleme listesi/i;
const COMMANDER_INFORMATIONAL_FINANCE_RE = /durum|durumlar|özet|karşılaştır|tablo|listele|neler konuşuluyor|haber|yorum|analiz|grafik|teknik|genel görünüm|ortalama|trend/i;
const COMMANDER_ACTIONABLE_RESPONSE_RE = /\bAL\b|\bSAT\b|\bBEKLE\b|\bDİKKAT\b|\bDIKKAT\b|giriş|stop|hedef|trade plan|pozisyon/i;
// DİKKAT: "ilan" kelime başında aranmalı — düz substring araması "b-ilan-ço"
// içinde eşleşip bilanço mesajlarını pazaryeri sanıyor ve TÜM finans karar
// kapılarını (commander gate, hüküm-kanıt kilidi, fiyatlanma kilidi) atlatıyordu.
const COMMANDER_PRODUCT_MARKETPLACE_RE = /ürün|(?:^|[^a-zçğıöşü])ilan|sahibinden|trendyol|letgo|dolap|hepsiemlak|amazon|ebay|n11|hepsiburada|araba|araç|ev eşyası|telefon|laptop|platformlar arası|stoklu al|stokta|dropshipping|fba|fırsat ara/i;
const COMMANDER_FRESH_MARKET_SCAN_RE = /sıfırdan|sifirdan|baştan|bastan|geniş\s+tara|genis\s+tara|piyasayı\s+tara|piyasayi\s+tara|piyasa\s+taraması|piyasa\s+taramasi|sepet\s+(çıkar|cikar|oluştur|olustur)|aday\s+(çıkar|cikar)|fırsat\s+hisseleri|firsat\s+hisseleri|umut\s+vadeden\s+hisse|hangi\s+hisseler/i;

const COMMANDER_MARKET_DATA_TOOLS = new Set([
  'get_stock_price',
  'get_bist_gainers',
  'run_investment_research_scan',
  'get_market_signal',
  'analyze_finance_signal',
  'analyze_earnings_pricing',
  'generate_stock_chart',
  'get_tcmb_rates',
  'get_forex_rates',
  'get_crypto_prices',
]);
const COMMANDER_DECISION_TOOLS = new Set(['analyze_finance_signal', 'judge_opportunity']);
const COMMANDER_RESEARCH_EVIDENCE_TOOLS = new Set(['web_search', 'verify_claim', 'search_youtube_insights', 'run_investment_research_scan']);

const RISK_GATE_THRESHOLDS = Object.freeze({
  equity: Object.freeze({
    low: Object.freeze({ maxVolatility: 4.5, minSampleSize: 20, minSourceReliability: 75, minConfidence: 68, maxPatternAgeDays: 3, maxContradictorySources: 0 }),
    medium: Object.freeze({ maxVolatility: 7, minSampleSize: 18, minSourceReliability: 70, minConfidence: 60, maxPatternAgeDays: 5, maxContradictorySources: 1 }),
    high: Object.freeze({ maxVolatility: 10, minSampleSize: 15, minSourceReliability: 65, minConfidence: 55, maxPatternAgeDays: 7, maxContradictorySources: 2 }),
  }),
  fx: Object.freeze({
    low: Object.freeze({ maxVolatility: 2.5, minSampleSize: 20, minSourceReliability: 80, minConfidence: 70, maxPatternAgeDays: 3, maxContradictorySources: 0 }),
    medium: Object.freeze({ maxVolatility: 4, minSampleSize: 18, minSourceReliability: 75, minConfidence: 60, maxPatternAgeDays: 5, maxContradictorySources: 1 }),
    high: Object.freeze({ maxVolatility: 6, minSampleSize: 15, minSourceReliability: 70, minConfidence: 55, maxPatternAgeDays: 7, maxContradictorySources: 1 }),
  }),
  crypto: Object.freeze({
    low: Object.freeze({ maxVolatility: 5, minSampleSize: 25, minSourceReliability: 80, minConfidence: 75, maxPatternAgeDays: 2, maxContradictorySources: 0 }),
    medium: Object.freeze({ maxVolatility: 9, minSampleSize: 20, minSourceReliability: 72, minConfidence: 65, maxPatternAgeDays: 4, maxContradictorySources: 1 }),
    high: Object.freeze({ maxVolatility: 14, minSampleSize: 18, minSourceReliability: 65, minConfidence: 55, maxPatternAgeDays: 6, maxContradictorySources: 2 }),
  }),
  commodity: Object.freeze({
    low: Object.freeze({ maxVolatility: 3.5, minSampleSize: 20, minSourceReliability: 78, minConfidence: 68, maxPatternAgeDays: 4, maxContradictorySources: 0 }),
    medium: Object.freeze({ maxVolatility: 6, minSampleSize: 18, minSourceReliability: 72, minConfidence: 60, maxPatternAgeDays: 6, maxContradictorySources: 1 }),
    high: Object.freeze({ maxVolatility: 9, minSampleSize: 15, minSourceReliability: 68, minConfidence: 55, maxPatternAgeDays: 7, maxContradictorySources: 2 }),
  }),
  unknown: Object.freeze({
    low: Object.freeze({ maxVolatility: 4, minSampleSize: 20, minSourceReliability: 78, minConfidence: 70, maxPatternAgeDays: 3, maxContradictorySources: 0 }),
    medium: Object.freeze({ maxVolatility: 7, minSampleSize: 18, minSourceReliability: 72, minConfidence: 60, maxPatternAgeDays: 5, maxContradictorySources: 1 }),
    high: Object.freeze({ maxVolatility: 10, minSampleSize: 15, minSourceReliability: 68, minConfidence: 55, maxPatternAgeDays: 7, maxContradictorySources: 2 }),
  }),
});

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 1) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function normalizeRiskTolerance(value = 'medium') {
  const normalized = String(value || 'medium').toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

function normalizeSignalRiskLevel(value = 'medium') {
  const normalized = String(value || 'medium').toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

function classifyAssetClass(asset, explicitAssetClass) {
  const explicit = String(explicitAssetClass || '').toLowerCase();
  if (explicit && RISK_GATE_THRESHOLDS[explicit]) {
    return explicit;
  }

  const text = String(asset || '').toUpperCase();
  if (!text) return 'unknown';

  if (/^(XAU|XAG)(USD|TRY)?$/.test(text) || /(ALTIN|GOLD|SILVER|BRENT|WTI|OIL|PETROL|GUMUS)/.test(text)) return 'commodity';
  if (/^(USD|EUR|GBP|JPY|CHF|AUD|CAD|TRY)(USD|EUR|GBP|JPY|CHF|AUD|CAD|TRY)?$/.test(text) || /(FX|FOREX)/.test(text)) return 'fx';
  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|DOT|MATIC|BNB|USDT|USDC)(USD|USDT|TRY|BTC|ETH)?$/.test(text)) return 'crypto';
  return 'equity';
}

function getRiskGateThresholds(assetClass, riskTolerance) {
  const normalizedAssetClass = RISK_GATE_THRESHOLDS[assetClass] ? assetClass : 'unknown';
  const normalizedRiskTolerance = normalizeRiskTolerance(riskTolerance);
  return RISK_GATE_THRESHOLDS[normalizedAssetClass][normalizedRiskTolerance];
}

function extractCommanderToolNames(events = []) {
  return [...new Set(
    events
      .filter((event) => event && event.type === 'tool_call' && event.tool)
      .map((event) => String(event.tool))
  )];
}

function isCommanderFinanceMessage(message = '') {
  return COMMANDER_FINANCE_DOMAIN_RE.test(String(message || ''));
}

function isCommanderProductMarketplaceMessage(message = '') {
  return COMMANDER_PRODUCT_MARKETPLACE_RE.test(String(message || ''));
}

function isCommanderActionableFinanceRequest(message = '') {
  const text = String(message || '');
  return isCommanderFinanceMessage(text) && COMMANDER_ACTIONABLE_FINANCE_RE.test(text);
}

function isCommanderFreshMarketScanRequest(message = '') {
  const text = String(message || '');
  return isCommanderFinanceMessage(text) && COMMANDER_FRESH_MARKET_SCAN_RE.test(text);
}

function isCommanderInformationalFinanceRequest(message = '') {
  const text = String(message || '');
  return isCommanderFinanceMessage(text) && COMMANDER_INFORMATIONAL_FINANCE_RE.test(text);
}

function hasCommanderActionableResponse(response = '') {
  return COMMANDER_ACTIONABLE_RESPONSE_RE.test(String(response || ''));
}

function buildCommanderGateResponse(status, reason, usedTools) {
  const toolNote = usedTools.length > 0
    ? `Kanıt araçları: ${usedTools.join(', ')}`
    : 'Kanıt araçları: yok';

  if (status === 'veri_yetersiz') {
    return [
      'VERI_YETERSIZ',
      '',
      'Bu istek işlem/sinyal niteliği taşıyor ama zorunlu piyasa verisi yeterince toplanmadan nihai AL/SAT üretmiyorum.',
      `Neden: ${reason}`,
      toolNote,
      '',
      'Devam etmek için fiyat/veri araçlarıyla yeniden analiz çalıştırılmalı: get_stock_price, get_market_signal, analyze_finance_signal, get_forex_rates, get_crypto_prices, get_tcmb_rates veya generate_stock_chart.',
    ].join('\n');
  }

  return [
    'NO_SIGNAL',
    '',
    'Piyasa verisi var ama karar kapısı yeterli deterministik teyit üretmediği için nihai sinyal vermiyorum.',
    `Neden: ${reason}`,
    toolNote,
    '',
    'İşlem sinyali için analyze_finance_signal ve/veya judge_opportunity tabanlı teyit gerekli.',
  ].join('\n');
}

function buildFreshMarketScanGateResponse(reason, usedTools) {
  const toolNote = usedTools.length > 0
    ? `Kanıt araçları: ${usedTools.join(', ')}`
    : 'Kanıt araçları: yok';

  return [
    'VERI_YETERSIZ',
    '',
    'Fresh market scan politikasi tamamlanmadan hisse sepeti veya AL/SAT benzeri nihai sonuc uretmiyorum.',
    `Neden: ${reason}`,
    toolNote,
    '',
    'Zorunlu disiplin: evreni dondur, genis tarama yap, resmi/guvenilir kaynaklarla claim dogrula, degerleme-risk-ters tez adimlarini tamamla. En cok artanlar listesi tek basina aday tavsiyesi degildir.',
  ].join('\n');
}

// Profil kurulum / tanışma mesajları: kullanıcı tercihlerini anlatırken geçen
// "al sat", "trade" gibi ifadeler işlem niyeti DEĞİLDİR. Bu bağlamda kapı ancak
// cevapta gerçek bir AL/SAT hükmü varsa devreye girer (detectEquityVerdict).
const COMMANDER_PROFILE_SETUP_RE = /(risk tolerans|yatırım vade|yatirim vade|maksimum kayıp|maksimum kayip|yatırımcı profil|yatirimci profil|profilimi|profilime|tanışalım|tanisalim|beni tanı|beni tani)/i;

function evaluateCommanderDecisionGate(message, response, events = []) {
  if (isCommanderProductMarketplaceMessage(message)) {
    return null;
  }

  if (!isCommanderFinanceMessage(message)) {
    return null;
  }

  if (COMMANDER_PROFILE_SETUP_RE.test(String(message || '')) && !detectEquityVerdict(response)) {
    return null;
  }

  const actionableRequest = isCommanderActionableFinanceRequest(message);
  const freshMarketScan = isCommanderFreshMarketScanRequest(message);
  // Karar kapısı sadece açık işlem niyeti olan isteklerde devreye girer.
  // Bilgi/özet/karşılaştırma isteklerinde gereksiz no_signal/veri_yetersiz döngüsünü böyle kırıyoruz.
  if (!actionableRequest && !(freshMarketScan && hasCommanderActionableResponse(response))) {
    return null;
  }

  const usedTools = extractCommanderToolNames(events);
  const marketDataTools = usedTools.filter((tool) => COMMANDER_MARKET_DATA_TOOLS.has(tool));
  const decisionTools = usedTools.filter((tool) => COMMANDER_DECISION_TOOLS.has(tool));
  const researchEvidenceTools = usedTools.filter((tool) => COMMANDER_RESEARCH_EVIDENCE_TOOLS.has(tool));

  if (marketDataTools.length === 0) {
    return {
      status: 'veri_yetersiz',
      reason: 'İşlem kararı için zorunlu piyasa veri araçları çalışmadı.',
      usedTools,
      response: buildCommanderGateResponse('veri_yetersiz', 'İşlem kararı için zorunlu piyasa veri araçları çalışmadı.', usedTools),
    };
  }

  if (freshMarketScan && hasCommanderActionableResponse(response) && researchEvidenceTools.length === 0) {
    const onlyRecentGainers = marketDataTools.length === 1 && marketDataTools[0] === 'get_bist_gainers';
    const reason = onlyRecentGainers
      ? 'Sadece en cok artanlar listesi kullanildi; bu fresh market scan icin yasak kisa yoldur.'
      : 'Claim/evidence dogrulama araci calismadi; arastirma kanit standardi tamamlanmadi.';

    return {
      status: 'veri_yetersiz',
      reason,
      usedTools,
      response: buildFreshMarketScanGateResponse(reason, usedTools),
    };
  }

  if (decisionTools.length === 0) {
    return {
      status: 'no_signal',
      reason: 'Piyasa verisi toplandı ama karar/puanlama teyidi oluşmadı.',
      usedTools,
      response: buildCommanderGateResponse('no_signal', 'Piyasa verisi toplandı ama karar/puanlama teyidi oluşmadı.', usedTools),
    };
  }

  return null;
}

function buildRiskGateMessage(status, reasons) {
  if (status === 'veri_yetersiz') {
    return `Risk gate veri yetersizliği nedeniyle kararı bloke etti: ${reasons.join(' | ')}`;
  }
  return `Risk gate kararı bloke etti: ${reasons.join(' | ')}`;
}

function isSignalRiskAllowed(signalRiskLevel, riskTolerance) {
  const normalizedSignalRisk = normalizeSignalRiskLevel(signalRiskLevel);
  const normalizedRiskTolerance = normalizeRiskTolerance(riskTolerance);
  if (normalizedRiskTolerance === 'high') return true;
  if (normalizedRiskTolerance === 'medium') return normalizedSignalRisk !== 'high';
  return normalizedSignalRisk === 'low';
}

function evaluateRiskGate(input = {}) {
  const assetClass = classifyAssetClass(input.asset, input.assetClass);
  const riskTolerance = normalizeRiskTolerance(input.riskTolerance);
  const thresholds = getRiskGateThresholds(assetClass, riskTolerance);

  const recentCloses = Array.isArray(input.recentCloses) ? input.recentCloses : [];
  const metrics = {
    volatility: toFiniteNumber(input.volatility),
    sampleSize: toFiniteNumber(input.sampleSize ?? input.barCount ?? recentCloses.length),
    sourceReliability: toFiniteNumber(input.sourceReliability ?? input.sourceScore),
    confidence: toFiniteNumber(input.confidence ?? input.signalConfidence),
    patternAgeDays: toFiniteNumber(input.patternAgeDays ?? input.patternAge),
    contradictorySources: toFiniteNumber(input.contradictorySources ?? input.contradictorySourcesCount ?? 0),
    signalRiskLevel: normalizeSignalRiskLevel(input.signalRiskLevel ?? 'medium'),
  };

  const missingReasons = [];
  if (metrics.volatility === null) missingReasons.push('Volatilite metriği yok.');
  if (metrics.sampleSize === null) missingReasons.push('Örneklem boyutu yok.');
  if (metrics.sourceReliability === null) missingReasons.push('Kaynak güvenilirlik skoru yok.');
  if (metrics.confidence === null) missingReasons.push('Confidence metriği yok.');
  if (metrics.patternAgeDays === null) missingReasons.push('Pattern yaş bilgisi yok.');

  if (missingReasons.length > 0) {
    return {
      passed: false,
      status: 'veri_yetersiz',
      assetClass,
      riskTolerance,
      thresholds,
      metrics,
      reasons: missingReasons,
      message: buildRiskGateMessage('veri_yetersiz', missingReasons),
    };
  }

  const reasons = [];
  if (metrics.sampleSize < thresholds.minSampleSize) {
    reasons.push(`Örneklem küçük: ${metrics.sampleSize} < ${thresholds.minSampleSize}`);
  }
  if (metrics.sourceReliability < thresholds.minSourceReliability) {
    reasons.push(`Kaynak güvenilirliği düşük: ${metrics.sourceReliability} < ${thresholds.minSourceReliability}`);
  }
  if (metrics.confidence < thresholds.minConfidence) {
    reasons.push(`Confidence düşük: ${metrics.confidence} < ${thresholds.minConfidence}`);
  }
  if (metrics.volatility > thresholds.maxVolatility) {
    reasons.push(`Volatilite fazla yüksek: %${round(metrics.volatility)} > %${thresholds.maxVolatility}`);
  }
  if (metrics.patternAgeDays > thresholds.maxPatternAgeDays) {
    reasons.push(`Pattern güncelliğini kaybetmiş: ${metrics.patternAgeDays}g > ${thresholds.maxPatternAgeDays}g`);
  }
  if (metrics.contradictorySources > thresholds.maxContradictorySources) {
    reasons.push(`Kaynak çelişkisi yüksek: ${metrics.contradictorySources} > ${thresholds.maxContradictorySources}`);
  }
  if (!isSignalRiskAllowed(metrics.signalRiskLevel, riskTolerance)) {
    reasons.push(`Sinyal risk seviyesi profil ile uyumsuz: ${metrics.signalRiskLevel}`);
  }

  if (reasons.length > 0) {
    return {
      passed: false,
      status: 'no_signal',
      assetClass,
      riskTolerance,
      thresholds,
      metrics,
      reasons,
      message: buildRiskGateMessage('no_signal', reasons),
    };
  }

  return {
    passed: true,
    status: 'pass',
    assetClass,
    riskTolerance,
    thresholds,
    metrics,
    reasons: [],
    message: 'Risk gate geçti.',
  };
}

// ============================
// Hüküm-Kanıt Kilidi (Verdict Evidence Lock)
// Politika: değerleme + dönemsel karşılaştırma + kaynak kanıtı + veri tazeliği
// + risk seviyesi AYNI cevapta tamamlanmadan AL/SAT hükmü çıkamaz. Eksikse
// hüküm deterministik olarak İNCELE/RİSKLİ seviyesine indirilir.
// ============================

const VERDICT_CONTEXT_LINE_RE = /(karar|sonuc|sonuç|hüküm|hukum|öneri|oneri|tavsiye|verdikt|pozisyon)/i;
// Büyük harf AL/SAT hüküm kelimesidir; Türkçe "al"/"sat" fiillerini yakalamamak
// için case-sensitive ve harf-komşuluğu dışlanarak aranır.
const VERDICT_WORD_RE = /(^|[^A-ZÇĞİÖŞÜa-zçğıöşü])(AL|SAT)($|[^A-ZÇĞİÖŞÜa-zçğıöşü])/;
const VERDICT_ARROW_RE = /(→|=>)\s*\*{0,2}(AL|SAT)(?![A-ZÇĞİÖŞÜ])/;
const VERDICT_TICKER_RE = /\b[A-Z0-9]{3,6}\s*:\s*\*{0,2}(AL|SAT)(?![A-ZÇĞİÖŞÜ])/;

const VERDICT_EVIDENCE_CHECKS = Object.freeze([
  {
    key: 'valuation',
    label: 'Değerleme çarpanı (F/K, FD/FAVÖK veya PD/DD)',
    test: (text) => /(F\/K|FD\/FAVÖK|FD\/FAVOK|PD\/DD|EV\/EBITDA|fiyat\/kazanç|fiyat\/kazanc)/i.test(text),
  },
  {
    key: 'period_comparison',
    label: 'Dönemsel karşılaştırma (en az yıllık, örn 2025/03 ↔ 2026/03)',
    test: (text) => {
      const periodTokens = new Set((text.match(/20\d{2}\s*[/\-.]\s*(?:0?[1-9]|1[0-2])(?!\d)/g) || []).map((token) => token.replace(/\s+/g, '')));
      if (periodTokens.size >= 2) return true;
      return /(önceki (dönem|çeyrek)|onceki (donem|ceyrek)|geçen yıl|gecen yil|yıllık değişim|yillik degisim|yıldan yıla|yildan yila|\byoy\b)/i.test(text);
    },
  },
  {
    key: 'source_evidence',
    label: 'Kaynak kanıtı (kaynak adı, KAP/İş Yatırım ayrımı veya URL)',
    test: (text) => /(kaynak|KAP|https?:\/\/|İş Yatırım|Is Yatirim|Yahoo Finance)/i.test(text),
  },
  {
    key: 'freshness',
    label: 'Veri tazeliği (veri zamanı / gecikme notu)',
    test: (text) => /(gecikmeli|veri zaman|itibar[ıi]yla|itibar[ıi]yle|kapanış verisi|kapanis verisi|saat \d{1,2}[:.]\d{2}|seans (içi|ici|kapan))/i.test(text),
  },
  {
    key: 'risk_level',
    label: 'Risk seviyesi + giriş/stop veya geçersizlik koşulu',
    test: (text) => /(stop|zarar[- ]kes|risk (seviyesi|düzeyi|duzeyi)|risk[:\s]*(düşük|dusuk|orta|yüksek|yuksek)|geçersizlik (koşulu|kosulu)|gecersizlik (kosulu|koşulu))/i.test(text),
  },
]);

function isVerdictLine(line) {
  return (
    VERDICT_ARROW_RE.test(line) ||
    VERDICT_TICKER_RE.test(line) ||
    (VERDICT_CONTEXT_LINE_RE.test(line) && VERDICT_WORD_RE.test(line))
  );
}

function detectEquityVerdict(response = '') {
  return String(response || '').split('\n').some(isVerdictLine);
}

function collectMissingVerdictEvidence(response = '') {
  const text = String(response || '');
  return VERDICT_EVIDENCE_CHECKS.filter((check) => !check.test(text)).map((check) => check.label);
}

function neutralizeEquityVerdicts(response = '') {
  return String(response || '')
    .split('\n')
    .map((line) => {
      if (!isVerdictLine(line)) return line;
      return line
        .replace(/(^|[^A-ZÇĞİÖŞÜa-zçğıöşü])AL($|[^A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1İNCELE$2')
        .replace(/(^|[^A-ZÇĞİÖŞÜa-zçğıöşü])SAT($|[^A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1RİSKLİ$2');
    })
    .join('\n');
}

function evaluateVerdictEvidenceLock(message, response) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  if (!isCommanderFinanceMessage(message)) return null;
  if (!detectEquityVerdict(response)) return null;

  const missing = collectMissingVerdictEvidence(response);
  if (missing.length === 0) return null;

  const lockedResponse = [
    neutralizeEquityVerdicts(response),
    '',
    '---',
    '⚖️ KARAR KİLİDİ (deterministik):',
    'AL/SAT hükmü için zorunlu kanıt seti bu cevapta tamamlanmadı; hüküm İNCELE/RİSKLİ seviyesine indirildi.',
    `Eksik kanıtlar: ${missing.join(' | ')}`,
    'Tam hüküm şartı: değerleme çarpanları + yıllık dönem karşılaştırması + kaynaklı kanıt + veri zamanı + risk/stop seviyesi aynı cevapta sunulmalı.',
  ].join('\n');

  return { status: 'verdict_locked', missing, response: lockedResponse };
}

// ============================
// Fiyatlanma Kilidi (Earnings Pricing Lock)
// Politika: bilanço kaynaklı AL/fırsat hükmü, analyze_earnings_pricing aracı
// GERÇEKTEN çalışıp sınıflandırma üretmeden çıkamaz. Doğrulama cevap metnindeki
// anahtar kelimeyle DEĞİL, tool_call provenance kaydıyla yapılır — çıktıda
// "önceden fiyatlanmış olabilir" cümlesinin geçmesi ölçüm yapıldığını
// kanıtlamaz. Bilanço kalitesi yorumu serbesttir; kilit sadece zamanlama
// hükmünü (AL / güçlü fırsat) sınırlar.
// ============================

const EARNINGS_PRICING_TOOL = 'analyze_earnings_pricing';
// Handler sınıflandırma ürettiğinde bu imzayla ikinci bir activity emit eder;
// kilit "araç çağrıldı" ile "araç tamamlandı" ayrımını bu imzadan yapar.
const EARNINGS_PRICING_COMPLETED_RE = /s[ıi]n[ıi]fland[ıi]rma\s*:/i;

const FUNDAMENTAL_CONTEXT_RE = /(bilanço|bilanco|temel analiz|finansal tablo|finansal rapor|gelir tablosu|nakit ak[ıi][şs]|favök|favok|ebitda|net k[âa]r|k[âa]r marj|marjlar|borçluluk|borcluluk|özkaynak|ozkaynak|çeyrek sonuç|ceyrek sonuc|kap rapor|kap bildirim|bilanço sezonu|bilanco sezonu)/i;

// Alım tarafı fırsat/zamanlama dili: büyük harf AL hükmü dışında kalan
// "güçlü fırsat", "alım fırsatı" gibi ifadeler de zamanlama hükmüdür.
const BUY_OPPORTUNITY_PHRASE_RE = /(güçlü f[ıi]rsat|guclu f[ıi]rsat|al[ıi]m f[ıi]rsat[ıi]|yeni f[ıi]rsat|kaç[ıi]r[ıi]lmaz|kacirilmaz|güçlü al[ıi]m|guclu al[ıi]m)/i;

const BUY_VERDICT_WORD_RE = /(^|[^A-ZÇĞİÖŞÜa-zçğıöşü])AL($|[^A-ZÇĞİÖŞÜa-zçğıöşü])/;

function isBuySideVerdictLine(line) {
  return isVerdictLine(line) && BUY_VERDICT_WORD_RE.test(line);
}

function detectBuySideTimingVerdict(response = '') {
  const text = String(response || '');
  if (text.split('\n').some(isBuySideVerdictLine)) return true;
  return BUY_OPPORTUNITY_PHRASE_RE.test(text);
}

function hasCompletedEarningsPricingRun(events = []) {
  return (Array.isArray(events) ? events : []).some(
    (event) =>
      event &&
      event.type === 'tool_call' &&
      String(event.tool) === EARNINGS_PRICING_TOOL &&
      EARNINGS_PRICING_COMPLETED_RE.test(String(event.detail || ''))
  );
}

function isFundamentalDrivenResponse(message = '', response = '') {
  return FUNDAMENTAL_CONTEXT_RE.test(String(message || '')) || FUNDAMENTAL_CONTEXT_RE.test(String(response || ''));
}

function evaluateEarningsPricingGate(message, response, events = []) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  // Bilanço/temel analiz dili tek başına finans bağlamıdır: "THYAO bilanço
  // açıkladı" mesajı borsa/hisse kelimesi geçmese de bu kapının konusudur.
  const financeContext = isCommanderFinanceMessage(message) || FUNDAMENTAL_CONTEXT_RE.test(String(message || ''));
  if (!financeContext) return null;
  if (!isFundamentalDrivenResponse(message, response)) return null;
  if (!detectBuySideTimingVerdict(response)) return null;
  if (hasCompletedEarningsPricingRun(events)) return null;

  const lockedResponse = [
    neutralizeEquityVerdicts(response),
    '',
    '---',
    '⚖️ FİYATLANMA KİLİDİ (deterministik):',
    'Bilanço kaynaklı AL/fırsat hükmü için önceden fiyatlanma ölçümü (analyze_earnings_pricing) çalışmadı veya tamamlanmadı; hüküm İNCELE seviyesine indirildi.',
    'Bilanço kalitesi yorumu geçerlidir; ancak piyasa bu sonuçları önceden satın almış olabilir. Ölçüm yapılmadan "iyi bilanço = iyi giriş zamanı" eşitlemesi kurulamaz.',
    'Tam hüküm şartı: bilanço öncesi 5/20/60 gün getiri + XU100 göreceli getiri + hacim genişlemesi + bilanço sonrası fiyat-hacim tepkisi analyze_earnings_pricing aracıyla ölçülmeli.',
  ].join('\n');

  return {
    status: 'pricing_locked',
    reason: 'Bilanço kaynaklı alım/fırsat hükmü var ama fiyatlanma analizi provenance kaydı yok.',
    response: lockedResponse,
  };
}

module.exports = {
  COMMANDER_DECISION_TOOLS,
  EARNINGS_PRICING_TOOL,
  COMMANDER_MARKET_DATA_TOOLS,
  RISK_GATE_THRESHOLDS,
  buildCommanderGateResponse,
  classifyAssetClass,
  collectMissingVerdictEvidence,
  detectEquityVerdict,
  detectBuySideTimingVerdict,
  evaluateCommanderDecisionGate,
  evaluateEarningsPricingGate,
  evaluateRiskGate,
  evaluateVerdictEvidenceLock,
  hasCompletedEarningsPricingRun,
  neutralizeEquityVerdicts,
  extractCommanderToolNames,
  getRiskGateThresholds,
  hasCommanderActionableResponse,
  isCommanderActionableFinanceRequest,
  isCommanderFreshMarketScanRequest,
  isCommanderFinanceMessage,
  isCommanderInformationalFinanceRequest,
  isCommanderProductMarketplaceMessage,
};
