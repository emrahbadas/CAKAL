import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';
import { safeScrape, randomDelay, extractUrgencyHints } from '../../base/src/scraper-utils';
import type { Page } from 'playwright';

/**
 * Sahibinden.com Source Adapter
 *
 * İkinci el araç, elektronik, ev eşyası taraması.
 * Cloudflare korumalı — dikkatli tarama: 4-10 sn gecikme.
 * Playwright ile headless, stealth modu.
 */

const BASE_URL = 'https://www.sahibinden.com';
const SEARCH_PATH = '/arama';

// Sahibinden kategori haritası
const CATEGORY_MAP: Record<string, string> = {
  araba: 'vasita',
  elektronik: 'elektronik',
  'ev-esyasi': 'ev-esyasi',
  giyim: 'giyim-aksesuar',
  diger: '',
};

export class SahibindenAdapter implements SourceAdapter {
  readonly id = 'sahibinden';
  readonly name = 'Sahibinden';
  readonly type = 'scrape' as const;
  readonly active = true;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[Sahibinden] Search: "${query}"`, options);

    const result = await safeScrape<SourceSignal[]>(this.id, async (page: Page) => {
      // Build search URL
      const params = new URLSearchParams({ query_text: query });
      if (options?.minPrice) params.set('price_min', String(options.minPrice));
      if (options?.maxPrice) params.set('price_max', String(options.maxPrice));

      // Sort parameter
      if (options?.sortBy === 'price-asc') params.set('sorting', 'price_asc');
      else if (options?.sortBy === 'price-desc') params.set('sorting', 'price_desc');
      else if (options?.sortBy === 'date') params.set('sorting', 'date_desc');

      // Category path
      const catSlug = options?.category ? CATEGORY_MAP[options.category] || '' : '';
      const searchUrl = catSlug
        ? `${BASE_URL}/${catSlug}?${params.toString()}`
        : `${BASE_URL}${SEARCH_PATH}?${params.toString()}`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Sahibinden anti-bot sayfası kontrolü
      const title = await page.title();
      if (title.includes('Just a moment') || title.includes('Checking')) {
        console.warn('[Sahibinden] Cloudflare challenge detected, waiting...');
        await page.waitForTimeout(5000);
      }

      // İlan listesini çek
      const listings = await page.$$eval(
        '.searchResultsItem',
        (items) =>
          items.slice(0, 20).map((item) => {
            const titleEl = item.querySelector('.classifiedTitle') as HTMLElement;
            const priceEl = item.querySelector('.searchResultsPriceValue span') as HTMLElement;
            const linkEl = item.querySelector('a[href*="/ilan/"]') as HTMLAnchorElement;
            const imgEl = item.querySelector('img') as HTMLImageElement;
            const descEl = item.querySelector('.searchResultsTagAttributeValue') as HTMLElement;
            const dateEl = item.querySelector('.searchResultsDateValue span') as HTMLElement;

            const priceText = priceEl?.textContent?.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.') || '0';

            return {
              title: titleEl?.textContent?.trim() || '',
              price: parseFloat(priceText) || 0,
              url: linkEl?.href || '',
              imageUrl: imgEl?.src || '',
              description: descEl?.textContent?.trim() || '',
              dateText: dateEl?.textContent?.trim() || '',
            };
          }),
      );

      // SourceSignal formatına çevir
      const signals: SourceSignal[] = listings
        .filter((l) => l.title && l.url)
        .map((l) => {
          const fullUrl = l.url.startsWith('http') ? l.url : `${BASE_URL}${l.url}`;
          const fullText = `${l.title} ${l.description}`;
          return {
            sourceId: 'sahibinden',
            sourceName: 'Sahibinden',
            title: l.title,
            description: l.description || undefined,
            price: l.price || undefined,
            currency: 'TRY',
            url: fullUrl,
            imageUrl: l.imageUrl || undefined,
            category: options?.category,
            urgencyHints: extractUrgencyHints(fullText),
            rawData: { dateText: l.dateText },
            fetchedAt: new Date().toISOString(),
          };
        });

      const maxResults = options?.maxResults ?? 10;
      return signals.slice(0, maxResults);
    });

    if (result.error) {
      console.error(`[Sahibinden] Search failed: ${result.error}`);
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
