/**
 * Base Source Adapter
 *
 * Tüm kaynak adaptörleri bu interface'i uygular.
 * API varsa API kullanılır, yoksa Playwright ile taranır.
 */

export interface SourceSignal {
  sourceId: string;
  sourceName: string;
  title: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  currency: string;
  url: string;
  imageUrl?: string;
  category?: string;
  urgencyHints: string[]; // 'acil', 'nakit lazım', etc.
  rawData: Record<string, unknown>;
  fetchedAt: string;
}

export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'api' | 'scrape';
  readonly active: boolean;

  search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]>;
  healthCheck(): Promise<boolean>;
}

export interface SourceSearchOptions {
  category?: string;
  maxResults?: number;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'price-asc' | 'price-desc' | 'date' | 'relevance';
}
