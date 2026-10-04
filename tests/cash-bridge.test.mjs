import { describe, it, expect } from 'vitest';

import bridge from '../apps/desktop/electron/cash-bridge.cjs';
import aiService from '../apps/desktop/electron/ai-service.cjs';

const { reconcileCashBridge, attributionAllowed } = bridge;
const { extractCashFlowItems, classifyDebtImprovementSource } = aiService;

/**
 * NAKİT KÖPRÜSÜ MUTABAKATI (docs §5 madde 2)
 *
 * Nakit akış SATIRLARI 13 Ağustos'ta düzeltildi ama köprünün KAPANDIĞI hiç
 * doğrulanmıyordu. Ölçülen vaka: BRSAN turunda ÇAKAL doğru sonuca vardı ama
 * köprüyü kapatamadan vardı — eksikliği fark etti, yine de hüküm kurdu.
 * Sonuç doğruydu; YÖNTEM değildi.
 *
 * FIXTURE GERÇEKTİR. Satır adları ve değerler İş Yatırım MaliTablo'dan
 * birebir ölçüldü (BRSAN 2026/6, grup XI_29, 4 Ekim 2026). Kur etkisi satırı
 * kaynakta kısaltmalı yazılıyor — tahmin edilemezdi:
 *   "Yab.ı Para Çevrim Fark. Nakit Ve Nakit Benz. Üzerindeki Etkisi"
 * Uydurma fixture kendini doğrular (docs §4.9); bu yüzden ölçüldü.
 */

// İş Yatırım satır biçimi: itemDescTr + value1..value4
const BRSAN_ROWS = [
  { itemDescTr: '  Nakit ve Nakit Benzerleri', value1: 9393170000 },
  { itemDescTr: ' İşletme Faaliyetlerinden Kaynaklanan Net Nakit', value1: 7695330000 },
  { itemDescTr: ' Esas Faaliyet ile İlgili Oluşan Nakit (+)', value1: 7583793000 },
  { itemDescTr: '  Diğer İşletme Faaliyetlerinden Nakit', value1: 111537000 },
  { itemDescTr: '  Diğer Yatırım Faaliyetlerinden Nakit', value1: -554733000 },
  { itemDescTr: ' Yatırım Faaliyetlerinden Kaynaklanan Nakit', value1: -3554310000 },
  { itemDescTr: 'Serbest Nakit Akım', value1: 4141020000 },
  { itemDescTr: 'Diğer Finansman Faaliyetlerinden Nakit', value1: -1686037000 },
  { itemDescTr: 'Finansman Faaliyetlerden Kaynaklanan Nakit', value1: -194124000 },
  { itemDescTr: ' Yab.ı Para Çevrim Fark. Nakit Ve Nakit Benz. Üzerindeki Etkisi', value1: -13853000 },
  { itemDescTr: ' Diğer Nakit Girişi/Çıkışı', value1: 0 },
  { itemDescTr: 'Nakit ve Benzerlerindeki Değişim', value1: 3933043000 },
  { itemDescTr: 'Diğer Nakit ve Nakit Benzerlerindeki Artış', value1: 0 },
  { itemDescTr: 'Dönem Başı Nakit Değerler', value1: 5460127000 },
  { itemDescTr: 'Dönem Sonu Nakit', value1: 9393170000 },
];

const items = (rows = BRSAN_ROWS) => extractCashFlowItems(rows);
const itemOf = (key, value) => ({ key, label: key, values: [value] });

describe('ölçülen satır adları desenlerle eşleşiyor', () => {
  const çıkarılan = items();
  const bul = (key) => çıkarılan.find((i) => i.key === key)?.values?.[0] ?? null;

  it('köprünün beş bileşeni de okunuyor', () => {
    expect(bul('isletmeNakitAkisi')).toBe(7695330000);
    expect(bul('yatirimNakitAkisi')).toBe(-3554310000);
    expect(bul('finansmanNakitAkisi')).toBe(-194124000);
    expect(bul('kurCevrimEtkisi')).toBe(-13853000);
    expect(bul('digerNakitHareketi')).toBe(0);
  });

  it('net değişim ve dönem başı/sonu okunuyor', () => {
    expect(bul('netNakitDegisimi')).toBe(3933043000);
    expect(bul('donemBasiNakit')).toBe(5460127000);
    expect(bul('donemSonuNakit')).toBe(9393170000);
  });

  it('BENZER AMA FARKLI satırlar karışmıyor', () => {
    // "Diğer Nakit ve Nakit Benzerlerindeki Artış" net değişim DEĞİLDİR;
    // "Nakit ve Nakit Benzerleri" bir bilanço kalemidir, akış değil.
    expect(bul('netNakitDegisimi')).not.toBe(0);
    expect(bul('netNakitDegisimi')).not.toBe(9393170000);
  });
});

describe('köprü mutabakatı', () => {
  it('GERÇEK VERİ — BRSAN köprüsü kapanıyor', () => {
    const r = reconcileCashBridge(items());
    expect(r.reconciled).toBe(true);
    expect(r.computed).toBe(3933043000);
    expect(r.reported).toBe(3933043000);
    expect(r.difference).toBe(0);
  });

  it('bağımsız çapraz kontrol de doğruluyor', () => {
    // dönem sonu − dönem başı = net değişim
    const r = reconcileCashBridge(items());
    expect(r.crossCheck.delta).toBe(3933043000);
    expect(r.crossCheck.agrees).toBe(true);
  });

  it('REGRESYON — bir kalem yanlış okunursa köprü KAPANMAZ', () => {
    // Tam olarak bu yüzden var: satır eşleşmesi bozulduğunda sessiz kalmasın.
    const bozuk = BRSAN_ROWS.map((r) => (
      r.itemDescTr.includes('Yatırım Faaliyetlerinden Kaynaklanan')
        ? { ...r, value1: -100000000 } // yanlış satır okunmuş gibi
        : r
    ));
    const r = reconcileCashBridge(items(bozuk));
    expect(r.reconciled).toBe(false);
    expect(r.reason).toContain('KAPANMIYOR');
  });

  it('bileşen eksikse "kapanıyor" DEMEZ', () => {
    // "Bilmiyoruz" ile "kapanıyor" aynı şey değildir.
    const r = reconcileCashBridge([
      itemOf('isletmeNakitAkisi', 100),
      itemOf('netNakitDegisimi', 100),
    ]);
    expect(r.reconciled).toBe(false);
    expect(r.missing).toContain('yatirimNakitAkisi');
  });

  it('net değişim satırı yoksa doğrulanamaz', () => {
    const r = reconcileCashBridge([
      itemOf('isletmeNakitAkisi', 100),
      itemOf('yatirimNakitAkisi', -40),
      itemOf('finansmanNakitAkisi', -10),
    ]);
    expect(r.reconciled).toBe(false);
    expect(r.reason).toMatch(/Net nakit değişimi satırı bulunamadı/);
  });

  it('opsiyonel bileşenler yoksa sıfır sayılır', () => {
    // Kur etkisi/diğer çoğu tabloda yok; yokluğu köprüyü bozmamalı.
    const r = reconcileCashBridge([
      itemOf('isletmeNakitAkisi', 100),
      itemOf('yatirimNakitAkisi', -40),
      itemOf('finansmanNakitAkisi', -10),
      itemOf('netNakitDegisimi', 50),
    ]);
    expect(r.reconciled).toBe(true);
  });

  it('yuvarlama toleransı var ama sınırlı', () => {
    const yakin = reconcileCashBridge([
      itemOf('isletmeNakitAkisi', 1_000_000),
      itemOf('yatirimNakitAkisi', 0),
      itemOf('finansmanNakitAkisi', 0),
      itemOf('netNakitDegisimi', 1_000_500), // %0,05 fark
    ]);
    expect(yakin.reconciled).toBe(true);

    const uzak = reconcileCashBridge([
      itemOf('isletmeNakitAkisi', 1_000_000),
      itemOf('yatirimNakitAkisi', 0),
      itemOf('finansmanNakitAkisi', 0),
      itemOf('netNakitDegisimi', 1_500_000), // %50 fark
    ]);
    expect(uzak.reconciled).toBe(false);
  });

  it('bozuk girdide çökmüyor', () => {
    expect(reconcileCashBridge(null).reconciled).toBe(false);
    expect(reconcileCashBridge([]).reconciled).toBe(false);
  });
});

describe('kaynak hükmü köprüye bağlı', () => {
  it('GERÇEK VERİ — köprü kapanınca OPERATIONS hükmü verilebilir', () => {
    const c = classifyDebtImprovementSource(items());
    expect(c.source).toBe('OPERATIONS');
    expect(c.reconciliation.reconciled).toBe(true);
  });

  it('REGRESYON — köprü kapanmazsa kaynak hükmü İNER', () => {
    // Ölçülen vaka: doğru sonuca kanıtsız varılmıştı. Artık varılamaz.
    const eksik = [
      itemOf('isletmeNakitAkisi', 7695330000),
      itemOf('finansmanNakitAkisi', -194124000),
      // yatırım ayağı yok → köprü kapanamaz
    ];
    const c = classifyDebtImprovementSource(eksik);
    expect(c.source).toBe('UNRECONCILED');
    expect(c.reason).toContain('kaynak belirlenemedi');
  });

  it('attributionAllowed yalnız kapanan köprüde true', () => {
    expect(attributionAllowed(reconcileCashBridge(items()))).toBe(true);
    expect(attributionAllowed({ reconciled: false })).toBe(false);
    expect(attributionAllowed(null)).toBe(false);
  });

  it('kalem hiç yoksa eski UNKNOWN davranışı korunur', () => {
    expect(classifyDebtImprovementSource([]).source).toBe('UNKNOWN');
  });
});
