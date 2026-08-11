import { describe, it, expect } from 'vitest';

import contract from '../apps/desktop/electron/research-contract.cjs';
import guards from '../apps/desktop/electron/decision-guards.cjs';

const { requiresResearchContract, createResearchRun, countDistinctTickers } = contract;
const { isCommanderFinanceMessage } = guards;

/**
 * KAPSAM KONUŞMADAN TAŞINIR, KANIT TAŞINMAZ.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026 canlı oturum, 2. tur):
 *   "bilanço + fiyatlama karşılaştırması da yap"
 *   → skor 0, sinyal "finans baglami yok", sözleşme AÇILMADI.
 * Oysa konuşma BRSAN ve MEYSU üzerineydi ve tur İNCELE/RİSKLİ hükmü üretti.
 *
 * İki bağımsız kusur vardı:
 *   1. COMMANDER_FINANCE_DOMAIN_RE'de "bilanço" yoktu — mesaj finans bile sayılmadı.
 *   2. Skor yalnız yeni mesaja bakıyordu — iki şirketi göremedi.
 */

const PRIOR = ['BRSAN', 'MEYSU'];
const skor = (m, prior = []) => requiresResearchContract(m, { priorEntities: prior });

describe('finans sözlüğü — temel analiz sözcükleri', () => {
  for (const kelime of ['bilanço', 'mali tablo', 'değerleme', 'temettü', 'özkaynak', 'net borç', 'fiyatlanma']) {
    it(`"${kelime}" finans bağlamı sayılır`, () => {
      expect(isCommanderFinanceMessage(`${kelime} hakkında ne diyorsun`)).toBe(true);
    });
  }

  it('genel "fiyat" sözcüğü tek başına finans bağlamı DEĞİLDİR', () => {
    // Pazaryeri mesajlarını finans sanmamalı.
    expect(isCommanderFinanceMessage('bu ürünün fiyatı nedir')).toBe(false);
  });
});

describe('sözleşme kapsamı — bağlamdan devralma', () => {
  it('ASIL VAKA: sembolsüz takip mesajı önceki turun kapsamını devralır', () => {
    const r = skor('bilanço + fiyatlama karşılaştırması da yap', PRIOR);
    expect(r.required).toBe(true);
    expect(r.signals.join(' ')).toContain('baglamdan');
  });

  it('kapsam verilmezse aynı mesaj yönetimsiz kalır (regresyonun kendisi)', () => {
    expect(skor('bilanço + fiyatlama karşılaştırması da yap', []).required).toBe(false);
  });

  it('mesaj kendi sembolünü söylüyorsa devralma YAPILMAZ (kullanıcı kapsamı yeniden çizdi)', () => {
    const r = skor('şimdi sadece ASELS bak', PRIOR);
    expect(countDistinctTickers('şimdi sadece ASELS bak')).toBe(1);
    expect(r.signals.join(' ')).not.toContain('baglamdan');
    expect(r.required).toBe(false);
  });

  it('bağlamsal işlem sorusu finans sözcüğü olmadan da yakalanır', () => {
    // "peki bugün alınır mı" — tek bir finans sözcüğü yok, niyet var.
    const r = skor('peki bugün alınır mı', ['BRSAN']);
    expect(r.required).toBe(true);
    expect(r.signals).toContain('hisse islem karari');
  });

  it('devralma TEK BAŞINA yetmez; niyet şart', () => {
    for (const gurultu of ['teşekkürler', 'hava durumu nasıl', 'bugün hangi filmi izlesem']) {
      const r = skor(gurultu, PRIOR);
      expect(r.required).toBe(false);
      expect(r.score).toBe(0);
    }
  });
});

describe('çok şirketli karşılaştırma sinyali', () => {
  it('iki şirket + karşılaştırma talebi eşiği geçer', () => {
    const r = skor('BRSAN ve MEYSU hakkında son haberleri tara ve karşılaştır');
    expect(r.required).toBe(true);
    expect(r.signals).toContain('coklu sirket karsilastirmasi');
  });

  it('döviz pariteleri şirket sayılmaz', () => {
    // investable_candidate MARKET_SESSION_STATUS ister ve tek üreticisi BIST'e
    // özgüdür; FX için sözleşme açmak kapanamayan bir duvar üretir.
    expect(countDistinctTickers('USDTRY ve EURTRY karşılaştır')).toBe(0);
    expect(skor('USDTRY ve EURTRY karşılaştır').required).toBe(false);
  });

  it('tek şirket + karşılaştırma sözcüğü sinyal üretmez', () => {
    expect(skor('BRSAN bilançosunu geçen çeyrekle karşılaştır').signals)
      .not.toContain('coklu sirket karsilastirmasi');
  });
});

describe('createResearchRun kapsamı geçirir', () => {
  it('priorEntities koşunun karmaşıklık hesabına yansır', () => {
    const run = createResearchRun({
      userQuestion: 'bilanço + fiyatlama karşılaştırması da yap',
      priorEntities: PRIOR,
    });
    expect(run.complexity.required).toBe(true);
  });

  it('priorEntities yoksa davranış eskisi gibi', () => {
    const run = createResearchRun({ userQuestion: 'bilanço + fiyatlama karşılaştırması da yap' });
    expect(run.complexity.required).toBe(false);
  });

  it('THYAO temel vakası korunuyor (kapsam olmadan da açılır)', () => {
    expect(skor('THYAO bugün alınır mı').required).toBe(true);
  });
});
