import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';
import { safeScrape, extractUrgencyHints } from '../../base/src/scraper-utils';
import type { Page } from 'playwright';

/**
 * Trendyol Source Adapter
 *
 * İndirim takibi, flash kampanyalar, fiyat karşılaştırma.
 * API mevcut değil — Playwright ile headless tarama.
 * Sahibinden'den daha az agresif koruma → 2-6 sn gecikme yeterli.
 */

const BASE_URL = 'https://www.trendyol.com';

// Trendyol kategori haritası
const CATEGORY_MAP: Record<string, string> = {
  elektronik: 'elektronik',
  giyim: 'giyim',
  'ev-esyasi': 'ev-yasam',
  diger: '',
};

export class TrendyolAdapter implements SourceAdapter {
  readonly id = 'trendyol';
  readonly name = 'Trendyol';
  readonly type = 'scrape' as const;
  readonly active = true;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[Trendyol] Search: "${query}"`, options);

    const result = await safeScrape<SourceSignal[]>(this.id, async (page: Page) => {
      // Trendyol search URL formatı
      const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
      let searchUrl = `${BASE_URL}/sr?q=${encodedQuery}`;

      // Fiyat filtresi
      if (options?.minPrice) searchUrl += `&fltr=${options.minPrice}`;
      if (options?.maxPrice) searchUrl += `-${options.maxPrice}TL`;

      // Sıralama
      if (options?.sortBy === 'price-asc') searchUrl += '&sst=PRICE_BY_ASC';
      else if (options?.sortBy === 'price-desc') searchUrl += '&sst=PRICE_BY_DESC';
      else if (options?.sortBy === 'date') searchUrl += '&sst=MOST_RECENT';

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Ürün listesinin yüklenmesini bekle
      await page.waitForSelector('.p-card-wrppr', { timeout: 10000 }).catch(() => null);

      // Ürün kartlarını çek
      const listings = await page.$$eval(
        '.p-card-wrppr',
        (cards) =>
          cards.slice(0, 20).map((card) => {
            const titleEl = card.querySelector('.prdct-desc-cntnr-ttl-w span') as HTMLElement;
            const brandEl = card.querySelector('.prdct-desc-cntnr-name') as HTMLElement;
            const priceEl = card.querySelector('.prc-box-dscntd') as HTMLElement;
            const origPriceEl = card.querySelector('.prc-box-orgnl') as HTMLElement;
            const linkEl = card.querySelector('a') as HTMLAnchorElement;
            const imgEl = card.querySelector('img') as HTMLImageElement;
            const ratingEl = card.querySelector('.ratingScore span') as HTMLElement;
            const campaignEl = card.querySelector('.campaign-badge') as HTMLElement;

            const parsePrice = (text: string | null): number => {
              if (!text) return 0;
              return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
            };

            return {
              title: `${brandEl?.textContent?.trim() || ''} ${titleEl?.textContent?.trim() || ''}`.trim(),
              price: parsePrice(priceEl?.textContent),
              originalPrice: parsePrice(origPriceEl?.textContent),
              url: linkEl?.href || '',
              imageUrl: imgEl?.src || imgEl?.getAttribute('data-src') || '',
              rating: ratingEl?.textContent?.trim() || '',
              campaign: campaignEl?.textContent?.trim() || '',
            };
          }),
      );

      // SourceSignal formatına çevir
      const signals: SourceSignal[] = listings
        .filter((l) => l.title && l.url)
        .map((l) => {
          const fullUrl = l.url.startsWith('http') ? l.url : `${BASE_URL}${l.url}`;

          // İndirim yüzdesi hesapla
          const discountPercent =
            l.originalPrice && l.price && l.originalPrice > l.price
              ? Math.round(((l.originalPrice - l.price) / l.originalPrice) * 100)
              : 0;

          const descParts: string[] = [];
          if (discountPercent > 0) descParts.push(`%${discountPercent} indirim`);
          if (l.campaign) descParts.push(l.campaign);
          if (l.rating) descParts.push(`⭐ ${l.rating}`);
          const description = descParts.join(' | ') || undefined;

          return {
            sourceId: 'trendyol',
            sourceName: 'Trendyol',
            title: l.title,
            description,
            price: l.price || undefined,
            originalPrice: l.originalPrice || undefined,
            currency: 'TRY',
            url: fullUrl,
            imageUrl: l.imageUrl || undefined,
            category: options?.category,
            urgencyHints: extractUrgencyHints(`${l.title} ${l.campaign || ''}`),
            rawData: {
              discountPercent,
              rating: l.rating,
              campaign: l.campaign,
            },
            fetchedAt: new Date().toISOString(),
          };
        });

      const maxResults = options?.maxResults ?? 10;
      return signals.slice(0, maxResults);
    });

    if (result.error) {
      console.error(`[Trendyol] Search failed: ${result.error}`);
      return [];
    }

    return result.data || [];
  }

  async healthCheck(): Promise<boolean> {
    const result = await safeScrape<boolean>(this.id, async (page: Page) => {
      const resp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return resp !== null && resp.status() < 400;
    });
    return result.data ?? false;
  }
}
