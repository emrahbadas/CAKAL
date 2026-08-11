import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const { buildActionLedger, distillToolFacts } = aiService;

/**
 * ARACIN ADI DEĞİL, GETİRDİĞİ ŞEY KAYDEDİLİR.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026): sanitizeConversationHistory tool mesajlarını
 * siliyor; yerine geçen işlem kaydı yalnız araç adı + OK/HATA yazıyordu.
 * Sonraki turda model "BRSAN mali tablosunu çektim" biliyor ama HANGİ DÖNEMİ
 * çektiğini bilmiyordu — 2Ç26 haberini görüp 2026/3 rakamlarıyla karşılaştırma
 * yaptı ve çelişkiyi fark etmedi.
 *
 * Ayrıca get_valuation_multiples eksik girdiyle bile success:true döndüğü için
 * kayıtta "OK" yazıyordu; model değerlemeyi yapılmış sanıyordu.
 */

const finansal = {
  tool: 'get_financial_statements',
  args: { symbol: 'BRSAN' },
  success: true,
  result: {
    success: true,
    source: 'is_yatirim_malitablo',
    data: {
      latestPeriod: '2026/3',
      periods: ['2026/3', '2025/12', '2025/9', '2025/6'],
      netKar: 273620000,
      ozkaynak: 39380000000,
    },
  },
};

const degerleme = {
  tool: 'get_valuation_multiples',
  args: { symbol: 'BRSAN' },
  success: true,
  result: { success: true, data: { price: 632, missingInputs: ['net kâr', 'özkaynak'] } },
};

const pano = {
  tool: 'get_bist_board',
  args: { symbols: 'BRSAN, MEYSU, XU100' },
  success: true,
  result: { success: true, data: { count: 2, notFound: ['XU100'] } },
};

const blokeTarama = {
  tool: 'run_investment_research_scan',
  args: {},
  success: true,
  result: { success: true, status: 'BLOCKED', data: {} },
};

describe('distillToolFacts — maddi içerik', () => {
  it('dönem ve dönem listesi kayda girer', () => {
    const facts = distillToolFacts(finansal.result);
    expect(facts).toContain('dönem=2026/3');
    expect(facts).toContain('2025/6');
  });

  it('değerler kayda girer', () => {
    const facts = distillToolFacts(finansal.result);
    expect(facts).toContain('netKâr=273620000');
    expect(facts).toContain('özkaynak=39380000000');
  });

  it('asOf kaydedilir — "bugünün fiyatı mı kapanış mı" sorusu için', () => {
    const facts = distillToolFacts({ success: true, data: { price: 12.09, asOf: '2026-08-11T16:10:00Z' } });
    expect(facts).toContain('asOf=2026-08-11T16:10:00Z');
  });

  it('eksik girdiler kayda girer', () => {
    expect(distillToolFacts(degerleme.result)).toContain('EKSİK_GİRDİ=net kâr,özkaynak');
  });

  it('bulunamayan semboller kayda girer', () => {
    expect(distillToolFacts(pano.result)).toContain('BULUNAMADI=XU100');
  });

  it('içerik yoksa null döner (kaydı gereksiz şişirme)', () => {
    expect(distillToolFacts({ success: true })).toBeNull();
    expect(distillToolFacts(null)).toBeNull();
  });
});

describe('işlem kaydı durumu — "OK" yalanı bitti', () => {
  it('eksik girdiyle dönen araç KISMİ işaretlenir, OK değil', () => {
    const kayit = buildActionLedger([degerleme]);
    expect(kayit).toContain('get_valuation_multiples [KISMİ]');
    expect(kayit).not.toContain('get_valuation_multiples [OK]');
  });

  it('BLOCKED dönen araç BLOKE işaretlenir', () => {
    expect(buildActionLedger([blokeTarama])).toContain('run_investment_research_scan [BLOKE]');
  });

  it('sembol düşüren araç KISMİ işaretlenir', () => {
    expect(buildActionLedger([pano])).toContain('get_bist_board [KISMİ]');
  });

  it('gerçekten başarılı araç OK kalır', () => {
    expect(buildActionLedger([finansal])).toContain('get_financial_statements [OK]');
  });

  it('success:false hâlâ HATA', () => {
    const kayit = buildActionLedger([{ tool: 'get_stock_price', args: {}, success: false }]);
    expect(kayit).toContain('[HATA]');
  });
});

describe('işlem kaydı başlığı modele ne yapacağını söyler', () => {
  it('KISMİ/BLOKE araçlarda hüküm kurulmaması yazılı', () => {
    const kayit = buildActionLedger([degerleme]);
    expect(kayit).toContain('İSTENEN VERİYİ GETİRMEMİŞTİR');
    expect(kayit).toContain('hüküm kurma');
  });

  it('boş liste kayıt üretmez', () => {
    expect(buildActionLedger([])).toBeNull();
  });
});
