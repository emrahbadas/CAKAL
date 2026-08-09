// Regresyon matrisinden çıkan alan sınıflandırma açıkları.
// Farklı sorgu sınıflarının birbirini zehirlememesi test edilir.
import { describe, it, expect } from 'vitest';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const {
  isCommanderFinanceMessage,
  isCommanderProductMarketplaceMessage,
  isCommanderActionableFinanceRequest,
  containsBistTicker,
} = guards;
const { requiresResearchContract } = contract;

describe('Hisse kodu finans bağlamıdır', () => {
  it('REGRESYON — "THYAO bugün alınır mı?" finans sayılır ve işlem niyeti görülür', () => {
    // Canlı matriste bu mesaj finans sayılmıyordu; karar kapısı, işlem
    // kontrolü ve sözleşme HİÇBİRİ çalışmadı. Cevabın iyi çıkması modelin
    // kendi disiplinine kalmıştı.
    const m = 'THYAO bugün alınır mı?';
    expect(isCommanderFinanceMessage(m)).toBe(true);
    expect(isCommanderActionableFinanceRequest(m)).toBe(true);
  });

  it('çıplak kod tek başına yeterli', () => {
    expect(containsBistTicker('ASELS')).toBe(true);
    expect(containsBistTicker('KCHOL ne durumda')).toBe(true);
  });

  it('yaygın büyük harfli sözcükler hisse sanılmaz', () => {
    for (const s of ['Merhaba, nasılsın?', 'TAMAM olur', 'EVET lütfen', 'Bugün günlerden ne?']) {
      expect(isCommanderFinanceMessage(s), s).toBe(false);
    }
  });

  it('borsa adları hisse kodu sayılmaz', () => {
    expect(containsBistTicker('BIST nedir')).toBe(false);
    expect(containsBistTicker('ENDEKS durumu')).toBe(false);
  });
});

describe('Pazaryeri istisnası finans bağlamını ezemez', () => {
  it('REGRESYON — "BIST\'te fırsat ara" pazaryeri DEĞİLDİR', () => {
    // "fırsat ara" kalıbı tüm finans karar kapılarını atlatıyordu; sistem
    // sekiz hisselik sıralama üretti ve hiçbir kapı bakmadı.
    const m = "BIST'te fırsat ara";
    expect(isCommanderProductMarketplaceMessage(m)).toBe(false);
    expect(isCommanderFinanceMessage(m)).toBe(true);
  });

  it('hisse kodu geçen fırsat sorgusu da pazaryeri değildir', () => {
    expect(isCommanderProductMarketplaceMessage('THYAO fırsat ara')).toBe(false);
  });

  it('gerçek pazaryeri sorgusu korunur', () => {
    for (const s of ['Sahibinden araba fırsatı ara', 'Trendyol telefon ilanı', 'letgo laptop fırsat ara']) {
      expect(isCommanderProductMarketplaceMessage(s), s).toBe(true);
      expect(isCommanderFinanceMessage(s), s).toBe(false);
    }
  });
});

describe('Sorgu sınıfları birbirini zehirlemez', () => {
  const cases = [
    ['USD/TRY kaç?', { finance: true, contract: false }],
    ['Bitcoin bugün nasıl?', { finance: true, contract: false }],
    ['Altın ne durumda?', { finance: true, contract: false }],
    ['Önceki analiz neden eksikti?', { finance: false, contract: false }],
    ['Bugün günlerden ne?', { finance: false, contract: false }],
    ['Merhaba, nasılsın?', { finance: false, contract: false }],
    ["THYAO, ASELS ve KCHOL'ü karşılaştır ve en iyi 3'ü sırala", { finance: true, contract: true }],
  ];

  for (const [msg, expected] of cases) {
    it(`"${msg}" → finans:${expected.finance} sözleşme:${expected.contract}`, () => {
      expect(isCommanderFinanceMessage(msg)).toBe(expected.finance);
      expect(requiresResearchContract(msg).required).toBe(expected.contract);
    });
  }

  it('REGRESYON — hisse işlem kararı tek başına sözleşme açar', () => {
    // "THYAO bugün alınır mı?" skor 3 ile eşiğin altında kalıyordu; sözleşme
    // açılmadı ve get_valuation_multiples hiç çağrılmadı.
    const r = requiresResearchContract('THYAO bugün alınır mı?');
    expect(r.required).toBe(true);
    expect(r.signals).toContain('hisse islem karari');
  });

  it('döviz işlem sorusu sözleşme AÇMAZ — duvar üretmesin', () => {
    // investable_candidate MARKET_SESSION_STATUS istiyor; tek üreticisi
    // get_bist_board (BIST'e özgü). Döviz için sözleşme tatmin edilemezdi.
    expect(requiresResearchContract('USD/TRY alınır mı?').required).toBe(false);
  });

  it('bilgi sorusu işlem sorusundan ayrılır', () => {
    expect(requiresResearchContract('THYAO kaç TL?').required).toBe(false);
    expect(requiresResearchContract('THYAO bilançosu nasıl?').required).toBe(false);
  });

  it('basit sorgular sözleşme eşiğini aşmaz — gereksiz plan turu yok', () => {
    for (const s of ['USD/TRY kaç?', 'Bitcoin bugün nasıl?', 'THYAO kaç TL?']) {
      expect(requiresResearchContract(s).score, s).toBeLessThan(4);
    }
  });
});
