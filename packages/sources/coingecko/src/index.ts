import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';

/**
 * CoinGecko Source Adapter
 *
 * Ücretsiz kripto para fiyat, piyasa ve trend verileri.
 * API KEY GEREKMİYOR — Rate limit: 10-30 req/min (free tier).
 * Kullanım: Kripto fırsat tespiti, arbitraj, piyasa analizi.
 */

const BASE_URL = 'https://api.coingecko.com/api/v3';

// Popüler coin ID haritası (Türkçe → CoinGecko ID)
const COIN_MAP: Record<string, string> = {
  bitcoin: 'bitcoin',
  btc: 'bitcoin',
  ethereum: 'ethereum',
  eth: 'ethereum',
  solana: 'solana',
  sol: 'solana',
  ripple: 'ripple',
  xrp: 'ripple',
  dogecoin: 'dogecoin',
  doge: 'dogecoin',
  bnb: 'binancecoin',
  cardano: 'cardano',
  ada: 'cardano',
  avax: 'avalanche-2',
  avalanche: 'avalanche-2',
  polkadot: 'polkadot',
  dot: 'polkadot',
  matic: 'matic-network',
  polygon: 'matic-network',
  shib: 'shiba-inu',
  link: 'chainlink',
  uni: 'uniswap',
  atom: 'cosmos',
  near: 'near',
  apt: 'aptos',
  sui: 'sui',
  ton: 'the-open-network',
  tron: 'tron',
  trx: 'tron',
};

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  ath: number;
  ath_change_percentage: number;
  sparkline_in_7d?: { price: number[] };
}

export interface TrendingCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number;
  price_btc: number;
  score: number;
}

export class CoinGeckoAdapter implements SourceAdapter {
  readonly id = 'coingecko';
  readonly name = 'CoinGecko';
  readonly type = 'api' as const;
  readonly active = true;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[CoinGecko] Search: "${query}"`, options);

    const lowerQuery = query.toLowerCase().trim();

    // Eğer spesifik coin istendi
    const coinId = COIN_MAP[lowerQuery];
    if (coinId) {
      return this.getCoinData([coinId]);
    }

    // "trend", "trending", "popüler" gibi sorgular
    if (/trend|popül|gündem|yükselen|rising|hot/i.test(query)) {
      return this.getTrending();
    }

    // "top", "en iyi", "market" gibi sorgular → top coins by market cap
    if (/top|en iyi|market|piyasa|genel/i.test(query)) {
      const max = options?.maxResults ?? 10;
      return this.getTopCoins(max);
    }

    // Genel arama → birden fazla coin aranıyor olabilir
    const coinIds = Object.entries(COIN_MAP)
      .filter(([key]) => lowerQuery.includes(key))
      .map(([, id]) => id);

    if (coinIds.length > 0) {
      return this.getCoinData([...new Set(coinIds)]);
    }

    // Fallback: top 10 coins
    return this.getTopCoins(options?.maxResults ?? 10);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Top N coins by market cap */
  async getTopCoins(count: number = 10): Promise<SourceSignal[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/coins/markets?vs_currency=try&order=market_cap_desc&per_page=${count}&page=1&sparkline=true&price_change_percentage=24h,7d`
      );
      if (!res.ok) return [];
      const coins: CoinPrice[] = await res.json();
      return coins.map(c => this.coinToSignal(c));
    } catch (err) {
      console.error('[CoinGecko] getTopCoins error:', err);
      return [];
    }
  }

  /** Spesifik coin verileri */
  async getCoinData(ids: string[]): Promise<SourceSignal[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/coins/markets?vs_currency=try&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h,7d`
      );
      if (!res.ok) return [];
      const coins: CoinPrice[] = await res.json();
      return coins.map(c => this.coinToSignal(c));
    } catch (err) {
      console.error('[CoinGecko] getCoinData error:', err);
      return [];
    }
  }

  /** Trending coins (son 24 saat) */
  async getTrending(): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/search/trending`);
      if (!res.ok) return [];
      const data = await res.json();
      const coins = (data.coins || []).slice(0, 10);

      return coins.map((entry: { item: TrendingCoin }): SourceSignal => {
        const c = entry.item;
        return {
          sourceId: `coingecko-trending-${c.id}`,
          sourceName: 'CoinGecko',
          title: `🔥 Trend: ${c.name} (${c.symbol.toUpperCase()})`,
          description: `Market Cap Sıra: #${c.market_cap_rank || '?'} | Trend skoru: ${c.score + 1}/10`,
          currency: 'BTC',
          url: `https://www.coingecko.com/en/coins/${c.id}`,
          category: 'finans',
          urgencyHints: ['trending', 'yükselen'],
          rawData: { ...c, type: 'trending' },
          fetchedAt: new Date().toISOString(),
        };
      });
    } catch (err) {
      console.error('[CoinGecko] getTrending error:', err);
      return [];
    }
  }

  private coinToSignal(c: CoinPrice): SourceSignal {
    const change24h = c.price_change_percentage_24h || 0;
    const urgency: string[] = [];
    if (Math.abs(change24h) > 10) urgency.push('büyük hareket');
    if (change24h < -15) urgency.push('çöküş', 'dip fırsatı');
    if (change24h > 15) urgency.push('ralli', 'FOMO riski');
    if (c.ath_change_percentage && c.ath_change_percentage > -10) urgency.push('ATH yakını');

    const emoji = change24h > 0 ? '📈' : change24h < 0 ? '📉' : '➡️';
    const changeText = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;

    return {
      sourceId: `coingecko-${c.id}`,
      sourceName: 'CoinGecko',
      title: `${emoji} ${c.name} (${c.symbol.toUpperCase()}) — ₺${c.current_price?.toLocaleString('tr-TR')}`,
      description: `24s: ${changeText} | Hacim: ₺${(c.total_volume || 0).toLocaleString('tr-TR')} | Gün: ₺${c.low_24h?.toLocaleString('tr-TR')} — ₺${c.high_24h?.toLocaleString('tr-TR')}`,
      price: c.current_price,
      currency: 'TRY',
      url: `https://www.coingecko.com/en/coins/${c.id}`,
      category: 'finans',
      urgencyHints: urgency,
      rawData: {
        id: c.id,
        symbol: c.symbol,
        price_change_24h: c.price_change_24h,
        price_change_percentage_24h: change24h,
        market_cap: c.market_cap,
        total_volume: c.total_volume,
        high_24h: c.high_24h,
        low_24h: c.low_24h,
        ath: c.ath,
        ath_change_percentage: c.ath_change_percentage,
        sparkline_7d: c.sparkline_in_7d?.price?.slice(-24) || [],
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}
