import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';

type RedditRssItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  subreddit: string;
};

type RedditSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

type RedditRssAdapterOptions = {
  subreddits?: string[];
  feedType?: 'new' | 'hot';
};

const DEFAULT_SUBREDDITS = ['stocks', 'investing', 'StockMarket', 'wallstreetbets', 'BorsaIstanbul', 'CryptoCurrency', 'bitcoin'];

const POSITIVE_WORDS = [
  'beat',
  'bullish',
  'buyback',
  'growth',
  'upgrade',
  'strong',
  'profit',
  'rally',
  'breakout',
  'accumulate',
];

const NEGATIVE_WORDS = [
  'dilution',
  'downgrade',
  'bearish',
  'miss',
  'weak',
  'loss',
  'delisting',
  'dump',
  'lawsuit',
  'risk',
];

const EVENT_WORDS = ['earnings', 'guidance', 'split', 'merger', 'acquisition', 'sec', 'lawsuit', 'dividend', 'halving'];

const QUERY_STOP_WORDS = new Set([
  'reddit',
  'borsa',
  'hisse',
  'stock',
  'stocks',
  'market',
  'piyasa',
  'crypto',
  'kripto',
  'signal',
  'sinyal',
  'bugun',
  'bugün',
  'nedir',
  'ne',
  'diyor',
  'diyorlar',
  'araştır',
  'arastir',
]);

export class RedditRssAdapter implements SourceAdapter {
  readonly id = 'reddit-rss';
  readonly name = 'Reddit RSS';
  readonly type = 'api' as const;
  readonly active = true;

  private readonly subreddits: string[];
  private readonly feedType: 'new' | 'hot';

  constructor(options: RedditRssAdapterOptions = {}) {
    this.subreddits = options.subreddits ?? DEFAULT_SUBREDDITS;
    this.feedType = options.feedType ?? 'new';
  }

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[Reddit RSS] Search: "${query}"`, options);

    const keywords = extractQueryKeywords(query);
    const maxResults = options?.maxResults ?? 10;
    const items = await this.fetchFeeds();
    const signals = items
      .map((item) => this.itemToSignal(item, keywords))
      .filter((signal) => {
        if (keywords.length === 0) return true;
        const matchedKeywords = signal.rawData.matchedKeywords as string[];
        return matchedKeywords.length > 0;
      })
      .sort((a, b) => (b.rawData.redditScore as number) - (a.rawData.redditScore as number));

    return signals.slice(0, maxResults);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const [firstSubreddit] = this.subreddits;
      if (!firstSubreddit) return false;
      const res = await fetch(buildFeedUrl(firstSubreddit, this.feedType), { headers: rssHeaders() });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async fetchFeeds(): Promise<RedditRssItem[]> {
    const results = await Promise.allSettled(
      this.subreddits.map(async (subreddit) => {
        const feedUrl = buildFeedUrl(subreddit, this.feedType);
        const res = await fetch(feedUrl, { headers: rssHeaders() });
        if (!res.ok) throw new Error(`Reddit RSS failed for r/${subreddit}: ${res.status} ${res.statusText}`);
        return parseRedditRss(await res.text(), subreddit);
      }),
    );

    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  private itemToSignal(item: RedditRssItem, keywords: string[]): SourceSignal {
    const analysis = analyzeRedditText(`${item.title} ${item.description}`, keywords);
    const urgencyHints = [...analysis.matchedKeywords, ...analysis.eventWords];
    if (analysis.sentiment !== 'neutral') urgencyHints.push(analysis.sentiment);

    return {
      sourceId: `reddit-rss-${item.subreddit}-${stableId(item.link || item.title)}`,
      sourceName: 'Reddit RSS',
      title: `[r/${item.subreddit}] ${item.title}`,
      description: buildDescription(analysis),
      currency: 'N/A',
      url: item.link,
      category: 'finans',
      urgencyHints,
      rawData: {
        subreddit: item.subreddit,
        pubDate: item.pubDate,
        matchedKeywords: analysis.matchedKeywords,
        eventWords: analysis.eventWords,
        sentiment: analysis.sentiment,
        redditScore: analysis.score,
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}

export function parseRedditRss(xml: string, subreddit: string): RedditRssItem[] {
  return matchBlocks(xml, 'entry')
    .concat(matchBlocks(xml, 'item'))
    .map((block) => ({
      title: decodeXml(readTag(block, 'title')),
      link: readAtomLink(block) || decodeXml(readTag(block, 'link')),
      pubDate: decodeXml(readTag(block, 'updated') || readTag(block, 'pubDate') || readTag(block, 'published')),
      description: decodeXml(readTag(block, 'content') || readTag(block, 'description') || readTag(block, 'summary')),
      subreddit,
    }))
    .filter((item) => item.title && item.link);
}

export function extractQueryKeywords(query: string): string[] {
  const explicitTickers = query.match(/\$?[A-ZÇĞİÖŞÜ]{2,8}(?:\.IS)?/g) ?? [];
  const words = query
    .split(/[^\p{L}\p{N}.$]+/u)
    .map((word) => word.replace(/^\$/, '').trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !QUERY_STOP_WORDS.has(word.toLowerCase()));

  return [...new Set([...explicitTickers.map((ticker) => ticker.replace(/^\$/, '')), ...words])];
}

export function analyzeRedditText(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  const matchedKeywords = keywords.filter((keyword) => normalized.includes(normalizeText(keyword)));
  const positiveHits = POSITIVE_WORDS.filter((word) => normalized.includes(word));
  const negativeHits = NEGATIVE_WORDS.filter((word) => normalized.includes(word));
  const eventWords = EVENT_WORDS.filter((word) => normalized.includes(word));

  const sentiment: RedditSentiment =
    positiveHits.length > 0 && negativeHits.length > 0
      ? 'mixed'
      : positiveHits.length > negativeHits.length
        ? 'positive'
        : negativeHits.length > positiveHits.length
          ? 'negative'
          : 'neutral';

  const sentimentScore = positiveHits.length * 12 - negativeHits.length * 14;
  const score = Math.max(0, Math.min(100, matchedKeywords.length * 25 + eventWords.length * 8 + Math.abs(sentimentScore)));

  return {
    matchedKeywords,
    eventWords,
    sentiment,
    score,
    positiveHits,
    negativeHits,
  };
}

function buildFeedUrl(subreddit: string, feedType: 'new' | 'hot'): string {
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${feedType}/.rss`;
}

function rssHeaders(): HeadersInit {
  return {
    Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml',
    'User-Agent': 'CakalRSSBot/1.0',
  };
}

function buildDescription(analysis: ReturnType<typeof analyzeRedditText>): string {
  const parts = [
    `Sinyal: ${analysis.sentiment}`,
    `Skor: ${analysis.score}/100`,
    analysis.matchedKeywords.length ? `Eşleşme: ${analysis.matchedKeywords.join(', ')}` : '',
    analysis.eventWords.length ? `Olay dili: ${analysis.eventWords.join(', ')}` : '',
  ].filter(Boolean);

  return parts.join(' | ');
}

function normalizeText(text: string): string {
  return stripHtml(text).toLocaleLowerCase('tr-TR');
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function matchBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((match) => match[1] ?? '');
}

function readTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function readAtomLink(block: string): string {
  const alternate = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*>/i);
  const hrefFirst = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const fallback = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return decodeXml(alternate?.[1] ?? hrefFirst?.[1] ?? fallback?.[1] ?? '');
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}