import type { SourceAdapter, SourceSignal, SourceSearchOptions } from '../../base/src';

/**
 * Frankfurter Source Adapter
 *
 * Ücretsiz döviz kuru API'si — Avrupa Merkez Bankası verileri.
 * API KEY GEREKMİYOR — Limitsiz kullanım.
 * Desteklenen para birimleri: USD, EUR, GBP, CHF, JPY, TRY ve 30+ diğer.
 * Kullanım: Döviz takibi, arbitraj hesabı, çapraz kur analizi.
 */

const BASE_URL = 'https://api.frankfurter.app';

// Türkçe → ISO para birimi haritası
const CURRENCY_MAP: Record<string, string> = {
  dolar: 'USD',
  usd: 'USD',
  euro: 'EUR',
  eur: 'EUR',
  sterlin: 'GBP',
  gbp: 'GBP',
  'ingiliz lirası': 'GBP',
  'isviçre frangı': 'CHF',
  frank: 'CHF',
  chf: 'CHF',
  yen: 'JPY',
  jpy: 'JPY',
  'türk lirası': 'TRY',
  try: 'TRY',
  tl: 'TRY',
  'kanada doları': 'CAD',
  cad: 'CAD',
  'avustralya doları': 'AUD',
  aud: 'AUD',
  'çin yuanı': 'CNY',
  yuan: 'CNY',
  cny: 'CNY',
  'güney kore wonu': 'KRW',
  won: 'KRW',
  krw: 'KRW',
  sek: 'SEK',
  nok: 'NOK',
  dkk: 'DKK',
  pln: 'PLN',
  huf: 'HUF',
  czk: 'CZK',
  ron: 'RON',
  bgn: 'BGN',
  hrk: 'HRK',
  rub: 'RUB',
  brl: 'BRL',
  mxn: 'MXN',
  sgd: 'SGD',
  hkd: 'HKD',
  inr: 'INR',
  zar: 'ZAR',
  idr: 'IDR',
  thb: 'THB',
  myr: 'MYR',
  php: 'PHP',
  nzd: 'NZD',
  ils: 'ILS',
};

export interface RateData {
  base: string;
  date: string;
  rates: Record<string, number>;
}

export interface TimeSeriesData {
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
}

export class FrankfurterAdapter implements SourceAdapter {
  readonly id = 'frankfurter';
  readonly name = 'Frankfurter (ECB)';
  readonly type = 'api' as const;
  readonly active = true;

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    console.log(`[Frankfurter] Search: "${query}"`, options);

    const lowerQuery = query.toLowerCase().trim();

    // Çapraz kur mı? (örn: "dolar euro" veya "usd/eur")
    const currencies = this.extractCurrencies(lowerQuery);

    if (currencies.length >= 2) {
      return this.getCrossRate(currencies[0], currencies[1]);
    }

    if (currencies.length === 1) {
      // Tek para birimi → TRY karşısında
      return this.getRateVsTRY(currencies[0]);
    }

    // "döviz", "kur" gibi genel sorgular → ana dövizler
    if (/döviz|kur|exchange|rate|para birimi/i.test(query)) {
      return this.getAllMajorRates();
    }

    // Fallback: ana döviz kurları
    return this.getAllMajorRates();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/latest?from=USD&to=TRY`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** TRY karşısında bir döviz kuru + son 30 günlük trend */
  async getRateVsTRY(currency: string): Promise<SourceSignal[]> {
    try {
      // Güncel kur
      const currentRes = await fetch(`${BASE_URL}/latest?from=${currency}&to=TRY`);
      if (!currentRes.ok) return [];
      const current: RateData = await currentRes.json();

      // 30 gün önce kur
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const histRes = await fetch(`${BASE_URL}/${thirtyDaysAgo}?from=${currency}&to=TRY`);
      const hist: RateData = histRes.ok ? await histRes.json() : { base: currency, date: thirtyDaysAgo, rates: {} };

      const currentRate = current.rates.TRY || 0;
      const histRate = hist.rates.TRY || currentRate;
      const change30d = histRate > 0 ? ((currentRate - histRate) / histRate) * 100 : 0;

      const emoji = change30d > 0 ? '📈' : change30d < 0 ? '📉' : '➡️';
      const urgency: string[] = [];
      if (Math.abs(change30d) > 5) urgency.push('büyük hareket');
      if (change30d > 8) urgency.push('hızlı yükseliş');
      if (change30d < -3) urgency.push('döviz düşüşü', 'alım fırsatı');

      return [{
        sourceId: `frankfurter-${currency}-TRY`,
        sourceName: 'Frankfurter (ECB)',
        title: `${emoji} ${currency}/TRY — ₺${currentRate.toFixed(4)}`,
        description: `30 günlük değişim: ${change30d >= 0 ? '+' : ''}${change30d.toFixed(2)}% | 30g önce: ₺${histRate.toFixed(4)} | Tarih: ${current.date}`,
        price: currentRate,
        currency: 'TRY',
        url: `https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html`,
        category: 'finans',
        urgencyHints: urgency,
        rawData: {
          pair: `${currency}/TRY`,
          currentRate,
          histRate,
          change30d,
          date: current.date,
          histDate: thirtyDaysAgo,
        },
        fetchedAt: new Date().toISOString(),
      }];
    } catch (err) {
      console.error('[Frankfurter] getRateVsTRY error:', err);
      return [];
    }
  }

  /** İki döviz arasında çapraz kur */
  async getCrossRate(from: string, to: string): Promise<SourceSignal[]> {
    try {
      const res = await fetch(`${BASE_URL}/latest?from=${from}&to=${to},TRY`);
      if (!res.ok) return [];
      const data: RateData = await res.json();
      const rate = data.rates[to] || 0;
      const tryRate = data.rates.TRY || 0;

      return [{
        sourceId: `frankfurter-${from}-${to}`,
        sourceName: 'Frankfurter (ECB)',
        title: `💱 ${from}/${to} — ${rate.toFixed(4)}`,
        description: `1 ${from} = ${rate.toFixed(4)} ${to} | 1 ${from} = ₺${tryRate.toFixed(4)} TRY | Tarih: ${data.date}`,
        price: rate,
        currency: to,
        url: `https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html`,
        category: 'finans',
        urgencyHints: [],
        rawData: {
          pair: `${from}/${to}`,
          rate,
          tryEquivalent: tryRate,
          date: data.date,
        },
        fetchedAt: new Date().toISOString(),
      }];
    } catch (err) {
      console.error('[Frankfurter] getCrossRate error:', err);
      return [];
    }
  }

  /** Ana döviz kurları (TRY bazında) */
  async getAllMajorRates(): Promise<SourceSignal[]> {
    try {
      const majors = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
      const res = await fetch(`${BASE_URL}/latest?from=TRY&to=${majors.join(',')}`);
      if (!res.ok) return [];
      const data: RateData = await res.json();

      // TRY bazlı oranları tersine çevir (1 USD = ? TRY)
      return majors
        .filter(cur => data.rates[cur])
        .map((cur): SourceSignal => {
          const rate = 1 / data.rates[cur]; // TRY per 1 unit
          return {
            sourceId: `frankfurter-${cur}-TRY`,
            sourceName: 'Frankfurter (ECB)',
            title: `💱 ${cur}/TRY — ₺${rate.toFixed(4)}`,
            description: `1 ${cur} = ₺${rate.toFixed(4)} | Kaynak: Avrupa Merkez Bankası | Tarih: ${data.date}`,
            price: rate,
            currency: 'TRY',
            url: `https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html`,
            category: 'finans',
            urgencyHints: [],
            rawData: { pair: `${cur}/TRY`, rate, date: data.date },
            fetchedAt: new Date().toISOString(),
          };
        });
    } catch (err) {
      console.error('[Frankfurter] getAllMajorRates error:', err);
      return [];
    }
  }

  /** Son 30 günlük kur zaman serisi */
  async getTimeSeries(from: string, to: string, days: number = 30): Promise<TimeSeriesData | null> {
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      const res = await fetch(`${BASE_URL}/${startDate}..${endDate}?from=${from}&to=${to}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private extractCurrencies(query: string): string[] {
    const found: string[] = [];
    // "/" ile ayrılmış pair kontrolü (usd/try, eur/gbp)
    const pairMatch = query.match(/([a-z]{3})\s*[\/\-]\s*([a-z]{3})/);
    if (pairMatch) {
      const c1 = CURRENCY_MAP[pairMatch[1]] || pairMatch[1].toUpperCase();
      const c2 = CURRENCY_MAP[pairMatch[2]] || pairMatch[2].toUpperCase();
      return [c1, c2];
    }

    // Kelime kelime kontrol
    for (const [key, iso] of Object.entries(CURRENCY_MAP)) {
      if (query.includes(key) && !found.includes(iso)) {
        found.push(iso);
      }
    }
    return found;
  }
}
