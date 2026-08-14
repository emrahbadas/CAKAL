import { describe, it, expect } from 'vitest';

import guards from '../apps/desktop/electron/decision-guards.cjs';

const {
  isCommanderFreshMarketScanRequest,
  responseContainsEquityRanking,
  evaluateUngovernedRankingGate,
} = guards;

/**
 * Bu paket, oturumun başındaki gerçek hatayı sabitler:
 * "en sağlam 3 tanesini sırala" → ne actionable ne fresh-scan sayıldı,
 * karar kapısı hiç çalışmadı, model get_bist_gainers ile sığ cevap verdi.
 *
 * İKİ KATMAN test edilir:
 *   1. Giriş niyeti (regex) — açık kalıpları yakalar, kapsayıcı DEĞİL
 *   2. Çıkış kapısı — giriş kaçsa bile sıralamayı yönetimsiz bırakmaz
 */

const toolEvent = (tool) => ({ type: 'tool_call', tool });

describe('giriş niyeti — sıralama/üstünlük talepleri', () => {
  const shouldTrigger = [
    'bist en iyi hisseler hangileri',
    'borsada en güçlü 5 hisseyi sırala',
    'hisse önerir misin',
    'top 5 aday hisse',
    'bist ilk 3 hisse',
    'hangi hisseler umut vadediyor',
    'borsa icin en cazip 3 tanesi',
    'hisse senedi seçer misin',
    'sen olsan hangi hisseyi alırdın',
    'bu listedeki hisselerden hangileri daha mantıklı',
    'bist hisseleri arasında hangisi daha iyi',
  ];

  for (const message of shouldTrigger) {
    it(`tetikler: "${message}"`, () => {
      expect(isCommanderFreshMarketScanRequest(message)).toBe(true);
    });
  }

  it('finans dışı sıralama talebini tetiklemez', () => {
    expect(isCommanderFreshMarketScanRequest('en iyi 3 telefon hangisi')).toBe(false);
    expect(isCommanderFreshMarketScanRequest('bana en iyi 5 filmi sırala')).toBe(false);
  });

  it('bilgi amaçlı finans sorusunu gereksiz tetiklemez', () => {
    expect(isCommanderFreshMarketScanRequest('THYAO grafiğini göster')).toBe(false);
    expect(isCommanderFreshMarketScanRequest('bist bugün nasıl kapandı')).toBe(false);
  });

  // GİRİŞ KATMANININ SINIRI — bilinçli olarak kabul edilmiştir.
  // Bu mesajlar finans kelimesi içermez; bağlam önceki turdan gelir. Giriş
  // katmanı bunu bilemez ve bilmeye çalışmamalıdır (mesajı tahmin etmek
  // sonsuz regex'e götürür). Bunlar ÇIKIŞ kapısında yakalanır.
  const cannotBeCaughtOnInput = [
    'en sağlam 3 tanesini sırala',   // oturumdaki gerçek hata cümlesi
    'ensağlam üçünü söyle',
    'bunlardan hangileri iyi',
  ];

  for (const message of cannotBeCaughtOnInput) {
    it(`giriş katmanı yakalayamaz (tasarım gereği): "${message}"`, () => {
      expect(isCommanderFreshMarketScanRequest(message)).toBe(false);
    });
  }
});

describe('çıkış tespiti — cevap sıralama içeriyor mu', () => {
  it('numaralı hisse listesini yakalar', () => {
    expect(responseContainsEquityRanking('1) TUREX — güçlü\n2) SSAAT — orta\n3) ISVEA')).toBe(true);
    expect(responseContainsEquityRanking('1. TUREX\n2. SSAAT')).toBe(true);
  });

  it('madde işaretli hisse listesini yakalar', () => {
    expect(responseContainsEquityRanking('- TUREX — momentum güçlü\n- SSAAT — hacim yüksek')).toBe(true);
  });

  it('üstünlük ifadesini yakalar', () => {
    expect(responseContainsEquityRanking('Bugünün en sağlam 3 hissesi şunlar')).toBe(true);
    expect(responseContainsEquityRanking('İlk 3 aday aşağıda')).toBe(true);
  });

  it('sıralama içermeyen cevabı işaretlemez', () => {
    expect(responseContainsEquityRanking('TUREX bugün %2.19 yükseldi, hacim ortalamanın üzerinde.')).toBe(false);
    expect(responseContainsEquityRanking('Bilanço kalitesi iyi görünüyor ama fiyatlanma ölçülmedi.')).toBe(false);
    expect(responseContainsEquityRanking('')).toBe(false);
  });
});

describe('UNGOVERNED_RANKING kapısı', () => {
  // Gerçekçi fixture: ÇAKAL'ın hisse cevabı her zaman finans sözcüğü içerir.
  const ranking = 'BIST hisse sıralaması:\n1) TUREX — güçlü\n2) SSAAT — orta\n3) ISVEA — zayıf';

  it('hiç araç çalışmadan sıralama üretilirse bloklar', () => {
    const result = evaluateUngovernedRankingGate('en sağlam 3 tanesini sırala', ranking, []);
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
    expect(result.response).toMatch(/araştırma kapısı açılmadı/i);
  });

  it('sadece get_bist_gainers ile sıralama üretilirse bloklar (asıl hata senaryosu)', () => {
    const result = evaluateUngovernedRankingGate(
      'en sağlam 3 tanesini sırala',
      ranking,
      [toolEvent('get_bist_gainers')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
    expect(result.reason).toMatch(/get_bist_gainers/);
  });

  it('yönetilmiş tarama çalıştıysa geçirir', () => {
    const result = evaluateUngovernedRankingGate(
      'en sağlam 3 tanesini sırala',
      ranking,
      [toolEvent('get_bist_gainers'), toolEvent('run_investment_research_scan')],
    );
    expect(result).toBeNull();
  });

  it('verify_claim çalıştıysa geçirir', () => {
    const result = evaluateUngovernedRankingGate('en iyi 3', ranking, [toolEvent('verify_claim')]);
    expect(result).toBeNull();
  });

  it('sıralama yoksa devreye girmez', () => {
    const result = evaluateUngovernedRankingGate(
      'TUREX nasıl',
      'TUREX bugün %2.19 yükseldi.',
      [toolEvent('get_stock_price')],
    );
    expect(result).toBeNull();
  });

  it('pazaryeri/ürün bağlamında devreye girmez', () => {
    const result = evaluateUngovernedRankingGate(
      'trendyol en iyi 3 telefon ilanı',
      '1) IPHONE — uygun\n2) SAMSUN — orta',
      [],
    );
    expect(result).toBeNull();
  });

  it('finans dışı mesajda devreye girmez', () => {
    expect(evaluateUngovernedRankingGate('en iyi 3 film', '1) MATRIX\n2) INCEPTION', [])).toBeNull();
  });

  it('mesajda finans kelimesi olmasa da cevaptan bağlam kurar (bağlamsal takip sorusu)', () => {
    // Oturumdaki gerçek hata: "en sağlam 3 tanesini sırala" tek başına
    // borsa/hisse kelimesi içermiyordu; bağlam önceki turdandı.
    const result = evaluateUngovernedRankingGate(
      'en sağlam 3 tanesini sırala',
      ranking,
      [toolEvent('get_bist_gainers')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });
});

describe('giriş kaçsa bile çıkış yakalar (asıl emniyet supabı)', () => {
  // ChatGPT'nin uyardığı kaçış senaryoları: yazım hatası, bağlamsal referans,
  // dolaylı talep. Giriş regex'i bunların hepsini yakalayamaz — yakalamak
  // zorunda da değil, çünkü çıkış kapısı arkada duruyor.
  const leakyMessages = [
    'ensağlam üçünü söyle',
    'bunlardan hangileri iyi',
    'şunları bi değerlendir bakalım',
    'yukarıdakileri kıyasla',
  ];

  for (const message of leakyMessages) {
    it(`çıkışta yakalanır: "${message}"`, () => {
      const result = evaluateUngovernedRankingGate(
        message,
        'BIST hisse listesi:\n1) TUREX — güçlü\n2) SSAAT — orta',
        [toolEvent('get_bist_gainers')],
      );
      expect(result).toBeTruthy();
      expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
    });
  }
});

describe('kullanıcının adıyla verdiği semboller — karşılaştırma sıralama değildir', () => {
  // GERÇEK VAKA (11 Ağustos 2026, ajan monitörü):
  // "BRSAN ve MEYSU hakkında son haberleri tara ve karşılaştır" isteğinde
  // web_search iki kez çalıştı (17 + 19 citation) ama cevaptaki "- BRSAN: İZLE"
  // ve "1. BRSAN ve MEYSU için teknik seviye haritası" satırları sıralama
  // çapalarına düştü. Kapı ateşledi, ikinci bir LLM turu boşuna yandı ve nihai
  // cevap kullanıcının hiç istemediği bir sıralamayı "geri çekerek" başladı.
  // Kapı ADAY SEÇİMİNİ yönetir; evren yoksa yönetilecek seçim de yoktur.
  const newsComparison = [
    '## Hızlı Özet',
    '- BRSAN: Haber akışı kurumsal; bilanço ve kârlılık önde.',
    '- MEYSU: Halka arz sonrası gelişmeler ve hukuki süreç.',
    '',
    '## Son karar',
    '- BRSAN: İZLE',
    '- MEYSU: RİSKLİ / BEKLE',
    '',
    'İstersen bir sonraki adımda:',
    '1. BRSAN ve MEYSU için teknik seviye haritası',
    '2. Bilanço haberlerinin fiyatlanma durumu',
  ].join('\n');

  it('kullanıcı iki sembolü de adıyla verdiyse kapı ateşlemez', () => {
    const result = evaluateUngovernedRankingGate(
      'BRSAN ve MEYSU hakkında son haberleri tara ve karşılaştır',
      newsComparison,
      [toolEvent('web_search'), toolEvent('get_stock_price')],
    );
    expect(result).toBeNull();
  });

  it('cevap kullanıcının vermediği bir kod getirirse kapı yine ateşler', () => {
    // Evren genişledi: TUREX kullanıcıdan gelmedi → bu bir aday seçimidir.
    const result = evaluateUngovernedRankingGate(
      'BRSAN ve MEYSU hakkında son haberleri tara ve karşılaştır',
      `${newsComparison}\n- TUREX: bunlardan daha iyi`,
      [toolEvent('web_search'), toolEvent('get_stock_price')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });

  it('açık sıralama talebinde kaçış kapalıdır', () => {
    const result = evaluateUngovernedRankingGate(
      'BRSAN ve MEYSU hisselerinden hangisi daha iyi, sırala',
      newsComparison,
      [toolEvent('web_search')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });

  it('cevapta üstünlük dili varsa kaçış kapalıdır', () => {
    const result = evaluateUngovernedRankingGate(
      'BRSAN ve MEYSU karşılaştır',
      `${newsComparison}\n\nBunlar bugünün en sağlam 2 hissesi.`,
      [toolEvent('web_search')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });

  it('kapı hâlâ sıralama olarak TANIR — sadece yönetim gereği düşer', () => {
    // responseContainsEquityRanking davranışı değişmemeli: metin liste
    // şeklindedir; kaçış kapının SONUCUNDA olur, tespitinde değil.
    expect(responseContainsEquityRanking(newsComparison)).toBe(true);
  });
});

/**
 * CANLI HATA REGRESYONU — 15 Ağustos 2026
 *
 * "telegramdaki kanalları listele" sorusuna verilen KANAL LİSTESİ hisse
 * sıralaması sanıldı; kapı iki kez ateşledi, bir LLM turu boşa yandı ve
 * kullanıcı cevap yerine "Sıralama üretilemedi" bloğu gördü.
 *
 * Kanal adları gerçektir (hesaptan okundu). Çapa deseni yalnız ŞEKLE
 * bakıyordu — "satır başında numara + 3-6 büyük harf":
 *
 *   "1. BORSA İZİNDE"        -> BORSA
 *   "4. YILDIZ PAZAR"        -> YILDIZ
 *   "6. MEYVE SEBZE HAL..."  -> MEYVE
 *   "8. SAHİBİNDEN SEBZE..." -> SAHİBİ
 *
 * Dördü de sicilde yok. Finans bağlamı bile cevaptan geliyordu ("Borsa Haber
 * Hisse" bir KANAL ADI) — kullanıcı borsadan hiç söz etmemişti.
 */
describe('REGRESYON — kanal listesi hisse sıralaması değildir', () => {
  const telegramKanalListesi = [
    '1. BORSA İZİNDE',
    '2. Borsa Haber Hisse',
    '3. Türkiye Nakliye Telegram 🇹🇷',
    '4. YILDIZ PAZAR',
    '5. Pazar Center (Türkiye)',
    '6. MEYVE SEBZE HAL FİYATLARI',
    '7. 🇹🇷 TÜRKİYE YATIRIM AKADEMİSİ ⚜️',
    '8. SAHİBİNDEN SEBZE MEYVE AL-SAT',
    '9. Borsa İstanbul #Bist',
  ].join('\n');

  it('kanal listesi sıralama SAYILMAZ', () => {
    expect(responseContainsEquityRanking(telegramKanalListesi)).toBe(false);
  });

  it('kapı susar — cevap kullanıcıya ulaşır', () => {
    const result = evaluateUngovernedRankingGate(
      'telegramdaki kanalları listele',
      telegramKanalListesi,
      [toolEvent('read_telegram_channels')],
    );
    expect(result).toBeNull();
  });

  it('sicilde olmayan büyük harfli kelimeler çapa üretmez', () => {
    for (const satir of ['1. BORSA İZİNDE', '4. YILDIZ PAZAR', '6. MEYVE SEBZE', '8. SAHİBİNDEN AL-SAT']) {
      expect(responseContainsEquityRanking(satir)).toBe(false);
    }
  });

  it('KAPSAM DARALMADI — gerçek semboller hâlâ çapa üretir', () => {
    // Düzeltmenin kapıyı köreltmediğinin kanıtı: aynı liste biçimi,
    // bu kez sicilde kayıtlı sembollerle.
    const gercekSiralama = '1) TUREX — güçlü hacim\n2) SSAAT — MA50 üzeri\n3) BRSAN — bilanço olumlu';
    expect(responseContainsEquityRanking(gercekSiralama)).toBe(true);

    const result = evaluateUngovernedRankingGate(
      'bistte en iyi hisseleri sırala',
      gercekSiralama,
      [toolEvent('read_telegram_channels')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });

  it('KAPSAM DARALMADI — kod geçmese de üstünlük dili yakalanır', () => {
    // Dil marker'ları sicilden bağımsızdır: hüküm kurulmuşsa kod aranmaz.
    const result = evaluateUngovernedRankingGate(
      'borsada ne alayım',
      'Sana en sağlam 3 hisse öneriyorum: hacmi genişleyenler.',
      [toolEvent('read_telegram_channels')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });
});
