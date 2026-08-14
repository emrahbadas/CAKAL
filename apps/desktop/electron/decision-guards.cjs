// TEMEL ANALİZ SÖZCÜKLERİ DE FİNANS BAĞLAMIDIR.
// ÖLÇÜLEN VAKA (11 Ağustos 2026): "bilanço + fiyatlama karşılaştırması da yap"
// mesajı bu desene takılmadığı için isCommanderFinanceMessage FALSE döndü;
// requiresResearchContract skoru 0 / sinyal "finans baglami yok" oldu ve iki
// hissenin bilançosunu karşılaştıran tur TAMAMEN yönetimsiz geçti. Sözcükler
// borsa jargonunda tek anlamlı olanlardan seçilir; "fiyat" gibi genel bir
// sözcük buraya GİRMEZ (pazaryeri mesajlarını finans sanar).
const COMMANDER_FINANCE_DOMAIN_RE = /borsa|hisse|xu100|bist|kripto|bitcoin|ethereum|döviz|usd|eur|altın|ons|emtia|trade|trading|pozisyon|portföy|al\s*sat|bilanço|bilanco|mali\s*tablo|finansal\s*tablo|değerleme|degerleme|fiyatla(ma|nma|nmış|nmis)|temett[üu]|özkaynak|ozkaynak|net\s*borç|net\s*borc|f\/k|pd\/dd|favök|favok|net\s*kâr|net\s*kar\b/i;
// DİKKAT: bu listedeki kalıplar DAR olmalı. Çıplak "giriş" / "hedef" yazmak,
// önceki analizi eleştiren ("iyi giriş fırsatı demişsin ama...") ya da
// piyasayı anlatan her mesajı işlem talebi saydırıyordu. Bu kelimeler ancak
// işlem bağlamıyla birlikte geçtiğinde niyet göstergesidir.
const COMMANDER_ACTIONABLE_FINANCE_RE = /\bal\s*sat\b|(?:^|[\s,.;:!?])alım(?:$|[\s,.;:!?])|(?:^|[\s,.;:!?])satış(?:$|[\s,.;:!?])|almalı mıyım|satmalı mıyım|alınır mı|satılır mı|giriş\s*(fırsat|firsat|nokta|seviye|fiyat|zaman|yap)|girmeli miyim|entry|\bstop\b|hedef\s*(fiyat|seviye)|price target|trade plan|trade edilecek|hangi hisse\s*(alınır|satılır)|kaç lot|işlem aç|işlem kapat|pozisyon aç|pozisyon kapat|al\/sat sinyali|trade sinyali|izleme listesi/i;
const COMMANDER_INFORMATIONAL_FINANCE_RE = /durum|durumlar|özet|karşılaştır|tablo|listele|neler konuşuluyor|haber|yorum|analiz|grafik|teknik|genel görünüm|ortalama|trend/i;
const COMMANDER_ACTIONABLE_RESPONSE_RE = /\bAL\b|\bSAT\b|\bBEKLE\b|\bDİKKAT\b|\bDIKKAT\b|giriş|stop|hedef|trade plan|pozisyon/i;
// DİKKAT: "ilan" kelime başında aranmalı — düz substring araması "b-ilan-ço"
// içinde eşleşip bilanço mesajlarını pazaryeri sanıyor ve TÜM finans karar
// kapılarını (commander gate, hüküm-kanıt kilidi, fiyatlanma kilidi) atlatıyordu.
const COMMANDER_PRODUCT_MARKETPLACE_RE = /ürün|(?:^|[^a-zçğıöşü])ilan|sahibinden|trendyol|letgo|dolap|hepsiemlak|amazon|ebay|n11|hepsiburada|araba|araç|ev eşyası|telefon|laptop|platformlar arası|stoklu al|stokta|dropshipping|fba|fırsat ara/i;
// Fresh market scan tetikleyicileri.
// GEÇMİŞ HATA: "en sağlam 3 tanesini sırala" bu listede yoktu; ne actionable
// ne fresh-scan sayıldığı için karar kapısı HİÇ çalışmadı ve model sadece
// get_bist_gainers ile sığ cevap üretti. Üstünlük/sıralama talepleri de bir
// aday seçimi talebidir; kapı onlarda da açılmalı.
const COMMANDER_FRESH_MARKET_SCAN_RE = /sıfırdan|sifirdan|baştan|bastan|geniş\s+tara|genis\s+tara|piyasayı\s+tara|piyasayi\s+tara|piyasa\s+taraması|piyasa\s+taramasi|sepet\s+(çıkar|cikar|oluştur|olustur)|aday\s+(çıkar|cikar)|fırsat\s+hisseleri|firsat\s+hisseleri|umut\s+vadeden\s+hisse|hangi\s+hisseler/i;

// Üstünlük + sıralama + seçim kalıpları. Türkçe'de ifade sonsuz çeşitlenir;
// bu liste kapsayıcı DEĞİLDİR — asıl emniyet supabı çıkış tarafındaki
// UNGOVERNED_RANKING kapısıdır (evaluateUngovernedRankingGate).
const COMMANDER_RANKING_REQUEST_RE = new RegExp([
  // "en sağlam/iyi/güçlü/cazip/mantıklı..." (Türkçe karakterli sözcük sınırı yok)
  'en\\s+(saglam|sağlam|iyi|güçlü|guclu|cazip|mantıklı|mantikli|karlı|karli|umutlu|uygun|potansiyelli|dipte|ucuz)',
  // "top 5", "ilk 3", "3 tanesini", "en iyi 3"
  '\\btop\\s*\\d+', 'ilk\\s*\\d+', '\\d+\\s*tane(sini|si)?', '\\d+\\s*adet',
  // sıralama fiilleri (yazım varyantları dahil: sırala/sirala/sıralar mısın)
  'sırala', 'sirala', 'siralar\\s*mısın', 'sıralar\\s*mısın',
  // seçim / tercih talebi
  'seç(er\\s*misin)?\\b', 'sec(er\\s*misin)?\\b', 'sen\\s*olsan', 'tercih\\s*eder',
  // karşılaştırmalı üstünlük
  'hangisi\\s+(daha|en)', 'hangileri', 'daha\\s+mantıklı', 'daha\\s+mantikli',
  // önceki tool çıktısına gönderme
  'bunlardan\\s+hangi', 'bu\\s+listede', 'listedekiler',
  // öneri talebi
  'öner(ir\\s*misin)?\\b', 'oner(ir\\s*misin)?\\b', 'tavsiye\\s*eder',
].join('|'), 'i');

// Çıktının bir HİSSE SIRALAMASI/SEÇİMİ içerdiğini gösteren desenler.
// Kapı, kullanıcı ifadesini tahmin etmek yerine ÇAKAL'ın kendi ürettiği
// metni denetler; bu deterministik ve kapsam olarak çok daha dar bir yüzeydir.
//
// İKİ SINIF AYRI TUTULUR:
//   ÇAPA — liste satırının başındaki hisse kodu. HANGİ kodun sıralandığı
//          bilinir; bu yüzden "bu kodu kullanıcı zaten adıyla verdi mi"
//          sorusu sorulabilir.
//   DİL  — açık üstünlük ifadesi ("en sağlam 3 hisse"). Kod geçmese bile
//          ortada bir kalite hükmü vardır; bu asla affedilmez.
const RANKING_ANCHOR_MARKERS = [
  /(^|\n)\s*\d+[).\-]\s*([A-ZÇĞİÖŞÜ]{3,6})\b/m,      // "1) TUREX" / "2. SSAAT"
  /(^|\n)\s*[-*]\s*([A-ZÇĞİÖŞÜ]{3,6})\s*[—:-]/m,      // "- TUREX —"
];

const RANKING_LANGUAGE_MARKERS = [
  /en\s+(sağlam|saglam|iyi|güçlü|guclu|cazip)\s+\d*\s*(hisse|üç|uc|3)/i,
  // DİKKAT: JS regex'te Türkçe 'İ' (U+0130) `i` ile EŞLEŞMEZ ve `\b` Türkçe
  // harflerde güvenilmez. Bu yüzden sınıf açıkça yazılır: [İIiı]
  /(^|[^a-zçğıöşü])([İIiı]lk|[Tt]op)\s*\d+\s*(hisse|aday)/,
];

// NOT: Çapa ve dil marker'ları BİRLEŞTİRİLMİŞ tek liste olarak KULLANILMAZ.
// Çapa yakalandıktan sonra sicil doğrulamasından geçmek zorundadır; birleşik
// listeyi ham hâlde test etmek tam da 15 Ağustos'taki kanal listesi hatasını
// üretiyordu. Tespit için responseContainsEquityRanking'e bak.

// Bir sıralamanın "yönetilmiş" sayılması için gereken kanıt araçları.
const GOVERNED_RANKING_TOOLS = new Set(['run_investment_research_scan', 'verify_claim']);

// ── Kanıt sözleşmesi ──────────────────────────────────────────────────
// Kapı "hangi ARAÇ çalıştı" değil "hangi KANIT var ve ne kadar taze" sorusunu
// sormalıdır. Araçlar değişir, yenisi eklenir, adı değişir; kanıt sınıfı sabit
// kalır. Bu tablo tek doğruluk kaynağıdır — araç kümeleri buradan TÜRETİLİR,
// elle ikinci bir liste tutulmaz.
//
// Aynı desen dosyada zaten var: hasCompletedEarningsPricingRun aracın adına
// değil, ürettiği "sınıflandırma:" imzasına bakar. Burada genelleştiriliyor.
const TOOL_EVIDENCE_CLASSES = Object.freeze({
  get_stock_price: ['CURRENT_EQUITY_PRICE'],
  // MARKET_SESSION_STATUS: piyasa açık mı, gösterilen fiyat gün içi mi son
  // kapanış mı. 9 Ağustos 2026 PAZAR günü sistem "bugün alım" hükmü kurdu;
  // veri Cuma kapanışıydı ve bunu söylemedi. Seans durumu artık bir KANIT
  // sınıfıdır ve "bugün alınabilir mi" sorusunun zorunlu girdisidir.
  get_bist_board: ['CURRENT_EQUITY_PRICE', 'LIQUIDITY', 'INDEX_MEMBERSHIP', 'MARKET_SESSION_STATUS'],
  get_bist_gainers: ['MARKET_MOVERS'],
  get_market_signal: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
  analyze_finance_signal: ['TECHNICAL_SIGNAL', 'DECISION_CONFIRMATION'],
  // XU100 serisini de çeker ve göreceli getiri üretir → benchmark kanıtı.
  analyze_earnings_pricing: ['EARNINGS_PRICE_REACTION', 'BENCHMARK_PRICE_SERIES'],
  generate_stock_chart: ['CURRENT_EQUITY_PRICE'],
  // Benchmark serisi AYRI bir kanıt sınıfıdır. XU100 şirket entity'si değil
  // (likidite/bilanço istenmez) ama "XU100'e göre +%6,7" iddiası benchmark
  // serisi olmadan kurulamaz. Benchmark'ı tamamen kanıtsız bırakmak, relatif
  // güç hükmünü ölçümsüz bırakır.
  get_tcmb_rates: ['FX_RATE'],
  get_forex_rates: ['FX_RATE'],
  get_crypto_prices: ['CRYPTO_PRICE'],
  run_investment_research_scan: ['CURRENT_EQUITY_PRICE', 'LIQUIDITY', 'RESEARCH_EVIDENCE'],
  verify_claim: ['RESEARCH_EVIDENCE'],
  web_search: ['WEB_CONTEXT'],
  search_youtube_insights: ['SENTIMENT_EVIDENCE'],
  judge_opportunity: ['DECISION_CONFIRMATION'],
  // FUNDAMENTALS ≠ VALUATION. Ham mali tablo gelmesi "değerleme yapıldı"
  // demek DEĞİLDİR. Canlı testte alt soru "temel değerleme" istiyordu, kanıt
  // olarak FUNDAMENTALS yazılmıştı ve mali tablo gelince COMPLETE sayıldı —
  // oysa cevabın kendisi "değerleme katmanı tam değil" diyordu.
  // get_valuation_multiples mali tablo + fiyattan F/K, PD/DD, FD/FAVÖK türetir.
  get_financial_statements: ['FUNDAMENTALS'],
  get_valuation_multiples: ['VALUATION'],
  // BORÇ İYİLEŞMESİNİN KAYNAĞI AYRI BİR KANITTIR.
  // FUNDAMENTALS "net borç 546,9 mn TL" der; bu rakamın halka arz nakdinden mi
  // operasyondan mı geldiğini söylemez. MEYSU vakasında sermaye girişiyle
  // kapanan borç, operasyonel kalite artısı olarak sunuldu.
  get_cash_flow_breakdown: ['CASH_FLOW_BREAKDOWN'],
});

// Kanıt sınıfına göre tazelik. Tek bir 5 dakikalık TTL her kanıta uygulanamaz:
// fiyat dakikalar içinde bayatlar, bilanço bir çeyrek boyunca geçerlidir.
const EVIDENCE_TTL_MS = Object.freeze({
  CURRENT_EQUITY_PRICE: 15 * 60 * 1000,
  FX_RATE: 15 * 60 * 1000,
  CRYPTO_PRICE: 5 * 60 * 1000,
  MARKET_MOVERS: 15 * 60 * 1000,
  TECHNICAL_SIGNAL: 60 * 60 * 1000,
  LIQUIDITY: 60 * 60 * 1000,
  INDEX_MEMBERSHIP: 24 * 60 * 60 * 1000,
  // Seans durumu gün içinde değişir (açılış/kapanış); kısa tutulur.
  MARKET_SESSION_STATUS: 30 * 60 * 1000,
  BENCHMARK_PRICE_SERIES: 60 * 60 * 1000,
  EARNINGS_PRICE_REACTION: 24 * 60 * 60 * 1000,
  FUNDAMENTALS: 90 * 24 * 60 * 60 * 1000,
  // Bilanço kadar yaşar: aynı çeyrek boyunca geçerlidir.
  CASH_FLOW_BREAKDOWN: 90 * 24 * 60 * 60 * 1000,
  // Değerleme fiyata bağlıdır; bilanço kadar uzun yaşayamaz.
  VALUATION: 6 * 60 * 60 * 1000,
  RESEARCH_EVIDENCE: 6 * 60 * 60 * 1000,
  WEB_CONTEXT: 6 * 60 * 60 * 1000,
  SENTIMENT_EVIDENCE: 24 * 60 * 60 * 1000,
  DECISION_CONFIRMATION: 60 * 60 * 1000,
});
const DEFAULT_EVIDENCE_TTL_MS = 60 * 60 * 1000;

const MARKET_DATA_EVIDENCE_CLASSES = Object.freeze([
  'CURRENT_EQUITY_PRICE', 'FX_RATE', 'CRYPTO_PRICE', 'MARKET_MOVERS', 'TECHNICAL_SIGNAL', 'EARNINGS_PRICE_REACTION',
]);

function toolsProviding(classes) {
  const wanted = new Set(classes);
  return new Set(
    Object.entries(TOOL_EVIDENCE_CLASSES)
      .filter(([, provided]) => provided.some((klass) => wanted.has(klass)))
      .map(([tool]) => tool),
  );
}

const COMMANDER_MARKET_DATA_TOOLS = toolsProviding(MARKET_DATA_EVIDENCE_CLASSES);

/**
 * Aktivite olaylarından kanıt defteri kurar.
 * Olaylar ÖNCEKİ TURLARDAN da gelebilir; her kanıt sınıfı için en taze kayıt
 * tutulur ve TTL'ine göre taze/bayat işaretlenir.
 */
function normalizeEntity(value) {
  return String(value || '').trim().toUpperCase().replace(/\.IS$/i, '');
}

// ── Sonuç-duyarlı kanıt sınıfı ────────────────────────────────────────
// ARACIN ÇALIŞMASI ≠ KANIT ÜRETMESİ.
// GERÇEK VAKA: tarayıcı `status: 'BLOCKED'` iken bile `success: true`
// döndürüyordu; defter yalnız araç ADINA baktığı için bloke tarama üç kanıt
// sınıfı birden basıyor, entity düzeyinde "BRSAN kanıtlı" sayılıyor ve
// yönetilmiş sıralama kapısını açıyordu. Aynı hastalık action ledger'da da
// vardı: model bir sonraki turda "değerleme aracını çalıştırdım, başarılı"
// diye hatırlıyordu — oysa araç eksik girdiyle dönmüştü.
//
// Sıra ÖNEMLİ: önce başarısızlık elenir, sonra olayın KENDİ beyanı okunur,
// en son statik tabloya düşülür. Beyan tabloyu daraltabilir de genişletebilir
// de; araç kendi ne ürettiğini tablodan iyi bilir.
const FAILED_RESULT_STATUSES = new Set([
  'BLOCKED', 'FAILED', 'ERROR', 'DENIED', 'TIMEOUT', 'RATE_LIMITED',
  'NO_DATA', 'EMPTY', 'UNAVAILABLE', 'INPUT_REQUIRED',
]);

function isFailedToolEvent(event) {
  if (!event) return true;
  if (event.success === false) return true;

  const result = event.result && typeof event.result === 'object' ? event.result : null;
  if (result && result.success === false) return true;

  for (const candidate of [event.status, result && result.status]) {
    if (typeof candidate !== 'string') continue;
    if (FAILED_RESULT_STATUSES.has(candidate.trim().toUpperCase())) return true;
  }
  return false;
}

/**
 * Bir tool_call olayının GERÇEKTEN ürettiği kanıt sınıfları.
 * @param {string} toolName
 * @param {object} event - tool_call aktivite olayı (success/status/result/evidenceClasses)
 * @returns {string[]} kanıt sınıfları; üretmediyse boş dizi
 */
function resolveEvidenceClasses(toolName, event = {}) {
  const tool = String(toolName || '');
  if (!tool) return [];

  // 1) Başarısız/bloke olay kanıt üretmez — tablo ne derse desin.
  if (isFailedToolEvent(event)) return [];

  // 2) Olayın kendi beyanı. Boş dizi de GEÇERLİ bir beyandır ("kanıt yok");
  //    bu yüzden Array.isArray ile yokluğundan ayrılır.
  const declared = event.evidenceClasses ?? (event.result && event.result.evidenceClasses);
  if (Array.isArray(declared)) {
    return [...new Set(declared.map((k) => String(k || '').trim()).filter(Boolean))];
  }

  // 3) Statik tablo — beyan yoksa aracın sözleşmesi geçerlidir.
  return TOOL_EVIDENCE_CLASSES[tool] ? [...TOOL_EVIDENCE_CLASSES[tool]] : [];
}

function buildEvidenceLedger(events = [], now = Date.now()) {
  const ledger = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.type !== 'tool_call' || !event.tool) continue;
    // Araç adı değil, olayın SONUCU belirler. Bkz. resolveEvidenceClasses.
    const classes = resolveEvidenceClasses(String(event.tool), event);
    if (classes.length === 0) continue;

    // TTL "ne zaman baktık" üzerinden ölçülür (retrievedAt). asOf ise verinin
    // ne zamana ait olduğudur ve raporlama içindir — ikisini karıştırma:
    // piyasa kapalıyken asOf Cuma kapanışıdır ama veri o an için günceldir.
    const at = Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : now;
    const asOf = event.asOf || null;
    const entities = (Array.isArray(event.entities) ? event.entities : [])
      .map(normalizeEntity)
      .filter(Boolean);

    for (const klass of classes) {
      let entry = ledger.get(klass);
      if (!entry) {
        entry = { at: -Infinity, asOf: null, tool: null, tools: [], entities: new Map() };
        ledger.set(klass, entry);
      }
      if (at > entry.at) {
        entry.at = at;
        entry.asOf = asOf;
        entry.tool = String(event.tool);
      }
      entry.tools = [...new Set([...entry.tools, String(event.tool)])];

      // Entity boyutu ZORUNLU ayrım: KCHOL hakkındaki bir alt soru THYAO için
      // çekilmiş fiyatla tatmin olmamalı. Entity'siz olaylar (piyasa geneli
      // tarama gibi) sınıf düzeyinde sayılır, entity düzeyinde saymaz.
      for (const entity of entities) {
        const prior = entry.entities.get(entity);
        if (!prior || at > prior.at) {
          entry.entities.set(entity, { at, asOf, tool: String(event.tool) });
        }
      }
    }
  }
  return ledger;
}

function ttlFor(klass) {
  return EVIDENCE_TTL_MS[klass] ?? DEFAULT_EVIDENCE_TTL_MS;
}

function hasFreshEvidence(ledger, klass, now = Date.now()) {
  const entry = ledger instanceof Map ? ledger.get(klass) : null;
  if (!entry) return false;
  return now - entry.at <= ttlFor(klass);
}

/**
 * Bu kanıt sınıfı BU VARLIK için taze mi?
 * Sınıf düzeyinde taze olması yetmez — hangi sembol için çekildiği önemlidir.
 */
function hasFreshEvidenceForEntity(ledger, klass, entity, now = Date.now()) {
  const entry = ledger instanceof Map ? ledger.get(klass) : null;
  if (!entry) return false;
  const key = normalizeEntity(entity);
  if (!key) return hasFreshEvidence(ledger, klass, now);
  const hit = entry.entities.get(key);
  if (!hit) return false;
  return now - hit.at <= ttlFor(klass);
}

/** Kanıt defterinde kayıtlı varlıklar (raporlama ve denetim için). */
function entitiesWithEvidence(ledger, klass) {
  const entry = ledger instanceof Map ? ledger.get(klass) : null;
  return entry ? [...entry.entities.keys()] : [];
}

function hasAnyFreshEvidence(ledger, classes, now = Date.now()) {
  return classes.some((klass) => hasFreshEvidence(ledger, klass, now));
}

function describeStaleEvidence(ledger, classes, now = Date.now()) {
  return classes
    .filter((klass) => ledger instanceof Map && ledger.has(klass) && !hasFreshEvidence(ledger, klass, now))
    .map((klass) => `${klass} (${Math.round((now - ledger.get(klass).at) / 60000)} dk önce, TTL ${Math.round((EVIDENCE_TTL_MS[klass] ?? DEFAULT_EVIDENCE_TTL_MS) / 60000)} dk)`);
}
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

/**
 * ÇALIŞAN değil, KANIT ÜRETEN araçlar.
 * "Araç çalıştı" ile "araç kanıt üretti" ayrımı gerektiğinde bu kullanılır;
 * bloke/başarısız çağrı bir kapıyı açmaya yetmez.
 */
function extractEvidenceProducingToolNames(events = []) {
  return [...new Set(
    events
      .filter((event) => event && event.type === 'tool_call' && event.tool)
      .filter((event) => resolveEvidenceClasses(String(event.tool), event).length > 0)
      .map((event) => String(event.tool))
  )];
}

// HİSSE KODU DA FİNANS BAĞLAMIDIR.
// GEÇMİŞ HATA: "THYAO bugün alınır mı?" mesajında borsa/hisse gibi bir alan
// kelimesi geçmediği için isCommanderFinanceMessage FALSE dönüyordu. Sonuç:
// karar kapısı, işlem niyeti kontrolü ve araştırma sözleşmesi HİÇBİRİ
// çalışmadı — açıkça bir alım sorusu olmasına rağmen. Cevabın iyi çıkması
// modelin kendi disiplinine kalmıştı, sisteme değil.
const BIST_TICKER_RE = /(^|[^A-ZÇĞİÖŞÜ0-9])([A-Z]{4,6})(?![A-ZÇĞİÖŞÜ])/g;

// KARA LİSTE ARTIK TEK SAVUNMA DEĞİL — sicil (allowlist) otoritedir.
// Bu küme yalnız sicil yüklenemezse devreye giren yedek olarak duruyor.
// ÖLÇÜLEN CANLI HATA (13 Ağustos 2026): kara liste yaklaşımı yapısal olarak
// yetersizdi, çünkü Türkçede büyük harfli kelime kümesi SINIRSIZ.
//   "BRSAN'ın son dönemini GEÇEN YILIN AYNI DÖNEMİYLE karşılaştır"
//   → ['BRSAN', 'YILIN', 'AYNI'] → "coklu sirket (3)" → skor 4/4
//   → gereksiz araştırma sözleşmesi → tek şirketlik soru 81 saniye sürdü.
// Kullanıcı üç şirket sormadı; dedektör Türkçe kelimeleri hisse sandı.
const TICKER_FALSE_POSITIVES = new Set([
  'BIST', 'BORSA', 'VIOP', 'TEFAS', 'TCMB', 'BDDK', 'TUIK', 'IMKB', 'ENDEKS',
  'TAMAM', 'MERHABA', 'SELAM', 'LUTFEN', 'TESEKKUR', 'EVET', 'HAYIR', 'PEKI',
  'ANCAK', 'FAKAT', 'VERI', 'ANALIZ', 'RAPOR', 'TOPLAM', 'ORTALAMA', 'HISSE',
]);

let symbolRegistry = null;
try {
  symbolRegistry = require('./bist-symbol-registry.cjs');
} catch (_) {
  symbolRegistry = null; // sicil yoksa kara listeye düşülür (aşağıda)
}

/**
 * Metinde geçen hisse kodları.
 *
 * Sicil varsa ALLOWLIST uygulanır: sicilde olmayan büyük harfli dizi sembol
 * SAYILMAZ. Yeni halka arz edilmiş bir şirket, sicil tazelenene kadar
 * görülmez — bu bilinçli bir tercih. Eksik tetikleme, her Türkçe cümlede
 * sahte şirket saymaktan iyidir; başarısızlık yönü güvenli tarafta olmalı.
 * XU100/XU030/XU050 gibi endeksler sicilde yoktur ve şirket sayılmamalıdır.
 */
function extractBistTickers(message = '') {
  const text = String(message || '');
  BIST_TICKER_RE.lastIndex = 0;
  const found = new Set();
  let m;
  while ((m = BIST_TICKER_RE.exec(text)) !== null) {
    if (isRecognizedTicker(m[2])) found.add(m[2]);
  }
  return [...found];
}

/**
 * Bu büyük harfli dizi GERÇEKTEN bir BIST sembolü mü?
 *
 * Sicil varsa allowlist, yoksa eski kara listeye düşülür. TEK KARAR NOKTASI:
 * aynı soruyu soran her yer buradan geçmeli. Sembol tespitinin üç ayrı kopyası
 * olduğu ve biri düzeltilince diğerinin yanlış çalışmaya devam ettiği daha
 * önce iki kez ölçüldü (bkz. docs §4.8).
 */
function isRecognizedTicker(code) {
  if (!code) return false;
  if (symbolRegistry) return symbolRegistry.isKnownBistSymbol(code);
  return !TICKER_FALSE_POSITIVES.has(code);
}

function containsBistTicker(message = '') {
  return extractBistTickers(message).length > 0;
}

/**
 * Sıralama çapalarının yakaladığı kodlar: "1) TUREX", "- BRSAN:".
 * Sadece ÇAPA marker'ları taranır — dil marker'larının kod bağlantısı yoktur.
 */
function collectRankingAnchorTickers(response = '') {
  const text = String(response || '');
  const found = new Set();
  for (const marker of RANKING_ANCHOR_MARKERS) {
    const flags = marker.flags.includes('g') ? marker.flags : `${marker.flags}g`;
    const scanner = new RegExp(marker.source, flags);
    let m;
    while ((m = scanner.exec(text)) !== null) {
      if (isRecognizedTicker(m[2])) found.add(m[2]);
    }
  }
  return [...found];
}

/**
 * @param {object} opts
 * @param {boolean} opts.tickerAware - Hisse kodunu finans sinyali say.
 *   KULLANICI MESAJI için true (varsayılan): "THYAO alınır mı" finanstır.
 *   ÜRETİLEN CEVAP için FALSE olmalı — serbest metinde her büyük harfli
 *   sözcük kod gibi görünür ("1) MATRIX, 2) INCEPTION" film sıralaması
 *   finans sanılıyordu.
 */
function isCommanderFinanceMessage(message = '', opts = {}) {
  const text = String(message || '');
  if (COMMANDER_FINANCE_DOMAIN_RE.test(text)) return true;
  return opts.tickerAware === false ? false : containsBistTicker(text);
}

// PAZARYERİ İSTİSNASI FİNANS BAĞLAMINI EZEMEZ.
// GEÇMİŞ HATA: "BIST'te fırsat ara" → COMMANDER_PRODUCT_MARKETPLACE_RE'deki
// "fırsat ara" kalıbına düşüp TÜM finans karar kapılarını atlatıyordu; sistem
// sekiz hisselik sıralama üretti ve hiçbir kapı bakmadı. İstisna, ikinci el
// eşya/ilan aramaları içindir — mesajda açık borsa bağlamı varsa geçersizdir.
const EXPLICIT_FINANCE_CONTEXT_RE = /\b(bist|borsa|hisse|xu\d{2,3}|endeks|kap|temett[üu]|portf[öo]y)\b/i;

function isCommanderProductMarketplaceMessage(message = '') {
  const text = String(message || '');
  if (!COMMANDER_PRODUCT_MARKETPLACE_RE.test(text)) return false;
  if (EXPLICIT_FINANCE_CONTEXT_RE.test(text) || containsBistTicker(text)) return false;
  return true;
}

function isCommanderActionableFinanceRequest(message = '') {
  const text = String(message || '');
  return isCommanderFinanceMessage(text) && COMMANDER_ACTIONABLE_FINANCE_RE.test(text);
}

function isCommanderFreshMarketScanRequest(message = '') {
  const text = String(message || '');
  // TARAMA KALIBI KENDİ BAŞINA PİYASA BAĞLAMIDIR.
  // ÖLÇÜLEN VAKA: "piyasayı sıfırdan tara ve aday çıkar" mesajı finans
  // sözlüğüne takılmıyordu ("piyasa" o listede yok) ve ders kitabı gibi bir
  // tarama talebi finans dışı sayılıp huni kapısından geri dönüyordu.
  // COMMANDER_FRESH_MARKET_SCAN_RE kalıpları zaten piyasaya özgüdür
  // ("piyasayı tara", "aday çıkar", "fırsat hisseleri"); genel finans
  // sözlüğünü genişletmek yerine bu kalıbı bağlam kanıtı sayıyoruz —
  // "ikinci el piyasası" gibi mesajları finans sanmamak için dar tutuldu.
  if (COMMANDER_FRESH_MARKET_SCAN_RE.test(text)) return true;
  if (!isCommanderFinanceMessage(text)) return false;
  return COMMANDER_RANKING_REQUEST_RE.test(text);
}

/**
 * Cevap metni bir hisse sıralaması/seçimi sunuyor mu?
 *
 * ÖLÇÜLEN CANLI HATA (15 Ağustos 2026): "telegramdaki kanalları listele"
 * sorusuna verilen kanal listesi hisse sıralaması sanıldı ve kapı iki kez
 * ateşleyip cevabı bloke etti. Sebep: çapa deseni yalnız ŞEKLE bakıyordu —
 * "satır başında numara + 3-6 büyük harf". Gerçek kanal adları:
 *
 *   "1. BORSA İZİNDE"          -> BORSA
 *   "4. YILDIZ PAZAR"          -> YILDIZ
 *   "6. MEYVE SEBZE HAL..."    -> MEYVE
 *   "8. SAHİBİNDEN SEBZE..."   -> SAHİBİ
 *
 * Dördü de sicilde YOK; hiçbiri hisse değil. Finans bağlamı da cevaptan
 * geliyordu ("Borsa Haber Hisse" kanal adı), yani kullanıcı borsadan hiç
 * söz etmemişti.
 *
 * Kritik ayrıntı: `collectRankingAnchorTickers` kara listeyi uyguladığı için
 * "BORSA"yı zaten eliyordu — ama bu fonksiyon onu ÇAĞIRMIYOR, ham deseni
 * test ediyordu. Aynı sorunun iki cevabı vardı ve biri yanlıştı.
 * Artık tek yoldan geçer: çapa = sicilde doğrulanmış sembol.
 *
 * Dil marker'ları ("en sağlam 3 hisse") koşulsuz kalır — kod geçmese bile
 * ortada kalite hükmü vardır.
 */
function responseContainsEquityRanking(response = '') {
  const text = String(response || '');
  if (!text.trim()) return false;
  if (RANKING_LANGUAGE_MARKERS.some((pattern) => pattern.test(text))) return true;
  return collectRankingAnchorTickers(text).length > 0;
}

/**
 * ÇIKIŞ KAPISI — girişte niyet kaçsa bile devreye girer.
 *
 * Gerekçe: Türkçe'de sıralama talebinin ifadesi sonsuz çeşitlenir (yazım
 * hataları, İngilizce karışımı, "bunlardan hangileri?" gibi bağlamsal
 * referanslar). Giriş regex'i kapsayıcı olamaz. Bu kapı ise ÇAKAL'ın KENDİ
 * ürettiği metne bakar: ortada bir hisse sıralaması varsa, arkasında
 * yönetilmiş araştırma da olmalıdır.
 *
 * Kural: cevap sıralama içeriyor VE araştırma/kanıt aracı çalışmamışsa
 *        → BLOCKED_UNGOVERNED_RANKING
 */
function evaluateUngovernedRankingGate(message, response, events = []) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  if (!responseContainsEquityRanking(response)) return null;

  // Finans bağlamı mesajdan VEYA cevaptan gelebilir.
  // GEÇMİŞ HATA: "en sağlam 3 tanesini sırala" tek başına finans kelimesi
  // içermiyor — bağlam önceki turdan geliyordu. Yalnız mesaja bakan bir kapı
  // tam da yakalaması gereken vakayı kaçırırdı. Cevap hisse sıralaması
  // içeriyorsa finans bağlamı zaten kanıtlanmıştır.
  // Cevap tarafında kod tespiti KAPALI: üretilen metindeki büyük harfli
  // sözcükler (film adı, kısaltma) hisse kodu sanılmamalı.
  const financeContext = isCommanderFinanceMessage(message)
    || isCommanderFinanceMessage(response, { tickerAware: false });
  if (!financeContext) return null;

  // ADAYLARI KULLANICI VERDİYSE ORTADA SEÇİM YOKTUR.
  // GERÇEK VAKA (11 Ağustos 2026): "BRSAN ve MEYSU hakkında son haberleri tara
  // ve karşılaştır" isteğinde cevaptaki "- BRSAN: İZLE" ve "1. BRSAN ve MEYSU
  // için teknik seviye haritası" satırları çapa marker'larına düştü. Kapı
  // ateşledi, boşuna ikinci LLM turu yandı ve nihai cevap kullanıcının hiç
  // istemediği bir "sıralamayı" geri çekerek başladı.
  // Oysa bu kapı ADAY SEÇİMİNİ yönetir: evren yoksa elenen de yoktur.
  // Kullanıcının kendi adıyla verdiği sembolleri karşılaştırmak seçim değildir.
  // Kaçış iki koşulda KAPALIDIR: açık tarama/sıralama talebi ("en sağlam 3'ü
  // sırala") ya da cevapta dil marker'ı — o durumda üstünlük hükmü kurulmuştur.
  const rankedByAnchor = collectRankingAnchorTickers(response);
  const hasRankingLanguage = RANKING_LANGUAGE_MARKERS.some((p) => p.test(String(response || '')));
  if (!hasRankingLanguage && !isCommanderFreshMarketScanRequest(message)) {
    const askedFor = new Set(extractBistTickers(message));
    if (askedFor.size > 0 && rankedByAnchor.length > 0
      && rankedByAnchor.every((code) => askedFor.has(code))) {
      return null;
    }
  }

  const usedTools = extractCommanderToolNames(events);
  // Kapıyı açan şey aracın ÇALIŞMASI değil, KANIT ÜRETMESİDİR.
  // Ölçüldü: `status: 'BLOCKED'` dönen bir run_investment_research_scan olayı
  // eski kodda üç kanıt sınıfı basıp bu kapıyı açıyordu.
  const producingTools = extractEvidenceProducingToolNames(events);
  if (producingTools.some((tool) => GOVERNED_RANKING_TOOLS.has(tool))) return null;

  const reason = usedTools.length === 0
    ? 'Hisse sıralaması üretildi fakat hiçbir araştırma aracı çalışmadı.'
    : `Hisse sıralaması üretildi fakat yönetilmiş araştırma çalışmadı (kullanılan: ${usedTools.join(', ')}).`;

  return {
    status: 'BLOCKED_UNGOVERNED_RANKING',
    reason,
    usedTools,
    response: buildUngovernedRankingResponse(reason, usedTools),
  };
}

// ── Borç kalite kapısı ────────────────────────────────────────────────
// GERÇEK VAKA (11 Ağustos 2026): "Net borç 1,36 mlr TL'den 546,9 mn TL'ye
// inmiş görünüyor. Bu pozitif." Muhasebe olarak doğru, hüküm olarak eksik:
// borcu kapatan nakit büyük ölçüde halka arz sermayesiydi ve işletme nakit
// akışı negatifti. Kasa doldu ama makine kendi ürettiği nakitle doldurmadı.
//
// Kural: cevap borç azalmasını OLUMLU bir hükme bağlıyorsa, arkasında
// CASH_FLOW_BREAKDOWN kanıtı olmalı. Yoksa iddia nötrleştirilir — bulgu
// silinmez, yalnız "kalite artısı" niteliği düşer.

// Borç/borçluluk iyileşmesi ifadeleri.
// DİKKAT: burada `\b` KULLANILMAZ. JS regex'inde ş/ı/ğ/ç/ö/ü kelime karakteri
// sayılmaz; /inmiş\b/ "inmiş" sözcüğünü KAÇIRIR (sonundaki 'ş' non-word).
// Aynı tuzak router'da da vardı ve orada da düzeltildi.
const DEBT_IMPROVEMENT_RE = /(net\s*bor[çc]|bor[çc]luluk|finansal\s*bor[çc])[^.\n]{0,90}(düş|dus|azal|geriled|iyileş|iyiles|inmiş|inmis|indi|ine?rek)/i;

// İyileşmeyi OLUMLU hükme bağlayan ifadeler.
const DEBT_POSITIVE_FRAMING_RE = /(bu\s*pozitif|pozitif|olumlu|güçlen|guclen|sağlam|saglam|iyi\s*sinyal|artı\s*yaz|lehte|güven\s*ver|guven\s*ver)/i;

function responseClaimsDebtQuality(response = '') {
  const text = String(response || '');
  if (!DEBT_IMPROVEMENT_RE.test(text)) return false;
  // İyileşme cümlesinin YAKININDA olumlu çerçeveleme var mı?
  // Tüm metinde "pozitif" aramak, başka bir konuda geçen kelimeyi yakalardı.
  return text.split(/\n{2,}|(?<=\.)\s+/).some(
    (parca) => DEBT_IMPROVEMENT_RE.test(parca) && DEBT_POSITIVE_FRAMING_RE.test(parca),
  ) || text.split('\n').some(
    (satir, i, hepsi) => DEBT_IMPROVEMENT_RE.test(satir)
      && DEBT_POSITIVE_FRAMING_RE.test([satir, hepsi[i + 1] || ''].join(' ')),
  );
}

/**
 * ÇIKIŞ KAPISI — borç iyileşmesi kanıtsız kaliteye yazılamaz.
 * Kanıt "araç çalıştı" değil "kanıt üretti" ölçütüyle aranır (bkz. Adım 2).
 */
function evaluateDebtQualityGate(message, response, events = []) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  if (!responseClaimsDebtQuality(response)) return null;

  const ledger = buildEvidenceLedger(events);
  if (hasFreshEvidence(ledger, 'CASH_FLOW_BREAKDOWN')) return null;

  const reason = 'Net borç iyileşmesi olumlu hükme bağlandı fakat nakit akışı ayrıştırması yok: '
    + 'borcu kapatan nakdin operasyondan mı sermaye girişinden mi geldiği ölçülmedi.';

  return {
    status: 'BLOCKED_UNSOURCED_DEBT_QUALITY',
    reason,
    response: [
      neutralizeEquityVerdicts(response),
      '',
      '---',
      '⚖️ BORÇ KALİTE KİLİDİ (deterministik):',
      reason,
      'Borç azalması muhasebe olarak doğru olabilir; OPERASYONEL kalite göstergesi olduğu '
        + 'ancak get_cash_flow_breakdown ile kanıtlanırsa söylenebilir.',
      'Eksik kanıtı toplayacak araç: get_cash_flow_breakdown.',
    ].join('\n'),
  };
}

// ── Yönlendirilmemiş yetenek talebi kapısı ────────────────────────────
// GERÇEK VAKA: "kaynak kodunda README'ye bir bölüm ekle" isteğinde ÇAKAL
// write_project_file ile doğrudan yazmayı denedi, sandbox duvarına çarptı ve
// "yapamıyorum, istersen sandbox'a yazayım" dedi. propose_surgical_change'i
// HİÇ çağırmadı. Cerrahi hat elinin altındayken kullanıcıya ölü dosya teklif
// etti.
//
// Kural: cevap bir kaynak-kod/yetenek işi üstlendiğini ya da reddettiğini
// gösteriyorsa, arkasında bir YÖNLENDİRME olmalı:
//   - propose_surgical_change  (Kademe 2 — cerrahi hat)
//   - register_sandbox_plugin  (Kademe 1 — veri kaynağı)
//   - run_sandbox_plugin       (zaten kurulu yetenek kullanıldı)
// Hiçbiri yoksa istek boşa düşmüştür → blokla ve doğru yola çevir.

// Çekirdek dosyaya yazma denemesinin duvara çarptığını gösteren imza.
const CORE_WRITE_BLOCKED_RE = /GÜVENLİK:.*(yolu korumalı|korumalı alanda)/i;

// Cevabın sandbox'a "çözüm" diye dosya yazmayı önerdiğini gösteren imza.
const DEAD_SANDBOX_OFFER_RE = /\.cakal-sandbox\/(tools|skills|workflows|prompts)\//i;

const SURGICAL_ROUTING_TOOLS = new Set([
  'propose_surgical_change',
  'register_sandbox_plugin',
  'run_sandbox_plugin',
  'apply_capability_plan',
]);

/** Cevap bir kaynak kod / yetenek işini üstleniyor ya da reddediyor mu? */
function responseClaimsCapabilityWork(response = '') {
  const text = String(response || '');
  if (!text.trim()) return false;
  return CORE_WRITE_BLOCKED_RE.test(text)
    || DEAD_SANDBOX_OFFER_RE.test(text)
    || /(kaynak kod|çekirdek dosya).{0,40}(yaz|değiştir|düzenle)/i.test(text)
    || /(yazma yetkim yok|yazamıyorum|yazamam).{0,80}(sandbox|korumalı)/i.test(text);
}

/**
 * ÇIKIŞ KAPISI — kaynak kod isteği boşa düşmesin.
 * Aktivite log'u tool_call olaylarından okunur; cevap metnindeki iddia yetmez.
 */
function evaluateUnroutedCapabilityGate(message, response, events = []) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  if (!responseClaimsCapabilityWork(response)) return null;

  const usedTools = extractCommanderToolNames(events);
  if (usedTools.some((tool) => SURGICAL_ROUTING_TOOLS.has(tool))) return null;

  const offeredDeadFile = DEAD_SANDBOX_OFFER_RE.test(String(response || ''));
  const reason = offeredDeadFile
    ? 'Kaynak kod isteği sandbox dosyasına yönlendirildi; o dosyaları çalışma zamanında hiçbir şey okumaz.'
    : 'Kaynak kod isteği hiçbir yola yönlendirilmedi (ne cerrahi hat ne sandbox plugin).';

  return {
    status: 'BLOCKED_UNROUTED_CAPABILITY',
    reason,
    usedTools,
    response: buildUnroutedCapabilityResponse(reason, usedTools),
  };
}

function buildUnroutedCapabilityResponse(reason, usedTools) {
  const toolNote = usedTools.length > 0 ? usedTools.join(', ') : 'yok';
  return [
    '## Bu istek cerrahi bakım gerektiriyor',
    '',
    `**Sebep:** ${reason}`,
    `**Çalışan araçlar:** ${toolNote}`,
    '',
    'Kaynak kod değişikliğini ben yapmam — kodlama ajanı (GitHub Copilot) yapar.',
    'Sandbox\'a dosya yazmak çözüm değildir: o dosyaları çalışma zamanında hiçbir şey okumaz.',
    '',
    '**Doğru yol:** `propose_surgical_change` ile talebi kaydet, sonra kullanıcı',
    'sol menüdeki **Cerrahi Bakım** ekranından başlatsın. Orada değişikliğin diff\'ini',
    'görüp onaylayacak.',
  ].join('\n');
}

function buildUngovernedRankingResponse(reason, usedTools) {
  const toolNote = usedTools.length > 0 ? usedTools.join(', ') : 'yok';
  return [
    '## Sıralama üretilemedi — araştırma kapısı açılmadı',
    '',
    `**Sebep:** ${reason}`,
    `**Çalışan araçlar:** ${toolNote}`,
    '',
    'Hisse sıralaması bir aday seçimidir; yalnız günlük değişim listesiyle yapılamaz.',
    'Bunun için evren taraması, likidite/veri kalitesi filtresi ve kanıt doğrulaması gerekir.',
    '',
    '**Yapılabilecek:** `run_investment_research_scan` ile yönetilmiş tarama çalıştır,',
    'ya da soruyu daralt (ör. tek hisse teknik görünüm, bilanço özeti).',
    '',
    'Not: Ölçülmemiş sıralama, en güçlü momentum listesi ile karıştırılmamalıdır.',
  ].join('\n');
}

function isCommanderInformationalFinanceRequest(message = '') {
  const text = String(message || '');
  return isCommanderFinanceMessage(text) && COMMANDER_INFORMATIONAL_FINANCE_RE.test(text);
}

function hasCommanderActionableResponse(response = '') {
  return COMMANDER_ACTIONABLE_RESPONSE_RE.test(String(response || ''));
}

// Kapı çıktısı iki eksenlidir: ANALİZ ayrı, EYLEM İZNİ ayrı.
//
// GEÇMİŞ HATA: kapı tek boolean gibi çalışıp cevabın TAMAMINI kısa bir
// VERI_YETERSIZ bloğuyla değiştiriyordu. Bir kanıt sınıfı eksik diye 40+
// kaynakla üretilmiş bütün araştırma çöpe gidiyordu. Doğru davranış, aynı
// dosyada verdict lock'ta zaten uygulanan desendir: metni koru, yalnız AL/SAT
// hükmünü nötrle ve neyin bloke edildiğini altına yaz. Analiz kullanıcıya
// ulaşır, eylem hükmü ulaşmaz.
//
// originalResponse boşsa (ya da nötrleme sonrası anlamlı içerik kalmıyorsa)
// eski tam-blok davranışına düşer — geriye dönük uyumluluk korunur.
function buildGateFooter(headline, summary, reason, toolNote, remedyLines) {
  return [
    '',
    '',
    '---',
    `⚖️ KARAR KAPISI — ${headline} (deterministik)`,
    summary,
    `Neden: ${reason}`,
    toolNote,
    ...remedyLines,
  ].join('\n');
}

function hasMeaningfulContent(response = '') {
  return String(response || '').trim().length >= 40;
}

function buildCommanderGateResponse(status, reason, usedTools, originalResponse = '') {
  const toolNote = usedTools.length > 0
    ? `Kanıt araçları: ${usedTools.join(', ')}`
    : 'Kanıt araçları: yok';

  const isVeriYetersiz = status === 'veri_yetersiz';
  const headline = isVeriYetersiz ? 'VERI_YETERSIZ' : 'NO_SIGNAL';
  const summary = isVeriYetersiz
    ? 'Bu istek işlem/sinyal niteliği taşıyor ama zorunlu piyasa verisi yeterince toplanmadan nihai AL/SAT üretmiyorum.'
    : 'Piyasa verisi var ama karar kapısı yeterli deterministik teyit üretmediği için nihai sinyal vermiyorum.';
  const remedyLines = isVeriYetersiz
    ? ['', 'Devam etmek için fiyat/veri araçlarıyla yeniden analiz çalıştırılmalı: get_bist_board (çok sembollü BIST panosu), get_stock_price, get_market_signal, analyze_finance_signal, get_forex_rates, get_crypto_prices, get_tcmb_rates veya generate_stock_chart.']
    : ['', 'İşlem sinyali için analyze_finance_signal ve/veya judge_opportunity tabanlı teyit gerekli.'];

  if (hasMeaningfulContent(originalResponse)) {
    return [
      neutralizeEquityVerdicts(originalResponse),
      buildGateFooter(
        headline,
        summary,
        reason,
        toolNote,
        [
          '',
          'Yukarıdaki analiz KORUNMUŞTUR; yalnız AL/SAT hükmü İNCELE/RİSKLİ seviyesine indirilmiştir.',
          'Bu bir bilgi bloğudur, işlem tavsiyesi değildir.',
          ...remedyLines,
        ],
      ),
    ].join('');
  }

  return [headline, '', summary, `Neden: ${reason}`, toolNote, ...remedyLines].join('\n');
}

function buildFreshMarketScanGateResponse(reason, usedTools, originalResponse = '') {
  const toolNote = usedTools.length > 0
    ? `Kanıt araçları: ${usedTools.join(', ')}`
    : 'Kanıt araçları: yok';

  const summary = 'Fresh market scan politikasi tamamlanmadan hisse sepeti veya AL/SAT benzeri nihai sonuc uretmiyorum.';
  const discipline = 'Zorunlu disiplin: evreni dondur, genis tarama yap, resmi/guvenilir kaynaklarla claim dogrula, degerleme-risk-ters tez adimlarini tamamla. En cok artanlar listesi tek basina aday tavsiyesi degildir.';

  if (hasMeaningfulContent(originalResponse)) {
    return [
      neutralizeEquityVerdicts(originalResponse),
      buildGateFooter('VERI_YETERSIZ / Fresh market scan', summary, reason, toolNote, [
        '',
        'Yukarıdaki gözlemler KORUNMUŞTUR; yalnız aday sepeti ve AL/SAT hükmü bloke edilmiştir.',
        '',
        discipline,
      ]),
    ].join('');
  }

  return ['VERI_YETERSIZ', '', summary, `Neden: ${reason}`, toolNote, '', discipline].join('\n');
}

// Profil kurulum / tanışma mesajları: kullanıcı tercihlerini anlatırken geçen
// "al sat", "trade" gibi ifadeler işlem niyeti DEĞİLDİR. Bu bağlamda kapı ancak
// cevapta gerçek bir AL/SAT hükmü varsa devreye girer (detectEquityVerdict).
const COMMANDER_PROFILE_SETUP_RE = /(risk tolerans|yatırım vade|yatirim vade|maksimum kayıp|maksimum kayip|yatırımcı profil|yatirimci profil|profilimi|profilime|tanışalım|tanisalim|beni tanı|beni tani)/i;

// ── Konuşma eylemi (speech act) ayrımı ────────────────────────────────
// GERÇEK VAKA: Kullanıcı önceki analizin eksiklerini eleştiren bir metin
// yapıştırdı. Metinde "giriş", "hedef", "analiz", hisse kodları geçtiği için
// kapı "Bu istek işlem/sinyal niteliği taşıyor" dedi ve cevabı bloke etti.
// Oysa ortada yeni bir AL/SAT talebi yoktu.
//
// Alan (domain) ile konuşma eylemi (speech act) farklı eksenlerdir:
//   domain=finance + speech_act=feedback  → işlem kapısı AÇILMAMALI
//   domain=finance + speech_act=request   → işlem kapısı açılır
//
// Bu kapı niyeti tahmin etmeye çalışmaz; emniyet supabı çıkıştadır:
// cevapta GERÇEK bir AL/SAT hükmü varsa (detectEquityVerdict) kapı yine
// devreye girer. Yani yanlış sınıflandırma en fazla bir bilgi cevabını
// serbest bırakır, kanıtsız bir hükmü değil.
const COMMANDER_META_DISCUSSION_RE = new RegExp([
  // sistemin/kodun kendisi hakkında konuşma
  'çakal', 'cakal', 'mimari', 'karar kapısı', 'karar kapisi', 'kapı\\s*(çalış|calis|aç|ac|kapa)',
  '\\btool\\b', '\\bprompt', 'aktivite log', '\\blog(lar|unda|larda)\\b', 'kaynak kod',
  // önceki cevaba/rapora gönderme, eleştiri, düzeltme
  'önceki\\s+(cevab|analiz|yanıt|yanit|tur)', 'onceki\\s+(cevab|analiz|yanit|tur)',
  'bu\\s+(bulgu|rapor|öneri|oneri|liste|değerlendirme|degerlendirme)',
  'değerlendir', 'degerlendir', 'eleştir', 'elestir',
  'hatal[ıi]\\b', 'yanl[ıi]ş\\b', 'yanlis\\b', 'eksik(ler|leri|lik)?\\b',
  'neden\\s+\\S+\\s*(madın|medin|mad[ıi]n|mıyor|miyor)',
  // dış kaynaklı analiz metni getirme
  'chatgpt', '\\bgpt\\b', 'şu listeye', 'su listeye',
].join('|'), 'i');

function isCommanderMetaDiscussion(message = '') {
  return COMMANDER_META_DISCUSSION_RE.test(String(message || ''));
}

/**
 * @param {object} options
 * @param {boolean} options.contractGoverned - Araştırma sözleşmesi kilitliyse
 *   zorunlu kanıt kümesinin TEK KAYNAĞI sözleşmedir. Bu kapı kendi listesini
 *   dayatmaz; yalnız hüküm güvenliğini korur.
 *
 * GEÇMİŞ HATA: sözleşme "s1/s3 COMPLETE" derken bu kapı aynı anda
 * "VERI_YETERSIZ: claim/evidence dogrulama araci calismadi" diyordu — çünkü
 * verify_claim bekliyordu, oysa sözleşme RESEARCH_EVIDENCE'ı hiç zorunlu
 * kılmamıştı. İki sistem farklı şey isteyince kullanıcı çelişki görüyordu.
 */
function evaluateCommanderDecisionGate(message, response, events = [], options = {}) {
  if (isCommanderProductMarketplaceMessage(message)) {
    return null;
  }

  if (!isCommanderFinanceMessage(message)) {
    return null;
  }

  // Profil kurulumu ve meta tartışma (eleştiri/soru/rapor değerlendirmesi):
  // bu konuşma eylemlerinde işlem kapısı ancak cevapta GERÇEK bir AL/SAT
  // hükmü varsa açılır. Alan kelimesinin geçmesi yetmez.
  const messageText = String(message || '');
  if ((COMMANDER_PROFILE_SETUP_RE.test(messageText) || isCommanderMetaDiscussion(messageText)) && !detectEquityVerdict(response)) {
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

  // Kapı artık "bu turda get_stock_price çağrıldı mı" sormaz; "elde TAZE
  // piyasa verisi kanıtı var mı" sorar. Kanıt önceki turdan gelmiş olabilir —
  // olaylar oturum boyunca taşındığında bu kapı onu görür. Bayat kanıt taze
  // sayılmaz ve gerekçede yaşıyla birlikte raporlanır.
  const now = Date.now();
  const ledger = buildEvidenceLedger(events, now);
  const hasMarketData = hasAnyFreshEvidence(ledger, MARKET_DATA_EVIDENCE_CLASSES, now);
  const staleMarketData = describeStaleEvidence(ledger, MARKET_DATA_EVIDENCE_CLASSES, now);

  if (!hasMarketData) {
    const dataReason = staleMarketData.length > 0
      ? `İşlem kararı için taze piyasa verisi yok; eldeki kanıt bayat: ${staleMarketData.join(', ')}.`
      : 'İşlem kararı için zorunlu piyasa veri araçları çalışmadı.';
    return {
      status: 'veri_yetersiz',
      reason: dataReason,
      usedTools,
      staleEvidence: staleMarketData,
      // GEÇMİŞ HATA: main.cjs onarım turunu `usedTools.length === 0` şartına
      // bağlıyordu. usedTools TÜM araçları sayar; verify_claim + web_search
      // çalışmış bir turda uzunluk 0 olmaz, dolayısıyla tam da onarılması
      // gereken vakada (piyasa verisi yok ama araştırma yapılmış) onarım hiç
      // tetiklenmez ve 40+ kaynaklık cevap çöpe giderdi. Kapı artık NEYİN
      // eksik olduğunu açıkça söyler; çağıran taraf buna bakar.
      missingEvidence: ['MARKET_DATA'],
      repairable: true,
      response: buildCommanderGateResponse('veri_yetersiz', dataReason, usedTools, response),
    };
  }

  if (!options.contractGoverned && freshMarketScan && hasCommanderActionableResponse(response) && researchEvidenceTools.length === 0) {
    const onlyRecentGainers = marketDataTools.length === 1 && marketDataTools[0] === 'get_bist_gainers';
    const reason = onlyRecentGainers
      ? 'Sadece en cok artanlar listesi kullanildi; bu fresh market scan icin yasak kisa yoldur.'
      : 'Claim/evidence dogrulama araci calismadi; arastirma kanit standardi tamamlanmadi.';

    return {
      status: 'veri_yetersiz',
      reason,
      usedTools,
      missingEvidence: ['RESEARCH_EVIDENCE'],
      repairable: true,
      response: buildFreshMarketScanGateResponse(reason, usedTools, response),
    };
  }

  if (decisionTools.length === 0) {
    return {
      status: 'no_signal',
      reason: 'Piyasa verisi toplandı ama karar/puanlama teyidi oluşmadı.',
      usedTools,
      missingEvidence: ['DECISION_CONFIRMATION'],
      repairable: true,
      response: buildCommanderGateResponse('no_signal', 'Piyasa verisi toplandı ama karar/puanlama teyidi oluşmadı.', usedTools, response),
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

// HÜKÜM REDDİ ≠ HÜKÜM.
// GEÇMİŞ HATA: "AL/SAT demiyorum. Doğru hüküm kelimeleri: KCHOL = İNCELE"
// satırı hüküm sayılıyordu — çünkü "hüküm" bağlam kelimesi ve "AL" büyük
// harfli. Kilit, hükümden KAÇINAN cevabı hüküm sanıp tam bir onarım turu
// başlattı. Reddi cezalandırmak, doğru davranışı cezalandırmaktır.
const VERDICT_NEGATION_RE = /(demiyorum|demem|demek (doğru|dogru) olmaz|vermiyorum|üretmiyorum|uretmiyorum|kullanma|kaç[ıi]n|yerine|değil\b|degil\b|yok\b)/i;

function isVerdictLine(line) {
  if (VERDICT_NEGATION_RE.test(line)) return false;
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

// ============================
// Fiyat Seviyesi Provenance Kilidi
// ============================
// GEÇMİŞ HATA: karar kilidinin `risk_level` kontrolü düz kelime aramasıydı —
// model "stop" yazdığı an tatmin oluyordu. Canlı testte KCHOL için
// "stop ₺182.1" verildi; bu sayıyı HİÇBİR araç üretmemişti. Aynı hatayı
// fiyatlanma kilidi için önlemiştik (hasCompletedEarningsPricingRun cevap
// metnine değil emit imzasına bakar); burada da aynı disiplin uygulanır.
//
// Kural: cevapta bir sembole ait SOMUT giriş/stop seviyesi varsa, o sembol
// için TECHNICAL_SIGNAL veya CURRENT_EQUITY_PRICE kanıtı defterde olmalı.

const PRICE_LEVEL_CONTEXT_RE = /(stop|zarar[- ]kes|giriş|giris|hedef|geçersizlik|gecersizlik|teyit seviyesi)/i;
const PRICE_LEVEL_NUMBER_RE = /(?:₺|TL\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*(?:TL|₺)?/;
const TICKER_IN_HEADING_RE = /(^|[^A-ZÇĞİÖŞÜ0-9])([A-Z]{4,6})(?![A-ZÇĞİÖŞÜ])/g;

const PRICE_LEVEL_EVIDENCE_CLASSES = Object.freeze(['TECHNICAL_SIGNAL', 'CURRENT_EQUITY_PRICE']);

// Başlıkta hisse kodu gibi görünen ama olmayan sözcükler.
// CANLI TESTTE YAKALANDI: "FRESH MARKET SCAN" başlığındaki MARKET altı harfli
// büyük yazıldığı için sembol sanıldı ve kapı "Kanıtsız seviye: MARKET" dedi.
// Aynı sınıf hata TICKER_STOPWORDS'te de vardı (BIST). Büyük harfli desen tek
// başına sembol kanıtı değildir.
const PRICE_LEVEL_SYMBOL_STOPWORDS = new Set([
  'MARKET', 'SCAN', 'FRESH', 'RISK', 'STOP', 'GIRIS', 'HEDEF', 'SEVIYE', 'PLAN',
  'BIST', 'BORSA', 'VIOP', 'ENDEKS', 'TOPLAM', 'ORTALAMA', 'NOTLAR', 'OZET',
  'KARAR', 'HUKUM', 'SONUC', 'ANALIZ', 'RAPOR', 'VERI', 'KAYNAK', 'UYARI',
]);

/**
 * Cevaptan "sembol → somut seviye verildi" eşleşmelerini çıkarır.
 * Sembol, seviyenin geçtiği satırdan geriye doğru en yakın başlıktan alınır.
 */
// Sistem tarafından eklenen bloklar taranmaz: sözleşme kapsamı, kilit
// açıklamaları ve kanıt sınıfı adları (MARKET_MOVERS gibi) model iddiası
// değildir. Kendi footer'ını okuyup kendini uyaran bir kapı gürültü üretir.
const SYSTEM_BLOCK_START_RE = /^(⚖️|📋|---\s*$)|ARAŞTIRMA SÖZLEŞMESİ KAPSAMI|KİLİDİ \(deterministik\)/;

// Somut seviye = gerçek fiyat kalıbı. "giriş kalitesi" bir seviye DEĞİLDİR;
// "₺198,50" veya "182.1 altı" seviyedir.
const CONCRETE_PRICE_RE = /(?:₺\s?\d{1,3}(?:[.,]\d{1,3})*|\b\d{1,4}[.,]\d{1,2}\b\s*(?:TL|₺)?|\b\d{2,4}\s*(?:TL|₺))/;

function stripSystemBlocks(response = '') {
  const out = [];
  let skipping = false;
  for (const line of String(response || '').split('\n')) {
    if (SYSTEM_BLOCK_START_RE.test(line.trim())) { skipping = true; continue; }
    if (skipping && /^#{1,6}\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

function extractQuotedPriceLevels(response = '') {
  const lines = stripSystemBlocks(response).split('\n');
  const found = new Map();
  let currentSymbol = null;

  for (const line of lines) {
    TICKER_IN_HEADING_RE.lastIndex = 0;
    const headingMatch = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line) || /^\s*\*\*(.+?)\*\*\s*$/.exec(line);
    if (headingMatch) {
      TICKER_IN_HEADING_RE.lastIndex = 0;
      const m = TICKER_IN_HEADING_RE.exec(headingMatch[1]);
      currentSymbol = m && !PRICE_LEVEL_SYMBOL_STOPWORDS.has(m[2]) ? m[2] : null;
    }
    if (!currentSymbol) continue;
    if (PRICE_LEVEL_CONTEXT_RE.test(line) && CONCRETE_PRICE_RE.test(line)) {
      const list = found.get(currentSymbol) || [];
      list.push(line.trim());
      found.set(currentSymbol, list);
    }
  }
  return found;
}

/**
 * Cevaptaki seviye satırından SAYILARI çıkarır.
 * Yüzdeler önce silinir: "%8 aşağıda" bir seviye değil, bir mesafedir.
 */
const CONCRETE_PRICE_SCAN_RE = new RegExp(CONCRETE_PRICE_RE.source, 'g');

function parseLevelNumbers(line = '') {
  const text = String(line || '').replace(/%\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%/g, ' ');
  const out = [];
  for (const match of text.matchAll(CONCRETE_PRICE_SCAN_RE)) {
    const raw = match[0]
      .replace(/₺|TL/gi, '')
      .trim()
      .replace(/\.(?=\d{3}\b)/g, '') // binlik ayıracı
      .replace(',', '.');
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Bir sembol için araçların GERÇEKTEN ürettiği sayısal ölçümler. */
function collectMeasuredValues(events = [], symbol = '') {
  const want = normalizeEntity(symbol);
  const values = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.type !== 'tool_call') continue;
    const list = event.measurements?.[want];
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) values.push(n);
    }
  }
  return values;
}

// ÇAPA BANDI. Bir seviyenin ölçümden türediğini KANITLAMAZ — tam ispat için
// modelin formülü bildirmesi gerekirdi. Yaptığı şey daha mütevazı ve yine de
// canlı hatayı yakalar: rakam, ölçülen bir değerle aynı büyüklük mertebesinde
// olmalı. 553 TL'lik bir hissede "stop 1 TL" hiçbir ölçümden türeyemez.
// Band bilerek geniş: %40 aşağıda bir stop da, %80 yukarıda bir hedef de
// meşrudur; dar band meşru cevabı bloklar ve kapıyı gürültüye çevirir.
const LEVEL_ANCHOR_MIN_RATIO = 0.5;
const LEVEL_ANCHOR_MAX_RATIO = 2;

function isAnchored(value, measured) {
  return measured.some((m) => value >= m * LEVEL_ANCHOR_MIN_RATIO && value <= m * LEVEL_ANCHOR_MAX_RATIO);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.researchStatus] Sözleşme kapanış durumu (COMPLETE/PARTIAL/BLOCKED...).
 *   Verilirse ve COMPLETE değilse hiçbir somut seviye geçemez.
 */
function evaluatePriceLevelProvenanceGate(message, response, events = [], now = Date.now(), opts = {}) {
  if (isCommanderProductMarketplaceMessage(message)) return null;
  const quoted = extractQuotedPriceLevels(response);
  if (quoted.size === 0) return null;

  // KURAL A — sözleşme kapanmadan seviye yok.
  // Hüküm kelimesi (AL/SAT) zaten iniyordu ama RAKAM kaçabiliyordu. Kullanıcı
  // açısından "AL demedim ama stop 553 yaz" ile "AL" arasında pratik fark yok:
  // ikisi de uygulanabilir bir işlem talimatıdır.
  // Yazılı kuraldan daha GENİŞ uygulanıyor: kural "istek giriş/stop içeriyorsa"
  // diyordu, buradaki koşul "cevap somut seviye içeriyorsa". Sebep: zarar
  // isteğin şeklinden değil, cevaptaki rakamdan doğar.
  const researchStatus = opts.researchStatus ? String(opts.researchStatus).toUpperCase() : null;
  const contractIncomplete = researchStatus !== null && researchStatus !== 'COMPLETE';

  const ledger = buildEvidenceLedger(events, now);
  const noEvidence = [];
  const notDerived = [];

  for (const [symbol, lines] of quoted) {
    const supported = PRICE_LEVEL_EVIDENCE_CLASSES.some(
      (klass) => hasFreshEvidenceForEntity(ledger, klass, symbol, now),
    );
    if (!supported) { noEvidence.push(symbol); continue; }

    // KURAL B — ölçüm VAR ama rakam ondan türemiş mi?
    const measured = collectMeasuredValues(events, symbol);
    // Ölçüm değeri kaydedilmemişse eski davranış korunur: sınıf kanıtı yeter.
    // Yeni kapıyı, değer taşımayan eski olaylar üzerinden ateşlemek yanlış
    // pozitif üretirdi.
    if (measured.length === 0) continue;
    const numbers = lines.flatMap(parseLevelNumbers);
    if (numbers.length === 0) continue;
    if (numbers.some((n) => !isAnchored(n, measured))) notDerived.push(symbol);
  }

  const blocked = contractIncomplete
    ? [...quoted.keys()]
    : [...new Set([...noEvidence, ...notDerived])];
  if (blocked.length === 0) return null;

  const explanation = [];
  if (contractIncomplete) {
    explanation.push(
      `Araştırma sözleşmesi ${researchStatus} durumunda kapandı; somut giriş/stop/hedef rakamı verilemez.`,
      'Eksik kanıtla üretilen seviye, hüküm kelimesi kullanılmasa bile uygulanabilir',
      'bir işlem talimatıdır. Sözleşme COMPLETE olmadan rakam yerine niteliksel',
      'ifade kullan ("teyit beklenir", "seviye için ölçüm gerekli").',
    );
  } else {
    if (noEvidence.length) {
      explanation.push(
        `Şu semboller için somut seviye verildi ama o sembole ait ölçüm kanıtı yok: ${noEvidence.join(', ')}.`,
      );
    }
    if (notDerived.length) {
      explanation.push(
        `Şu semboller için verilen rakam, o sembolde ölçülen hiçbir değerle bağdaşmıyor: ${notDerived.join(', ')}.`,
        'Ölçümün VARLIĞI yetmez; rakamın o ölçümden TÜREMESİ gerekir.',
      );
    }
    explanation.push(
      'Seviye rakamı üretmek ölçüm yapmak değildir. Giriş/stop için ilgili sembolde',
      'analyze_finance_signal veya get_stock_price çalışmalı ve seviye o çıktıdan türetilmelidir.',
      'Ölçüm yoksa seviye verme; "teyit beklenir" gibi niteliksel ifade kullan.',
    );
  }

  const lockedResponse = [
    neutralizeEquityVerdicts(response),
    '',
    '---',
    '⚖️ SEVİYE PROVENANCE KİLİDİ (deterministik):',
    ...explanation,
  ].join('\n');

  const reason = contractIncomplete
    ? `Sözleşme ${researchStatus}: seviye üretilemez (${blocked.join(', ')})`
    : [
      noEvidence.length ? `Kanıtsız seviye: ${noEvidence.join(', ')}` : null,
      notDerived.length ? `Türetilemeyen seviye: ${notDerived.join(', ')}` : null,
    ].filter(Boolean).join(' | ');

  return {
    status: 'price_level_locked',
    reason,
    unsupportedSymbols: blocked,
    noEvidenceSymbols: noEvidence,
    notDerivedSymbols: notDerived,
    contractIncomplete,
    response: lockedResponse,
  };
}

module.exports = {
  COMMANDER_DECISION_TOOLS,
  EARNINGS_PRICING_TOOL,
  COMMANDER_MARKET_DATA_TOOLS,
  TOOL_EVIDENCE_CLASSES,
  EVIDENCE_TTL_MS,
  MARKET_DATA_EVIDENCE_CLASSES,
  buildEvidenceLedger,
  hasFreshEvidence,
  hasFreshEvidenceForEntity,
  entitiesWithEvidence,
  hasAnyFreshEvidence,
  describeStaleEvidence,
  collectMeasuredValues,
  parseLevelNumbers,
  evaluatePriceLevelProvenanceGate,
  extractQuotedPriceLevels,
  RISK_GATE_THRESHOLDS,
  buildCommanderGateResponse,
  classifyAssetClass,
  collectMissingVerdictEvidence,
  detectEquityVerdict,
  detectBuySideTimingVerdict,
  evaluateCommanderDecisionGate,
  evaluateEarningsPricingGate,
  evaluateUngovernedRankingGate,
  evaluateUnroutedCapabilityGate,
  evaluateDebtQualityGate,
  responseClaimsDebtQuality,
  evaluateRiskGate,
  responseClaimsCapabilityWork,
  buildUnroutedCapabilityResponse,
  SURGICAL_ROUTING_TOOLS,
  responseContainsEquityRanking,
  buildUngovernedRankingResponse,
  COMMANDER_RANKING_REQUEST_RE,
  // Bağlamdan devralınan kapsamla birleştirilebilmesi için ham desen de açık:
  // "peki bugün alınır mı?" mesajında finans SÖZCÜĞÜ yok ama işlem NİYETİ var.
  COMMANDER_ACTIONABLE_FINANCE_RE,
  GOVERNED_RANKING_TOOLS,
  evaluateVerdictEvidenceLock,
  hasCompletedEarningsPricingRun,
  neutralizeEquityVerdicts,
  extractCommanderToolNames,
  extractEvidenceProducingToolNames,
  resolveEvidenceClasses,
  // İşlem kaydı da "OK" derken aynı başarısızlık tanımını kullansın:
  // iki yerde iki farklı liste tutmak, birinin bayatlaması demektir.
  FAILED_RESULT_STATUSES,
  getRiskGateThresholds,
  hasCommanderActionableResponse,
  isCommanderActionableFinanceRequest,
  isCommanderFreshMarketScanRequest,
  isCommanderFinanceMessage,
  containsBistTicker,
  extractBistTickers,
  collectRankingAnchorTickers,
  isCommanderMetaDiscussion,
  COMMANDER_META_DISCUSSION_RE,
  isCommanderInformationalFinanceRequest,
  isCommanderProductMarketplaceMessage,
};
