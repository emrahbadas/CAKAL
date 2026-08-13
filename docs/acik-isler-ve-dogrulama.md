# Açık İşler ve Doğrulama Listesi

**Son güncelleme:** 2026-08-14
**Bağlam:** 11 Ağustos 2026 tarihli canlı BRSAN/MEYSU oturumunun ajan log'undan çıkan kusur zinciri temizlendi. Bu dosya, o çalışmanın **kapanmayan** ve **kanıtlanmayan** kısımlarını tutar. Kapanan maddeler README'deki Yol Haritası'ndadır.

Kural: bir madde buradan ancak **ölçülmüş kanıtla** çıkar. "Yazıldı" yeterli değil, "çalıştığı görüldü" gerekir.

---

## 1. Canlı doğrulama — TAMAMLANDI (13 Ağustos 2026)

Dördü de gerçek kaynağa karşı çalıştırıldı ve **PASS** verdi. Koşum: commit `3f8ad0a`, Electron CDP üzerinden sürülen gerçek pencere, BIST kapalı (Istanbul 22:26–23:12).

| # | Ne | Canlı sonuç |
|---|---|---|
| 1.1 | **YoY isteği** | ✅ **PASS** — `yoyAvailable: true`, `yoyPeriods: ["2026/6","2025/6","2024/6","2023/6"]`. BRSAN 2026/6 ↔ 2025/6 gerçek karşılaştırma döndü (hasılat +%49,4, net kâr +%200,5) |
| 1.2 | **İleriden geriye prob** | ✅ **PASS** — pencere `2026/6` ile başladı, 2026/3'e düşmedi. 45 günlük varsayımın kalkışı canlıda doğrulandı |
| 1.3 | **Nakit akışı satır adları** | ✅ **PASS** — en riskli maddeydi. `get_cash_flow_breakdown` gerçek veri döndürdü (`source=is_yatirim_malitablo`), `NO_DATA` DEĞİL. İşletme nakdi 7,70 mlr TL çıkarıldı, kaynak `OPERATIONS` sınıflandı. Desenler gerçek `itemDescTr` değerleriyle tutuyor; korkulan "her borç yorumu bloklanır" senaryosu gerçekleşmedi |
| 1.4 | **Aracın gerçekten çağrılması** | ✅ **PASS** — model `get_cash_flow_breakdown`'ı borç yorumundan ÖNCE çağırdı; borç kalite kapısının ateşlemesi gerekmedi |

## 2. Ölçülmesi gereken maliyet/davranış değişiklikleri

Bunlar hata değil; **bilinçli genişletmeler**. Canlıda maliyeti ölçülmeden "doğru ayar" denemez.

| # | Ne değişti | Ölçülecek |
|---|---|---|
| 2.1 | Sözleşme artık daha çok turda açılıyor (haber karşılaştırması turu skor 2 → 4) | Plan reddi / yeniden deneme sıklığı, ek gecikme |
| 2.2 | Router daha çok turu `deep_analysis`'e (gpt-5.4) yolluyor | Token maliyeti artışı; "işlem seviyesi asla zayıf modele düşmez" kuralının bedeli kabul edilebilir mi |
| 2.3 | `internalTurn` + `commitConversationTurn` | Çok kapılı gerçek bir turdan sonra geçmişte **2 kayıt** kaldığı görülmeli. Şu an yalnız *kaynak sözleşmesi* testle sabit, **davranış değil** |
| 2.4 | Volatilite tavanı core'da 35 → 5 | Core tarafı canlı hattan çağrılmadığı için etkisi bugün YOK; Adım 4'ün kalanı yapılınca eleme oranı ölçülmeli |
| 2.5 | Kapsam brifingi | **ÖLÇÜLDÜ (13 Ağustos).** Brifing çalışıyor ve ETKİLİ: hiçbir turda `HÜKÜM İNDİRİLDİ` ateşlemedi, yani model brifingi okuyup uydu. MEYSU turunda modelin kendi cümlesi brifing metninden birebir geldi ("uygulanabilir işlem talimatıdır"). **MALİYET GERÇEK:** brifing `chat()` başına çalıştığı için tek kullanıcı isteğinde birden çok kez tetiklenebiliyor — MEYSU turunda 4 sözleşme kapanışı + 2 brifing görüldü, süre 481s. Basit sorularda hiç tetiklenmiyor (THYAO kaç TL → 42s, brifing yok). Optimizasyon adayı: brifingi istek başına tekle |

## 3. Kapanmayan işler

### 3.1 Sözleşme / huni zinciri

- **Onarım aracı ADIYLA isteniyor ama ZORLANMIYOR.** Sözleşme doğru hedefi hesaplıyor ("Eksik kanıtı toplayacak araçlar: `get_bist_board`") ve onarım mesajına yazıyor; model başka araç çağırıyor (`get_stock_price`, `verify_claim`) ve kimse itiraz etmiyor. **Ölçüldü (13 Ağustos):** `get_bist_board` onarım turunda hiç çağrılmadı, `MARKET_SESSION_STATUS` eksik kaldı. Yani erişilemeyen kanıt değil, **yönlendirilemeyen araç** var. Dispatcher onarım turunda hedef aracı zorlayabilmeli (veya çağrılmadığını kayda geçirmeli).
- **İlk kompozisyon boşa gidiyor.** Akış: araçlar → **1. cevap** → kapanış → onarım → araçlar → **2. cevap**. Ölçüldü: 72,3s + 78,5s = ~151 saniye ve iki tam kompozisyon. Kapsam brifingi ikisinde de çalıştı (doğru), ama kullanıcıya yalnız ikincisi gidiyor — birincisi tamamen israf. Doğru sıra: **plan → araştırma → kanıt doğrulama → onarım → nihai kapsam → TEK composer**. Brifingi kaldırmak çözüm değil; onarımı composer'dan ÖNCE bitirmek çözüm.
- **Adım 5 — kademe 5–7 (`DEEP_RESEARCH`, `FINAL_GATE`) yok.** `run_investment_research_scan` charter → evren → eleme yapıp derin kademeleri `nextRequiredStates` ile devrediyor. Huni sözleşmesi `FINAL_GATE`'e ulaşmayan huniyi doğru şekilde `BLOCKED` sayıyor.
- **`CANDIDATE_FUNNEL` kanıt sınıfı kaydedilmedi.** Adım 2 kilidi kalktı ama üretilemeyen bir sınıfı plana açmak kapanamayan duvar üretir. Derin kademeler gelince kaydedilecek.
- **Adım 4'ün kalanı:** `runInvestmentScreening` hâlâ canlı hattan çağrılmıyor. Volatilite *semantiği* tekleşti, **skorlayıcı gövdeleri hâlâ iki yerde**. Aynı çağrı zincirini değiştirdiği için Adım 5 ile birlikte yapılmalı.
- ~~**Kapanışın nihai çözümü.**~~ **YAPILDI (12 Ağustos 2026).** `buildCoverageBriefing(coverage)` alt soruları TAM / KISMİ / BLOKE diye ayırıp eksik kanıt sınıflarıyla birlikte composer'a veriyor; `ai-service.cjs` cevap taslağı hazır olduğunda ve kapanış COMPLETE değilse tek bir yeniden yazım turu açıyor (`tool_choice: 'none'` — araç açılsaydı kapsam brifingden sonra değişir ve brifing yalan olurdu). Kapsam bir kez hesaplanıp hem brifingde hem kapanış raporunda kullanılıyor; iki ayrı hesap ayrışabilirdi.
  **SINIR:** brifing bir KAPI DEĞİL, bilgilendirmedir — modelin uymasını umar, garanti etmez. `neutralizeEquityVerdicts` ve seviye kapısı yerinde kaldı. Model sözü kanıt değildir; brifing kapının yerine geçmez, önüne geçer. Brifing turu başarısız olursa eski davranışa düşülür.
  **MALİYET:** kapanmayan her sözleşmede bir ek LLM çağrısı. Canlıda ölçülmeli (bkz. bölüm 2).
  Test: `tests/coverage-briefing.test.mjs` (13 test).

### 3.2 Kanıt kalitesi

- **Seviye TÜRETİM kanıtı hâlâ zorunlu değil — en değerli açık madde.** 12 Ağustos'ta eklenen iki kural (sözleşme kapanmadan rakam yok + rakam ölçümle aynı mertebede olmalı) gerçek koruma sağlıyor, ama **yeterli değil**. Canlı MEYSU turunda seviyeler yalnız `MARKET_SESSION_STATUS` eksik olduğu için engellendi. Oysa seans durumu bir **zaman etiketidir** (canlı mı, gecikmeli mi, son kapanış mı), seviyenin türetim kanıtı değildir. Giriş/stop/hedef için gereken ve HİÇBİRİ zorunlu olmayan kanıtlar: salınım dipleri/tepeleri, yatay destek/direnç, ATR veya eşdeğer volatilite tamponu, giriş yöntemi (kırılım mı destekten dönüş mü), hedef yöntemi (teknik direnç mi temel değer mi), risk/getiri oranı, işlem vadesi, seviyenin formülü ve dayandığı kanıt kimliği.
  **TEHLİKE:** mevcut sözleşmeye göre yalnız seans verisi gelince kapı AÇILABİLİR ve model yine ölçümsüz seviye üretebilir. Yani bugünkü koruma doğru sonucu **yanlış gerekçeyle** veriyor.
  Regresyon testi adı: `levels_must_remain_blocked_when_only_session_is_missing_but_derivation_evidence_is_absent`
- **Nakit köprüsü mutabakatı (attribution gate) yok.** Nakit akışı satırları düzeldi ama köprünün KAPANDIĞI doğrulanmıyor. Gereken: `operating + investing + financing + fxEffect === balanceDelta` kontrolü ve bir `reconciled` bayrağı. `reconciled !== true` iken composer "işletmeden geldi" veya "finansmanla makyaj yok" diyememeli; onarıma dönmeli, onarım da başarısızsa "kaynak belirlenemedi" demeli. **Ölçülen vaka:** BRSAN turunda ÇAKAL doğru sonuca vardı ama köprüyü kapatamadan vardı — eksikliği fark etti, yine de hüküm kurdu. Sonuç doğruydu; yöntem değildi.
- **YouTube arama metadata'sı araştırma kanıtı sayılıyor.** "2 video bulundu" ile "içeriği incelendi" aynı şey değil; `RESEARCH_EVIDENCE` bugün ilkiyle COMPLETE oluyor. Cevapta uzman/kurum adı, görüş tarihi, bağlantı, tezin dayanağı, incelenen paylaşım sayısı, platform dağılımı ve tekrar ayıklaması yok. Doğru ayrım: `YOUTUBE_SEARCH_METADATA` (COMPLETE olabilir) ≠ `SOCIAL_SENTIMENT_EVIDENCE` ≠ `EXPERT_RESEARCH_EVIDENCE`.
- ~~**Sembol dedektörü Türkçe kelimeleri hisse sanıyor.**~~ **BULUNDU VE DÜZELTİLDİ (13 Ağustos 2026).** `"BRSAN'ın son dönemini GEÇEN YILIN AYNI DÖNEMİYLE karşılaştır"` → `['BRSAN','YILIN','AYNI']` → `coklu sirket (3)` → skor 4/4 → gereksiz araştırma sözleşmesi → tek şirketlik soru **81 saniye** sürdü (ilk araç bekletildi, plan kuruldu, aynı araç tekrar çağrıldı). Kara liste yapısal olarak yetersizdi: Türkçede büyük harfli kelime kümesi sınırsız. Yeni `bist-symbol-registry.cjs` (624 sembol, Mynet panosundan) **allowlist** olarak otorite; sicilde olmayan dizi sembol sayılmıyor. Ayrıca sistemde ÜÇÜNCÜ bir sembol dedektörü olduğu ortaya çıktı (`countDistinctTickers` kendi kara listesini taşıyordu) — sicil bağlandığında skor HÂLÂ 3 diyordu; tek doğruluk kaynağına indirildi. Tazeleme: `scripts/refresh-bist-symbol-registry.cjs`.
  **BİLİNÇLİ TAVİZ:** yeni halka arz edilen şirket, sicil tazelenene kadar görülmez. Eksik tetikleme, her Türkçe cümlede sahte şirket saymaktan iyidir.
- ~~**Nakit akışı yanlış satırı okuyor.**~~ **BULUNDU VE DÜZELTİLDİ (13 Ağustos 2026).** İki ayrı kusur, gerçek İş Yatırım verisiyle ölçüldü (BRSAN 2026/6, 147 satır):
  1. `^yatırım faaliyetlerinden` deseni ÜÇ satıra uyuyor, `rows.find` ilkini alıyordu: "Yatırım Faaliyetlerinden **Gelirler**" = 143.888.000 (gelir tablosu kalemi) seçiliyor, gerçek "Yatırım Faaliyetlerinden Kaynaklanan Nakit" = **−3.554.310.000** atlanıyordu. Yatırım geliri, yatırım nakit akışı değildir.
  2. Finansman satırı İş Yatırım'da "Finansman **Faaliyetlerden** Kaynaklanan Nakit" yazıyor; desen "Faaliyetlerinden" arıyordu ve satırı **hiç yakalayamıyordu** (gerçek değer −194.124.000). Nakit köprüsü tek ayak üstünde kapanıyordu.
  Desenler `kaynaklanan.*nakit` ayırt edicisiyle ve `(in)?` ekiyle düzeltildi. Ayrıca `debt-quality-cashflow.test.mjs` fixture'ı UYDURMA satır adları taşıyordu — gerçek adlara taşındı; uydurma fixture, gevşek desenin yanlış satırı seçtiğini gizliyordu.
  Test: `tests/symbol-registry-and-cashflow-rows.test.mjs` (11 test).
- ~~**`analyze_earnings_pricing` kanıt satırları bozuk.**~~ **CANLIDA BULUNDU VE DÜZELTİLDİ (13 Ağustos 2026).** Tüm getiriler tam `-%100` çıkıyordu. Kök neden: `Number(null) === 0` ve `Number.isFinite(0) === true` olduğu için `toFinite(null)` SIFIR döndürüyordu. Yahoo, seansı süren günün barını `close: null` (hacim dolu) gönderiyor; o bar `close: 0` diye içeri girip dizinin SONUNCUSU olduğu için ÇAPA seçiliyordu. MA50 de sıfırla kirleniyordu.
  **Neden tehlikeliydi:** sınıflandırma yine de `NOT_EXTENDED` + "veri güveni: **high**" diyordu — çöp veriye yüksek güven etiketi. O etiket fiyatlanma kapısının zamanlama hükmüne izin verip vermediğini belirliyor.
  **Nasıl bulundu:** kapı yakalamadı, **ÇAKAL kendi cevabında bildirdi**: "aynı araçta kanıt satırları bariz bozuk görünüyor (-100% gibi anomali var), bu yüzden stop kararında onu ana dayanak yapmıyorum." Sektör tespiti hatasından sonra ikinci kez kendi kusurunu raporladı.
  Düzeltme: `toFinite` null/undefined/'' değerlerini açıkça eleyor; `normalizeBars` ayrıca sıfır ve negatif kapanışı atıyor (ikinci savunma). Canlı doğrulama: aynı sorgu düzeltmeden sonra `-%1,7 / -%7,4 / +%2,9` döndü, referans tarih son GEÇERLİ kapanış (`2026-08-12`).
  Test: `tests/earnings-pricing-null-close.test.mjs` (6 test).

- ~~**Seviye provenance derinleşmedi.**~~ **YAPILDI (12 Ağustos 2026).** Kanıt olayı artık `measurements: { SEMBOL: [sayılar] }` taşıyor (`extractMeasurements`); kapı ikinci soruyu soruyor: cevaptaki rakam, o sembolde ölçülen bir değerle **aynı büyüklük mertebesinde mi**. Değilse `notDerivedSymbols` ile bloklanıyor. Canlı vakadaki "553 TL'lik hissede stop 1 TL" sınıfı hata artık geçmiyor.
  **SINIR — abartılmasın:** bu bir çapa kontrolüdür, türetim İSPATI değildir. Band bilerek geniş (ölçümün 0.5×–2× aralığı), çünkü dar band meşru hedefi/stopu bloklar ve kapıyı gürültüye çevirir. Tam ispat modelin formülü bildirmesini gerektirir; o yapılmadı. Ölçüm değeri taşımayan eski olaylarda eski davranış korunur (yanlış pozitif üretmemek için).
- ~~**ChatGPT'nin 3 numaralı kabul testi UYGULANMADI**~~ **YAPILDI (12 Ağustos 2026).** `evaluatePriceLevelProvenanceGate` artık `opts.researchStatus` alıyor; `COMPLETE` değilse kanıt tam olsa bile somut giriş/stop/hedef rakamı çıkamıyor. `main.cjs` bu durumu **onarım turundan sonra** yeniden hesaplayıp geçiriyor (bayat kapanış haksız blok üretirdi). Yazılı kuraldan bilerek daha geniş uygulandı: kural "istek giriş/stop içeriyorsa" diyordu, koşul "cevap somut seviye içeriyorsa" oldu — zarar isteğin şeklinden değil, cevaptaki rakamdan doğar. Sözleşme kurulmayan basit turlarda (`researchStatus` null) kural devreye girmez.
  Test: `tests/level-derivation.test.mjs` (16 test).
- **Kaynak otorite katmanı yok.** Alan adı tekilleştirmesi var; otorite derecesi ve ortak köken tespiti yok — 31 farklı alan adı hâlâ 31 bağımsız kaynak demek değil.
- **`evidenceConfidence` sabit** (`success ? 0.78 : 0.35`). Gerçek ölçüm olmadan `dataConfidence` kapısı ayırt etmiyor.
- **Eşik kalibrasyonu için geriye dönük test motoru yok** (`backtests/` altında yalnız örnek JSON).

### 3.3 Sunum / tutarlılık

- **"Veri zamanı" ile "rapor dönemi" karışıyor.** Cevapta `Veri zamanı: 2026-08-13T22:11:52.977Z` yazıyor; bu finansal tablonun tarihi DEĞİL, aracın veriyi çektiği an. Üç alan ayrı yazılmalı: **rapor dönemi** (2026/6), **karşılaştırma dönemi** (2025/6), **verinin alınma zamanı**.
- **Dönem terminolojisi yanlış.** Araç "yıl öncesi aynı ÇEYREK" diyor ama 2026/6 ↔ 2025/6 karşılaştırması tek çeyrek değil **altı aylık kümülatif** (01.01–30.06). Doğrusu: "geçen yılın aynı raporlama dönemi".
- **Enflasyon düzeltmesi beyan edilmiyor.** İş Yatırım geçmiş dönemi güncel satın alma gücüne taşıyor; ÇAKAL'ın 2025/12 net borç rakamı (9,18 mlr) resmî tablodaki ham rakamdan (7,79 mlr) farklı. Kullanılabilir ama "karşılaştırma enflasyonla Haziran 2026'ya taşınmıştır" denmeli, yoksa kullanıcı ham rakam sanır.
- **`NOT_EXTENDED` anlamı taşıyor.** Sınıflandırma yalnız **teknik fiyat uzamasını** anlatır; "temel olarak ucuz/pahalı değil" demek DEĞİLDİR. Cevaplarda ikinci anlama kayıyor.
- **Tablolarda birim yok.** `43.592.538.000` yerine `43,59 mlr TL` veya en azından tablo başlığında "Tutarlar: TL".
- **Zaman etiketi karışık.** Makine UTC+1 (Batı Afrika); cevapta bir yerde `19:07:54Z`, başka yerde etiketsiz "19:07". BIST seansı Europe/Istanbul ile **doğru** hesaplanıyor (seans hükmü sağlam), ama kullanıcıya gösterilen zaman ne makine ne borsa saati. Tek bir sunum kuralı gerekiyor.
- **Aynı adlı metrik, farklı tanım.** `analyze_earnings_pricing` "hacim genişlemesi 0.78x" derken `analyze_finance_signal` "hacim oranı 3.23x" diyor; range pozisyonu da turlar arası 93 → 89, 14 → 39 oynadı. Farklı pencere/tanım olabilir ama cevapta hiç etiketlenmiyor → kanıt çelişkisi görünümü.
- **KAP adaptörü bağlı değil.** `packages/sources/kap` yazılmış ama Commander aracı olarak bağlanmamış; katalizör kademesi ona muhtaç.

### 3.5 Performans

- **Deterministik sorular için hızlı yol yok.** "THYAO kaç TL?" turu 42 saniye sürdü: profil/strateji DB sorgusu + iki LLM geçişi + araç. Bu sorunun tek doğru cevabı var ve LLM'e ihtiyaç duymuyor. Öneri: `PRICE_SINGLE_FACT → get_stock_price → deterministik formatlayıcı` (hedef 2–3 saniye). Aynı kalıp `FINANCIAL_YOY_SINGLE_COMPANY` için de kurulabilir.
- **Profil/strateji DB sorgusu her turda çalışıyor**, basit sorularda gereksiz. Ölçüldü: bir turda 19 saniye.

### 3.4 Yapısal

- `ai-service.cjs` monoliti (~11k satır) modüllere bölünmedi.
- FSM genişlemesi: kontrollü POST, zincirli API çağrıları, JSON dönüşüm DSL'i.
- MCP gateway: tool'ların policy kapısı arkasında dış ajanlara açılması.

---

## 4. Bu oturumda öğrenilen ve tekrarlanmaması gereken hata sınıfları

Bunlar koda yorum olarak da yazıldı; toplu hâli buraya:

1. **JS regex'te `\b` Türkçe harfleri kelime karakteri saymaz.** `/karşılaştır\b/` "karşılaştırması"yı, `/inmiş\b/` "inmiş"i kaçırır. Bu oturumda **üç ayrı yerde** aynı tuzağa düşüldü (router, borç kapısı, ve daha önce `FUNDAMENTAL_QUERY_RE`'de fark edilip not edilmiş). Yeni desen yazarken önce bunu sor.
2. **Aracın çalışması ≠ kanıt üretmesi.** `success: true` + `status: 'BLOCKED'` mümkün. Aynı hastalık sınıf düzeyinde (Adım 2), entity düzeyinde (`notFound`) ve işlem kaydında (`OK` yalanı) ayrı ayrı çıktı.
3. **İki doğruluk kaynağı zamanla ayrışır.** Volatilite eşiği iki yerdeydi ve aynı koşula zıt etiket veriyordu. Ayrışmanın sebebi eşik değil **birimdi** — taşımadan önce birimi sor.
4. **Testler eski semantiği tutar.** Volatilite fixture'ı eski birimde yazılmıştı; kırılmadan fark edilemezdi. Bir semantik değişikliğinde testin de taşınması gerekip gerekmediğini kontrol et.
5. **"Veri yok" ile "aracım getirmiyor" farklı şeylerdir.** Birincisi piyasa eksikliği, ikincisi bizim eksiğimiz. Cevap bu ikisini karıştırırsa kullanıcı yanlış sonuç çıkarır.
6. **`Number(null) === 0`.** `Number.isFinite(0)` de `true`. Bu ikisi birleşince null bir ölçüm SIFIR olarak sisteme girer ve tüm oranları `-%100` yapar. `Number('')` de sıfırdır. Sayıya çeviren her yardımcı null/''/undefined'ı ÖNCE elemeli. (Bu, null'ın sayı kılığında geçmesinin **üçüncü** tekrarı.)
7. **Kara liste, sonsuz kümeye karşı çalışmaz.** Türkçe büyük harfli kelimeler sınırsızdır; `TICKER_FALSE_POSITIVES`'e kelime eklemek asla bitmez. Kapalı kümeye karşı **allowlist** kurulur — sicil otoritedir, kalan her şey elenir.
8. **Bir dedektörü düzeltmek yetmez; kaç kopyası olduğunu SAY.** Sembol tespitinin üç ayrı uygulaması vardı. Sicil bağlandıktan sonra skor hâlâ yanlıştı çünkü sayım başka bir kopyadan geçiyordu. Düzeltmeden önce `grep` ile aynı işi yapan başka kod var mı bak.
9. **Fixture kaynağı taklit etmiyorsa test kendini doğrular.** `debt-quality-cashflow` fixture'ındaki satır adları uydurmaydı; gerçek İş Yatırım adları farklıydı ve gevşek desen yanlış satırı seçiyordu. Test yeşildi, üretim yanlıştı. Dış kaynağa bağlı fixture'ları **bir kez gerçek yanıttan** üret.
10. **Modelin kendi kusurunu bildirmesi bir kanıt kaynağıdır.** `-%100` anomalisini kapı değil ÇAKAL yakaladı; sektör tespiti hatasında da aynısı olmuştu. Cevaptaki "bu araç bozuk görünüyor" cümlesi ciddiye alınmalı.

---

## 5. Sıradaki iş — öncelik sırası

Sıra keyfî değil: her madde **ürünün ana vaadine olan uzaklığına** göre dizildi. Vaat şu — *kanıtsız hüküm çıkmaz*. Vaadi delen açık önce kapanır.

| # | İş | Neden bu sırada | Nerede |
|---|---|---|---|
| 1 | **Seviye türetim kanıtı** — salınım/ATR/yöntem/risk-getiri zorunlu kanıt sınıfları | Bugünkü koruma doğru sonucu YANLIŞ gerekçeyle veriyor; seans verisi gelince kapı açılır ve model yine seviye uydurabilir | §3.2 |
| 2 | **Nakit köprüsü mutabakatı** — `reconciled` bayrağı, kapanmayan köprüde hüküm yasağı | Satırlar düzeldi ama köprünün KAPANDIĞI doğrulanmıyor; ÇAKAL doğru sonuca kanıtsız vardı | §3.2 |
| 3 | **Tek composer akışı** — onarımı cevaptan önce bitir | İlk kompozisyon tamamen israf (~72s); brifing doğru ama yanlış yerde çalışıyor | §3.1 |
| 4 | **Onarım aracını zorla** | Sözleşme doğru aracı söylüyor, model dinlemiyor, kimse itiraz etmiyor | §3.1 |
| 5 | **Kanıt sınıfı ayrıştırması** — arama metadata'sı ≠ sosyal duyarlılık ≠ uzman araştırması | "2 video bulundu" bugün COMPLETE sayılıyor | §3.2 |
| 6 | **Sunum kuralları** — rapor dönemi / veri zamanı ayrımı, birim, enflasyon beyanı, dönem terminolojisi | Ucuz ve kullanıcıyı doğrudan yanıltan kalemler | §3.3 |
| 7 | **Hızlı yollar** — `PRICE_SINGLE_FACT`, `FINANCIAL_YOY_SINGLE_COMPANY` | 42s'lik fiyat sorusu; doğruluk sorunu değil ama kullanım kalitesi | §3.5 |
| 8 | **Huni Adım 4+5** — kademe 5–7 ve skorlayıcı birleşmesi | Büyük iş, ama vaadi delmiyor; yukarıdakiler kapanmadan başlanmamalı | §3.1 |
| 9 | **Kaynak otorite katmanı**, `evidenceConfidence`, geriye dönük test motoru | Uzun vadeli kalite | §3.2 |
| 10 | **KAP adaptörünü Commander'a bağla** | Katalizör kademesi buna muhtaç; huni öncesi ön koşul | §3.3 |

**Not:** 1 ve 2 birlikte yapılabilir — ikisi de "rakam/hüküm hangi ölçümden türedi" sorusunun aynı ailesinden.
