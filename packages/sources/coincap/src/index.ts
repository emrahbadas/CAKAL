import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';

/**
 * CoinCap Source Adapter
 *
 * Ücretsiz, gerçek zamanlı kripto para piyasa verileri.
 * API KEY GEREKMİYOR — Rate limit: 200 req/min (free tier).
 * WebSocket desteği var (ws://prices.coincap.io).
 * Kullanım: Anlık fiyat, hacim, piyasa değeri, 24s değişim.
 */

const BASE_URL = 'https://api.coincap.io/v2';

// CoinCap ID haritası
const COINCAP_MAP: Record<string, string> = {
  bitcoin: 'bitcoin',
  btc: 'bitcoin',
  ethereum: 'ethereum',
  eth: 'ethereum',
  solana: 'solana',
  sol: 'solana',
  ripple: 'xrp',
  xrp: 'xrp',
  dogecoin: 'dogecoin',
  doge: 'dogecoin',
  bnb: 'binance-coin',
  cardano: 'cardano',
  ada: 'cardano',
  avax: 'avalanche',
  polkadot: 'polkadot',
  dot: 'polkadot',
  matic: 'polygon',
  polygon: 'polygon',
  shib: 'shiba-inu',
  link: 'chainlink',
  uni: 'uniswap',
  litecoin: 'litecoin',
  ltc: 'litecoin',
  tron: 'tron',
  trx: 'tron',
  near: 'near-protocol',
  ton: 'toncoin',
};

interface CoinCapAsset {
  id: string;
  rank: string;
  symbol: string;
  name: string;
  supply: string;
  maxSupply: string | null;
  marketCapUsd: string;
  volumeUsd24Hr: string;
  priceUsd: string;
  changePercent24Hr: string;
  vwap24Hr: string;
}

interface CoinCapHistory {
  priceUsd: string;
  time: number;
  date: string;
}

export class CoinCapAdapter implements SourceAdapter {
  readonly id = 'coincap';
  readonly name = 'CoinCap';
  readonly type = 'api' as const;
  readonly active = true;

  // TRY/USD kuru — Frankfurter'dan veya cache'ten alınabilir
  private tryRate: number = 0;
  private tryRateUpdatedAt: number = 0;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[CoinCap] Search: "${query}"`, options);

    await this.ensureTryRate();
    const lowerQuery = query.toLowerCase().trim();

    // Spesifik coin
    const coinId = COINCAP_MAP[lowerQuery];
    if (coinId) {
      return this.getAssetWithHistory(coinId);
    }

    // "top", "market" gibi genel sorgular
    if (/top|en iyi|market|piyasa|genel/i.test(query)) {
      return this.getTopAssets(options?.maxResults ?? 10);
    }

    // "en çok yükselen", "gainer" gibi sorgular
    if (/yükselen|gainer|kazanan|artış|pump/i.test(query)) {
      return this.getTopGainers();
    }

    // "en çok düşen", "loser" gibi sorgular
    if (/düşen|loser|kaybeden|düşüş|dump|dip/i.test(query)) {
      return this.getTopLosers();
    }

    // Birden fazla coin aranıyor olabilir
    const coinIds = Object.entries(COINCAP_MAP)
      .filter(([key]) => lowerQuery.includes(key))
      .map(([, id]) => id);

    if (coinIds.length > 0) {
      const results: SourceSignal[] = [];
      for (const id of [...new Set(coinIds)]) {
        results.push(...await this.getAssetWithHistory(id));
      }
      return results;
    }

    // CoinCap search endpoint
    return this.searchAssets(query, options?.maxResults ?? 10);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/assets?limit=1`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Top N assets */
  async getTopAssets(count: number = 10): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/assets?limit=${count}`);
      if (!res.ok) return [];
      const { data }: { data: CoinCapAsset[] } = await res.json();
      return data.map(a => this.assetToSignal(a));
    } catch (err) {
      console.error('[CoinCap] getTopAssets error:', err);
      return [];
    }
  }

  /** Tek asset + 7 günlük geçmiş */
  async getAssetWithHistory(id: string): Promise<SourceSignal[]> {
    try {
      const [assetRes, histRes] = await Promise.all([
        fetch(`${BASE_URL}/assets/${id}`),
        fetch(`${BASE_URL}/assets/${id}/history?interval=h1`), // Saatlik 24s veri
      ]);

      if (!assetRes.ok) return [];
      const { data: asset }: { data: CoinCapAsset } = await assetRes.json();

      let history: CoinCapHistory[] = [];
      if (histRes.ok) {
        const histData = await histRes.json();
        history = (histData.data || []).slice(-168); // Son 7 gün (168 saat)
      }

      const signal = this.assetToSignal(asset);
      // Geçmiş veriyi rawData'ya ekle
      signal.rawData = {
        ...signal.rawData,
        history_7d: history.slice(-168).map((h: CoinCapHistory) => ({
          price: parseFloat(h.priceUsd),
          time: h.time,
        })),
        history_24h: history.slice(-24).map((h: CoinCapHistory) => ({
          price: parseFloat(h.priceUsd),
          time: h.time,
        })),
      };

      return [signal];
    } catch (err) {
      console.error('[CoinCap] getAssetWithHistory error:', err);
      return [];
    }
  }

  /** En çok yükselenler */
  async getTopGainers(): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/assets?limit=50`);
      if (!res.ok) return [];
      const { data }: { data: CoinCapAsset[] } = await res.json();

      const sorted = data
        .filter(a => a.changePercent24Hr)
        .sort((a, b) => parseFloat(b.changePercent24Hr) - parseFloat(a.changePercent24Hr))
        .slice(0, 10);

      return sorted.map(a => {
        const signal = this.assetToSignal(a);
        signal.urgencyHints.push('yükselen', 'gainer');
        return signal;
      });
    } catch {
      return [];
    }
  }

  /** En çok düşenler */
  async getTopLosers(): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/assets?limit=50`);
      if (!res.ok) return [];
      const { data }: { data: CoinCapAsset[] } = await res.json();

      const sorted = data
        .filter(a => a.changePercent24Hr)
        .sort((a, b) => parseFloat(a.changePercent24Hr) - parseFloat(b.changePercent24Hr))
        .slice(0, 10);

      return sorted.map(a => {
        const signal = this.assetToSignal(a);
        signal.urgencyHints.push('düşen', 'dip fırsatı');
        return signal;
      });
    } catch {
      return [];
    }
  }

  /** CoinCap search */
  private async searchAssets(query: string, limit: number): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/assets?search=${encodeURIComponent(query)}&limit=${limit}`);
      if (!res.ok) return [];
      const { data }: { data: CoinCapAsset[] } = await res.json();
      return data.map(a => this.assetToSignal(a));
    } catch {
      return [];
    }
  }

  private assetToSignal(a: CoinCapAsset): SourceSignal {
    const priceUsd = parseFloat(a.priceUsd) || 0;
    const priceTry = priceUsd * this.tryRate;
    const change24h = parseFloat(a.changePercent24Hr) || 0;
    const volumeUsd = parseFloat(a.volumeUsd24Hr) || 0;
    const marketCapUsd = parseFloat(a.marketCapUsd) || 0;

    const urgency: string[] = [];
    if (Math.abs(change24h) > 10) urgency.push('büyük hareket');
    if (change24h < -15) urgency.push('çöküş');
    if (change24h > 15) urgency.push('ralli');
    if (volumeUsd > marketCapUsd * 0.3) urgency.push('yüksek hacim');

    const emoji = change24h > 0 ? '📈' : change24h < 0 ? '📉' : '➡️';
    const changeText = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;

    return {
      sourceId: `coincap-${a.id}`,
      sourceName: 'CoinCap',
      title: `${emoji} #${a.rank} ${a.name} (${a.symbol}) — $${priceUsd.toFixed(priceUsd < 1 ? 6 : 2)} / ₺${priceTry.toFixed(2)}`,
      description: `24s: ${changeText} | Hacim: $${this.formatNumber(volumeUsd)} | MCap: $${this.formatNumber(marketCapUsd)} | VWAP: $${parseFloat(a.vwap24Hr || '0').toFixed(2)}`,
      price: priceTry,
      currency: 'TRY',
      url: `https://coincap.io/assets/${a.id}`,
      category: 'finans',
      urgencyHints: urgency,
      rawData: {
        id: a.id,
        rank: parseInt(a.rank),
        symbol: a.symbol,
        priceUsd,
        priceTry,
        changePercent24Hr: change24h,
        volumeUsd24Hr: volumeUsd,
        marketCapUsd,
        vwap24Hr: parseFloat(a.vwap24Hr || '0'),
        supply: parseFloat(a.supply || '0'),
        maxSupply: a.maxSupply ? parseFloat(a.maxSupply) : null,
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  /** USD/TRY kurunu al (cache 5 dakika) */
  private async ensureTryRate(): Promise<void> {
    if (this.tryRate > 0 && Date.now() - this.tryRateUpdatedAt < 300_000) return;

    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=TRY');
      if (res.ok) {
        const data = await res.json();
        this.tryRate = data.rates?.TRY || 38;
        this.tryRateUpdatedAt = Date.now();
      }
    } catch {
      if (this.tryRate === 0) this.tryRate = 38; // Fallback
    }
  }

  private formatNumber(n: number): string {
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(2);
  }
}
