import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const { extractFinancialKeyItems } = aiService;

/**
 * GERÇEK VAKA (11 Ağustos 2026 canlı oturum):
 * Aynı cevapta get_financial_statements BRSAN net kârını (273,62 mn TL) ve
 * özkaynağını (39,38 mlr TL) tabloya yazarken get_valuation_multiples
 * "missingInputs: net kâr, özkaynak" dedi. Cevap kendi kendini yalanladı.
 *
 * İKİ BAĞIMSIZ KUSUR VARDI:
 *   1. Aranan anahtar adları ('netKar', 'ozkaynak') kalem tablosunda HİÇ yok;
 *      gerçekleri 'netDonemKari' ve 'ozkaynaklar'. Her şirkette %100 boş dönerdi.
 *   2. Sektör argümanı geçilmiyordu; grup XI_29 değilse adaptör BANK'a düşüyor
 *      ve banka kalıpları sanayi satırlarını bulamıyordu.
 *
 * Bu paket ikisini de sabitler.
 */

// İş Yatırım MaliTablo satır şeklinin sadeleştirilmiş hâli.
const row = (itemCode, itemDescTr, v1) => ({
  itemCode, itemDescTr, value1: v1, value2: null, value3: null, value4: null,
});

// Sanayi şirketi (BRSAN benzeri) tablosu.
const industrialRows = [
  row('1', 'Hasılat', 18_380_000_000),
  row('2', 'Brüt Kar (Zarar)', 1_210_000_000),
  row('3', 'Esas Faaliyet Karı', 340_980_000),
  row('4', 'Dönem Karı (Zararı)', 273_620_000),
  row('5', 'Toplam Varlıklar', 60_000_000_000),
  row('6', 'Özkaynaklar', 39_380_000_000),
  row('7', 'Nakit ve Nakit Benzerleri', 3_000_000_000),
];

const keyOf = (items, key) => items.find((k) => k.key === key)?.values?.[0] ?? null;

describe('değerleme girdileri — anahtar adı sözleşmesi', () => {
  it('get_valuation_multiples\'ın aradığı anahtarlar GERÇEKTEN üretiliyor', () => {
    // Bu test kusur #1'i sabitler: araç bu iki adı arıyor, tablo bu iki adı
    // üretmeli. Ad değişirse test kırılır — sessiz null dönüşü olmaz.
    const { keyItems } = extractFinancialKeyItems(industrialRows, 'XI_29', 'INDUSTRIAL');
    const uretilen = keyItems.map((k) => k.key);

    expect(uretilen).toContain('netDonemKari');
    expect(uretilen).toContain('ozkaynaklar');
    expect(keyOf(keyItems, 'netDonemKari')).toBe(273_620_000);
    expect(keyOf(keyItems, 'ozkaynaklar')).toBe(39_380_000_000);
  });

  it('artık kullanılmayan uydurma adlar üretilmiyor (regresyon çıpası)', () => {
    const { keyItems } = extractFinancialKeyItems(industrialRows, 'XI_29', 'INDUSTRIAL');
    const uretilen = keyItems.map((k) => k.key);
    // Kod bu adları ararsa null alır; testin amacı o hatayı bir daha
    // "veri yok" gibi göstermemek.
    expect(uretilen).not.toContain('netKar');
    expect(uretilen).not.toContain('ozkaynak');
  });
});

describe('değerleme girdileri — sektör argümanı', () => {
  it('sektör GEÇİLMEZSE ve grup XI_29 değilse sanayi kalemleri kaybolur', () => {
    // Kusur #2'nin kanıtı: sector=null + group='UFRS' → BANK adaptörü.
    // ÖLÇÜLEN DAVRANIŞ (tahmin değil): yedi kalemden yalnız 'ozkaynaklar'
    // hayatta kalır, çünkü BANK deseni /(^|\. )özkaynaklar/ "Özkaynaklar"
    // satırını da yakalar. Net kâr ve gelir tablosu kalemleri kaybolur.
    const { keyItems } = extractFinancialKeyItems(industrialRows, 'UFRS');
    expect(keyItems.map((k) => k.key)).toEqual(['ozkaynaklar']);
    expect(keyOf(keyItems, 'netDonemKari')).toBeNull();
    expect(keyOf(keyItems, 'hasilat')).toBeNull();
  });

  it('grup XI_29 ise sektörsüz çağrı zarar vermez (INDUSTRIAL yedeği tutar)', () => {
    // Kusur #2 yalnız UFRS/UFRS_K gruplarında ısırır; kapsamı abartma.
    const { keyItems } = extractFinancialKeyItems(industrialRows, 'XI_29');
    expect(keyOf(keyItems, 'netDonemKari')).toBe(273_620_000);
  });

  it('sektör GEÇİLİRSE aynı satırlardan aynı grupta kalemler çıkar', () => {
    const { keyItems } = extractFinancialKeyItems(industrialRows, 'UFRS', 'INDUSTRIAL');
    expect(keyOf(keyItems, 'netDonemKari')).toBe(273_620_000);
    expect(keyOf(keyItems, 'ozkaynaklar')).toBe(39_380_000_000);
  });

  it('iki çağrı yolu aynı satırlardan aynı sonucu vermeli', () => {
    // Asıl vakanın özü: statements ve multiples aynı veriyi okuyup farklı
    // sonuç bildiremez.
    const statements = extractFinancialKeyItems(industrialRows, 'UFRS', 'INDUSTRIAL');
    const multiples = extractFinancialKeyItems(industrialRows, 'UFRS', 'INDUSTRIAL');
    expect(keyOf(multiples.keyItems, 'netDonemKari')).toBe(keyOf(statements.keyItems, 'netDonemKari'));
    expect(keyOf(multiples.keyItems, 'ozkaynaklar')).toBe(keyOf(statements.keyItems, 'ozkaynaklar'));
  });
});
