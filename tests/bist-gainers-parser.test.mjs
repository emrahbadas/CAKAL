import { describe, expect, it } from 'vitest';
import aiService from '../apps/desktop/electron/ai-service.cjs';

const { parseUzmanparaBistGainersHtml, filterBistGainers } = aiService;

const uzmanparaFixture = `
  <table class="table3 table4">
    <tbody>
      <tr>
        <th>Hisse</th><th>Son</th><th>Dun</th><th>%</th><th>Yuksek</th><th>Dusuk</th><th>Ag.Ort.</th><th>Hacim(LOT)</th><th>Hacim(TL)</th>
      </tr>
      <tr>
        <td class="currency currency-up"><a href="/borsa/hisse-senetleri/dunya-holding-dunyh/">DUNYH</a></td>
        <td class="center">123,20</td><td class="center">112,00</td><td class="degisim up">10,00</td>
        <td class="center">123,20</td><td class="center">111,70</td><td class="center">119,28</td>
        <td class="center">3.820.663</td><td class="center">455,7&nbsp;Mio</td>
      </tr>
      <tr>
        <td class="currency currency-up"><a href="/borsa/hisse-senetleri/baydoner-restoranlari-bydnr/">BYDNR</a></td>
        <td class="center">40,06</td><td class="center">36,42</td><td class="degisim up">9,99</td>
        <td class="center">40,06</td><td class="center">38,00</td><td class="center">39,85</td>
        <td class="center">618.922</td><td class="center">24,7&nbsp;Mio</td>
      </tr>
      <tr>
        <td class="currency currency-up"><a href="/borsa/hisse-senetleri/enpra/">ENPRA</a></td>
        <td class="center">70,00</td><td class="center">66,65</td><td class="degisim up">5,03</td>
        <td class="center">70,00</td><td class="center">66,70</td><td class="center">69,42</td>
        <td class="center">95.587</td><td class="center">6,6&nbsp;Mio</td>
      </tr>
      <tr>
        <td class="currency currency-up"><a href="/borsa/hisse-senetleri/barma/">BARMA</a></td>
        <td class="center">70,45</td><td class="center">67,15</td><td class="degisim up">4,91</td>
        <td class="center">71,10</td><td class="center">67,70</td><td class="center">69,60</td>
        <td class="center">2.117.345</td><td class="center">147,4&nbsp;Mio</td>
      </tr>
    </tbody>
  </table>
`;

describe('Uzmanpara BIST gainers parser', () => {
  it('parses ticker rows and Turkish numeric fields', () => {
    const items = parseUzmanparaBistGainersHtml(uzmanparaFixture);

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      symbol: 'DUNYH',
      price: 123.2,
      previousClose: 112,
      changePercent: 10,
      volumeLot: 3820663,
      volumeText: '455,7 Mio',
      sourceUrl: 'https://uzmanpara.milliyet.com.tr/borsa/hisse-senetleri/dunya-holding-dunyh/',
    });
  });

  it('filters the requested daily percent band without falling back to fixed symbols', () => {
    const items = parseUzmanparaBistGainersHtml(uzmanparaFixture);
    const band = filterBistGainers(items, { minChangePercent: 5, maxChangePercent: 10, excludeLimitUp: true });

    expect(band.map((item) => item.symbol)).toEqual(['BYDNR', 'ENPRA']);
  });
});