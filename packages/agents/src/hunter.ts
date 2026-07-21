import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';
import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../sources/base/src';
import { SahibindenAdapter } from '../../sources/sahibinden/src';
import { TrendyolAdapter } from '../../sources/trendyol/src';
import { LetgoAdapter } from '../../sources/letgo/src';
import { RedditRssAdapter } from '../../sources/reddit-rss/src';
import { randomDelay } from '../../sources/base/src/scraper-utils';

/**
 * Opportunity Hunter — Fırsat Avcısı
 *
 * Tanımlanmış kaynak listesini tarar. Ham sinyalleri toplar, kopyaları temizler,
 * ilk puanlama için Scoring Engine'e gönderir.
 * Sprint 3: Gerçek Playwright adaptörlerine bağlandı.
 */
export class OpportunityHunterAgent extends BaseAgent {
  readonly name = 'hunter' as const;
  readonly description = 'Kaynaklardan fırsat tarar, filtreler ve puanlar';

  private adapters: SourceAdapter[] = [
    new SahibindenAdapter(),
    new TrendyolAdapter(),
    new LetgoAdapter(),
    new RedditRssAdapter(),
  ];

  async run(input: AgentInput, _context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const query = input.message || '';
      const categories = input.data?.categories as string[] | undefined;
      const maxPerSource = (input.data?.maxPerSource as number) ?? 10;
      const sourcesToUse = (input.data?.sources as string[]) ?? this.adapters.map((a) => a.id);

      // Aktif adaptörleri filtrele
      const activeAdapters = this.adapters.filter(
        (a) => a.active && sourcesToUse.includes(a.id)
      );

      if (activeAdapters.length === 0) {
        return this.buildResult(true, {
          query,
          opportunities: [],
          message: 'Aktif kaynak bulunamadı.',
        }, startTime);
      }

      // Her kaynağı sırayla tara (paralel yerine sıralı — ban riski azaltmak için)
      const allSignals: SourceSignal[] = [];
      const sourceResults: Array<{ sourceId: string; count: number; error?: string }> = [];

      for (const adapter of activeAdapters) {
        try {
          const options: SourceSearchOptions = {
            maxResults: maxPerSource,
            category: categories?.[0],
          };

          const signals = await adapter.search(query, options);
          allSignals.push(...signals);
          sourceResults.push({ sourceId: adapter.id, count: signals.length });

          // Kaynaklar arası rastgele gecikme (2-5 sn)
          if (activeAdapters.indexOf(adapter) < activeAdapters.length - 1) {
            await randomDelay(2000, 5000);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Hunter] ${adapter.id} error:`, msg);
          sourceResults.push({ sourceId: adapter.id, count: 0, error: msg });
        }
      }

      // Kopyaları temizle (aynı URL'den gelen sinyaller)
      const deduped = this.deduplicateSignals(allSignals);

      // Acil sinyalleri öne al
      const sorted = deduped.sort((a, b) => {
        // Aciliyet sinyali olanlar önce
        if (a.urgencyHints.length !== b.urgencyHints.length) {
          return b.urgencyHints.length - a.urgencyHints.length;
        }
        // Sonra fiyata göre (ucuzdan pahalıya)
        return (a.price || Infinity) - (b.price || Infinity);
      });

      return this.buildResult(true, {
        query,
        sourcesChecked: sourceResults,
        totalSignals: allSignals.length,
        dedupedCount: sorted.length,
        opportunities: sorted,
        message: `${activeAdapters.length} kaynak tarandı, ${sorted.length} benzersiz sonuç bulundu.`,
      }, startTime);
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /** URL bazlı deduplication */
  private deduplicateSignals(signals: SourceSignal[]): SourceSignal[] {
    const seen = new Set<string>();
    return signals.filter((s) => {
      // URL'den query parametreleri temizle (normalize)
      const normalized = s.url.split('?')[0].toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
}
