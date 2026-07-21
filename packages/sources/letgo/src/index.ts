import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';
import { safeScrape, extractUrgencyHints } from '../../base/src/scraper-utils';
import type { Page } from 'playwright';

/**
 * Letgo / Dolap Source Adapter
 *
 * Kişisel satışlar, acil satışlar.
 * Dolap.com üzerinden ikinci el giyim + aksesuar taraması.
 * Orta seviye koruma → 3-7 sn gecikme.
 */

const BASE_URL = 'https://www.dolap.com';

export class LetgoAdapter implements SourceAdapter {
  readonly id = 'letgo';
  readonly name = 'Letgo/Dolap';
  readonly type = 'scrape' as const;
  readonly active = true;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[Letgo/Dolap] Search: "${query}"`, options);

    const result = await safeScrape<SourceSignal[]>(this.id, async (page: Page) => {
      // Dolap arama URL'si
      const encodedQuery = encodeURIComponent(query);
      let searchUrl = `${BASE_URL}/arama?q=${encodedQuery}`;

      // Fiyat filtresi
      if (options?.minPrice) searchUrl += `&price_min=${options.minPrice}`;
      if (options?.maxPrice) searchUrl += `&price_max=${options.maxPrice}`;

      // Sıralama
      if (options?.sortBy === 'price-asc') searchUrl += '&sort=price_asc';
      else if (options?.sortBy === 'price-desc') searchUrl += '&sort=price_desc';
      else if (options?.sortBy === 'date') searchUrl += '&sort=newest';

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Ürün kartlarını bekle
      await page.waitForSelector('[class*="product-card"], [class*="ProductCard"]', { timeout: 10000 }).catch(() => null);

      // Ürünleri çek — Dolap CSS selector'ları
      const listings = await page.$$eval(
        '[class*="product-card"], [class*="ProductCard"], .search-result-item',
        (cards) =>
          cards.slice(0, 20).map((card) => {
            const titleEl = card.querySelector('[class*="product-name"], [class*="ProductName"], .product-title') as HTMLElement;
            const priceEl = card.querySelector('[class*="product-price"], [class*="ProductPrice"], .price') as HTMLElement;
            const origPriceEl = card.querySelector('[class*="original-price"], [class*="OldPrice"], .old-price') as HTMLElement;
            const linkEl = card.querySelector('a') as HTMLAnchorElement;
            const imgEl = card.querySelector('img') as HTMLImageElement;
            const sellerEl = card.querySelector('[class*="seller-name"], [class*="SellerName"]') as HTMLElement;
            const conditionEl = card.querySelector('[class*="condition"], [class*="Condition"]') as HTMLElement;

            const parsePrice = (text: string | null): number => {
              if (!text) return 0;
              return parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
            };

            return {
              title: titleEl?.textContent?.trim() || '',
              price: parsePrice(priceEl?.textContent),
              originalPrice: parsePrice(origPriceEl?.textContent),
              url: linkEl?.href || '',
              imageUrl: imgEl?.src || imgEl?.getAttribute('data-src') || '',
              seller: sellerEl?.textContent?.trim() || '',
              condition: conditionEl?.textContent?.trim() || '',
            };
          }),
      );

      // SourceSignal formatına çevir
      const signals: SourceSignal[] = listings
        .filter((l) => l.title && l.url)
        .map((l) => {
          const fullUrl = l.url.startsWith('http') ? l.url : `${BASE_URL}${l.url}`;

          const descParts: string[] = [];
          if (l.condition) descParts.push(l.condition);
          if (l.seller) descParts.push(`Satıcı: ${l.seller}`);
          if (l.originalPrice && l.price && l.originalPrice > l.price) {
            const discount = Math.round(((l.originalPrice - l.price) / l.originalPrice) * 100);
            descParts.push(`%${discount} indirim`);
          }
          const description = descParts.join(' | ') || undefined;

          return {
            sourceId: 'letgo',
            sourceName: 'Letgo/Dolap',
            title: l.title,
            description,
            price: l.price || undefined,
            originalPrice: l.originalPrice || undefined,
            currency: 'TRY',
            url: fullUrl,
            imageUrl: l.imageUrl || undefined,
            category: options?.category || 'giyim',
            urgencyHints: extractUrgencyHints(l.title),
            rawData: { seller: l.seller, condition: l.condition },
            fetchedAt: new Date().toISOString(),
          };
        });

      const maxResults = options?.maxResults ?? 10;
      return signals.slice(0, maxResults);
    });

    if (result.error) {
      console.error(`[Letgo/Dolap] Search failed: ${result.error}`);
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
