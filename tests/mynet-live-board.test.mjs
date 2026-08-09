import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const aiServiceSource = fs.readFileSync(
  path.join(here, '..', 'apps', 'desktop', 'electron', 'ai-service.cjs'),
  'utf8',
);

// ai-service.cjs Electron bağımlıdır ve doğrudan import edilemez. Parser saf
// fonksiyonlardan oluşur; kaynaktan izole edip değerlendiriyoruz. Böylece test
// gerçek koda bağlı kalır (kopya değil) ama Electron gerektirmez.
function loadParser() {
  const names = [
    'MYNET_LIVE_BOARD_URL',
    'MYNET_BOARD_FIELD_TERMINATOR',
    'parseMynetNumber',
    'parseMynetIndexMembership',
    'parseMynetLiveBoardHtml',
  ];
  const chunks = names.map((name) => {
    const re = name.startsWith('MYNET_')
      ? new RegExp(`^const ${name} = .*?;$`, 'm')
      : new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm');
    const match = aiServiceSource.match(re);
    if (!match) throw new Error(`ai-service.cjs içinde bulunamadı: ${name}`);
    return match[0];
  });
  // eslint-disable-next-line no-new-func
  return new Function(`${chunks.join('\n\n')}\nreturn { parseMynetLiveBoardHtml, parseMynetNumber, parseMynetIndexMembership, MYNET_LIVE_BOARD_URL };`)();
}

const { parseMynetLiveBoardHtml, parseMynetNumber, parseMynetIndexMembership, MYNET_LIVE_BOARD_URL } = loadParser();

const LEGEND = '|_id|l|h|L|C|t|dd|d|b|a|wa|tV|tT|code|index|url';

/** Gerçek Mynet biçiminde tek kayıt üretir (sayısal alanlar koddan ÖNCE gelir). */
function record({ id = 'H1', last, high, low, chg, time = '18:10', dd = '1', d = '1', bid, ask, wa, lot, tl, code, index = '*null*', url }) {
  return [id, last, high, low, chg, time, dd, d, bid, ask, wa, lot, tl, code, index, url ?? `hisseler/${code.toLowerCase()}-test-sirket/`, '_'].join('|');
}

function page(records) {
  return `<html><body><script type="text/x-handlebars-template" id="stocksData">${records.join('|')}${LEGEND}</script></body></html>`;
}

const THYAO = record({
  id: 'H1962', last: '306,25', high: '312,25', low: '303,25', chg: '-1,61',
  bid: '306,25', ask: '306,50', wa: '307,37', lot: '64.739.369', tl: '19.898.773.703,25',
  code: 'THYAO', index: '*XU030*XU100*XU050*', url: 'hisseler/thyao-turk-hava-yollari/',
});
const ZOREN = record({
  id: 'H1720', last: '2,31', high: '2,33', low: '2,29', chg: '0,43',
  bid: '2,31', ask: '2,32', wa: '2,31', lot: '42.028.303', tl: '96.878.325,97',
  code: 'ZOREN', index: '*XU100*', url: 'hisseler/zoren-zorlu-enerji/',
});

describe('Mynet canlı borsa parser', () => {
  it('sayısal alanları sembol kodundan ÖNCE okur (legend sırasına uyar)', () => {
    const result = parseMynetLiveBoardHtml(page([THYAO, ZOREN]));
    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);

    const thyao = result.items.find((i) => i.symbol === 'THYAO');
    // Kritik regresyon: alan sırası kayarsa THYAO fiyatı ZOREN'in değerini alır.
    expect(thyao.price).toBe(306.25);
    expect(thyao.high).toBe(312.25);
    expect(thyao.low).toBe(303.25);
    expect(thyao.changePercent).toBe(-1.61);

    const zoren = result.items.find((i) => i.symbol === 'ZOREN');
    expect(zoren.price).toBe(2.31);
    expect(zoren.turnoverTRY).toBe(96878325.97);
  });

  it('Türkçe binlik/ondalık ayıracını doğru çevirir', () => {
    expect(parseMynetNumber('19.898.773.703,25')).toBe(19898773703.25);
    expect(parseMynetNumber('2,31')).toBe(2.31);
    expect(parseMynetNumber('-1,61')).toBe(-1.61);
    expect(parseMynetNumber('')).toBeNull();
    expect(parseMynetNumber('_')).toBeNull();
  });

  it('endeks üyeliğini ayrıştırır, null endeksi boş dizi yapar', () => {
    expect(parseMynetIndexMembership('*XU030*XU100*XU050*').sort()).toEqual(['XU030', 'XU050', 'XU100']);
    expect(parseMynetIndexMembership('*null*')).toEqual([]);
    expect(parseMynetIndexMembership('')).toEqual([]);

    const result = parseMynetLiveBoardHtml(page([THYAO, ZOREN]));
    const thyao = result.items.find((i) => i.symbol === 'THYAO');
    expect(thyao.inXu030).toBe(true);
    expect(thyao.inXu100).toBe(true);
    const zoren = result.items.find((i) => i.symbol === 'ZOREN');
    expect(zoren.inXu030).toBe(false);
    expect(zoren.inXu100).toBe(true);
  });

  it('önceki kapanışı değişim yüzdesinden türetir', () => {
    const result = parseMynetLiveBoardHtml(page([ZOREN]));
    const zoren = result.items[0];
    // 2,31 / (1 + 0,0043) ≈ 2,3001
    expect(zoren.previousClose).toBeCloseTo(2.3001, 3);
  });

  it('url ile kod uyuşmazsa kaydı atar — kaymış diziden yanlış fiyat üretmez', () => {
    const misaligned = record({
      id: 'H9', last: '10,00', high: '11,00', low: '9,00', chg: '1,00',
      bid: '10,00', ask: '10,10', wa: '10,05', lot: '1.000', tl: '10.000,00',
      code: 'AAAAA', url: 'hisseler/bbbbb-baska-sirket/',
    });
    const result = parseMynetLiveBoardHtml(page([THYAO, misaligned]));
    expect(result.success).toBe(true);
    expect(result.items.map((i) => i.symbol)).toEqual(['THYAO']);
    expect(result.malformed).toBe(1);
  });

  it('5 karakterden uzun enstrüman kodlarını düşürmez (ALTINS1 regresyonu)', () => {
    const cert = record({
      id: 'H5', last: '72,80', high: '73,00', low: '72,50', chg: '0,41',
      bid: '72,75', ask: '72,80', wa: '72,70', lot: '1.000', tl: '72.800,00',
      code: 'ALTINS1', url: 'hisseler/altins1-darphane-altin-sertifikasi/',
    });
    const result = parseMynetLiveBoardHtml(page([cert]));
    expect(result.items.map((i) => i.symbol)).toEqual(['ALTINS1']);
    expect(result.items[0].price).toBe(72.8);
    expect(result.malformed).toBe(0);
  });

  it('içinde I geçen sembolleri eler mi — Türkçe lowercase tuzağı regresyonu', () => {
    // toLocaleLowerCase('tr-TR') kullanılırsa 'BIMAS' → 'bımas' olur ve url
    // eşleşmesi bozulur; panodaki ~100 sembol sessizce kaybolur.
    const withDottedI = ['BIMAS', 'SISE', 'ISCTR', 'ALKIM', 'INFO'].map((code) => record({
      id: 'H' + code, last: '10,00', high: '10,50', low: '9,50', chg: '1,00',
      bid: '10,00', ask: '10,05', wa: '10,02', lot: '100', tl: '1.000,00',
      code, url: `hisseler/${code.toLowerCase()}-test-sirket/`,
    }));
    const result = parseMynetLiveBoardHtml(page(withDottedI));
    expect(result.items.map((i) => i.symbol)).toEqual(['BIMAS', 'SISE', 'ISCTR', 'ALKIM', 'INFO']);
    expect(result.malformed).toBe(0);
  });

  it('gün aralığı dışındaki son fiyatı işaretler (sessiz geçmez)', () => {
    const halted = record({
      id: 'H7', last: '50,00', high: '45,00', low: '44,00', chg: '0,00',
      bid: '44,50', ask: '45,00', wa: '44,50', lot: '0', tl: '0,00',
      code: 'HALTD', url: 'hisseler/haltd-durdurulmus/',
    });
    const result = parseMynetLiveBoardHtml(page([halted]));
    expect(result.items[0].priceInDayRange).toBe(false);
    expect(parseMynetLiveBoardHtml(page([THYAO])).items[0].priceInDayRange).toBe(true);
  });

  it('stocksData bloğu yoksa sessizce boş dönmez, hata verir', () => {
    const result = parseMynetLiveBoardHtml('<html><body>veri yok</body></html>');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/stocksData/i);
  });

  it('legend yoksa alan sırası tahmin edilmez, parse reddedilir', () => {
    const noLegend = `<html><script type="text/x-handlebars-template" id="stocksData">${THYAO}</script></html>`;
    const result = parseMynetLiveBoardHtml(noLegend);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/legend/i);
  });

  it('Mynet kolon adlarını değiştirirse sessizce kaymaz, açık hata verir', () => {
    const changed = `<html><script type="text/x-handlebars-template" id="stocksData">${THYAO}|_id|l|h|L|C|t|dd|d|b|a|wa|tV|tT|ticker|index|url</script></html>`;
    const result = parseMynetLiveBoardHtml(changed);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/code/);
  });

  it('kaynak URL kullanıcının verdiği canlı borsa adresidir', () => {
    expect(MYNET_LIVE_BOARD_URL).toBe('https://finans.mynet.com/borsa/canliborsa/');
  });
});

describe('get_bist_board karar kapısına kayıtlı', () => {
  it('piyasa veri aracı sayılır — tek başına VERI_YETERSIZ tetiklemez', async () => {
    const guards = await import('../apps/desktop/electron/decision-guards.cjs');
    const { COMMANDER_MARKET_DATA_TOOLS, evaluateCommanderDecisionGate } = guards.default ?? guards;
    expect(COMMANDER_MARKET_DATA_TOOLS.has('get_bist_board')).toBe(true);

    const gate = evaluateCommanderDecisionGate(
      'THYAO hissesi için giriş yapılır mı, borsa ne durumda?',
      'THYAO: İNCELE',
      [{ type: 'tool_call', tool: 'get_bist_board' }, { type: 'tool_call', tool: 'analyze_finance_signal' }],
    );
    expect(gate).toBeNull();
  });
});
