import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';

/**
 * Perplexity API Source Adapter
 *
 * Web genelinde bilgi sentezi, trend tespiti, haber özeti.
 * Resmi API kullanır — tarama yapmaz.
 */
export class PerplexityAdapter implements SourceAdapter {
  readonly id = 'perplexity';
  readonly name = 'Perplexity';
  readonly type = 'api' as const;
  readonly active = true;

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    const maxResults = options?.maxResults ?? 5;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `Sen bir fırsat avcısı asistanısın. Kullanıcının sorgusuna göre güncel fırsat, indirim, trend veya arbitraj bilgisi ara. JSON formatında ${maxResults} sonuç döndür. Her sonuçta: title, description, estimated_price (TL), source_url, urgency (low/medium/high), category alanları olsun.`,
          },
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      console.error('[Perplexity] API error:', response.statusText);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return this.parseResponse(content);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 10,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private parseResponse(content: string): SourceSignal[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: Record<string, unknown>): SourceSignal => ({
        sourceId: `perplexity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceName: 'Perplexity',
        title: String(item.title || 'Bilinmiyor'),
        description: String(item.description || ''),
        price: typeof item.estimated_price === 'number' ? item.estimated_price : undefined,
        currency: 'TRY',
        url: String(item.source_url || ''),
        category: String(item.category || 'diger'),
        urgencyHints: item.urgency === 'high' ? ['acil'] : [],
        rawData: item,
        fetchedAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }
}
