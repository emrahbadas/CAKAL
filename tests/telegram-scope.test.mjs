import { describe, it, expect } from 'vitest';

import scope from '../apps/desktop/electron/telegram-scope.cjs';

const {
  detectRequestedWindow,
  resolveTimeWindow,
  windowStartIso,
  filterMessagesByWindow,
  savedChannelIds,
} = scope;

/**
 * TASARIM KARARI (15 Ağustos 2026, Kaptan'ın isteği)
 *
 * "Telegramdaki birçok şeyi ÇAKAL'ın görmesi gereksiz, çok fazla gürültü
 * olur... default olarak kullanıcı aksini söylemedikçe telegram taramasında
 * sadece o günün mesajları taranır."
 *
 * İki kural burada sabitlenir:
 *   1. Aralık VARSAYILAN olarak bugündür.
 *   2. Genişletme yetkisi KULLANICININ ifadesindedir, modelin parametresinde
 *      değil. Model "month" yazabilir; kullanıcı istemediyse geçmez.
 *      Bu, "beyan kanıt değildir" kuralının kapsam tarafındaki karşılığı.
 */

describe('kullanıcı ifadesinden aralık tespiti', () => {
  const cases = [
    ['telegram kanallarında ne var', null],
    ['bugün ne konuşulmuş', 'today'],
    ['son 24 saat içinde bir şey var mı', 'today'],
    ['son 1 hafta ne yazılmış', 'week'],
    ['son bir hafta THYAO geçti mi', 'week'],
    ['geçen hafta ne oldu', 'week'],
    ['haftalık özet çıkar', 'week'],
    ['son 7 gün tara', 'week'],
    ['son 1 ay ne konuşulmuş', 'month'],
    ['son bir ay içinde', 'month'],
    ['geçen ay ne oldu', 'month'],
    ['son 30 gün', 'month'],
    ['tüm geçmişi tara', 'all'],
    ['bütün mesajları oku', 'all'],
    ['arşivi tara', 'all'],
  ];

  for (const [mesaj, beklenen] of cases) {
    it(`"${mesaj}" → ${beklenen ?? 'açık istek yok'}`, () => {
      expect(detectRequestedWindow(mesaj)).toBe(beklenen);
    });
  }

  it('TÜRKÇE TUZAĞI — "ay" içeren başka kelimeler aylık sanılmaz', () => {
    // "ayrıca", "ayarlar", "ayna": hepsi "ay" ile başlar.
    for (const mesaj of ['ayrıca ne var', 'ayarları aç', 'kanal ayarlarını göster']) {
      expect(detectRequestedWindow(mesaj)).toBeNull();
    }
  });

  it('BÜYÜK HARF — tr-TR küçültmesi uygulanıyor', () => {
    // Düz toLowerCase() Türkçe 'İ' ve 'I' için yanlış sonuç verir.
    expect(detectRequestedWindow('SON 1 AY NE OLMUŞ')).toBe('month');
    expect(detectRequestedWindow('BUGÜN NE VAR')).toBe('today');
  });

  it('iki aralık birden geçerse GENİŞ olan kazanır', () => {
    // Daraltmak kullanıcının istemediği veriyi gizlemek olurdu.
    expect(detectRequestedWindow('bugün değil, son 1 ay içinde')).toBe('month');
  });
});

describe('etkin aralık — kullanıcı otoritedir', () => {
  it('VARSAYILAN bugündür', () => {
    const r = resolveTimeWindow(undefined, 'telegram kanallarını oku');
    expect(r.window).toBe('today');
    expect(r.userAsked).toBeNull();
  });

  it('MODEL TEK BAŞINA GENİŞLETEMEZ', () => {
    // Kritik kural: model "month" istedi ama kullanıcı öyle bir şey demedi.
    const r = resolveTimeWindow('month', 'telegram kanallarını oku');
    expect(r.window).toBe('today');
    expect(r.clamped).toBe(true);
    expect(r.requestedByModel).toBe('month');
  });

  it('kullanıcı açıkça isterse genişler', () => {
    const r = resolveTimeWindow('month', 'son 1 ay ne konuşulmuş');
    expect(r.window).toBe('month');
    expect(r.clamped).toBe(false);
  });

  it('kullanıcı isterse model daraltsa BİLE genişler', () => {
    // Kullanıcı "son 1 hafta" dedi, model "today" yazdı → kullanıcı kazanır.
    const r = resolveTimeWindow('today', 'son 1 hafta ne yazılmış');
    expect(r.window).toBe('week');
    expect(r.clamped).toBe(true);
  });

  it('geçersiz parametre varsayılanı bozmaz', () => {
    expect(resolveTimeWindow('gecen_sene', 'kanalları oku').window).toBe('today');
    expect(resolveTimeWindow(null, 'kanalları oku').window).toBe('today');
  });

  it('etiket kullanıcıya gösterilecek şekilde geliyor', () => {
    expect(resolveTimeWindow(undefined, 'oku').label).toBe('bugün');
    expect(resolveTimeWindow(undefined, 'son 1 ay').label).toBe('son 30 gün');
  });
});

describe('aralık başlangıcı', () => {
  it('"bugün" İSTANBUL gününe göre hesaplanır', () => {
    // Makine saati ≠ borsa saati. Kaptan GMT+1'de olabilir; onun gece
    // yarısı İstanbul'da ertesi gün. Aynı varsayım daha önce "bugün alım"
    // hükmünde yanlış güne düşmüştü.
    // 15 Ağustos 2026, 00:30 İstanbul = 14 Ağustos 21:30 UTC
    const now = new Date('2026-08-14T21:30:00Z');
    expect(windowStartIso('today', now)).toBe('2026-08-14T21:00:00.000Z'); // 15 Ağu 00:00 +03:00
  });

  it('İstanbul günü UTC gününden farklı olabilir', () => {
    // 14 Ağustos 22:30 UTC → İstanbul'da 15 Ağustos 01:30.
    // UTC gününe bakan bir hesap 14 Ağustos'u seçer ve YANLIŞ olur.
    const now = new Date('2026-08-14T22:30:00Z');
    const start = windowStartIso('today', now);
    expect(start).toBe('2026-08-14T21:00:00.000Z');
    expect(new Date(start).getTime()).toBeLessThan(now.getTime());
  });

  it('hafta/ay kayan penceredir, takvim değil', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    expect(windowStartIso('week', now)).toBe('2026-08-08T12:00:00.000Z');
    expect(windowStartIso('month', now)).toBe('2026-07-16T12:00:00.000Z');
  });

  it('"tüm geçmiş" sınırsızdır', () => {
    expect(windowStartIso('all', new Date())).toBeNull();
  });
});

describe('mesaj eleme', () => {
  const mesajlar = [
    { id: 1, date: '2026-08-15T09:00:00.000Z', text: 'bugün' },
    { id: 2, date: '2026-08-14T09:00:00.000Z', text: 'dün' },
    { id: 3, date: '2026-07-01T09:00:00.000Z', text: 'geçen ay' },
  ];

  it('aralık dışı mesajlar elenir', () => {
    const kalan = filterMessagesByWindow(mesajlar, '2026-08-15T00:00:00.000Z');
    expect(kalan.map(m => m.id)).toEqual([1]);
  });

  it('sınır dahildir', () => {
    const kalan = filterMessagesByWindow(mesajlar, '2026-08-14T09:00:00.000Z');
    expect(kalan.map(m => m.id)).toEqual([1, 2]);
  });

  it('sınır yoksa hepsi geçer', () => {
    expect(filterMessagesByWindow(mesajlar, null)).toHaveLength(3);
  });

  it('TARİHİ OKUNAMAYAN MESAJ ELENİR', () => {
    // "Belki aralıktadır" diye içeri almak kapsam beyanını yalan yapar.
    // Aralık dışı olmadığını kanıtlayamıyorsak aralık içinde sayamayız.
    const bozuk = [...mesajlar, { id: 4, date: null, text: 'tarihsiz' }, { id: 5, date: 'saçma', text: 'x' }];
    const kalan = filterMessagesByWindow(bozuk, '2026-08-15T00:00:00.000Z');
    expect(kalan.map(m => m.id)).toEqual([1]);
  });

  it('bozuk girdide çökmüyor', () => {
    expect(filterMessagesByWindow(null, '2026-08-15T00:00:00.000Z')).toEqual([]);
    expect(filterMessagesByWindow(mesajlar, 'geçersiz-tarih')).toHaveLength(3);
  });
});

describe('takip listesi kimlikleri', () => {
  it('tekilleştirir ve boşları eler', () => {
    expect(savedChannelIds([
      { id: '111', title: 'A' },
      { id: '111', title: 'A kopya' },
      { id: '  222  ', title: 'B' },
      { id: '', title: 'boş' },
      { title: 'idsiz' },
    ])).toEqual(['111', '222']);
  });

  it('SEÇİM YOKSA BOŞ DÖNER — sessizce tüm kanallara genişletmez', () => {
    // Boş seçimi "hepsi" saymak, kullanıcının daraltma isteğinin tam tersi
    // olurdu; çağıran taraf "seçim yapılmamış" durumunu ayırt edebilmeli.
    expect(savedChannelIds([])).toEqual([]);
    expect(savedChannelIds(null)).toEqual([]);
  });
});
