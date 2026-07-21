import { describe, expect, it } from 'vitest';
import aiService from '../apps/desktop/electron/ai-service.cjs';
import scraper from '../apps/desktop/electron/scraper.cjs';

const {
  buildToolResultPreview,
  buildChinaListingsFromPerplexity,
  determineOpportunitySources,
  hasChinaSourcingIntent,
  isTrendyolCampaignQuery,
  mergeRuntimeCapabilityOverrides,
  prioritizeTrendyolCampaignListings,
} = aiService;

describe('marketplace scraper capabilities', () => {
  it('exposes second-hand scraper adapter for Letgo/Dolap routing', () => {
    expect(typeof scraper.scrapeSecondHand).toBe('function');
  });

  it('detects and prioritizes Trendyol campaign listings', () => {
    expect(isTrendyolCampaignQuery('telefon indirim kampanya')).toBe(true);
    expect(isTrendyolCampaignQuery('normal telefon ara')).toBe(false);

    const sorted = prioritizeTrendyolCampaignListings([
      { title: 'Normal urun', price: 100, originalPrice: null, discount: null },
      { title: 'Sepette indirimli urun', price: 80, originalPrice: 100, discount: '%20' },
      { title: 'Daha iyi kampanya', price: 70, originalPrice: 100, discount: '%30' },
    ], { query: 'indirim kampanya' });

    expect(sorted.map((item) => item.title)).toEqual(['Daha iyi kampanya', 'Sepette indirimli urun']);
  });

  it('routes vehicle market valuation away from Trendyol and Letgo product scrapers', () => {
    const sources = determineOpportunitySources('Volvo XC40 2020 model 2. el piyasa değeri Türkiye ilanları', {
      source: 'all',
      category: 'araba',
    });

    expect(sources).toEqual(['sahibinden', 'perplexity']);
    expect(sources).not.toContain('trendyol');
    expect(sources).not.toContain('letgo');
  });

  it('keeps second-hand product routing for non-vehicle marketplace searches', () => {
    const sources = determineOpportunitySources('ikinci el iphone 13 uygun fiyat', {
      source: 'all',
      category: 'elektronik',
    });

    expect(sources).toContain('trendyol');
    expect(sources).toContain('letgo');
    expect(sources).toContain('akakce');
  });

  it('does not treat Turkish icin as China sourcing intent in backend source planning', () => {
    expect(hasChinaSourcingIntent('hisseler icin ne dersin')).toBe(false);
    expect(hasChinaSourcingIntent('hisseler için ne dersin')).toBe(false);
    expect(hasChinaSourcingIntent('Cin pazari icin tedarikci ara')).toBe(true);
  });

  it('shows Perplexity source and citation count in tool result previews', () => {
    const preview = buildToolResultPreview({
      tool: 'web_search',
      success: true,
      source: 'perplexity',
      data: {
        success: true,
        content: 'Volvo XC40 piyasa fiyatı araştırma sonucu.',
        citations: ['https://example.com/one', 'https://example.com/two'],
      },
    });

    expect(preview).toContain('source=perplexity');
    expect(preview).toContain('citations=2');
  });

  it('builds China marketplace listings without the old round helper crash', () => {
    const listings = buildChinaListingsFromPerplexity(
      '- Sample supplier | $2.50 MOQ 100 https://example.com/item\n- 1688 item ¥12.4 https://example.cn/item',
      'alibaba',
      'telefon standi',
      [],
      { fxUsdTry: 40, fxCnyTry: 5 },
    );

    expect(listings).toHaveLength(2);
    expect(listings[0].price).toBe(100);
    expect(listings[1].price).toBe(62);
  });

  it('overrides stale DB missing statuses for marketplace scanners at runtime', () => {
    const capabilities = mergeRuntimeCapabilityOverrides([
      { capability_name: 'sahibinden_scan', status: 'missing', description: 'old', required_config: { tool: 'playwright' } },
      { capability_name: 'trendyol_scan', status: 'missing', description: 'old', required_config: { tool: 'playwright' } },
      { capability_name: 'letgo_scan', status: 'missing', description: 'old', required_config: { tool: 'playwright' } },
    ]);

    expect(capabilities.filter((capability) => capability.status === 'active').map((capability) => capability.capability_name)).toEqual([
      'sahibinden_scan',
      'trendyol_scan',
      'letgo_scan',
    ]);
  });
});