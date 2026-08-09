import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import guardsModule from '../apps/desktop/electron/decision-guards.cjs';
import agentsModule from '../apps/desktop/electron/deterministic-agents.cjs';
import pricingModule from '../apps/desktop/electron/earnings-pricing.cjs';

const guards = guardsModule.default ?? guardsModule;
const agents = agentsModule.default ?? agentsModule;
const pricing = pricingModule.default ?? pricingModule;

const {
  evaluateCommanderDecisionGate,
  buildEvidenceLedger,
  hasFreshEvidence,
  TOOL_EVIDENCE_CLASSES,
  EVIDENCE_TTL_MS,
  COMMANDER_MARKET_DATA_TOOLS,
  isCommanderMetaDiscussion,
} = guards;

const here = path.dirname(fileURLToPath(import.meta.url));
const aiSource = fs.readFileSync(path.join(here, '..', 'apps', 'desktop', 'electron', 'ai-service.cjs'), 'utf8');

/**
 * ai-service.cjs Electron'a bağlıdır ve doğrudan import edilemez. Saf
 * yardımcıları KAYNAKTAN izole ediyoruz; böylece test gerçek koda bağlı kalır
 * (kopya değil) ama Electron gerektirmez.
 *
 * Kalıplar sırayla denenir ve TEMBEL eşleşir: `[\s\S]*?` yerine satır başına
 * çapalı kapanış (`^];`, `^});`) kullanılır — aksi halde bir dizi tanımı bir
 * sonrakini de yutup "already been declared" hatası verir.
 */
function loadFromAiService(names) {
  const chunks = names.map((name) => {
    const patterns = [
      new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm'),
      new RegExp(`^const ${name} = Object\\.freeze\\(\\{[\\s\\S]*?^\\}\\);$`, 'm'),
      new RegExp(`^const ${name} = \\[[\\s\\S]*?^\\];$`, 'm'),
      new RegExp(`^const ${name} = [^\\n]*;$`, 'm'),
    ];
    for (const re of patterns) {
      const match = aiSource.match(re);
      if (match) return match[0];
    }
    throw new Error(`ai-service.cjs içinde bulunamadı: ${name}`);
  });
  // eslint-disable-next-line no-new-func
  return new Function(`${chunks.join('\n\n')}\nreturn { ${names.join(', ')} };`)();
}

const ai = loadFromAiService([
  'SOURCE_TIER_PATTERNS',
  'extractDomain',
  'classifySourceTier',
  'summarizeClaimSources',
  'CROSS_SOURCE_PRICE_TOLERANCE_PERCENT',
  'buildCrossSourcePriceCheck',
  'FINANCIAL_KEY_ITEM_PATTERNS',
  'FINANCIAL_KEY_ITEM_PATTERNS_BANK',
  'FINANCIAL_KEY_ITEM_PATTERNS_INSURANCE',
  'FINANCIAL_KEY_ITEM_PATTERNS_REIT',
  'FINANCIAL_KEY_ITEM_PATTERNS_HOLDING',
  'SECTOR_ADAPTERS',
  'detectFinancialSector',
  'extractFinancialKeyItems',
]);

const now = Date.now();
const toolCall = (tool, ageMinutes = 0) => ({ type: 'tool_call', tool, timestamp: now - ageMinutes * 60_000 });

// ══════════════════════════════════════════════════════════════════════
// 1) Onarım tetikleyicisi — 13:59 vakası
// ══════════════════════════════════════════════════════════════════════
describe('onarım tetikleyicisi (P0-1)', () => {
  const ACTIONABLE = 'THYAO için giriş fırsatı var mı, borsa alım yapılır mı?';

  it('araştırma araçları çalışmış ama piyasa verisi yoksa ONARILABİLİR işaretlenir', () => {
    // GEÇMİŞ HATA: main.cjs onarımı usedTools.length===0 şartına bağlıyordu.
    // verify_claim + web_search çalışınca uzunluk 0 olmadığı için tam da
    // onarılması gereken vakada onarım tetiklenmiyordu.
    const gate = evaluateCommanderDecisionGate(ACTIONABLE, 'AL: THYAO', [
      toolCall('verify_claim'),
      toolCall('web_search'),
    ]);

    expect(gate).not.toBeNull();
    expect(gate.status).toBe('veri_yetersiz');
    expect(gate.usedTools.length).toBeGreaterThan(0); // eski koşulun kaçırdığı durum
    expect(gate.repairable).toBe(true);
    expect(gate.missingEvidence).toContain('MARKET_DATA');
  });

  it('hiç araç çalışmadığında da onarılabilir kalır', () => {
    const gate = evaluateCommanderDecisionGate(ACTIONABLE, 'AL: THYAO', []);
    expect(gate.repairable).toBe(true);
    expect(gate.missingEvidence).toContain('MARKET_DATA');
  });

  it('karar teyidi eksikse eksik kanıt sınıfı DECISION_CONFIRMATION olur', () => {
    const gate = evaluateCommanderDecisionGate(ACTIONABLE, 'AL: THYAO', [toolCall('get_stock_price')]);
    expect(gate.status).toBe('no_signal');
    expect(gate.missingEvidence).toContain('DECISION_CONFIRMATION');
    expect(gate.repairable).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2) Kısmi bozma — analiz korunur, hüküm iner
// ══════════════════════════════════════════════════════════════════════
describe('kapı kısmi bozma yapar (P0-2)', () => {
  const ANALYSIS = [
    'THYAO havacılık tarafında güçlü bir yolcu büyümesi gösteriyor.',
    'Yakıt maliyetleri gerilerken birim gelir korunmuş görünüyor.',
    'Sektör genelinde kapasite artışı sürüyor ve rekabet baskısı var.',
    'Karar: AL',
  ].join('\n');

  it('mevcut analizi SİLMEZ, sadece AL/SAT hükmünü indirir', () => {
    const gate = evaluateCommanderDecisionGate(
      'THYAO hissesi alım yapılır mı, giriş fırsatı nasıl?',
      ANALYSIS,
      [toolCall('verify_claim')],
    );

    expect(gate).not.toBeNull();
    // Analiz korunmuş olmalı
    expect(gate.response).toContain('yolcu büyümesi');
    expect(gate.response).toContain('rekabet baskısı');
    // Hüküm inmiş olmalı
    expect(gate.response).toContain('İNCELE');
    expect(gate.response).not.toMatch(/Karar:\s*AL\b/);
    // Kapı kimliği yine görünür
    expect(gate.response).toContain('VERI_YETERSIZ');
  });

  it('ortada anlamlı analiz yoksa eski tam-blok davranışına düşer', () => {
    const gate = evaluateCommanderDecisionGate('THYAO hissesi alım yapılır mı?', 'AL', [toolCall('verify_claim')]);
    expect(gate.response.startsWith('VERI_YETERSIZ')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3) speech_act — eleştiri işlem talebi değildir
// ══════════════════════════════════════════════════════════════════════
describe('konuşma eylemi ayrımı (P0-3)', () => {
  it('hisse kodları ve finans kelimeleri içeren ELEŞTİRİ mesajı kapıyı açmaz', () => {
    const critique = [
      'Önceki analizinde KCHOL için 20 günlük getiriyi %7,88 demişsin ama başka yerde %3 yazıyor.',
      'Ayrıca "iyi giriş fırsatı" dediğin hisselerde hedef fiyat yok. Bu bulguları değerlendir.',
    ].join(' ');

    expect(isCommanderMetaDiscussion(critique)).toBe(true);
    const gate = evaluateCommanderDecisionGate(critique, 'Haklısın, iki araç farklı referans noktası kullanıyor.', []);
    expect(gate).toBeNull();
  });

  it('ChatGPT raporu yapıştırılmış mesaj işlem talebi sayılmaz', () => {
    const msg = 'chatgpt nin şu bulgularını değerlendir: borsa tarafında karar kapısı hatalı çalışıyor, giriş sinyali üretmiyor.';
    const gate = evaluateCommanderDecisionGate(msg, 'Bulguların çoğu doğru; kodda karşılığını buldum.', []);
    expect(gate).toBeNull();
  });

  it('EMNİYET SUPABI: eleştiri gibi görünse de cevapta gerçek AL/SAT varsa kapı yine devreye girer', () => {
    const msg = 'Önceki analizini değerlendir, borsa için alım yapılır mı?';
    const gate = evaluateCommanderDecisionGate(msg, 'Karar: AL — THYAO', []);
    expect(gate).not.toBeNull();
    expect(gate.status).toBe('veri_yetersiz');
  });

  it('gerçek işlem talebi hâlâ kapıyı açar', () => {
    const gate = evaluateCommanderDecisionGate('Bugün trade edilecek 3 hisse ver', 'AL: SISE', []);
    expect(gate).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4) Kanıt sınıfı + TTL + turlar arası taşıma
// ══════════════════════════════════════════════════════════════════════
describe('kanıt defteri (P1-5, P1-6)', () => {
  it('araç adını değil kanıt sınıfını kaydeder', () => {
    const ledger = buildEvidenceLedger([toolCall('get_bist_board')], now);
    expect(hasFreshEvidence(ledger, 'CURRENT_EQUITY_PRICE', now)).toBe(true);
    expect(hasFreshEvidence(ledger, 'LIQUIDITY', now)).toBe(true);
    expect(hasFreshEvidence(ledger, 'INDEX_MEMBERSHIP', now)).toBe(true);
    expect(hasFreshEvidence(ledger, 'FUNDAMENTALS', now)).toBe(false);
  });

  it('ÖNCEKİ TURDA çekilen taze fiyat verisi kapıyı geçirir', () => {
    // 13:32'de veri çekildi, 13:41'de soru soruldu → kanıt hâlâ taze.
    const gate = evaluateCommanderDecisionGate(
      'THYAO hissesi alım yapılır mı?',
      'Karar: İNCELE',
      [toolCall('get_stock_price', 9), toolCall('judge_opportunity', 9)],
    );
    expect(gate).toBeNull();
  });

  it('BAYAT fiyat verisi "araç çalışmadı" değil "kanıt bayat" olarak raporlanır', () => {
    const gate = evaluateCommanderDecisionGate(
      'THYAO hissesi alım yapılır mı?',
      'Karar: AL',
      [toolCall('get_stock_price', 45), toolCall('judge_opportunity', 45)],
    );
    expect(gate).not.toBeNull();
    expect(gate.reason).toMatch(/bayat/i);
    expect(gate.staleEvidence.join(' ')).toContain('CURRENT_EQUITY_PRICE');
  });

  it('bilanço kanıtı fiyattan çok daha uzun yaşar (sınıfa göre TTL)', () => {
    expect(EVIDENCE_TTL_MS.FUNDAMENTALS).toBeGreaterThan(EVIDENCE_TTL_MS.CURRENT_EQUITY_PRICE);
    const ledger = buildEvidenceLedger([toolCall('get_financial_statements', 60 * 24 * 30)], now);
    expect(hasFreshEvidence(ledger, 'FUNDAMENTALS', now)).toBe(true);
  });

  it('piyasa veri aracı kümesi kanıt tablosundan TÜRETİLİR, elle tutulmaz', () => {
    for (const tool of COMMANDER_MARKET_DATA_TOOLS) {
      expect(TOOL_EVIDENCE_CLASSES[tool]).toBeDefined();
    }
    expect(COMMANDER_MARKET_DATA_TOOLS.has('get_bist_board')).toBe(true);
    expect(COMMANDER_MARKET_DATA_TOOLS.has('verify_claim')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5) Sektör adaptörleri — eksik adaptör ELEMEZ
// ══════════════════════════════════════════════════════════════════════
describe('sektör adaptörleri (P1-7)', () => {
  const row = (desc, v1 = 100) => ({ itemCode: desc.slice(0, 6), itemDescTr: desc, value1: v1, value2: v1, value3: v1, value4: v1 });

  it('sigorta şirketini BANKA sanmaz — teknik/prim kalemlerinden tanır', () => {
    const rows = [
      row('Yazılan Primler (Brüt)'), row('Kazanılmış Primler'),
      row('Gerçekleşen Hasarlar'), row('Teknik Bölüm Dengesi'), row('Özkaynaklar'),
    ];
    const detected = ai.detectFinancialSector(rows, 'UFRS', 'ANSGR');
    expect(detected.sector).toBe('INSURANCE');

    const { keyItems } = ai.extractFinancialKeyItems(rows, 'UFRS', 'INSURANCE');
    const keys = keyItems.map((k) => k.key);
    expect(keys).toContain('yazilanPrim');
    expect(keys).toContain('teknikBolumDengesi');
  });

  it('banka tablosu hâlâ banka olarak tanınır', () => {
    const rows = [row('Net Faiz Geliri'), row('Mevduat'), row('Aktif Toplamı'), row('XVI. Özkaynaklar')];
    expect(ai.detectFinancialSector(rows, 'UFRS', 'GARAN').sector).toBe('BANK');
  });

  it('GYO ve holding sektöre özgü kalemleriyle tanınır', () => {
    const reitRows = [row('Yatırım Amaçlı Gayrimenkuller'), row('Toplam Varlıklar'), row('Özkaynaklar')];
    expect(ai.detectFinancialSector(reitRows, 'XI_29', 'ISGYO').sector).toBe('REIT');

    const holdingRows = [row('Özkaynak Yöntemiyle Değerlenen Yatırımlar'), row('Toplam Varlıklar')];
    expect(ai.detectFinancialSector(holdingRows, 'XI_29', 'KCHOL').sector).toBe('HOLDING');
  });

  it('sektör kalemi bulunamasa bile GENEL kalemler yine çıkar (şirket elenmez)', () => {
    // Sektör GYO tespit edildi ama tabloda GYO kalemi yok: taban set çalışmalı.
    const rows = [row('Hasılat'), row('Brüt Kar'), row('Toplam Varlıklar'), row('Özkaynaklar')];
    const { keyItems } = ai.extractFinancialKeyItems(rows, 'XI_29', 'REIT');
    const keys = keyItems.map((k) => k.key);
    expect(keys).toContain('hasilat');
    expect(keys).toContain('ozkaynaklar');
    expect(keyItems.length).toBeGreaterThan(0);
  });

  it('sanayi şirketi varsayılan yolda kalır', () => {
    const rows = [row('Satış Gelirleri'), row('Brüt Kar'), row('Toplam Varlıklar')];
    expect(ai.detectFinancialSector(rows, 'XI_29', 'TUPRS').sector).toBe('INDUSTRIAL');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6) Kaynak otoritesi — sayı ≠ doğrulama
// ══════════════════════════════════════════════════════════════════════
describe('kaynak güveni (P1-8)', () => {
  it('aynı alan adından gelen 20 atıf 20 bağımsız kaynak sayılmaz', () => {
    const citations = Array.from({ length: 20 }, (_, i) => `https://ornekhaber.com/haber-${i}`);
    const summary = ai.summarizeClaimSources(citations);
    expect(summary.totalCitations).toBe(20);
    expect(summary.uniqueDomains).toBe(1);
    expect(summary.dominantDomainWarning).toMatch(/tek alan adından/);
  });

  it('resmî kaynak varlığı kaynak güvenini yükseltir', () => {
    const summary = ai.summarizeClaimSources(['https://www.kap.org.tr/bildirim/123', 'https://ornekhaber.com/x']);
    expect(summary.tiers.official).toBe(1);
    expect(summary.sourceConfidence).toBe('high');
    expect(summary.hasOfficialSource).toBe(true);
  });

  it('yalnız sosyal/video kaynağı düşük güvenle etiketlenir, atılmaz', () => {
    const summary = ai.summarizeClaimSources(['https://www.youtube.com/watch?v=a', 'https://x.com/biri/status/1']);
    expect(summary.sourceConfidence).toBe('low');
    expect(summary.uniqueDomains).toBe(2);
    expect(summary.tiers.social).toBe(2);
  });

  it('www öneki ve alt yollar aynı alan adına indirgenir', () => {
    expect(ai.extractDomain('https://www.kap.org.tr/a/b')).toBe('kap.org.tr');
    expect(ai.classifySourceTier('isyatirim.com.tr')).toBe('primaryFinance');
    expect(ai.classifySourceTier('youtube.com')).toBe('social');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7) Çapraz kaynak fiyat tutarlılığı
// ══════════════════════════════════════════════════════════════════════
describe('çapraz kaynak fiyat kontrolü (Mynet ↔ Yahoo)', () => {
  it('tolerans içindeki fark UZLAŞMA sayılır', () => {
    const check = ai.buildCrossSourcePriceCheck({ price: 100 }, 101);
    expect(check.status).toBe('AGREE');
    expect(check.deviationPercent).toBe(1);
  });

  it('tolerans dışındaki fark AÇIKÇA çelişki olarak işaretlenir', () => {
    const check = ai.buildCrossSourcePriceCheck({ price: 100 }, 112);
    expect(check.status).toBe('DIVERGENT');
    expect(check.deviationPercent).toBe(12);
    expect(check.note).toMatch(/sapma/);
  });

  it('tek kaynak varsa sahte uzlaşma üretmez', () => {
    expect(ai.buildCrossSourcePriceCheck(null, 100).status).toBe('SINGLE_SOURCE');
    expect(ai.buildCrossSourcePriceCheck({ price: 100 }, null).status).toBe('SINGLE_SOURCE');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8) Fiyatlanma etiketleri — ölçülen şeyi söylüyor
// ══════════════════════════════════════════════════════════════════════
describe('fiyatlanma etiketleri (P2-9)', () => {
  it('etiketler fiyat UZAMASI ailesindedir', () => {
    expect(pricing.PRICING_CLASSIFICATIONS).toContain('PRICE_EXTENDED');
    expect(pricing.PRICING_CLASSIFICATIONS).toContain('NOT_EXTENDED');
    expect(pricing.PRICING_CLASSIFICATIONS).not.toContain('LARGELY_PRICED');
  });

  it('eski adlar için geriye dönük eşleme korunur', () => {
    expect(pricing.LEGACY_PRICING_CLASSIFICATION_ALIASES.LARGELY_PRICED).toBe('PRICE_EXTENDED');
    expect(pricing.LEGACY_PRICING_CLASSIFICATION_ALIASES.LOW_EVIDENCE_OF_PRICING).toBe('NOT_EXTENDED');
  });

  it('konsensüs yokken "bilanço fiyatlandı" hükmü ÜRETİLMEZ', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      close: 100 + i * 2,
      volume: 1_000_000,
    }));
    const result = pricing.assessEarningsPricing({ symbol: 'TEST', bars, indexBars: bars, announcementDate: null });
    expect(result.earningsPricedIn.verdict).toBe('UNKNOWN');
    expect(result.expectationSurprise).toBe('UNKNOWN');
    expect(result.classificationMeaning).toMatch(/Beklenti\/konsensüs GİRDİ DEĞİLDİR/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9) Workflow policy — beyan değil provenance
// ══════════════════════════════════════════════════════════════════════
describe('araştırma workflow provenance (P2-son)', () => {
  it('araç kanıtı olmadan beyan edilen state BLOKLAR', () => {
    const result = agents.runDeterministicAgent('finance', {
      action: 'evaluate_research_workflow',
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: ['RESEARCH_CHARTER_CREATED', 'SOURCE_PLAN_CREATED', 'DEEP_DIVE_RESEARCH', 'VALUATION_ANALYSIS', 'RISK_ANALYSIS', 'RED_TEAM_REVIEW', 'EVIDENCE_VALIDATION', 'REPORT_READY'],
      activityEvents: [], // hiçbir araç çalışmadı
    });

    expect(result.validation.passed).toBe(false);
    const reasons = result.validation.blockingReasons.join(' | ');
    expect(reasons).toMatch(/VALUATION_ANALYSIS/);
    expect(reasons).toMatch(/arac kaniti yok/);
  });

  it('gerçekten çalışmış araçlar state\'i doğrular', () => {
    const result = agents.runDeterministicAgent('finance', {
      action: 'evaluate_research_workflow',
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: ['RESEARCH_CHARTER_CREATED', 'SOURCE_PLAN_CREATED', 'DEEP_DIVE_RESEARCH', 'VALUATION_ANALYSIS', 'RISK_ANALYSIS', 'RED_TEAM_REVIEW', 'EVIDENCE_VALIDATION', 'REPORT_READY'],
      activityEvents: [
        toolCall('get_financial_statements'),
        toolCall('verify_claim'),
        toolCall('analyze_finance_signal'),
      ],
      mandate: { riskTolerance: 'medium' },
    });

    expect(result.provenance.attestedStates).toContain('VALUATION_ANALYSIS');
    expect(result.provenance.attestedStates).toContain('EVIDENCE_VALIDATION');
    expect(result.validation.passed).toBe(true);
  });

  it('araçla kanıtlanamayan state\'ler "beyandır" diye uyarılır, gizlenmez', () => {
    const result = agents.runDeterministicAgent('finance', {
      action: 'evaluate_research_workflow',
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: ['RESEARCH_CHARTER_CREATED', 'SOURCE_PLAN_CREATED', 'DEEP_DIVE_RESEARCH', 'VALUATION_ANALYSIS', 'RISK_ANALYSIS', 'RED_TEAM_REVIEW', 'EVIDENCE_VALIDATION', 'REPORT_READY'],
      activityEvents: [toolCall('get_financial_statements'), toolCall('verify_claim'), toolCall('judge_opportunity')],
      mandate: { riskTolerance: 'medium' },
    });

    expect(result.provenance.selfDeclaredStates).toContain('RED_TEAM_REVIEW');
    expect(result.validation.warnings.join(' ')).toMatch(/yalnizca beyandir/);
  });
});
