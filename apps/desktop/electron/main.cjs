const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const cron = require('node-cron');
const { initOpenAI, chat, multiSourceSearch, resetConversation, trackCapabilityGap, mergeRuntimeCapabilityOverrides } = require('./ai-service.cjs');
const { evaluateCommanderDecisionGate, evaluateEarningsPricingGate, evaluateUngovernedRankingGate, evaluateUnroutedCapabilityGate, evaluateVerdictEvidenceLock } = require('./decision-guards.cjs');
const { runDeterministicAgent } = require('./deterministic-agents.cjs');
const { TelegramReader } = require('./telegram-reader.cjs');
const { ensureDefaultUserProfile, consolidateUserLearning } = require('./user-learning.cjs');
const { storeSecret, hasSecret, listSecretRefs, listSecretRequests, fulfillSecretRequest } = require('./secret-broker.cjs');
const { resolveAnalysisArtifact } = require('./analysis-artifacts.cjs');
const surgeryReview = require('./surgery/review-service.cjs');
const { createSessionManager } = require('./surgery/session-manager.cjs');

// Load environment variables. Sıra: proje kökü .env (dev) → resources/.env
// (paketli sürümde bundle edildiyse) → userData/.env (kurulu sürüm için
// kullanıcının elle kopyaladığı dosya). dotenv var olan değişkeni ezmez;
// ilk bulunan değer geçerlidir.
const envCandidates = [
  path.join(__dirname, '../../../.env'),
  process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
  path.join(app.getPath('userData'), '.env'),
].filter(Boolean);
let loadedEnvPath = null;
for (const candidate of envCandidates) {
  try {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      if (!loadedEnvPath) loadedEnvPath = candidate;
    }
  } catch { /* ignore */ }
}
if (loadedEnvPath) {
  console.log('[ENV] Yüklendi:', loadedEnvPath);
} else {
  console.warn('[ENV] Hiçbir .env dosyası bulunamadı. Denenen yollar:', envCandidates.join(' | '));
}

const isDev = !app.isPackaged;

// Stability guard for some Windows GPU/network stack crashes.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Local config file for runtime settings (Telegram tokens, etc.)
const configPath = path.join(app.getPath('userData'), 'cakal-config.json');

function loadLocalConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveLocalConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ==============================
// Telegram Notification Service
// ==============================

class TelegramService {
  constructor() {
    this.botToken = null;
    this.chatId = null;
  }

  configure(botToken, chatId) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  isConfigured() {
    return !!(this.botToken && this.chatId);
  }

  async send(title, body, type = 'opportunity') {
    if (!this.isConfigured()) {
      console.warn('[Telegram] Not configured, skipping');
      return false;
    }

    const icons = {
      opportunity: '🎯',
      'weekly-summary': '📊',
      'watchlist-alert': '🔔',
      'profile-update': '👤',
    };
    const icon = icons[type] || '📌';
    const text = `${icon} <b>${title}</b>\n\n${body}`;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Telegram] Send failed:', response.status, errText);
        return false;
      }

      console.log('[Telegram] Message sent successfully');
      return true;
    } catch (error) {
      console.error('[Telegram] Send error:', error.message);
      return false;
    }
  }
}

const telegram = new TelegramService();

// ==============================
// Telegram Channel Reader (MTProto/GramJS)
// ==============================

const telegramReader = new TelegramReader(configPath);

// Startup: load saved API credentials
(() => {
  const cfg = loadLocalConfig();
  if (cfg.TELEGRAM_API_ID && cfg.TELEGRAM_API_HASH) {
    telegramReader.configure(cfg.TELEGRAM_API_ID, cfg.TELEGRAM_API_HASH);
    console.log('[TelegramReader] Configured from saved config');
  }
})();

// ==============================
// Notification Filter — Bildirim Eşik Kontrolü
// ==============================

/**
 * Bir fırsatın bildirim alıp almayacağını kontrol eder.
 * Kurallar:
 * - Güven skoru >= 0.70 (100 üzerinden >= 70)
 * - Tahmini marj >= kullanıcının minimum eşiği (varsayılan 5%)
 * - Aynı fırsattan 24 saat içinde sadece 1 bildirim (DB kontrolü)
 */
async function shouldNotify(opportunity, supabase, userId) {
  // Skor kontrolü
  const score = opportunity.score || 0;
  if (score < 70) {
    console.log(`[Notify] Score too low (${score}), skipping`);
    return false;
  }

  // Marj kontrolü
  const margin = opportunity.expected_profit_percent || 0;
  if (margin < 5) {
    console.log(`[Notify] Margin too low (${margin}%), skipping`);
    return false;
  }

  // 24 saat dedup kontrolü (DB varsa)
  if (supabase && opportunity.id) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('notification_log')
      .select('id')
      .eq('opportunity_id', opportunity.id)
      .eq('user_id', userId)
      .gte('sent_at', since)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`[Notify] Already notified for this opportunity in 24h, skipping`);
      return false;
    }
  }

  return true;
}

/**
 * Fırsat bildirimini gönderir ve log kaydı oluşturur.
 */
async function sendOpportunityNotification(opportunity, supabase, userId) {
  if (!telegram.isConfigured()) return false;

  const pass = await shouldNotify(opportunity, supabase, userId);
  if (!pass) return false;

  const title = opportunity.title || 'Yeni Fırsat';
  const parts = [];
  if (opportunity.source) parts.push(`📍 ${opportunity.source}`);
  if (opportunity.price) parts.push(`💰 ${opportunity.price} TL`);
  if (opportunity.expected_profit_percent) parts.push(`📈 %${opportunity.expected_profit_percent} beklenen marj`);
  if (opportunity.score) parts.push(`⭐ Skor: ${opportunity.score}/100`);
  if (opportunity.source_url) parts.push(`\n🔗 ${opportunity.source_url}`);
  const body = parts.join('\n') || opportunity.description || '';

  const delivered = await telegram.send(title, body, 'opportunity');

  // Bildirim log kaydı
  if (supabase) {
    await supabase.from('notification_log').insert({
      user_id: userId,
      channel: 'telegram',
      notification_type: 'opportunity',
      title,
      body,
      opportunity_id: opportunity.id || null,
      delivered,
    }).then(null, (err) => console.error('[Notify] Log insert error:', err.message));
  }

  return delivered;
}

const CHINA_RESEARCH_METHOD = [
  'AliExpress: düşük MOQ ve dropshipping uyumluluğu için ürün + tedarikçi puanı kontrol edilir.',
  'Alibaba: tedarikçi doğrulama (verified/trade assurance), MOQ, üretim kapasitesi ve fiyat bandı karşılaştırılır.',
  '1688: Çin iç pazar birim maliyet benchmarkı alınır; CNY fiyatlar TRY bazına çevrilerek marj kontrolü yapılır.',
  'Citations ve listing URLleri ile manuel teyit adımı zorunludur (örnek sipariş, teslim süresi, iade koşulu).',
];

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTitleTokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function titleSimilarityScore(a, b) {
  const tokA = new Set(normalizeTitleTokens(a));
  const tokB = new Set(normalizeTitleTokens(b));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokA) {
    if (tokB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokA.size, tokB.size);
}

function sourceReliabilityScore(source) {
  const key = String(source || '').toLowerCase();
  const scores = {
    alibaba: 78,
    aliexpress: 68,
    '1688': 72,
    trendyol: 82,
    sahibinden: 74,
    perplexity: 66,
  };
  return scores[key] || 62;
}

function sourceLogisticsRiskScore(source) {
  const key = String(source || '').toLowerCase();
  const scores = {
    alibaba: 58,
    aliexpress: 52,
    '1688': 67,
    trendyol: 18,
    sahibinden: 26,
    perplexity: 35,
  };
  return scores[key] || 40;
}

function medianOf(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildCommerceCandidatesFromLiveData(targetListings, chinaListings, options = {}) {
  const fxRate = toFiniteNumber(options.fxRate, 38);
  const maxCandidates = Math.max(1, Math.min(10, toFiniteNumber(options.maxCandidates, 6)));

  const targets = (Array.isArray(targetListings) ? targetListings : [])
    .filter((item) => toFiniteNumber(item.price, 0) > 0)
    .sort((a, b) => toFiniteNumber(b.price, 0) - toFiniteNumber(a.price, 0));

  const sources = (Array.isArray(chinaListings) ? chinaListings : [])
    .filter((item) => toFiniteNumber(item.price, 0) > 0)
    .sort((a, b) => toFiniteNumber(a.price, 0) - toFiniteNumber(b.price, 0));

  const candidates = [];

  for (const target of targets) {
    if (candidates.length >= maxCandidates) break;
    const targetPrice = toFiniteNumber(target.price, 0);
    if (targetPrice <= 0) continue;

    let bestMatch = null;
    let bestScore = -Infinity;

    for (const source of sources) {
      const sourcePrice = toFiniteNumber(source.price, 0);
      if (sourcePrice <= 0 || sourcePrice >= targetPrice * 0.97) continue;

      const similarity = titleSimilarityScore(target.title, source.title);
      const spreadRatio = (targetPrice - sourcePrice) / Math.max(1, targetPrice);
      const score = similarity * 100 + spreadRatio * 35;
      if (score > bestScore && (similarity >= 0.22 || spreadRatio >= 0.3)) {
        bestScore = score;
        bestMatch = { source, similarity, spreadRatio };
      }
    }

    if (!bestMatch) continue;

    const peerCount = targets.filter((peer) => titleSimilarityScore(peer.title, target.title) > 0.42).length;
    const competitionScore = clampNumber(28 + peerCount * 9, 20, 92);
    const rating = toFiniteNumber(target.rating, 0);
    const reviewCount = toFiniteNumber(target.reviewCount, 0);
    const trendScore = clampNumber(
      50 + Math.round(rating * 6) + Math.min(24, Math.round(Math.log10(reviewCount + 1) * 11)),
      40,
      95,
    );

    const quantity = targetPrice > 1000 ? 15 : targetPrice > 400 ? 25 : 40;
    const adCostTRY = Math.round(Math.max(900, targetPrice * quantity * 0.08));
    const packagingTRY = Math.round(quantity * 14);
    const targetSellPriceTRY = Math.round(targetPrice * 0.97);

    candidates.push({
      productName: target.title || bestMatch.source.title || 'Ürün',
      sourcePlatform: bestMatch.source.source || 'aliexpress',
      targetPlatform: target.source || 'trendyol',
      sourcePrice: Math.round(toFiniteNumber(bestMatch.source.price, 0)),
      sourceCurrency: 'TRY',
      fxRate,
      quantity,
      targetSellPriceTRY,
      adCostTRY,
      packagingTRY,
      demandTrendScore: trendScore,
      competitionScore,
      sourceReliability: sourceReliabilityScore(bestMatch.source.source),
      logisticsRiskScore: sourceLogisticsRiskScore(bestMatch.source.source),
      returnRate: 6,
      evidence: {
        targetUrl: target.url || null,
        sourceUrl: bestMatch.source.url || null,
        titleSimilarity: Number(bestMatch.similarity.toFixed(3)),
        spreadRatio: Number((bestMatch.spreadRatio * 100).toFixed(2)),
      },
    });
  }

  // Fallback — benzerlikle eşleşme yoksa en ucuz tedarik + medyan hedef fiyat ile bir aday üret.
  if (candidates.length === 0 && targets.length > 0 && sources.length > 0) {
    const source = sources[0];
    const target = targets[Math.floor(targets.length / 2)];
    const targetPrice = toFiniteNumber(target.price, 0);
    const quantity = targetPrice > 1000 ? 12 : 20;
    candidates.push({
      productName: target.title || source.title || 'Ürün',
      sourcePlatform: source.source || 'aliexpress',
      targetPlatform: target.source || 'trendyol',
      sourcePrice: Math.round(toFiniteNumber(source.price, 0)),
      sourceCurrency: 'TRY',
      fxRate,
      quantity,
      targetSellPriceTRY: Math.round(targetPrice * 0.95),
      adCostTRY: Math.round(Math.max(800, targetPrice * quantity * 0.07)),
      packagingTRY: Math.round(quantity * 12),
      demandTrendScore: 62,
      competitionScore: 58,
      sourceReliability: sourceReliabilityScore(source.source),
      logisticsRiskScore: sourceLogisticsRiskScore(source.source),
      returnRate: 6,
      evidence: {
        targetUrl: target.url || null,
        sourceUrl: source.url || null,
        titleSimilarity: Number(titleSimilarityScore(target.title, source.title).toFixed(3)),
        spreadRatio: Number((((targetPrice - toFiniteNumber(source.price, 0)) / Math.max(1, targetPrice)) * 100).toFixed(2)),
      },
    });
  }

  const sourcePrices = candidates.map((item) => toFiniteNumber(item.sourcePrice, 0)).filter((price) => price > 0);
  const targetPrices = candidates.map((item) => toFiniteNumber(item.targetSellPriceTRY, 0)).filter((price) => price > 0);

  return {
    candidates,
    diagnostics: {
      targetListings: targets.length,
      chinaListings: sources.length,
      candidateCount: candidates.length,
      medianSourcePriceTRY: Math.round(medianOf(sourcePrices)),
      medianTargetPriceTRY: Math.round(medianOf(targetPrices)),
    },
  };
}

// Supabase client (CJS compatible)
let supabaseClient = null;
let supabaseServiceClient = null;

async function initSupabase() {
  // env yoksa userData/cakal-config.json içindeki anahtarlara düş — kurulu
  // (paketli) sürümde .env bulunmayabilir.
  const localConf = loadLocalConfig();
  const url = process.env.SUPABASE_URL || localConf.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || localConf.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localConf.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(
      `[DB] SUPABASE_URL veya SUPABASE_ANON_KEY yok. Yüklenen env: ${loadedEnvPath || 'YOK'}. ` +
      `Kurulu sürümde .env dosyasını şuraya kopyalayabilirsin: ${app.getPath('userData')}`
    );
    return null;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    // Tüm Supabase REST çağrılarına üst sınır: askıda kalan bir istek (ağ
    // kopması, DNS bekleme vb.) await eden IPC handler'ı sonsuza dek
    // bloklayıp UI'yi "Araştırıyorum..."da kilitlemesin.
    const boundedFetch = (input, init = {}) => fetch(input, {
      ...init,
      signal: init.signal || AbortSignal.timeout(20000),
    });
    // Electron 31 = Node 20: global WebSocket yok. realtime-js'in
    // "Ensure you are running Node.js 22+..." uyarısını ws paketi ile
    // transport sağlayarak gideriyoruz.
    let realtimeOptions;
    try {
      realtimeOptions = { transport: require('ws') };
    } catch (_) { /* ws yoksa realtime sadece uyarı verir, REST etkilenmez */ }
    // RLS aktif: public tablolara anon erişimi kapalı. Main process güvenilir
    // katman olduğundan ana istemci service role ile çalışır (renderer'a asla geçmez).
    supabaseClient = createClient(url, serviceKey || key, {
      auth: { persistSession: false },
      global: { fetch: boundedFetch },
      ...(realtimeOptions ? { realtime: realtimeOptions } : {}),
    });
    if (serviceKey) {
      supabaseServiceClient = createClient(url, serviceKey, {
        auth: { persistSession: false },
        global: { fetch: boundedFetch },
        ...(realtimeOptions ? { realtime: realtimeOptions } : {}),
      });
    } else {
      console.warn('[DB] SUPABASE_SERVICE_ROLE_KEY not set — RLS altında DB erişimi kısıtlı olabilir');
    }
    console.log('[DB] Supabase initialized');
    return supabaseClient;
  } catch (err) {
    console.error('[DB] Supabase init error:', err.message);
    return null;
  }
}

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

// Main window reference for reliable IPC
let mainWindow = null;

// Initialize OpenAI
if (process.env.OPENAI_API_KEY) {
  initOpenAI(process.env.OPENAI_API_KEY);
  console.log('[AI] OpenAI initialized');
} else {
  console.warn('[AI] OPENAI_API_KEY not set!');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Çakal Çekirdeği',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.CAKAL_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] did-fail-load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron] Renderer process gone:', details?.reason || 'unknown');
    // Intentionally no auto-reopen. If user closes the app, it must stay closed.
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

app.whenReady().then(async () => {
  await initSupabase();

  // Telegram'ı yapılandır (local config veya env'den)
  const localConf = loadLocalConfig();
  const telegramToken = localConf.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = localConf.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (telegramToken && telegramChatId) {
    telegram.configure(telegramToken, telegramChatId);
    console.log('[Telegram] Configured');
  } else {
    console.warn('[Telegram] Not configured — token or chatId missing');
  }

  createWindow();

  // ==============================
  // Startup: Duplikat pattern temizliği
  // ==============================
  if (supabaseClient) {
    (async () => {
      try {
        const { data: allPatterns } = await supabaseClient
          .from('strategy_patterns')
          .select('id, name, confidence, created_at')
          .order('confidence', { ascending: false });
        if (allPatterns && allPatterns.length > 0) {
          const seen = new Map();
          const dupeIds = [];
          for (const p of allPatterns) {
            if (seen.has(p.name)) {
              dupeIds.push(p.id); // düşük confidence'lı duplikatları sil
            } else {
              seen.set(p.name, p.id);
            }
          }
          if (dupeIds.length > 0) {
            await supabaseClient.from('strategy_patterns').delete().in('id', dupeIds);
            console.log(`[Startup] Cleaned ${dupeIds.length} duplicate patterns`);
          }
        }
      } catch (e) {
        console.warn('[Startup] Pattern cleanup error:', e.message);
      }
    })();
  }

  // ==============================
  // Cron Scheduler — Günlük/Haftalık Görevler
  // ==============================

  // Her gün 23:00 — Pattern Extraction + Strategy Weight Update
  cron.schedule('0 23 * * *', async () => {
    console.log('[Cron] Daily pattern extraction starting...');
    try {
      if (!supabaseClient) return;

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [feedbacksRes, patternsRes] = await Promise.all([
        supabaseClient.from('recommendation_feedback')
          .select('*, recommendations(*, opportunities(*))')
          .eq('user_id', DEFAULT_USER_ID)
          .gte('created_at', weekAgo),
        supabaseClient.from('strategy_patterns').select('*, strategy_weights(*)'),
      ]);

      const feedbacks = (feedbacksRes.data || []).map(fb => ({
        ...fb,
        category: fb.recommendations?.opportunities?.category || 'diger',
        source: fb.recommendations?.opportunities?.source || 'unknown',
      }));
      const existingPatterns = patternsRes.data || [];

      // New pattern detection
      const categoryGroups = {};
      for (const fb of feedbacks) {
        const cat = fb.category || 'diger';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(fb);
      }

      const existingNames = new Set(existingPatterns.map(p => p.name.toLowerCase()));
      let createdCount = 0;
      let updatedCount = 0;

      for (const [category, fbs] of Object.entries(categoryGroups)) {
        if (fbs.length < 2) continue;
        const profitFbs = fbs.filter(f => f.outcome === 'profit');
        const lossFbs = fbs.filter(f => f.outcome === 'loss');
        if (profitFbs.length < 2 && lossFbs.length < 2) continue;

        const isPositive = profitFbs.length >= lossFbs.length;
        const patternName = isPositive ? `${category}_basarili_trend` : `${category}_riskli_alan`;
        if (existingNames.has(patternName.toLowerCase())) continue;

        const totalProfit = profitFbs.reduce((s, f) => s + (f.actual_profit || 0), 0);
        const avgProfit = profitFbs.length > 0 ? totalProfit / profitFbs.length : 0;

        const { data: newP } = await supabaseClient.from('strategy_patterns').insert({
          name: patternName,
          description: `${category} kategorisinde ${isPositive ? 'başarılı' : 'riskli'} trend`,
          success_count: profitFbs.length,
          fail_count: lossFbs.length,
          avg_profit: Math.round(avgProfit * 100) / 100,
          confidence: Math.min(0.8, 0.2 + (Math.max(profitFbs.length, lossFbs.length) / fbs.length) * 0.6),
          status: profitFbs.length + lossFbs.length >= 3 && profitFbs.length > lossFbs.length ? 'active' : 'on-hold',
          tags: [category.toLowerCase()],
        }).select().single();

        if (newP) {
          await supabaseClient.from('strategy_weights').insert({
            pattern_id: newP.id, weight: newP.status === 'active' ? 0.3 : 0, reason: 'Cron otomatik keşif',
          }).then(null, () => {});
          createdCount++;
        }
      }

      // Weight updates for existing patterns
      for (const pattern of existingPatterns) {
        const patternTags = pattern.tags || [];
        const matchingFbs = feedbacks.filter(fb => {
          const fbCat = (fb.category || '').toLowerCase();
          return patternTags.some(t => fbCat.includes(t)) || pattern.name.toLowerCase().includes(fbCat);
        });
        if (matchingFbs.length === 0) continue;

        const profitCount = matchingFbs.filter(f => f.outcome === 'profit').length;
        const lossCount = matchingFbs.filter(f => f.outcome === 'loss').length;
        const successRate = profitCount / matchingFbs.length;

        let weightDelta = 0;
        let reason = '';
        if (successRate >= 0.7) { weightDelta = 0.15; reason = `Günlük: yüksek başarı %${Math.round(successRate * 100)}`; }
        else if (successRate >= 0.5) { weightDelta = 0.05; reason = `Günlük: orta başarı`; }
        else if (successRate < 0.3) { weightDelta = -0.15; reason = `Günlük: düşük başarı`; }
        else { weightDelta = -0.05; reason = `Günlük: ortalamanın altı`; }

        const newSucc = (pattern.success_count || 0) + profitCount;
        const newFail = (pattern.fail_count || 0) + lossCount;
        const total = newSucc + newFail;
        let newStatus = pattern.status;
        if (total < 3) newStatus = 'on-hold';
        else if (newSucc > newFail * 1.5) newStatus = 'active';
        else if (newFail > newSucc * 2) newStatus = 'weakened';

        await supabaseClient.from('strategy_patterns').update({
          success_count: newSucc, fail_count: newFail, status: newStatus,
          confidence: Math.min(1, Math.max(0, (pattern.confidence || 0) + weightDelta * 0.5)),
        }).eq('id', pattern.id);

        const curWeight = pattern.strategy_weights?.[0]?.weight || 0;
        await supabaseClient.from('strategy_weights').insert({
          pattern_id: pattern.id,
          weight: Math.round(Math.min(1, Math.max(-1, curWeight + weightDelta)) * 100) / 100,
          reason,
        }).then(null, () => {});

        updatedCount++;
      }

      console.log(`[Cron] Daily extraction done: ${createdCount} new, ${updatedCount} updated`);

      if (telegram.isConfigured() && (createdCount > 0 || updatedCount > 0)) {
        telegram.send('Günlük Pattern Analizi', `🧩 ${createdCount} yeni pattern keşfedildi\n🔄 ${updatedCount} pattern güncellendi`, 'profile-update').catch(() => {});
      }

      await consolidateUserLearning(supabaseClient, { source: 'cron:daily-pattern-extraction' }).catch((err) => {
        console.warn('[Cron] Learning consolidation failed:', err.message);
      });
    } catch (err) {
      console.error('[Cron] Daily extraction error:', err.message);
    }
  });

  // Her Pazar 10:00 — Haftalık Karakter Raporu
  cron.schedule('0 10 * * 0', async () => {
    console.log('[Cron] Weekly character report starting...');
    try {
      if (!supabaseClient) return;

      // UI'a bildir — rapor hazırlanıyor
      const win = mainWindow || BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('notification', {
          type: 'weekly-summary',
          title: 'Haftalık Rapor Hazırlanıyor',
          body: 'Karakter analiziniz üretiliyor...',
        });
      }

      // Rapor üretimini doğrudan tetikle (profile:weekly-report handler mantığı)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [profileRes, feedbacksRes, oppsRes, indexRes, patternsRes] = await Promise.all([
        supabaseClient.from('user_profile').select('*').eq('id', DEFAULT_USER_ID).single(),
        supabaseClient.from('recommendation_feedback').select('*, recommendations(*, opportunities(*))').eq('user_id', DEFAULT_USER_ID).gte('created_at', weekAgo),
        supabaseClient.from('opportunities').select('*').gte('created_at', weekAgo).order('score', { ascending: false }).limit(50),
        supabaseClient.from('user_index_entries').select('*').eq('user_id', DEFAULT_USER_ID).gte('created_at', weekAgo),
        supabaseClient.from('strategy_patterns').select('*').eq('status', 'active').order('confidence', { ascending: false }).limit(10),
      ]);

      const profile = profileRes.data;
      const feedbacks = feedbacksRes.data || [];
      const opportunities = oppsRes.data || [];
      const indexEntries = indexRes.data || [];
      const patterns = patternsRes.data || [];

      const profitFb = feedbacks.filter(f => f.outcome === 'profit');
      const lossFb = feedbacks.filter(f => f.outcome === 'loss');
      const totalProfit = profitFb.reduce((s, f) => s + (f.actual_profit || 0), 0);
      const totalLoss = lossFb.reduce((s, f) => s + Math.abs(f.actual_profit || 0), 0);

      const categoryDist = {};
      for (const opp of opportunities) {
        categoryDist[opp.category] = (categoryDist[opp.category] || 0) + 1;
      }
      const interestKeys = indexEntries
        .filter(e => ['interest', 'preference'].includes(e.entry_type))
        .map(e => e.entry_key);

      const OpenAI = require('openai');
      const analysisClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const analysisPrompt = `Sen Çakal Çekirdeği'nin Profile Keeper ajanısın. Haftalık verileri analiz et.

KULLANICI: risk=${profile?.risk_tolerance || 'medium'}, kâr=₺${profile?.total_profit || 0}
BU HAFTA: ${opportunities.length} fırsat, ${feedbacks.length} geri bildirim (kâr:${profitFb.length} zarar:${lossFb.length}), net ₺${totalProfit - totalLoss}
Kategoriler: ${JSON.stringify(categoryDist)}
Patternler: ${patterns.map(p => p.name).join(', ') || 'yok'}

JSON döndür: {"characterSummary":"..","strengths":[],"improvements":[],"weeklyScore":0-100,"recommendedActions":[]}`;

      const gptResponse = await analysisClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Sadece geçerli JSON döndür.' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.5,
        max_tokens: 512,
        response_format: { type: 'json_object' },
      });

      let report;
      try {
        report = JSON.parse(gptResponse.choices[0]?.message?.content || '{}');
      } catch {
        report = { characterSummary: 'Rapor oluşturulamadı.', weeklyScore: 50 };
      }

      // Profile event olarak kaydet
      await supabaseClient.from('profile_events').insert({
        user_id: DEFAULT_USER_ID,
        event_type: 'weekly_report',
        event_data: report,
      }).then(null, () => {});

      // Telegram ile gönder
      if (telegram.isConfigured()) {
        const summary = '📊 Haftalık Skor: ' + (report.weeklyScore || 50) + '/100\n💰 Net: ₺' + (totalProfit - totalLoss) + '\n📦 ' + opportunities.length + ' fırsat incelendi\n\n' + (report.characterSummary || '');
        await telegram.send('Haftalık Karakter Raporu', summary, 'weekly-summary');
      }

      // UI'a rapor hazır bildirimi
      if (win) {
        win.webContents.send('notification', {
          type: 'weekly-summary',
          title: 'Haftalık Rapor Hazır',
          body: report.characterSummary || 'Rapor üretildi.',
        });
      }

      console.log('[Cron] Weekly report generated and sent. Score:', report.weeklyScore);
    } catch (err) {
      console.error('[Cron] Weekly report error:', err.message);
    }
  });

  // Her 4 saatte bir — Watchlist Matcher (fırsatları watchlist ile eşleştir)
  cron.schedule('0 */4 * * *', async () => {
    console.log('[Cron] Watchlist matcher starting...');
    try {
      if (!supabaseClient) return;

      // Aktif watchlist'leri al
      const { data: watchlists } = await supabaseClient
        .from('watchlists')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID)
        .eq('is_active', true);

      if (!watchlists || watchlists.length === 0) {
        console.log('[Cron] No active watchlists, skipping.');
        return;
      }

      // Son 4 saatteki yeni fırsatları al
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: recentOpps } = await supabaseClient
        .from('opportunities')
        .select('*')
        .gte('created_at', fourHoursAgo)
        .order('score', { ascending: false });

      if (!recentOpps || recentOpps.length === 0) {
        console.log('[Cron] No recent opportunities to match.');
        return;
      }

      let totalMatches = 0;

      for (const wl of watchlists) {
        const keywords = (wl.query_keywords || []).map(k => k.toLowerCase());
        if (keywords.length === 0) continue;

        const matches = recentOpps.filter(opp => {
          const text = `${opp.title || ''} ${opp.description || ''} ${opp.category || ''}`.toLowerCase();

          // Keyword eşleşmesi
          const keywordMatch = keywords.some(kw => text.includes(kw));
          if (!keywordMatch) return false;

          // Kaynak filtresi
          if (wl.source_filter && wl.source_filter.length > 0) {
            if (!wl.source_filter.includes(opp.source)) return false;
          }

          // Fiyat filtresi
          if (wl.price_min && opp.price < wl.price_min) return false;
          if (wl.price_max && opp.price > wl.price_max) return false;

          return true;
        });

        if (matches.length === 0) continue;

        // Eşleşmeleri DB'ye kaydet
        const matchRows = matches.map(opp => {
          // Match score: keyword overlap + price proximity
          const text = `${opp.title || ''} ${opp.description || ''}`.toLowerCase();
          const matchedKws = keywords.filter(kw => text.includes(kw));
          const kwScore = (matchedKws.length / keywords.length) * 60;
          const priceScore = opp.score ? (opp.score / 100) * 40 : 20;
          return {
            watchlist_id: wl.id,
            opportunity_id: opp.id,
            match_score: Math.round(kwScore + priceScore),
            price_at_match: opp.price || null,
            notified: false,
          };
        });

        // Upsert — aynı çifti tekrar ekleme
        for (const row of matchRows) {
          await supabaseClient
            .from('watchlist_matches')
            .upsert(row, { onConflict: 'watchlist_id,opportunity_id' })
            .then(null, () => {});
        }

        // Watchlist son eşleşme tarihini güncelle
        const bestMatch = matches[0];
        await supabaseClient
          .from('watchlists')
          .update({
            last_matched_at: new Date().toISOString(),
            last_price: bestMatch.price || wl.last_price,
            updated_at: new Date().toISOString(),
          })
          .eq('id', wl.id);

        totalMatches += matches.length;

        // Fiyat düşüşü kontrolü + Telegram alarm
        if (wl.notify_on_match && telegram.isConfigured()) {
          const priceInfo = bestMatch.price ? `₺${bestMatch.price}` : 'fiyat bilinmiyor';
          const priceDropNote = (wl.notify_on_price_drop && wl.last_price && bestMatch.price && bestMatch.price < wl.last_price)
            ? `\n📉 Fiyat düştü! ₺${wl.last_price} → ₺${bestMatch.price} (-%${Math.round((1 - bestMatch.price / wl.last_price) * 100)})`
            : '';

          const body = `🎯 "${wl.title}" için ${matches.length} yeni eşleşme!\n\n`
            + `🏆 En iyi: ${bestMatch.title}\n💰 ${priceInfo}${priceDropNote}\n⭐ Skor: ${bestMatch.score || '?'}/100`
            + (bestMatch.source_url ? `\n🔗 ${bestMatch.source_url}` : '');

          await telegram.send('Watchlist Alarm 🔔', body, 'watchlist-alert').catch(() => {});

          // Bildirim gönderildiğini işaretle
          for (const row of matchRows) {
            await supabaseClient
              .from('watchlist_matches')
              .update({ notified: true })
              .eq('watchlist_id', row.watchlist_id)
              .eq('opportunity_id', row.opportunity_id)
              .then(null, () => {});
          }
        }

        // UI'a bildirim gönder
        const win = mainWindow || BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('notification', {
            type: 'watchlist-match',
            title: `Watchlist: ${wl.title}`,
            body: `${matches.length} yeni eşleşme bulundu!`,
          });
        }
      }

      console.log(`[Cron] Watchlist matcher done: ${totalMatches} matches across ${watchlists.length} watchlists`);
    } catch (err) {
      console.error('[Cron] Watchlist matcher error:', err.message);
    }
  });

  console.log('[Cron] Scheduler started — daily 23:00, weekly Sunday 10:00, watchlist every 4h');

  app.on('activate', () => {
    if (process.platform === 'darwin' && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Scraper cleanup
  try {
    const { destroyScraper } = require('./scraper.cjs');
    destroyScraper();
  } catch (e) {}

  if (process.platform !== 'darwin') app.quit();
});

app.on('child-process-gone', (_event, details) => {
  if (details?.type === 'GPU' || details?.type === 'Utility') {
    console.warn('[Electron] Child process gone:', details.type, details.reason || 'unknown');
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Electron] uncaughtException:', err?.stack || err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Electron] unhandledRejection:', reason);
});

// ==============================
// IPC: Analysis File — open in default browser
// ==============================

// Renderer'dan HAM YOL kabul edilmez. Widget HTML'ini LLM yazabildiği ve
// iframe'de script çalıştığı için, yol taşıyan bir kanal LLM'in keyfi dosya
// (ör. kendi yazdığı bir .bat) açtırmasına giden bir zincir oluşturuyordu.
// Artık yalnızca uygulamanın kendi ürettiği ve kayıt defterinde bulunan bir
// artifactId kabul edilir; yol kayıttan gelir ve açma anında yeniden doğrulanır.
ipcMain.handle('analysis:open-artifact', async (_event, artifactId) => {
  try {
    const resolved = resolveAnalysisArtifact(artifactId);
    if (!resolved) {
      console.warn('[IPC] analysis:open-artifact reddedildi — bilinmeyen veya geçersiz artifact');
      return { success: false, error: 'Geçersiz veya süresi geçmiş analiz dosyası.' };
    }
    const openError = await shell.openPath(resolved);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (err) {
    console.error('[IPC] analysis:open-artifact error:', err);
    return { success: false, error: err.message };
  }
});

// ==============================
// IPC: Cerrahi bakım — diff inceleme ve onaylı merge
// Merge kararı LLM'e veya cerraha ait değildir; yalnız kullanıcı verir.
// BLOCK durumunda kullanıcı onayı bile merge'i açmaz (review-service kontrol eder).
// ==============================

// Cerrahi oturum yöneticisi: bekleyen talepler, başlatma, iptal.
// Cerrahi YALNIZ buradan başlar ve yalnız kullanıcının UI onayıyla.
const surgerySession = createSessionManager({
  repoRoot: path.resolve(__dirname, '../../..'),
});

// Cerrahi olaylarını renderer'a köprüle (ayrı kanal: sohbet aktivitesiyle karışmasın)
surgerySession.onEvent((event) => {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('surgery-activity', event);
  }
});

// Son bilinen kimlik durumu. ÇAKAL'a her turda bildirilir; her sohbet turunda
// CLI başlatıp sormak pahalı olurdu.
let lastSurgeryAuth = false;

ipcMain.handle('surgery:auth-status', async () => {
  try {
    const result = await surgerySession.checkAuth();
    lastSurgeryAuth = Boolean(result.authenticated);
    return { success: true, ...result };
  } catch (err) {
    lastSurgeryAuth = false;
    return { success: false, authenticated: false, error: err.message };
  }
});

// GitHub cihaz kodu girişi. ÇAKAL kullanıcı adına giriş yapmaz; kodu ekrana
// taşır, onayı kullanıcı kendi tarayıcısında verir, token CLI kasasında kalır.
ipcMain.handle('surgery:login-start', async () => {
  try {
    return { success: true, ...(await surgerySession.startLogin()) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:login-cancel', async () => {
  try {
    return { success: true, ...surgerySession.cancelLogin() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Yalnız GitHub'ın resmî cihaz aktivasyon adresi açılabilir; CLI çıktısından
// gelen rastgele bir URL açtırılamaz.
ipcMain.handle('surgery:open-device-page', async () => {
  try {
    const { GITHUB_DEVICE_URL } = require('./surgery/auth-login.cjs');
    await shell.openExternal(GITHUB_DEVICE_URL);
    return { success: true, url: GITHUB_DEVICE_URL };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:session-status', async () => {
  try {
    return { success: true, ...surgerySession.getStatus() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:list-requests', async () => {
  try {
    return { success: true, requests: surgerySession.listRequests() };
  } catch (err) {
    return { success: false, error: err.message, requests: [] };
  }
});

ipcMain.handle('surgery:start', async (_event, payload = {}) => {
  try {
    if (!payload.changeRequestId) {
      return { success: false, error: 'changeRequestId gerekli.' };
    }
    const result = await surgerySession.startSurgery(payload.changeRequestId, {
      timeoutMs: payload.timeoutMs,
    });
    return { success: result.ok !== false, ...result };
  } catch (err) {
    console.error('[IPC] surgery:start error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:abort', async () => {
  try {
    const result = await surgerySession.abortSurgery();
    return { success: result.ok !== false, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:list-branches', async () => {
  try {
    return { success: true, branches: surgeryReview.listSurgicalBranches() };
  } catch (err) {
    console.error('[IPC] surgery:list-branches error:', err.message);
    return { success: false, error: err.message, branches: [] };
  }
});

ipcMain.handle('surgery:preflight', async (_event, payload = {}) => {
  try {
    const gate = surgeryReview.runPreflight({
      base: payload.base || 'main',
      head: payload.head,
      verify: payload.verify === true,
    });
    console.log(`[Surgery] preflight ${payload.head}: ${gate.verdict}`);
    return { success: true, gate };
  } catch (err) {
    console.error('[IPC] surgery:preflight error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:diff', async (_event, payload = {}) => {
  try {
    if (payload.file) {
      return { success: true, diff: surgeryReview.getFileDiff({ base: payload.base || 'main', head: payload.head, file: payload.file }), truncated: false };
    }
    return { success: true, ...surgeryReview.getDiff({ base: payload.base || 'main', head: payload.head }) };
  } catch (err) {
    console.error('[IPC] surgery:diff error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('surgery:approve-merge', async (_event, payload = {}) => {
  try {
    const result = surgeryReview.approveAndMerge({
      base: payload.base || 'main',
      head: payload.head,
      approved: payload.approved === true,
      verify: payload.verify !== false,
    });
    console.log(`[Surgery] merge ${payload.head}: ${result.merged ? 'MERGED' : result.reason}`);
    return { success: true, result };
  } catch (err) {
    console.error('[IPC] surgery:approve-merge error:', err.message);
    return { success: false, error: err.message };
  }
});

// ==============================
// IPC: Sesli Asistan — STT (Whisper) + TTS
// Token ekonomisi: Bu uçlar YALNIZCA renderer'daki sesli asistan overlay'i
// açıkken ve gerektiğinde çağrılır. Sürekli akış/stream yok; her konuşma
// segmenti tek transcription çağrısı, her cevap tek TTS çağrısıdır.
// ==============================

const VOICE_STT_MODEL = process.env.VOICE_STT_MODEL || 'gpt-4o-mini-transcribe';
const VOICE_TTS_MODEL = process.env.VOICE_TTS_MODEL || 'gpt-4o-mini-tts';
const VOICE_TTS_VOICE = process.env.VOICE_TTS_VOICE || 'alloy';
// OpenAI TTS istek başına 4096 karakter kabul eder; uzun cevaplar cümle
// sınırlarından parçalanıp sırayla çalınır. Toplam üst sınır maliyet emniyeti.
const VOICE_TTS_CHUNK_CHARS = 3500;
const VOICE_TTS_MAX_TOTAL_CHARS = Number(process.env.VOICE_TTS_MAX_CHARS) || 9000;

/** Metni cümle sınırlarına saygılı, chunkSize'ı aşmayan parçalara böl. */
function splitForTts(text, chunkSize) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > chunkSize) {
      if (current.trim()) { chunks.push(current.trim()); current = ''; }
      for (let i = 0; i < sentence.length; i += chunkSize) {
        chunks.push(sentence.slice(i, i + chunkSize).trim());
      }
      continue;
    }
    if ((current + sentence).length > chunkSize) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

async function callOpenAiTts(apiKey, input) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VOICE_TTS_MODEL,
      voice: VOICE_TTS_VOICE,
      input,
      instructions: 'Türkçe, doğal ve akıcı konuş. Finansal terimleri net telaffuz et.',
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    console.error('[Voice] TTS hatası:', res.status, errText);
    const error = new Error(`TTS ${res.status}`);
    error.detail = errText;
    throw error;
  }
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

// Latin dışı alfabe (Hangul/CJK/Kiril/Arap) — kısa Türkçe kliplerde STT'nin
// dili yanlış kilitlediğinin göstergesi ("Gördün mü" -> Korece çıktı gibi).
const NON_LATIN_SCRIPT_RE = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ]/;

async function callOpenAiTranscription(apiKey, buffer, mimeType, model) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'utterance.webm');
  form.append('model', model);
  form.append('language', 'tr');
  // Kısa kliplerde dil kilidini Türkçeye sabitleyen bağlam ipucu.
  form.append('prompt', 'Türkçe finans sohbeti: BIST, hisse, bilanço, sepet, tarama, analiz, fırsat, portföy.');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    const error = new Error(`STT ${res.status}`);
    error.detail = errText;
    throw error;
  }
  const json = await res.json();
  return String(json.text || '').trim();
}

ipcMain.handle('voice:transcribe', async (_event, payload) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, error: 'OPENAI_API_KEY yok' };
    const base64 = payload?.audioBase64;
    if (!base64) return { success: false, error: 'Ses verisi yok' };
    const buffer = Buffer.from(base64, 'base64');
    // Çok kısa kayıtlar (yanlış tetiklenen VAD) için API'ye gitme — token koruması.
    if (buffer.length < 4000) return { success: true, text: '' };

    let text = await callOpenAiTranscription(apiKey, buffer, payload?.mimeType, VOICE_STT_MODEL);

    // Dil kayması tespiti: Türkçe konuşmada Latin dışı alfabe çıktıysa bir kez
    // whisper-1 ile yeniden dene; o da Latin dışıysa transkripti güvenilmez say.
    if (NON_LATIN_SCRIPT_RE.test(text)) {
      console.warn('[Voice] Latin dışı transkript, whisper-1 ile yeniden deneniyor:', text.slice(0, 40));
      try {
        text = await callOpenAiTranscription(apiKey, buffer, payload?.mimeType, 'whisper-1');
      } catch (_) { /* retry başarısızsa aşağıdaki kontrol yakalar */ }
      if (NON_LATIN_SCRIPT_RE.test(text)) {
        return { success: true, text: '', unreliable: true };
      }
    }

    return { success: true, text };
  } catch (err) {
    console.error('[Voice] transcribe error:', err.message, err.detail || '');
    return { success: false, error: err.message };
  }
});

ipcMain.handle('voice:tts', async (_event, payload) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, error: 'OPENAI_API_KEY yok' };
    const rawText = String(payload?.text || '').trim();
    if (!rawText) return { success: false, error: 'Metin yok' };
    // Markdown/tabloları sesli okumaya uygun düz metne indir. Uzun cevaplar
    // 4096 karakter API limitine takılmasın diye cümle sınırlarından parçalanır;
    // VOICE_TTS_MAX_CHARS toplam maliyet emniyet sınırıdır.
    const speakable = rawText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\|[^\n]*\|/g, ' ')
      .replace(/[#*_>`~\-]{2,}/g, ' ')
      .replace(/[#*_>`~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, VOICE_TTS_MAX_TOTAL_CHARS);
    if (!speakable) return { success: false, error: 'Okunabilir metin yok' };

    const chunks = splitForTts(speakable, VOICE_TTS_CHUNK_CHARS);
    const audioChunks = await Promise.all(chunks.map((chunk) => callOpenAiTts(apiKey, chunk)));
    // audioBase64: eski istemcilerle uyumluluk için ilk parça.
    return { success: true, audioChunks, audioBase64: audioChunks[0], mimeType: 'audio/mpeg' };
  } catch (err) {
    console.error('[Voice] tts error:', err.message);
    return { success: false, error: err.message };
  }
});

// IPC: AI Chat
// ==============================

ipcMain.handle('agent:run', async (_event, agentName, payload) => {
  console.log(`[IPC] Agent run: ${agentName}`, payload?.message?.substring(0, 50));

  // Agent run loglama — başlangıç
  let agentRunId = null;
  const runStartTime = Date.now();
  if (supabaseClient) {
    try {
      const { data: runData } = await supabaseClient
        .from('agent_runs')
        .insert({
          agent_name: agentName,
          input_summary: (payload?.message || payload?.action || '').substring(0, 500),
          success: true,
          metadata: { action: payload?.action || null, source: 'manual' },
        })
        .select('id')
        .single();
      if (runData) agentRunId = runData.id;
    } catch (e) { console.warn('[AgentRun] Insert error:', e.message); }
  }

  // Activity event emitter → renderer (uses stored mainWindow ref)
  const emitActivity = (event) => {
    try {
      const win = mainWindow || BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('agent-activity', event);
      }
    } catch (e) {
      console.warn('[Activity] Failed to emit event:', event?.type, e.message);
    }
  };

  try {
    if (agentName === 'commander') {
      const commanderActivityLog = [];
      const commanderEmitActivity = (event) => {
        commanderActivityLog.push(event);
        emitActivity(event);
      };

      commanderEmitActivity({ type: 'agent_start', agent: 'commander', message: payload.message, timestamp: Date.now() });

      // Build dynamic profile context for system prompt injection
      // Cerrahi hattın durumu her turda bildirilir: ÇAKAL bağlantı yokken
      // kullanıcıyı önce bağlanmaya yönlendirebilsin, çalışan cerrahi varken
      // ikinci başlatma vaadinde bulunmasın.
      const surgeryContext = (() => {
        try {
          const s = surgerySession.getStatus();
          return { status: s.status, pendingCount: s.pendingCount, authenticated: lastSurgeryAuth };
        } catch {
          return null;
        }
      })();

      let profileContext = { surgery: surgeryContext };
      if (supabaseClient) {
        try {
          commanderEmitActivity({ type: 'db_fetch', detail: 'Profil ve strateji verileri alınıyor...', timestamp: Date.now() });
          const profile = await ensureDefaultUserProfile(supabaseClient);
          let indexEntries = [];
          let recentPatterns = [];
          let openGaps = [];
          let pendingProposals = [];
          let pendingPromotions = [];
          let fetchError = null;
          const runtimeActiveCapabilities = new Set(
            mergeRuntimeCapabilityOverrides([])
              .filter((capability) => capability.status === 'active')
              .map((capability) => capability.capability_name),
          );

          const [indexSettled, patternSettled, gapsSettled, proposalsSettled, promotionsSettled] = await Promise.allSettled([
            supabaseClient.from('user_index_entries').select('*').eq('user_id', DEFAULT_USER_ID).order('created_at', { ascending: false }).limit(30),
            supabaseClient.from('strategy_patterns').select('*').eq('status', 'active').order('confidence', { ascending: false }).limit(5),
            supabaseClient.from('capability_gaps').select('*').neq('status', 'resolved').order('trigger_count', { ascending: false }).limit(10),
            supabaseClient.from('expansion_proposals').select('*').eq('status', 'pending').order('proposed_at', { ascending: false }).limit(10),
            supabaseClient.from('evolution_log').select('*').eq('evolution_type', 'config_change').like('target_path', 'CORE_PROMOTION::%').eq('status', 'proposed').order('proposed_at', { ascending: false }).limit(10),
          ]);

          if (indexSettled.status === 'fulfilled') {
            indexEntries = indexSettled.value?.data || [];
            if (indexSettled.value?.error) {
              fetchError = indexSettled.value.error.message;
            }
          } else {
            fetchError = indexSettled.reason?.message || 'index fetch failed';
          }

          if (patternSettled.status === 'fulfilled') {
            recentPatterns = patternSettled.value?.data || [];
            if (patternSettled.value?.error) {
              fetchError = fetchError || patternSettled.value.error.message;
            }
          } else {
            fetchError = fetchError || patternSettled.reason?.message || 'pattern fetch failed';
          }

          if (gapsSettled.status === 'fulfilled') {
            openGaps = (gapsSettled.value?.data || []).filter((gap) => !runtimeActiveCapabilities.has(gap.capability_name));
            if (gapsSettled.value?.error) {
              fetchError = fetchError || gapsSettled.value.error.message;
            }
          } else {
            fetchError = fetchError || gapsSettled.reason?.message || 'gap fetch failed';
          }

          if (proposalsSettled.status === 'fulfilled') {
            pendingProposals = (proposalsSettled.value?.data || []).filter((proposal) => !runtimeActiveCapabilities.has(proposal.capability_name));
            if (proposalsSettled.value?.error) {
              fetchError = fetchError || proposalsSettled.value.error.message;
            }
          } else {
            fetchError = fetchError || proposalsSettled.reason?.message || 'proposal fetch failed';
          }

          if (promotionsSettled.status === 'fulfilled') {
            pendingPromotions = promotionsSettled.value?.data || [];
            if (promotionsSettled.value?.error) {
              fetchError = fetchError || promotionsSettled.value.error.message;
            }
          } else {
            fetchError = fetchError || promotionsSettled.reason?.message || 'promotion fetch failed';
          }

          profileContext = {
            profile,
            indexEntries,
            recentPatterns,
            openGaps,
            pendingProposals,
            pendingPromotions,
            surgery: surgeryContext,
          };

          commanderEmitActivity({
            type: 'db_fetch_done',
            detail: fetchError
              ? `Profil: ${profile ? '✓' : '✗'}, Index: ${indexEntries.length}, Pattern: ${recentPatterns.length} (uyarı: ${fetchError})`
              : `Profil: ${profile ? '✓' : '✗'}, Index: ${indexEntries.length}, Pattern: ${recentPatterns.length}`,
            timestamp: Date.now(),
          });
        } catch (e) {
          console.warn('[IPC] Profile context fetch error:', e.message);
        }
      }

      // DB bağlantısı açılışta kurulamadıysa (env sonradan eklendi, geçici ağ
      // hatası vb.) her chat turunda bir kez daha dene — DB toolları
      // "Veritabanı bağlantısı yok" ile ölü kalmasın.
      if (!supabaseClient) {
        await initSupabase();
        if (supabaseClient) {
          commanderEmitActivity({
            type: 'db_reconnect',
            detail: 'Veritabanı bağlantısı kuruldu (lazy init).',
            timestamp: Date.now(),
          });
        }
      }

      let response = await chat(payload.message || '', {
        perplexityKey: process.env.PERPLEXITY_API_KEY,
        supabaseClient,
        profileContext,
        onActivity: commanderEmitActivity,
        telegramService: telegram,
        telegramReader: telegramReader,
        registerSurgicalRequest: surgerySession.registerRequest,
      });

      let gateResult = evaluateCommanderDecisionGate(payload.message, response, commanderActivityLog);

      const shouldRetryForData =
        gateResult &&
        gateResult.status === 'veri_yetersiz' &&
        Array.isArray(gateResult.usedTools) &&
        gateResult.usedTools.length === 0;

      const shouldRetryForDecision =
        gateResult &&
        gateResult.status === 'no_signal';

      if (shouldRetryForData || shouldRetryForDecision) {
        commanderEmitActivity({
          type: 'decision_gate',
          agent: 'commander',
          detail: shouldRetryForData
            ? 'VERI_YETERSIZ tespit edildi, otomatik veri toplama retry başlatılıyor (1 kez).'
            : 'NO_SIGNAL tespit edildi, otomatik karar teyidi retry başlatılıyor (1 kez).',
          timestamp: Date.now(),
        });

        const retryMessage = shouldRetryForData
          ? [
              payload.message || '',
              '',
              '[ÇEKİRDEK ZORUNLULUK]',
              'Final yanıt üretmeden önce en az bir piyasa veri aracı çağır:',
              'get_stock_price, get_market_signal, analyze_finance_signal, get_forex_rates, get_crypto_prices, get_tcmb_rates veya generate_stock_chart.',
              'Ardından sadece mevcut veriye dayanarak cevap ver; veri yoksa nedenini açık yaz.',
            ].join('\n')
          : [
              payload.message || '',
              '',
              '[ÇEKİRDEK ZORUNLULUK]',
              'Piyasa verisi toplandı fakat karar teyidi eksik. Final yanıt öncesi mutlaka karar teyit aracı çağır:',
              'analyze_finance_signal ve/veya judge_opportunity.',
              'Sonucu deterministik teyide dayalı özetle; teyit oluşmazsa gerekçeyi açık yaz.',
            ].join('\n');

        response = await chat(retryMessage, {
          perplexityKey: process.env.PERPLEXITY_API_KEY,
          supabaseClient,
          profileContext,
          onActivity: commanderEmitActivity,
          telegramService: telegram,
          telegramReader: telegramReader,
        registerSurgicalRequest: surgerySession.registerRequest,
        });

        gateResult = evaluateCommanderDecisionGate(payload.message, response, commanderActivityLog);
      }

      if (gateResult) {
        commanderEmitActivity({
          type: 'decision_gate',
          agent: 'commander',
          detail: `${gateResult.status.toUpperCase()}: ${gateResult.reason}`,
          timestamp: Date.now(),
        });
        response = gateResult.response;
      } else {
        // Yönlendirilmemiş yetenek kilidi (ÇIKIŞ TARAFI):
        // Kaynak kod isteği ne cerrahi hatta ne sandbox plugin'e yönlendirildiyse
        // istek boşa düşmüştür. Gerçek vaka: README isteği duvara çarptı, ÇAKAL
        // "sandbox'a yazayım mı" dedi — o dosyaları hiçbir şey okumaz.
        let routingLock = evaluateUnroutedCapabilityGate(payload.message, response, commanderActivityLog);
        if (routingLock) {
          commanderEmitActivity({
            type: 'decision_gate',
            agent: 'commander',
            detail: 'YÖNLENDİRİLMEMİŞ YETENEK: kaynak kod isteği boşa düştü. Cerrahi hatta devretme denemesi başlatılıyor (1 kez).',
            timestamp: Date.now(),
          });

          const routingCompletionMessage = [
            payload.message || '',
            '',
            '[ÇEKİRDEK ZORUNLULUK — KADEME 2 YÖNLENDİRME]',
            'Önceki cevabında kaynak kod değişikliği gereken bir isteği hiçbir yola yönlendirmedin.',
            'Kaynak koda YAZAMAZSIN; sandbox dosyası yazmak da çözüm değildir (o dosyaları hiçbir şey okumaz).',
            'Şimdi propose_surgical_change çağır: original_user_request alanına kullanıcının talebini',
            'DEĞİŞTİRMEDEN koy, kısa bir başlık ve gerekçe ver.',
            'Sonra kullanıcıya Cerrahi Bakım ekranından başlatmasını söyle.',
          ].join('\n');

          response = await chat(routingCompletionMessage, {
            perplexityKey: process.env.PERPLEXITY_API_KEY,
            supabaseClient,
            profileContext,
            onActivity: commanderEmitActivity,
            registerSurgicalRequest: surgerySession.registerRequest,
            telegramService: telegram,
            telegramReader: telegramReader,
          });

          routingLock = evaluateUnroutedCapabilityGate(payload.message, response, commanderActivityLog);
          if (routingLock) {
            commanderEmitActivity({
              type: 'decision_gate',
              agent: 'commander',
              detail: `${routingLock.status}: ${routingLock.reason}`,
              timestamp: Date.now(),
            });
            response = routingLock.response;
          }
        }

        // Yönetilmemiş sıralama kilidi (ÇIKIŞ TARAFI):
        // Giriş niyeti regex'i Türkçe'nin ifade çeşitliliğinde kaçabilir
        // ("ensağlam", "top 5 aday", "bunlardan hangileri?"). Bu kapı kullanıcı
        // ifadesini tahmin etmeye çalışmaz; ÇAKAL'ın ÜRETTİĞİ cevaba bakar:
        // ortada hisse sıralaması varsa arkasında yönetilmiş araştırma da olmalı.
        let rankingLock = evaluateUngovernedRankingGate(payload.message, response, commanderActivityLog);
        if (rankingLock) {
          commanderEmitActivity({
            type: 'decision_gate',
            agent: 'commander',
            detail: 'YÖNETİLMEMİŞ SIRALAMA: hisse sıralaması var ama araştırma taraması çalışmadı. Tamamlama denemesi başlatılıyor (1 kez).',
            timestamp: Date.now(),
          });

          const rankingCompletionMessage = [
            payload.message || '',
            '',
            '[ÇEKİRDEK ZORUNLULUK — YÖNETİLMEMİŞ SIRALAMA]',
            'Önceki cevabında hisse sıralaması/seçimi vardı ama yönetilmiş araştırma taraması çalışmadı.',
            'Sıralama bir aday seçimidir; günlük değişim listesi (get_bist_gainers) tek başına buna yetmez.',
            'İki seçeneğin var:',
            '1) run_investment_research_scan aracını çalıştır; evren kapsamını, elenenleri ve gerekçelerini cevaba koy.',
            '2) Tarama yapılamıyorsa sıralamayı KALDIR. "En sağlam/en iyi" deme; en fazla "bugünün en güçlü momentum hareketleri" de ve bunun bir kalite ölçüsü OLMADIĞINI açıkça yaz.',
          ].join('\n');

          response = await chat(rankingCompletionMessage, {
            perplexityKey: process.env.PERPLEXITY_API_KEY,
            supabaseClient,
            profileContext,
            onActivity: commanderEmitActivity,
            telegramService: telegram,
            telegramReader: telegramReader,
        registerSurgicalRequest: surgerySession.registerRequest,
          });

          rankingLock = evaluateUngovernedRankingGate(payload.message, response, commanderActivityLog);
          if (rankingLock) {
            commanderEmitActivity({
              type: 'decision_gate',
              agent: 'commander',
              detail: `${rankingLock.status}: ${rankingLock.reason}`,
              timestamp: Date.now(),
            });
            response = rankingLock.response;
          }
        }

        // Fiyatlanma kilidi: bilanço kaynaklı AL/fırsat hükmü, analyze_earnings_pricing
        // aracı GERÇEKTEN çalışıp sınıflandırma üretmeden (provenance kaydı) çıkamaz.
        // Doğrulama cevap metnindeki kelimeyle değil tool_call activity log'uyla yapılır.
        let pricingLock = evaluateEarningsPricingGate(payload.message, response, commanderActivityLog);
        if (pricingLock) {
          commanderEmitActivity({
            type: 'decision_gate',
            agent: 'commander',
            detail: 'FİYATLANMA KİLİDİ: bilanço kaynaklı AL/fırsat hükmü var ama analyze_earnings_pricing çalışmadı. Tamamlama denemesi başlatılıyor (1 kez).',
            timestamp: Date.now(),
          });

          const pricingCompletionMessage = [
            payload.message || '',
            '',
            '[ÇEKİRDEK ZORUNLULUK — FİYATLANMA KİLİDİ]',
            'Önceki cevabında bilanço kaynaklı AL/fırsat hükmü vardı ama önceden fiyatlanma ölçümü yapılmadı.',
            'İki seçeneğin var:',
            '1) analyze_earnings_pricing aracını çağır (sembol + biliniyorsa bilanço açıklama tarihi), çıkan sınıflandırmayı ve kanıt satırlarını cevaba aynen koy, hükmü sınıflandırmaya göre güncelle (LARGELY_PRICED/OVEREXTENDED ise kovalamama/kâr realizasyonu uyarısıyla).',
            '2) Ölçüm yapılamıyorsa AL/fırsat hükmünü kaldır; bilanço kalitesini yorumla ama zamanlama hükmü olarak SADECE İNCELE veya İZLE kullan.',
            'Konsensüs verisi görmediysen consensusSurprise alanını DOLDURMA; beklenti sürprizini UNKNOWN olarak raporla.',
          ].join('\n');

          response = await chat(pricingCompletionMessage, {
            perplexityKey: process.env.PERPLEXITY_API_KEY,
            supabaseClient,
            profileContext,
            onActivity: commanderEmitActivity,
            telegramService: telegram,
            telegramReader: telegramReader,
        registerSurgicalRequest: surgerySession.registerRequest,
          });

          pricingLock = evaluateEarningsPricingGate(payload.message, response, commanderActivityLog);
          if (pricingLock) {
            commanderEmitActivity({
              type: 'decision_gate',
              agent: 'commander',
              detail: 'FİYATLANMA KİLİDİ uygulandı: ölçüm hâlâ yok. Bilanço kaynaklı alım hükmü İNCELE seviyesine indirildi.',
              timestamp: Date.now(),
            });
            response = pricingLock.response;
          }
        }

        // Hüküm-kanıt kilidi: AL/SAT ancak değerleme + dönem karşılaştırması +
        // kaynak kanıtı + veri tazeliği + risk seviyesi tamamsa çıkabilir.
        let verdictLock = evaluateVerdictEvidenceLock(payload.message, response);
        if (verdictLock) {
          commanderEmitActivity({
            type: 'decision_gate',
            agent: 'commander',
            detail: `KARAR KİLİDİ: AL/SAT hükmü var ama kanıt eksik (${verdictLock.missing.length} kalem). Tamamlama denemesi başlatılıyor (1 kez).`,
            timestamp: Date.now(),
          });

          const completionMessage = [
            payload.message || '',
            '',
            '[ÇEKİRDEK ZORUNLULUK — KARAR KİLİDİ]',
            'Önceki cevabında AL/SAT hükmü vardı ama şu zorunlu kanıtlar eksikti:',
            ...verdictLock.missing.map((item) => `- ${item}`),
            'İki seçeneğin var:',
            '1) Eksik kanıtları araçlarla tamamla (get_financial_statements ile yıllık karşılaştırma, değerleme çarpanları, kaynak+tarih, veri zamanı, risk/stop seviyesi) ve hükmü koru.',
            '2) Kanıt tamamlanamıyorsa hüküm kelimesi olarak SADECE İNCELE, İZLE, RİSKLİ veya VERİ YETERSİZ kullan.',
            'AL/SAT hükmünü kanıtsız tekrar etme.',
          ].join('\n');

          response = await chat(completionMessage, {
            perplexityKey: process.env.PERPLEXITY_API_KEY,
            supabaseClient,
            profileContext,
            onActivity: commanderEmitActivity,
            telegramService: telegram,
            telegramReader: telegramReader,
        registerSurgicalRequest: surgerySession.registerRequest,
          });

          verdictLock = evaluateVerdictEvidenceLock(payload.message, response);
          if (verdictLock) {
            commanderEmitActivity({
              type: 'decision_gate',
              agent: 'commander',
              detail: `KARAR KİLİDİ uygulandı: kanıt hâlâ eksik (${verdictLock.missing.join(', ')}). Hüküm İNCELE/RİSKLİ seviyesine indirildi.`,
              timestamp: Date.now(),
            });
            response = verdictLock.response;
          }
        }
      }

      console.log(
        '[IPC] Commander response stats:',
        'len=' + (response?.length || 0),
        'hasWidget=' + /```\s*widget\s*[\r\n]/i.test(response || ''),
        'hasChart=' + /```\s*chart\s*[\r\n]/i.test(response || '')
      );

      // Save conversation event to profile_events (conversation_logs tablosu mevcut değil)
      // KRİTİK: Bu loglama çağrıları await EDİLMEZ. Cevap hazırken DB çağrısı
      // askıda kalırsa invoke promise'i çözülmez ve UI "Araştırıyorum..."da
      // sonsuza dek takılı kalır. Loglama kritik değil; arka planda aksın.
      if (supabaseClient) {
        supabaseClient.from('profile_events').insert({
          user_id: DEFAULT_USER_ID,
          event_type: 'conversation',
          event_data: {
            agent: 'commander',
            input: (payload.message || '').substring(0, 300),
            output_length: (response || '').length,
          },
        }).then(
          () => {},
          (err) => console.warn('[IPC] profile_events log hatası (yoksayıldı):', err?.message),
        );
      }

      // Agent run loglama — commander başarılı (fire-and-forget)
      if (agentRunId && supabaseClient) {
        const durationMs = Date.now() - runStartTime;
        supabaseClient.from('agent_runs').update({
          success: true, duration_ms: durationMs,
          output_summary: (response || '').substring(0, 500),
          metadata: { agentType: 'commander', messageLength: (payload.message || '').length, responseLength: (response || '').length },
        }).eq('id', agentRunId).then(
          () => {},
          (err) => console.warn('[IPC] agent_runs log hatası (yoksayıldı):', err?.message),
        );
      }

      return { status: 'ok', response };
    }

    if (agentName === 'reset') {
      resetConversation();
      return { status: 'ok', response: 'Sohbet sıfırlandı.' };
    }

    // ── Sprint 6: İleri Ajan Doğrudan Çalıştırma ──
    const advancedAgents = ['arbitrage', 'street-hunter', 'finance', 'travel', 'judge', 'commerce-vision', 'system-conscience'];
    if (advancedAgents.includes(agentName)) {
      emitActivity({ type: 'agent_start', agent: agentName, message: payload.message || payload.action, timestamp: Date.now() });
      const action = payload.action || payload.data?.action;
      const agentInput = { message: payload.message || '', data: { action, ...payload } };
      const agentContext = { userId: DEFAULT_USER_ID, supabaseClient, profile: null, userProfile: null, recentPatterns: [] };

      // Fetch profile for context-aware agents
      if (supabaseClient) {
        try {
          const profile = await ensureDefaultUserProfile(supabaseClient);
          agentContext.profile = profile;
          agentContext.userProfile = profile;

          const { data: recentPatterns } = await supabaseClient
            .from('strategy_patterns')
            .select('*')
            .eq('status', 'active')
            .order('confidence', { ascending: false })
            .limit(10);
          agentContext.recentPatterns = recentPatterns || [];
        } catch { /* ignore */ }
      }

      emitActivity({ type: 'agent_thinking', agent: agentName, detail: `${agentName} çalışıyor: ${action || 'info'}`, timestamp: Date.now() });

      let result = runDeterministicAgent(agentName, { ...payload, action }, agentContext);

      if (!result) {
        switch (agentName) {
          case 'system-conscience': {
          if (action === 'check_gaps') {
            const { data: gaps } = await supabaseClient
              .from('capability_gaps')
              .select('*')
              .eq('status', 'open')
              .order('trigger_count', { ascending: false });
            const threshold = 3;
            const above = (gaps || []).filter(g => g.trigger_count >= threshold);
            result = { action, gaps: gaps || [], aboveThreshold: above.length, threshold, message: above.length > 0 ? `${above.length} yetenek eşik aştı — öneri üretilebilir.` : 'Eşik aşan yetenek yok.' };
          } else if (action === 'get_proposals') {
            const { data: proposals } = await supabaseClient
              .from('expansion_proposals')
              .select('*')
              .order('proposed_at', { ascending: false })
              .limit(10);
            result = { action, proposals: proposals || [] };
          } else {
            result = { action: 'info', message: 'System Conscience hazır. Aksiyonlar: check_gaps, get_proposals, generate_proposal, respond_proposal' };
          }
          break;
        }
          default:
            result = { action: 'unsupported', message: `${agentName} ajanı desteklenmiyor.` };
        }
      }

      emitActivity({ type: 'response_ready', agent: agentName, detail: `${agentName} tamamlandı`, timestamp: Date.now() });

      // Agent run loglama — başarılı bitiş
      if (agentRunId && supabaseClient) {
        try {
          const durationMs = Date.now() - runStartTime;
          const itemsFound = Array.isArray(result) ? result.length : (result?.gaps?.length || result?.proposals?.length || 0);
          await supabaseClient.from('agent_runs').update({
            success: true, duration_ms: durationMs,
            output_summary: JSON.stringify(result).substring(0, 500),
            metadata: { action: payload?.action, resultType: typeof result, itemsFound },
          }).eq('id', agentRunId);
        } catch (_) { /* ignore */ }
      }

      return { status: 'ok', response: result };
    }

    return { status: 'ok', response: `${agentName} ajanı henüz aktif değil.` };
  } catch (error) {
    console.error(`[IPC] Agent error:`, error.message);
    if (!error?.__activityEmitted) {
      emitActivity({ type: 'error', agent: agentName, detail: error.message, timestamp: Date.now() });
    }

    // Agent run loglama — hata
    if (agentRunId && supabaseClient) {
      try {
        const durationMs = Date.now() - runStartTime;
        await supabaseClient.from('agent_runs').update({
          success: false, duration_ms: durationMs, error_message: error.message,
          output_summary: `ERROR: ${error.message}`.substring(0, 500),
        }).eq('id', agentRunId);
      } catch (_) { /* ignore */ }
    }

    return { status: 'error', response: `Hata: ${error.message}` };
  }
});

ipcMain.handle('commerce:auto-pipeline', async (_event, payload = {}) => {
  try {
    const message = String(payload.message || '').trim();
    const query = String(payload.query || message).trim();
    if (!query) {
      return { status: 'error', error: 'Mesaj veya query gerekli.' };
    }

    const maxResults = Math.max(5, Math.min(20, toFiniteNumber(payload.maxResults, 12)));
    const fxRate = toFiniteNumber(payload.fxRate, 38);
    const perplexityKey = process.env.PERPLEXITY_API_KEY;

    const [targetScan, aliexpressScan, alibabaScan, scan1688] = await Promise.all([
      multiSourceSearch(query, {
        source: 'all',
        maxResults,
        perplexityKey,
        fxUsdTry: fxRate,
      }),
      multiSourceSearch(query, {
        source: 'aliexpress',
        maxResults: Math.min(10, maxResults),
        perplexityKey,
        fxUsdTry: fxRate,
      }),
      multiSourceSearch(query, {
        source: 'alibaba',
        maxResults: Math.min(10, maxResults),
        perplexityKey,
        fxUsdTry: fxRate,
      }),
      multiSourceSearch(query, {
        source: '1688',
        maxResults: Math.min(10, maxResults),
        perplexityKey,
        fxUsdTry: fxRate,
      }),
    ]);

    const targetListings = (targetScan?.listings || []).filter((item) => {
      const src = String(item?.source || '').toLowerCase();
      return src === 'trendyol' || src === 'sahibinden' || src === 'hepsiburada' || src === 'perplexity';
    });

    const chinaListings = [
      ...(aliexpressScan?.listings || []),
      ...(alibabaScan?.listings || []),
      ...(scan1688?.listings || []),
    ].filter((item) => {
      const src = String(item?.source || '').toLowerCase();
      return src === 'aliexpress' || src === 'alibaba' || src === '1688';
    });

    const built = buildCommerceCandidatesFromLiveData(targetListings, chinaListings, {
      fxRate,
      maxCandidates: payload.maxCandidates,
    });

    const agentContext = {
      userId: DEFAULT_USER_ID,
      supabaseClient,
      profile: null,
      userProfile: null,
      recentPatterns: [],
    };

    if (supabaseClient) {
      try {
        const profile = await ensureDefaultUserProfile(supabaseClient);
        agentContext.profile = profile;
        agentContext.userProfile = profile;
      } catch { /* ignore */ }
    }

    const strategy = runDeterministicAgent('commerce-vision', {
      action: 'build_dropshipping_strategy',
      candidates: built.candidates,
    }, agentContext);

    if (built.candidates.length === 0 && supabaseClient) {
      trackCapabilityGap(
        'commerce-auto-pipeline',
        `Canlı kaynaklardan aday üretilemedi: ${query}`,
        supabaseClient,
      ).catch(() => {});
    }

    return {
      status: 'ok',
      response: {
        query,
        candidates: built.candidates,
        diagnostics: built.diagnostics,
        strategy,
        sources: {
          target: targetScan?.sources || {},
          aliexpress: aliexpressScan?.sources?.aliexpress || aliexpressScan?.sources || {},
          alibaba: alibabaScan?.sources?.alibaba || alibabaScan?.sources || {},
          '1688': scan1688?.sources?.['1688'] || scan1688?.sources || {},
        },
        chinaResearchMethod: CHINA_RESEARCH_METHOD,
        notes: [
          'Pipeline canlı kaynaklardan listing toplar ve candidate üretir.',
          'Son karar commerce-vision tarafından A-Z maliyet ve strateji olarak hesaplanır.',
        ],
      },
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Database Queries
// ==============================

function formatRequiredConfig(requiredConfig) {
  if (!requiredConfig || typeof requiredConfig !== 'object') return 'Belirtilmemiş';
  const pairs = Object.entries(requiredConfig)
    .map(([key, value]) => {
      if (value == null || value === '') return key;
      if (typeof value === 'object') return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${String(value)}`;
    })
    .filter(Boolean);
  return pairs.length > 0 ? pairs.join(' • ') : 'Belirtilmemiş';
}

function buildCapabilityGapInsight(gap, capability) {
  const capabilityName = gap?.capability_name || capability?.capability_name || 'unknown_capability';
  const capabilityDescription = capability?.description || 'Bu yetenek için açıklama tanımlı değil.';
  const requiredConfig = capability?.required_config || {};
  const status = capability?.status || (gap?.status === 'resolved' ? 'active' : gap?.status || 'open');
  const context = gap?.context || 'Bağlam kaydı yok.';
  const triggerCount = Number(gap?.trigger_count || 0);

  const remediationSteps = [
    `1. Eksik yetenek: ${capabilityName}`,
    `2. Gerekli bileşenler: ${formatRequiredConfig(requiredConfig)}`,
    `3. Öncelik: ${triggerCount >= 3 ? 'yüksek' : triggerCount >= 2 ? 'orta' : 'izleme'}`,
    `4. Etki alanı: ${capability?.category || 'genel'}`,
    `5. Sonraki aksiyon: onay verilirse genişleme önerisi oluşturulsun, gerekirse API key/tool istenilsin.`,
  ];

  return {
    ...gap,
    capability_name: capabilityName,
    capability_description: capabilityDescription,
    capability_status: status,
    capability_category: capability?.category || null,
    required_config: requiredConfig,
    required_config_summary: formatRequiredConfig(requiredConfig),
    gap_summary: `${capabilityName} yeteneği tetiklenmiş ve sistem bunu ${triggerCount} kez istemiş.`,
    missing_reason: capability?.status === 'missing'
      ? 'Bu yetenek sistemde yok; tool veya API bağlantısı gerekiyor.'
      : capability?.status === 'planned'
        ? 'Bu yetenek plan aşamasında; inşa edilmesi için onay gerekir.'
        : 'Bu yetenek için çalışma bağlamı veya entegrasyon eksik görünüyor.',
    remediation_steps: remediationSteps,
    approval_request: `Onay verilirse ${capabilityName} için gerekli araç, API key veya entegrasyon hazırlığı başlatılacak.`,
    context,
  };
}

ipcMain.handle('db:get-profile', async () => {
  if (!supabaseClient) return { status: 'error', data: null, error: 'DB not connected' };
  try {
    const data = await ensureDefaultUserProfile(supabaseClient);
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', data: null, error: err.message };
  }
});

ipcMain.handle('db:update-profile', async (_event, updates) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    await ensureDefaultUserProfile(supabaseClient);
    const { data, error } = await supabaseClient
      .from('user_profile')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', DEFAULT_USER_ID)
      .select()
      .single();
    if (error) throw error;

    await consolidateUserLearning(supabaseClient, { source: 'ipc:update-profile' }).catch((err) => {
      console.warn('[DB] Learning consolidation after profile update failed:', err.message);
    });
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:upload-chat-image', async (_event, dataUrl) => {
  const storageClient = supabaseServiceClient || supabaseClient;
  if (!storageClient) return { status: 'error', error: 'DB not connected' };
  try {
    const matches = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!matches) throw new Error('Invalid data URL');
    const mimeType = matches[1];
    const base64Data = matches[2].replace(/\s/g, '');
    const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64Data, 'base64');
    const { error } = await storageClient.storage
      .from('chat-images')
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = storageClient.storage
      .from('chat-images')
      .getPublicUrl(fileName);
    return { status: 'ok', url: publicUrl };
  } catch (err) {
    console.error('[Storage] Upload error:', err.message);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:save-message', async (_event, msg) => {
  if (!supabaseClient) return { status: 'ok' };
  try {
    // Strip base64 image data before saving to DB (keeps only text portion)
    const IMG_STRIP_RE = /__IMG__[^_]*(?:_(?!_IMG_))*__ENDIMG__\n?/;
    const contentForDB = String(msg.content || '').replace(IMG_STRIP_RE, '[Görsel]').trim() || '[Görsel]';
    const { error } = await supabaseClient
      .from('conversation_logs')
      .insert({
        id: msg.id,
        user_id: DEFAULT_USER_ID,
        role: msg.role,
        content: contentForDB,
        metadata: { hasImage: IMG_STRIP_RE.test(String(msg.content || '')) },
        created_at: msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined,
      });
    if (error) throw error;
    return { status: 'ok' };
  } catch (err) {
    console.error('[DB] Save message error:', err.message);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:get-messages', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    const limit = (options && options.limit) || 100;
    const { data, error } = await supabaseClient
      .from('conversation_logs')
      .select('id, role, content, created_at, metadata')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:get-opportunities', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('opportunities')
      .select('*')
      .order('created_at', { ascending: false });

    if (options.status) query = query.eq('status', options.status);
    if (options.category) query = query.eq('category', options.category);
    if (options.minScore) query = query.gte('score', options.minScore);
    query = query.limit(options.limit || 50);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:save-opportunity', async (_event, opportunity) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { data, error } = await supabaseClient
      .from('opportunities')
      .insert(opportunity)
      .select()
      .single();
    if (error) throw error;

    // Also create a recommendation record
    await supabaseClient
      .from('recommendations')
      .insert({
        user_id: DEFAULT_USER_ID,
        opportunity_id: data.id,
        reasoning: opportunity.reasoning,
      });

    // Telegram bildirim tetikle (eşik kontrolü dahil)
    sendOpportunityNotification(data, supabaseClient, DEFAULT_USER_ID).catch((err) =>
      console.error('[Notify] Async send error:', err.message)
    );

    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:get-recommendations', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    const { data, error } = await supabaseClient
      .from('recommendations')
      .select('*, opportunities(*), recommendation_feedback(*)')
      .eq('user_id', DEFAULT_USER_ID)
      .order('presented_at', { ascending: false })
      .limit(options.limit || 20);
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:save-feedback', async (_event, feedback) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { data, error } = await supabaseClient
      .from('recommendation_feedback')
      .insert({ ...feedback, user_id: DEFAULT_USER_ID })
      .select()
      .single();
    if (error) throw error;

    // Update user profile based on feedback outcome
    if (feedback.outcome === 'profit' && feedback.actual_profit) {
      const { error: rpcError } = await supabaseClient.rpc('increment_profit', {
        uid: DEFAULT_USER_ID,
        amount: feedback.actual_profit,
      });
      if (rpcError) {
        // If RPC not available, do manual update
        const { data: profile } = await supabaseClient
          .from('user_profile')
          .select('total_profit, transaction_count')
          .eq('id', DEFAULT_USER_ID)
          .single();
        if (profile) {
          await supabaseClient.from('user_profile').update({
            total_profit: (profile.total_profit || 0) + feedback.actual_profit,
            transaction_count: (profile.transaction_count || 0) + 1,
            updated_at: new Date().toISOString(),
          }).eq('id', DEFAULT_USER_ID);
        }
      }
    }

    // Log profile event
    await supabaseClient.from('profile_events').insert({
      user_id: DEFAULT_USER_ID,
      event_type: 'feedback_received',
      event_data: { outcome: feedback.outcome, profit: feedback.actual_profit },
    });

    // Auto-feed user_index based on feedback outcome
    const indexEntries = [];
    if (feedback.outcome === 'profit') {
      indexEntries.push({
        user_id: DEFAULT_USER_ID,
        entry_type: 'success_signal',
        entry_key: 'feedback_profit_' + (feedback.category || 'general'),
        entry_value: { profit: feedback.actual_profit, category: feedback.category },
        confidence: Math.min(0.9, 0.5 + (feedback.actual_profit || 0) / 10000),
        source: 'auto',
      });
    } else if (feedback.outcome === 'loss') {
      indexEntries.push({
        user_id: DEFAULT_USER_ID,
        entry_type: 'risk_signal',
        entry_key: 'feedback_loss_' + (feedback.category || 'general'),
        entry_value: { loss: feedback.actual_profit, category: feedback.category },
        confidence: 0.7,
        source: 'auto',
      });
    }
    if (feedback.category) {
      indexEntries.push({
        user_id: DEFAULT_USER_ID,
        entry_type: 'preference',
        entry_key: 'category_' + feedback.category.toLowerCase().replace(/\s+/g, '_'),
        entry_value: { category: feedback.category, outcome: feedback.outcome },
        confidence: 0.6,
        source: 'auto',
      });
    }
    if (indexEntries.length > 0) {
      try { await supabaseClient.from('user_index_entries').insert(indexEntries); } catch (_) { /* ignore */ }
    }

    await consolidateUserLearning(supabaseClient, { source: 'ipc:save-feedback' }).catch((err) => {
      console.warn('[DB] Learning consolidation after feedback failed:', err.message);
    });

    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:get-dashboard-stats', async () => {
  if (!supabaseClient) return { status: 'ok', data: null };
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [opps, feedbacks, profile, patterns, watchlists] = await Promise.all([
      supabaseClient.from('opportunities').select('id', { count: 'exact' }).gte('created_at', weekAgo),
      supabaseClient.from('recommendation_feedback').select('outcome, actual_profit').eq('user_id', DEFAULT_USER_ID),
      supabaseClient.from('user_profile').select('*').eq('id', DEFAULT_USER_ID).single(),
      supabaseClient.from('strategy_patterns').select('name, confidence, status').eq('status', 'active').order('confidence', { ascending: false }).limit(5),
      supabaseClient.from('watchlists').select('id', { count: 'exact' }).eq('user_id', DEFAULT_USER_ID).eq('is_active', true),
    ]);

    const fb = feedbacks.data || [];
    const totalProfit = fb.filter(f => f.outcome === 'profit').reduce((s, f) => s + (f.actual_profit || 0), 0);
    const totalLoss = fb.filter(f => f.outcome === 'loss').reduce((s, f) => s + Math.abs(f.actual_profit || 0), 0);

    return {
      status: 'ok',
      data: {
        opportunitiesThisWeek: opps.count || 0,
        totalProfit,
        totalLoss,
        activeWatchlists: watchlists.count || 0,
        topPatterns: patterns.data || [],
        feedbackCount: fb.length,
        profitCount: fb.filter(f => f.outcome === 'profit').length,
        lossCount: fb.filter(f => f.outcome === 'loss').length,
        profile: profile.data,
      },
    };
  } catch (err) {
    return { status: 'error', data: null, error: err.message };
  }
});

ipcMain.handle('db:get-strategy-patterns', async () => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    const { data, error } = await supabaseClient
      .from('strategy_patterns')
      .select('*, strategy_weights(*)')
      .order('confidence', { ascending: false });
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

// ==============================
// IPC: Pattern Extraction & Strategy Weights
// ==============================

ipcMain.handle('patterns:extract', async () => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [feedbacksRes, patternsRes] = await Promise.all([
      supabaseClient.from('recommendation_feedback')
        .select('*, recommendations(*, opportunities(*))')
        .eq('user_id', DEFAULT_USER_ID)
        .gte('created_at', weekAgo),
      supabaseClient.from('strategy_patterns').select('*, strategy_weights(*)'),
    ]);

    const feedbacks = (feedbacksRes.data || []).map(fb => ({
      ...fb,
      category: fb.recommendations?.opportunities?.category || 'diger',
      source: fb.recommendations?.opportunities?.source || 'unknown',
    }));
    const existingPatterns = patternsRes.data || [];

    // 1) Detect new patterns
    const categoryGroups = {};
    for (const fb of feedbacks) {
      const cat = fb.category || 'diger';
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(fb);
    }

    const existingNames = new Set(existingPatterns.map(p => p.name.toLowerCase()));
    const newPatternsToCreate = [];

    for (const [category, fbs] of Object.entries(categoryGroups)) {
      if (fbs.length < 2) continue;
      const profitFbs = fbs.filter(f => f.outcome === 'profit');
      const lossFbs = fbs.filter(f => f.outcome === 'loss');
      if (profitFbs.length < 2 && lossFbs.length < 2) continue;

      const isPositive = profitFbs.length >= lossFbs.length;
      const patternName = isPositive ? `${category}_basarili_trend` : `${category}_riskli_alan`;
      if (existingNames.has(patternName.toLowerCase())) continue;

      const totalProfit = profitFbs.reduce((s, f) => s + (f.actual_profit || 0), 0);
      const avgProfit = profitFbs.length > 0 ? totalProfit / profitFbs.length : 0;

      newPatternsToCreate.push({
        name: patternName,
        description: `${category} kategorisinde ${isPositive ? 'başarılı' : 'riskli'} fırsat trendi`,
        success_count: profitFbs.length,
        fail_count: lossFbs.length,
        avg_profit: Math.round(avgProfit * 100) / 100,
        confidence: Math.min(0.8, (Math.max(profitFbs.length, lossFbs.length) / fbs.length) * 0.6 + 0.2),
        status: profitFbs.length + lossFbs.length >= 3 && profitFbs.length > lossFbs.length ? 'active' : 'on-hold',
        tags: [category.toLowerCase()],
      });
    }

    let createdPatterns = [];
    if (newPatternsToCreate.length > 0) {
      const { data } = await supabaseClient
        .from('strategy_patterns')
        .insert(newPatternsToCreate)
        .select();
      createdPatterns = data || [];

      // Create initial weights for new patterns
      if (createdPatterns.length > 0) {
        const weights = createdPatterns.map(p => ({
          pattern_id: p.id,
          weight: p.status === 'active' ? 0.3 : 0,
          reason: 'Otomatik keşif — ilk ağırlık',
        }));
        try { await supabaseClient.from('strategy_weights').insert(weights); } catch (_) { /* ignore */ }
      }
    }

    // 2) Update existing pattern weights
    const weightUpdates = [];
    for (const pattern of existingPatterns) {
      const patternTags = pattern.tags || [];
      const matchingFbs = feedbacks.filter(fb => {
        const fbCat = (fb.category || '').toLowerCase();
        return patternTags.some(tag => fbCat.includes(tag)) || pattern.name.toLowerCase().includes(fbCat);
      });

      if (matchingFbs.length === 0) continue;

      const profitCount = matchingFbs.filter(f => f.outcome === 'profit').length;
      const lossCount = matchingFbs.filter(f => f.outcome === 'loss').length;
      const successRate = profitCount / matchingFbs.length;

      let weightDelta = 0;
      let reason = '';
      if (successRate >= 0.7) { weightDelta = 0.15; reason = `Yüksek başarı: %${Math.round(successRate * 100)}`; }
      else if (successRate >= 0.5) { weightDelta = 0.05; reason = `Orta başarı: %${Math.round(successRate * 100)}`; }
      else if (successRate < 0.3) { weightDelta = -0.15; reason = `Düşük başarı: %${Math.round(successRate * 100)}`; }
      else { weightDelta = -0.05; reason = `Ortalamanın altı: %${Math.round(successRate * 100)}`; }

      const newSuccessCount = (pattern.success_count || 0) + profitCount;
      const newFailCount = (pattern.fail_count || 0) + lossCount;
      const total = newSuccessCount + newFailCount;
      let newStatus = pattern.status;
      if (total < 3) newStatus = 'on-hold';
      else if (newSuccessCount > newFailCount * 1.5) newStatus = 'active';
      else if (newFailCount > newSuccessCount * 2) newStatus = 'weakened';

      // Update pattern
      await supabaseClient.from('strategy_patterns').update({
        success_count: newSuccessCount,
        fail_count: newFailCount,
        status: newStatus,
        confidence: Math.min(1, Math.max(0, (pattern.confidence || 0) + weightDelta * 0.5)),
        updated_at: new Date().toISOString(),
      }).eq('id', pattern.id);

      // Insert new weight entry for history
      const currentWeight = pattern.strategy_weights?.[0]?.weight || 0;
      const newWeight = Math.min(1, Math.max(-1, currentWeight + weightDelta));
      await supabaseClient.from('strategy_weights').insert({
        pattern_id: pattern.id,
        weight: Math.round(newWeight * 100) / 100,
        reason,
      });

      weightUpdates.push({ patternId: pattern.id, name: pattern.name, weightDelta, newStatus, reason });
    }

    return {
      status: 'ok',
      data: {
        newPatterns: createdPatterns.length,
        updatedPatterns: weightUpdates.length,
        details: { created: createdPatterns.map(p => p.name), updates: weightUpdates },
      },
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('patterns:daily-summary', async () => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [feedbacksRes, patternsRes, oppsRes] = await Promise.all([
      supabaseClient.from('recommendation_feedback')
        .select('outcome, actual_profit, recommendations(opportunities(category, source))')
        .eq('user_id', DEFAULT_USER_ID)
        .gte('created_at', dayAgo),
      supabaseClient.from('strategy_patterns').select('status'),
      supabaseClient.from('opportunities').select('id', { count: 'exact' }).gte('created_at', dayAgo),
    ]);

    const feedbacks = feedbacksRes.data || [];
    const patterns = patternsRes.data || [];

    const categoryStats = {};
    for (const fb of feedbacks) {
      const cat = fb.recommendations?.opportunities?.category || 'diger';
      if (!categoryStats[cat]) categoryStats[cat] = { count: 0, profit: 0, loss: 0 };
      categoryStats[cat].count++;
      if (fb.outcome === 'profit') categoryStats[cat].profit += fb.actual_profit || 0;
      if (fb.outcome === 'loss') categoryStats[cat].loss += Math.abs(fb.actual_profit || 0);
    }

    const topCategory = Object.entries(categoryStats)
      .sort(([, a], [, b]) => (b.profit - b.loss) - (a.profit - a.loss))[0];

    return {
      status: 'ok',
      data: {
        categoryStats,
        topCategory: topCategory ? { name: topCategory[0], ...topCategory[1] } : null,
        patternHealth: {
          active: patterns.filter(p => p.status === 'active').length,
          weakened: patterns.filter(p => p.status === 'weakened').length,
          total: patterns.length,
        },
        opportunitiesToday: oppsRes.count || 0,
        feedbacksToday: feedbacks.length,
        profitToday: feedbacks.filter(f => f.outcome === 'profit').reduce((s, f) => s + (f.actual_profit || 0), 0),
        lossToday: feedbacks.filter(f => f.outcome === 'loss').reduce((s, f) => s + Math.abs(f.actual_profit || 0), 0),
      },
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Dashboard Trend Data (7 günlük)
// ==============================

ipcMain.handle('db:get-trend-data', async () => {
  if (!supabaseClient) return { status: 'ok', data: null };
  try {
    const days = 7;
    const result = { daily: [], categoryBreakdown: {}, patternTrend: [] };

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const [oppsRes, fbRes] = await Promise.all([
        supabaseClient.from('opportunities')
          .select('id', { count: 'exact' })
          .gte('created_at', dayStart.toISOString())
          .lt('created_at', dayEnd.toISOString()),
        supabaseClient.from('recommendation_feedback')
          .select('outcome, actual_profit')
          .eq('user_id', DEFAULT_USER_ID)
          .gte('created_at', dayStart.toISOString())
          .lt('created_at', dayEnd.toISOString()),
      ]);

      const fbs = fbRes.data || [];
      const profit = fbs.filter(f => f.outcome === 'profit').reduce((s, f) => s + (f.actual_profit || 0), 0);
      const loss = fbs.filter(f => f.outcome === 'loss').reduce((s, f) => s + Math.abs(f.actual_profit || 0), 0);

      const dayLabel = dayStart.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' });
      result.daily.push({
        label: dayLabel,
        opportunities: oppsRes.count || 0,
        profit: Math.round(profit),
        loss: Math.round(loss),
        net: Math.round(profit - loss),
        feedbacks: fbs.length,
      });
    }

    // Category breakdown (last 30 days)
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: opps30 } = await supabaseClient
      .from('opportunities')
      .select('category')
      .gte('created_at', monthAgo);

    const catCounts = {};
    for (const opp of (opps30 || [])) {
      catCounts[opp.category || 'diger'] = (catCounts[opp.category || 'diger'] || 0) + 1;
    }
    result.categoryBreakdown = catCounts;

    // Pattern confidence trend (weight history from last 5 entries per pattern)
    const { data: activePatterns } = await supabaseClient
      .from('strategy_patterns')
      .select('id, name, confidence, status, strategy_weights(weight, updated_at)')
      .eq('status', 'active')
      .order('confidence', { ascending: false })
      .limit(5);

    result.patternTrend = (activePatterns || []).map(p => ({
      name: p.name,
      confidence: Math.round((p.confidence || 0) * 100),
      status: p.status,
      weights: (p.strategy_weights || [])
        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
        .slice(-5)
        .map(w => ({ weight: w.weight, date: w.updated_at })),
    }));

    return { status: 'ok', data: result };
  } catch (err) {
    return { status: 'error', data: null, error: err.message };
  }
});

// ==============================
// IPC: System Capabilities (Self-Awareness)
// ==============================

ipcMain.handle('db:get-capabilities', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient.from('system_capabilities').select('*').order('category');
    if (options.status) query = query.eq('status', options.status);
    if (options.category) query = query.eq('category', options.category);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

// ==============================
// IPC: System Conscience — Sprint 7
// ==============================

/** Açık durumdaki capability_gaps listesi */
ipcMain.handle('conscience:check-gaps', async () => {
  if (!supabaseClient) return { status: 'error', data: [], error: 'DB not connected' };
  try {
    const [gapsRes, capsRes] = await Promise.all([
      supabaseClient
      .from('capability_gaps')
      .select('*')
      .eq('status', 'open')
      .order('trigger_count', { ascending: false }),
      supabaseClient
        .from('system_capabilities')
        .select('*'),
    ]);

    if (gapsRes.error) throw gapsRes.error;
    if (capsRes.error) throw capsRes.error;

    const capabilityMap = new Map((capsRes.data || []).map((cap) => [cap.capability_name, cap]));
    const data = (gapsRes.data || []).map((gap) => buildCapabilityGapInsight(gap, capabilityMap.get(gap.capability_name)));
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

/** Eşik aşan gap için otomatik öneri üretimi (3+ tetiklenme) */
ipcMain.handle('conscience:generate-proposal', async (_event, capabilityName) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const TRIGGER_THRESHOLD = 3;
    const WEEKLY_MAX_PROPOSALS = 1;

    // Gap kontrolü
    const { data: gap, error: gapErr } = await supabaseClient
      .from('capability_gaps')
      .select('*')
      .eq('capability_name', capabilityName)
      .single();
    if (gapErr || !gap) return { status: 'error', error: 'Gap bulunamadı: ' + capabilityName };

    const { data: capability } = await supabaseClient
      .from('system_capabilities')
      .select('*')
      .eq('capability_name', capabilityName)
      .maybeSingle();

    const insight = buildCapabilityGapInsight(gap, capability);

    if (gap.trigger_count < TRIGGER_THRESHOLD) {
      return {
        status: 'skipped',
        message: `Henüz eşik aşılmadı (${gap.trigger_count}/${TRIGGER_THRESHOLD})`,
        triggerCount: gap.trigger_count,
        insight,
      };
    }

    // Haftalık max öneri kontrolü
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentProposals } = await supabaseClient
      .from('expansion_proposals')
      .select('id')
      .gte('proposed_at', weekAgo);
    if (recentProposals && recentProposals.length >= WEEKLY_MAX_PROPOSALS) {
      return { status: 'skipped', message: `Haftalık öneri limiti doldu (${recentProposals.length}/${WEEKLY_MAX_PROPOSALS})` };
    }

    // Zaten bu gap için pending öneri var mı?
    const { data: existingProposal } = await supabaseClient
      .from('expansion_proposals')
      .select('id')
      .eq('capability_name', capabilityName)
      .eq('status', 'pending')
      .limit(1);
    if (existingProposal && existingProposal.length > 0) {
      return { status: 'skipped', message: 'Bu yetenek için zaten bekleyen bir öneri var.' };
    }

    // Öneri üret
    const suggestionMap = {
      skyscanner_api: { title: 'Skyscanner API Entegrasyonu', description: 'Uçak bileti fiyat karşılaştırma ve en ucuz tarih bulma.', suggestion: 'Skyscanner Partners API veya Kiwi.com Tequila API eklenirse gerçek uçak bileti fırsatları aranabilir.' },
      booking_api: { title: 'Booking.com API Entegrasyonu', description: 'Otel fiyat düşüşü ve son dakika fırsat takibi.', suggestion: 'Booking.com Demand API ile otel fırsatları otomatik taranabilir.' },
      site_analyzer: { title: 'Site Analyzer Tool', description: 'Herhangi bir web sitesini ziyaret edip içerik analizi yapma.', suggestion: 'Playwright ile URL açıp içerik çekebilecek bir tool eklenirse site analizi yapılabilir.' },
      aliexpress: { title: 'AliExpress Kaynak Adaptörü', description: 'Çinden doğrudan düşük maliyetli ürün bulma.', suggestion: 'AliExpress API veya scraper ile global arbitraj yapılabilir.' },
      amazon: { title: 'Amazon Kaynak Adaptörü', description: 'Amazon Outlet/Warehouse fırsat tarama.', suggestion: 'Amazon Product API veya scraper ile fırsatlar taranabilir.' },
      ebay: { title: 'eBay Kaynak Adaptörü', description: 'Açık artırma ve düşük fiyatlı ürün bulma.', suggestion: 'eBay API ile global fırsatlar taranabilir.' },
    };

    const mapped = suggestionMap[capabilityName] || {
      title: `${capabilityName} Entegrasyonu`,
      description: insight.gap_summary,
      suggestion: [
        insight.missing_reason,
        `Gerekli yapı: ${insight.required_config_summary}`,
        `Bağlam: ${insight.context}`,
      ].filter(Boolean).join(' '),
    };

    const { data: proposal, error: insErr } = await supabaseClient
      .from('expansion_proposals')
      .insert({
        capability_name: capabilityName,
        title: mapped.title,
        description: mapped.description,
        suggestion: mapped.suggestion,
        status: 'pending',
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // Gap'i "proposed" olarak güncelle
    await supabaseClient.from('capability_gaps').update({ status: 'proposed' }).eq('id', gap.id);

    return { status: 'ok', data: { ...proposal, insight } };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

/** Bekleyen genişleme önerilerini listele */
ipcMain.handle('conscience:get-proposals', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('expansion_proposals')
      .select('*')
      .order('proposed_at', { ascending: false });

    if (options.status) query = query.eq('status', options.status);
    query = query.limit(options.limit || 20);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

/** Kullanıcı öneriye cevap verir (accept/reject) */
ipcMain.handle('conscience:respond-proposal', async (_event, proposalId, response, userComment) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    if (!['accepted', 'rejected'].includes(response)) {
      return { status: 'error', error: 'Geçersiz cevap. accepted veya rejected olmalı.' };
    }

    const { data, error } = await supabaseClient
      .from('expansion_proposals')
      .update({
        status: response,
        user_response: userComment || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .select()
      .single();
    if (error) throw error;

    // Kabul edildiyse ilgili gap'i "resolved" yap
    if (response === 'accepted' && data) {
      await supabaseClient.from('capability_gaps')
        .update({ status: 'resolved' })
        .eq('capability_name', data.capability_name);
    }

    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Evolution Engine (Sprint 8)
// ==============================

ipcMain.handle('evolution:get-ddl-log', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('evolution_ddl_log')
      .select('*')
      .order('executed_at', { ascending: false });

    if (options.status) query = query.eq('status', options.status);
    if (options.ddl_type) query = query.eq('ddl_type', options.ddl_type);
    query = query.limit(options.limit || 20);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('evolution:get-log', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('evolution_log')
      .select('*')
      .order('proposed_at', { ascending: false });

    if (options.status) query = query.eq('status', options.status);
    if (options.evolution_type) query = query.eq('evolution_type', options.evolution_type);
    query = query.limit(options.limit || 20);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('evolution:rollback-ddl', async (_event, ddlLogId) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    // Get the DDL log entry
    const { data: entry, error: fetchError } = await supabaseClient
      .from('evolution_ddl_log')
      .select('*')
      .eq('id', ddlLogId)
      .single();

    if (fetchError || !entry) throw new Error('DDL log kaydı bulunamadı.');
    if (!entry.rollback_sql) throw new Error('Bu DDL için rollback SQL mevcut değil.');
    if (entry.status === 'rolled_back') throw new Error('Bu DDL zaten geri alınmış.');

    // Execute rollback SQL via rpc
    const { error: rpcError } = await supabaseClient.rpc('exec_sql', { sql_text: entry.rollback_sql });
    if (rpcError) throw new Error(`Rollback hatası: ${rpcError.message}`);

    // Update status
    await supabaseClient
      .from('evolution_ddl_log')
      .update({ status: 'rolled_back' })
      .eq('id', ddlLogId);

    console.log(`[Evolution] Rollback executed for DDL: ${entry.ddl_type} — ${entry.target_table}`);
    return { status: 'ok', data: { rolledBack: true, ddlType: entry.ddl_type, targetTable: entry.target_table } };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('evolution:get-model-config', async () => {
  const { MODEL_CONFIG, getModelForTask } = require('./ai-service.cjs');
  return { status: 'ok', data: MODEL_CONFIG };
});

ipcMain.handle('evolution:propose-code', async (_event, payload) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { evolutionType, title, description, targetPath } = payload;

    // Log proposal to evolution_log
    const { data, error } = await supabaseClient
      .from('evolution_log')
      .insert({
        evolution_type: evolutionType || 'new_module',
        title: title || 'Untitled evolution',
        description: description || '',
        target_path: targetPath || null,
        status: 'proposed',
        model_used: 'gpt-4o',
      })
      .select()
      .single();

    if (error) throw error;
    console.log(`[Evolution] Code proposal logged: ${title}`);
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('evolution:respond-code', async (_event, logId, response) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const newStatus = response === 'approved' ? 'approved' : 'rejected';

    // Eğer onaylandıysa ve generated_code varsa → dosyaya uygula
    if (newStatus === 'approved') {
      const { data: entry } = await supabaseClient
        .from('evolution_log')
        .select('*')
        .eq('id', logId)
        .single();

      if (entry && entry.target_path && entry.generated_code) {
        const projectRoot = path.resolve(__dirname, '../../..');
        const targetPath = path.resolve(projectRoot, entry.target_path);

        // Güvenlik kontrolü (path.relative tabanlı — kardeş klasör bypass'ı kapalı)
        const { isInsideRoot } = require('./command-guard.cjs');
        if (isInsideRoot(projectRoot, targetPath)) {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // Yedek al
          if (fs.existsSync(targetPath)) {
            fs.copyFileSync(targetPath, targetPath + '.cakal-backup');
          }

          // Patch modu mu yoksa tam dosya mı?
          if (entry.diff_content && entry.diff_content.startsWith('---')) {
            // Patch: diff_content'ten eski ve yeni kodu çıkar
            const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
            const patchLines = entry.diff_content.split('\n');
            const oldBlock = patchLines.filter(l => l.startsWith('--- ')).map(l => l.slice(4)).join('\n');
            if (oldBlock && existing.includes(oldBlock)) {
              const patched = existing.replace(oldBlock, entry.generated_code);
              fs.writeFileSync(targetPath, patched, 'utf-8');
            } else {
              // Fallback: tam dosya yaz
              fs.writeFileSync(targetPath, entry.generated_code, 'utf-8');
            }
          } else {
            // Tam dosya yazma
            fs.writeFileSync(targetPath, entry.generated_code, 'utf-8');
          }

          console.log(`[Evolution] Code applied to: ${entry.target_path}`);
        }
      }
    }

    const { data, error } = await supabaseClient
      .from('evolution_log')
      .update({
        status: newStatus === 'approved' ? 'applied' : 'rejected',
        applied_at: newStatus === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', logId)
      .select()
      .single();

    if (error) throw error;
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Self-Dev — Dosya Okuma/Yazma/Arama/Terminal (UI'dan doğrudan)
// ==============================

ipcMain.handle('selfdev:read-file', async (_event, filePath) => {
  try {
    const projectRoot = path.resolve(__dirname, '../../..');
    const fullPath = path.resolve(projectRoot, filePath);
    if (!require('./command-guard.cjs').isInsideRoot(projectRoot, fullPath)) {
      return { status: 'error', error: 'Proje dışına erişim engellendi' };
    }
    if (!fs.existsSync(fullPath)) {
      return { status: 'error', error: 'Dosya bulunamadı' };
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { status: 'ok', data: { content, lines: content.split('\n').length } };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('selfdev:list-files', async (_event, dirPath = '') => {
  try {
    const projectRoot = path.resolve(__dirname, '../../..');
    const fullPath = path.resolve(projectRoot, dirPath);
    if (!require('./command-guard.cjs').isInsideRoot(projectRoot, fullPath)) {
      return { status: 'error', error: 'Proje dışına erişim engellendi' };
    }
    if (!fs.existsSync(fullPath)) {
      return { status: 'error', error: 'Dizin bulunamadı' };
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = entries
      .filter(e => !['node_modules', '.git', 'dist'].includes(e.name))
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name).replace(/\\/g, '/'),
      }));
    return { status: 'ok', data: files };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('selfdev:run-command', async (_event, command, timeoutMs = 30000) => {
  try {
    const projectRoot = path.resolve(__dirname, '../../..');
    const { execSync } = require('child_process');

    // Güvenlik: allowlist + Windows/PowerShell dahil blocklist (command-guard.cjs)
    const { checkCommand } = require('./command-guard.cjs');
    const guard = checkCommand(command);
    if (!guard.allowed) {
      return { status: 'error', error: `Komut engellendi: ${guard.reason}` };
    }

    const output = execSync(command, {
      cwd: projectRoot,
      timeout: Math.min(timeoutMs, 120000),
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    return { status: 'ok', data: { output: output.substring(0, 5000), exit_code: 0 } };
  } catch (err) {
    return {
      status: 'error',
      data: {
        exit_code: err.status || 1,
        stdout: (err.stdout || '').substring(0, 2000),
        stderr: (err.stderr || '').substring(0, 2000),
      },
      error: err.message.substring(0, 500),
    };
  }
});

ipcMain.handle('selfdev:get-agent-runs', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    let query = supabaseClient
      .from('agent_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(options.limit || 20);

    if (options.agent_name) {
      query = query.eq('agent_name', options.agent_name);
    }
    if (options.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Config Management
// ==============================

ipcMain.handle('config:get', async (_event, key) => {
  // First check local config, then env vars
  const localConfig = loadLocalConfig();
  if (localConfig[key]) return localConfig[key];

  // Only expose safe config keys from env
  const safeKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  if (safeKeys.includes(key)) {
    return process.env[key] || null;
  }
  return null;
});

ipcMain.handle('config:save', async (_event, settings) => {
  try {
    const localConfig = loadLocalConfig();
    Object.assign(localConfig, settings);
    saveLocalConfig(localConfig);

    // If Telegram settings changed, update env for runtime + reconfigure
    if (settings.TELEGRAM_BOT_TOKEN) process.env.TELEGRAM_BOT_TOKEN = settings.TELEGRAM_BOT_TOKEN;
    if (settings.TELEGRAM_CHAT_ID) process.env.TELEGRAM_CHAT_ID = settings.TELEGRAM_CHAT_ID;

    // Telegram'ı runtime'da yeniden yapılandır
    const token = settings.TELEGRAM_BOT_TOKEN || localConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = settings.TELEGRAM_CHAT_ID || localConfig.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      telegram.configure(token, chatId);
      console.log('[Telegram] Reconfigured at runtime');
    }

    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('config:get-all', async () => {
  const localConfig = loadLocalConfig();
  return {
    status: 'ok',
    data: {
      TELEGRAM_BOT_TOKEN: localConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
      TELEGRAM_CHAT_ID: localConfig.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '',
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasPerplexity: !!process.env.PERPLEXITY_API_KEY,
      hasYouTube: !!process.env.YOUTUBE_API_KEY,
      hasSupabase: !!supabaseClient,
      hasTelegram: telegram.isConfigured(),
      hasTelegramReader: telegramReader.isAuthenticated(),
      TELEGRAM_API_ID: localConfig.TELEGRAM_API_ID || '',
      TELEGRAM_API_HASH: localConfig.TELEGRAM_API_HASH || '',
    },
  };
});

// ==============================
// IPC: Secret Broker (trusted UI path, never exposed to LLM tools)
// ==============================

ipcMain.handle('secret:store', async (_event, { name, value }) => {
  try {
    const result = storeSecret(name, value);

    // Otonom entegrasyon: bu secret bir bekleyen isteği karşılıyorsa
    // renderer'a haber ver; ChatScreen [OTOMATİK DEVAM] mesajıyla testi başlatır.
    // Ham secret değeri bu event'te YER ALMAZ.
    try {
      const fulfilled = fulfillSecretRequest(name);
      if (fulfilled?.capabilityName) {
        const win = mainWindow || BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('secret-request-fulfilled', {
            name: fulfilled.name,
            ref: fulfilled.ref,
            capability_name: fulfilled.capabilityName,
            test_input: fulfilled.testInput || null,
          });
        }
      }
    } catch (fulfillErr) {
      console.warn('[SecretBroker] Request fulfill/notify error:', fulfillErr.message);
    }

    return { status: 'ok', data: result };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('secret:requests', async () => {
  try {
    return { status: 'ok', data: listSecretRequests() };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('secret:status', async (_event, name) => {
  try {
    return { status: 'ok', data: { name, ref: `secret:${name}`, stored: hasSecret(name) } };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('secret:list', async () => {
  try {
    return { status: 'ok', data: listSecretRefs() };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Telegram Test & Direct Send
// ==============================

ipcMain.handle('telegram:test', async () => {
  if (!telegram.isConfigured()) {
    return { status: 'error', error: 'Telegram yapılandırılmamış. Bot token ve Chat ID gerekli.' };
  }
  try {
    const sent = await telegram.send('🦊 Çakal Çekirdeği Test', 'Telegram bağlantısı başarılı! Bildirimler aktif.', 'profile-update');
    if (sent) {
      return { status: 'ok', message: 'Test mesajı gönderildi!' };
    } else {
      return { status: 'error', error: 'Mesaj gönderilemedi. Token veya Chat ID yanlış olabilir.' };
    }
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('telegram:send', async (_event, { title, body, type }) => {
  if (!telegram.isConfigured()) {
    return { status: 'error', error: 'Telegram yapılandırılmamış' };
  }
  try {
    const sent = await telegram.send(title, body, type || 'opportunity');

    // Log
    if (supabaseClient) {
      await supabaseClient.from('notification_log').insert({
        user_id: DEFAULT_USER_ID,
        channel: 'telegram',
        notification_type: type || 'opportunity',
        title,
        body,
        delivered: sent,
      }).then(null, () => {});
    }

    return { status: sent ? 'ok' : 'error', error: sent ? undefined : 'Gönderilemedi' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Telegram Channel Reader (MTProto)
// ==============================

ipcMain.handle('telegram-reader:configure', async (_event, { apiId, apiHash }) => {
  try {
    telegramReader.configure(apiId, apiHash);
    // Save to local config
    const cfg = loadLocalConfig();
    cfg.TELEGRAM_API_ID = apiId;
    cfg.TELEGRAM_API_HASH = apiHash;
    saveLocalConfig(cfg);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('telegram-reader:send-code', async (_event, { phone }) => {
  try {
    if (!telegramReader.isConfigured()) {
      return { status: 'error', error: 'API ID ve API Hash ayarlanmamış' };
    }
    const result = await telegramReader.sendCode(phone);
    return { status: 'ok', ...result };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('telegram-reader:verify-code', async (_event, { phone, code, phoneCodeHash }) => {
  try {
    const result = await telegramReader.verifyCode(phone, code, phoneCodeHash);
    return result;
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('telegram-reader:verify-2fa', async (_event, { password }) => {
  try {
    const result = await telegramReader.verify2FA(password);
    return result;
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('telegram-reader:get-channels', async () => {
  try {
    if (!telegramReader.isAuthenticated()) {
      return { status: 'error', error: 'Telegram girişi yapılmamış', data: [] };
    }
    const channels = await telegramReader.getJoinedChannels();
    return { status: 'ok', data: channels };
  } catch (err) {
    return { status: 'error', error: err.message, data: [] };
  }
});

ipcMain.handle('telegram-reader:read-messages', async (_event, { channelId, limit }) => {
  try {
    if (!telegramReader.isAuthenticated()) {
      return { status: 'error', error: 'Telegram girişi yapılmamış', data: [] };
    }
    const messages = await telegramReader.readChannelMessages(channelId, limit || 20);
    return { status: 'ok', data: messages };
  } catch (err) {
    return { status: 'error', error: err.message, data: [] };
  }
});

ipcMain.handle('telegram-reader:search', async (_event, { channelIds, keywords, limit }) => {
  try {
    if (!telegramReader.isAuthenticated()) {
      return { status: 'error', error: 'Telegram girişi yapılmamış', data: [] };
    }
    const results = await telegramReader.searchChannels(channelIds, keywords, limit || 10);
    return { status: 'ok', data: results };
  } catch (err) {
    return { status: 'error', error: err.message, data: [] };
  }
});

ipcMain.handle('telegram-reader:get-saved-channels', async () => {
  return { status: 'ok', data: telegramReader.getSavedChannels() };
});

ipcMain.handle('telegram-reader:save-channel', async (_event, { channelId, title }) => {
  const channels = telegramReader.addChannel(channelId, title);
  return { status: 'ok', data: channels };
});

ipcMain.handle('telegram-reader:remove-channel', async (_event, { channelId }) => {
  const channels = telegramReader.removeChannel(channelId);
  return { status: 'ok', data: channels };
});

ipcMain.handle('telegram-reader:status', async () => {
  return {
    status: 'ok',
    data: {
      configured: telegramReader.isConfigured(),
      authenticated: telegramReader.isAuthenticated(),
      savedChannels: telegramReader.getSavedChannels().length,
    },
  };
});

// ==============================
// IPC: Watchlist Management
// ==============================

ipcMain.handle('db:get-watchlists', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('watchlists')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false });

    if (options.activeOnly !== false) {
      query = query.eq('is_active', true);
    }
    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:add-watchlist', async (_event, watchlist) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { data, error } = await supabaseClient
      .from('watchlists')
      .insert({
        user_id: DEFAULT_USER_ID,
        title: watchlist.title,
        category: watchlist.category || 'general',
        query_keywords: watchlist.keywords || [],
        source_filter: watchlist.sources || null,
        price_min: watchlist.priceMin || null,
        price_max: watchlist.priceMax || null,
      })
      .select()
      .single();
    if (error) throw error;
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('db:remove-watchlist', async (_event, watchlistId) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { error } = await supabaseClient
      .from('watchlists')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', watchlistId)
      .eq('user_id', DEFAULT_USER_ID);
    if (error) throw error;
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Scrape Sources Management
// ==============================

ipcMain.handle('db:get-scrape-sources', async () => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    const { data, error } = await supabaseClient
      .from('scrape_sources')
      .select('*')
      .order('source_name');
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:update-scrape-source', async (_event, sourceId, updates) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const { data, error } = await supabaseClient
      .from('scrape_sources')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('source_id', sourceId)
      .select()
      .single();
    if (error) throw error;
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Notification Log
// ==============================

ipcMain.handle('db:get-notification-log', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('notification_log')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('sent_at', { ascending: false });

    if (options.type) query = query.eq('notification_type', options.type);
    query = query.limit(options.limit || 50);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

// ==============================
// IPC: User Index Entries (Profile Guardian)
// ==============================

ipcMain.handle('db:get-user-index', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('user_index_entries')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false });

    if (options.entry_type) query = query.eq('entry_type', options.entry_type);
    query = query.limit(options.limit || 50);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

ipcMain.handle('db:save-user-index', async (_event, entries) => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };
  try {
    const rows = (Array.isArray(entries) ? entries : [entries]).map((e) => ({
      user_id: DEFAULT_USER_ID,
      entry_type: e.entry_type,
      entry_key: e.entry_key,
      entry_value: e.entry_value || {},
      confidence: e.confidence || 0.5,
      source: e.source || 'auto',
    }));

    const { data, error } = await supabaseClient
      .from('user_index_entries')
      .insert(rows)
      .select();
    if (error) throw error;

    await consolidateUserLearning(supabaseClient, { source: 'ipc:save-user-index' }).catch((err) => {
      console.warn('[DB] Learning consolidation after index save failed:', err.message);
    });
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// ==============================
// IPC: Profile Events
// ==============================

ipcMain.handle('db:get-profile-events', async (_event, options = {}) => {
  if (!supabaseClient) return { status: 'ok', data: [] };
  try {
    let query = supabaseClient
      .from('profile_events')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false });

    if (options.event_type) query = query.eq('event_type', options.event_type);
    query = query.limit(options.limit || 50);

    const { data, error } = await query;
    if (error) throw error;
    return { status: 'ok', data: data || [] };
  } catch (err) {
    return { status: 'error', data: [], error: err.message };
  }
});

// ==============================
// IPC: Weekly Character Report (GPT-4o)
// ==============================

ipcMain.handle('profile:weekly-report', async () => {
  if (!supabaseClient) return { status: 'error', error: 'DB not connected' };

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Gather all data for the week
    const [profileRes, feedbacksRes, oppsRes, indexRes, patternsRes] = await Promise.all([
      supabaseClient.from('user_profile').select('*').eq('id', DEFAULT_USER_ID).single(),
      supabaseClient.from('recommendation_feedback').select('*, recommendations(*, opportunities(*))').eq('user_id', DEFAULT_USER_ID).gte('created_at', weekAgo),
      supabaseClient.from('opportunities').select('*').gte('created_at', weekAgo).order('score', { ascending: false }).limit(50),
      supabaseClient.from('user_index_entries').select('*').eq('user_id', DEFAULT_USER_ID).gte('created_at', weekAgo),
      supabaseClient.from('strategy_patterns').select('*').eq('status', 'active').order('confidence', { ascending: false }).limit(10),
    ]);

    const profile = profileRes.data;
    const feedbacks = feedbacksRes.data || [];
    const opportunities = oppsRes.data || [];
    const indexEntries = indexRes.data || [];
    const patterns = patternsRes.data || [];

    // Build aggregate stats
    const profitFb = feedbacks.filter(f => f.outcome === 'profit');
    const lossFb = feedbacks.filter(f => f.outcome === 'loss');
    const totalProfit = profitFb.reduce((s, f) => s + (f.actual_profit || 0), 0);
    const totalLoss = lossFb.reduce((s, f) => s + Math.abs(f.actual_profit || 0), 0);

    const categoryDist = {};
    for (const opp of opportunities) {
      categoryDist[opp.category] = (categoryDist[opp.category] || 0) + 1;
    }

    const interestKeys = indexEntries
      .filter(e => ['interest', 'preference'].includes(e.entry_type))
      .map(e => e.entry_key);

    // Ask GPT-4o for character analysis
    const OpenAI = require('openai');
    const analysisClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const analysisPrompt = `Sen Çakal Çekirdeği'nin Profile Keeper ajanısın. Kullanıcının haftalık verilerini analiz edip karakter raporu üreteceksin.

KULLANICI PROFİLİ:
- Risk toleransı: ${profile?.risk_tolerance || 'medium'}
- Karar hızı: ${profile?.decision_speed || 'fast'}
- Toplam kâr: ₺${profile?.total_profit || 0}
- İşlem sayısı: ${profile?.transaction_count || 0}
- İlgi alanları: ${(profile?.preferred_domains || []).join(', ') || 'belirsiz'}

BU HAFTA VERİLERİ:
- Fırsat sayısı: ${opportunities.length}
- Geri bildirim sayısı: ${feedbacks.length} (kâr: ${profitFb.length}, zarar: ${lossFb.length})
- Toplam kâr: ₺${totalProfit} | Zarar: ₺${totalLoss} | Net: ₺${totalProfit - totalLoss}
- Kategori dağılımı: ${JSON.stringify(categoryDist)}
- İlgi sinyalleri: ${[...new Set(interestKeys)].join(', ') || 'yok'}
- Aktif patternler: ${patterns.map(p => p.name + ' (%' + Math.round(p.confidence * 100) + ')').join(', ') || 'yok'}

Şu JSON formatında rapor üret (Türkçe):
{
  "characterSummary": "2-3 cümle: Kullanıcının öğrenme eğrisi ve ticaret karakteri",
  "strengths": ["güçlü yan 1", "güçlü yan 2"],
  "improvements": ["geliştirilecek alan 1", "geliştirilecek alan 2"],
  "topCategory": "en başarılı kategori",
  "riskAssessment": "risk toleransı değerlendirmesi (1 cümle)",
  "weeklyScore": 0-100,
  "recommendedActions": ["aksiyon 1", "aksiyon 2"],
  "profileUpdates": {
    "risk_tolerance": null,
    "engagement_score_delta": 0,
    "new_interests": []
  }
}

Sadece JSON döndür, başka açıklama ekleme.`;

    const gptResponse = await analysisClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Sen bir profil analiz ajanısın. Sadece geçerli JSON döndür.' },
        { role: 'user', content: analysisPrompt },
      ],
      temperature: 0.5,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const reportText = gptResponse.choices[0]?.message?.content || '{}';
    let report;
    try {
      report = JSON.parse(reportText);
    } catch {
      report = { characterSummary: reportText, strengths: [], improvements: [], weeklyScore: 50 };
    }

    // Apply profile updates
    const updates = report.profileUpdates || {};
    const profilePatch = {};
    if (updates.risk_tolerance && ['low', 'medium', 'high'].includes(updates.risk_tolerance)) {
      profilePatch.risk_tolerance = updates.risk_tolerance;
    }
    if (updates.engagement_score_delta && profile) {
      profilePatch.engagement_score = Math.min(100, (profile.engagement_score || 0) + updates.engagement_score_delta);
    }
    if (updates.new_interests && updates.new_interests.length > 0 && profile) {
      const existing = profile.preferred_domains || [];
      const merged = [...new Set([...existing, ...updates.new_interests])];
      profilePatch.preferred_domains = merged;
    }

    if (Object.keys(profilePatch).length > 0) {
      await supabaseClient
        .from('user_profile')
        .update({ ...profilePatch, updated_at: new Date().toISOString() })
        .eq('id', DEFAULT_USER_ID);
    }

    // Save report as profile event
    await supabaseClient.from('profile_events').insert({
      user_id: DEFAULT_USER_ID,
      event_type: 'weekly_report',
      event_data: report,
    });

    // Save index entries from GPT analysis
    if (updates.new_interests && updates.new_interests.length > 0) {
      const indexRows = updates.new_interests.map((interest) => ({
        user_id: DEFAULT_USER_ID,
        entry_type: 'interest',
        entry_key: 'gpt_detected_' + interest.toLowerCase().replace(/\s+/g, '_'),
        entry_value: { interest, source: 'weekly_analysis' },
        confidence: 0.7,
        source: 'auto',
      }));
      try { await supabaseClient.from('user_index_entries').insert(indexRows); } catch (_) { /* ignore */ }
    }

    // Telegram ile haftalık rapor gönder
    if (telegram.isConfigured()) {
      const summary = '📊 Haftalık Skor: ' + report.weeklyScore + '/100\n💰 Net: ₺' + (totalProfit - totalLoss) + '\n📦 ' + opportunities.length + ' fırsat incelendi\n\n' + (report.characterSummary || '');
      telegram.send('Haftalık Karakter Raporu', summary, 'weekly-summary').catch(() => {});
    }

    return { status: 'ok', data: report };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});
