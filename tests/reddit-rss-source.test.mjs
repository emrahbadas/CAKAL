import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedditRssAdapter, analyzeRedditText, extractQueryKeywords, parseRedditRss } from '../packages/sources/reddit-rss/src/index.ts';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <title>TSLA earnings beat, but guidance weak</title>
    <link href="https://www.reddit.com/r/stocks/comments/1/tsla_earnings/" rel="alternate" />
    <updated>2026-07-01T20:00:00Z</updated>
    <content>TSLA beat estimates but guidance looks weak.</content>
  </entry>
  <entry>
    <title>My portfolio update</title>
    <link href="https://www.reddit.com/r/stocks/comments/2/portfolio/" rel="alternate" />
    <updated>2026-07-01T21:00:00Z</updated>
    <content>No ticker here.</content>
  </entry>
</feed>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RedditRssAdapter', () => {
  it('parses Atom/RSS items into normalized reddit items', () => {
    const items = parseRedditRss(SAMPLE_RSS, 'stocks');

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'TSLA earnings beat, but guidance weak',
      link: 'https://www.reddit.com/r/stocks/comments/1/tsla_earnings/',
      subreddit: 'stocks',
    });
  });

  it('extracts query tickers and filters generic borsa words', () => {
    expect(extractQueryKeywords('Reddit borsa TSLA $NVDA bugün ne diyor?')).toEqual(['TSLA', 'NVDA']);
  });

  it('scores mixed earnings guidance language', () => {
    const analysis = analyzeRedditText('TSLA earnings beat, but guidance weak', ['TSLA']);

    expect(analysis.matchedKeywords).toEqual(['TSLA']);
    expect(analysis.eventWords).toEqual(['earnings', 'guidance']);
    expect(analysis.sentiment).toBe('mixed');
    expect(analysis.score).toBeGreaterThan(30);
  });

  it('fetches subreddit RSS feeds and returns SourceSignal results for matching tickers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => SAMPLE_RSS,
    })));

    const adapter = new RedditRssAdapter({ subreddits: ['stocks'] });
    const signals = await adapter.search('TSLA', { maxResults: 5 });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      sourceName: 'Reddit RSS',
      category: 'finans',
      url: 'https://www.reddit.com/r/stocks/comments/1/tsla_earnings/',
    });
    expect(signals[0].rawData).toMatchObject({
      subreddit: 'stocks',
      matchedKeywords: ['TSLA'],
      sentiment: 'mixed',
    });
  });
});