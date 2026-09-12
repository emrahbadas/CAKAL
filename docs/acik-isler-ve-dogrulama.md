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

### 3.6 Entegrasyon durum yüzeyleri — Telegram DÜZELTİLDİ (15 Ağustos 2026)

**Bulunan:** Ayarlar → Telegram Kanal Okuyucu "Telegram hesabı bağlı — kanallar okunabilir" diyordu. Ölçüm bunun yanlış olduğunu gösterdi: `users.GetUsers` → `401 SESSION_REVOKED`. `isAuthenticated()` yetkiyi sunucuya sormuyor, yalnızca kayıtlı dizenin uzunluğuna bakıyordu (`length > 10`); iptal edilmiş oturum da 369 karakter olduğu için kontrol geçiyordu. Yanlış "bağlı" durumu `tgAuthStep === 'done'` dalını seçiyor, o dalda da giriş formu hiç çizilmiyordu → **yeniden giriş yapmak imkânsızdı**.

**Yapılan:**
- `isAuthenticated()` ikiye ayrıldı: `hasStoredSession()` (ucuz, dize var mı) ve `async verifyAuthorization()` (gerçek yetki sorgusu, 60 sn önbellek, 8 sn zaman aşımı).
- Hata sınıflaması: `SESSION_REVOKED` / `AUTH_KEY_DUPLICATED` / `AUTH_KEY_UNREGISTERED` … → `revoked`; ağ hatası → `unreachable`. **Ağ hatasında kayıtlı oturum silinmez** — yoksa aynı kilidin yeni sürümü üretilirdi.
- `resetAuth()` + `telegram-reader:reset` IPC: yerel oturumu siler, API bilgilerini ve kanal listesini korur, Telegram'daki diğer cihazlara dokunmaz.
- `sendCode()` ölü oturumu önce temizler — iptal edilmiş auth key ile kod isteği de 401 döner.
- Arayüz: `done` dalına "Yeniden giriş yap / hesabı değiştir" düğmesi; `revoked` durumunda sebebi açıklayan uyarı kutusu.
- Kapılar (`get-channels`, `read-messages`, `search`, `read_telegram_channels` aracı) artık gerçek yetkiye bakıyor.

**Doğrulama:** `tests/telegram-session-auth.test.mjs` (15 test). Regresyon mutasyonla sınandı — eski davranış geri konduğunda 5 test düşüyor. Ayrıca gerçek (iptal edilmiş) oturuma karşı canlı çalıştırıldı: `hasStoredSession()=true`, `verifyAuthorization() → {authorized:false, reason:'revoked'}`.

**Açık kalan:** Aynı numarayı iki uygulamada kullanırken oturum dizesi paylaşılırsa `AUTH_KEY_DUPLICATED` ile ikisi birden iptal olur. Kod artık bu durumu sebebiyle bildiriyor ama **önlemiyor** — belge seviyesinde uyarı yeterli görüldü.

### 3.7 Sıralama kapısı yanlış alarmı — DÜZELTİLDİ (15 Ağustos 2026)

**Bulunan:** "telegramdaki kanalları listele" sorusuna verilen kanal listesi hisse sıralaması sanıldı. Kapı iki kez ateşledi, bir LLM turu boşa yandı, kullanıcı cevap yerine "Sıralama üretilemedi" bloğu gördü.

**Sebep:** `responseContainsEquityRanking` yalnız ŞEKLE bakıyordu — "satır başında numara + 3-6 büyük harf". Gerçek kanal adlarıyla ölçüldü:

| satır | çapa | sicilde var mı |
|---|---|---|
| `1. BORSA İZİNDE` | BORSA | hayır |
| `4. YILDIZ PAZAR` | YILDIZ | hayır |
| `6. MEYVE SEBZE HAL FİYATLARI` | MEYVE | hayır |
| `8. SAHİBİNDEN SEBZE MEYVE AL-SAT` | SAHİBİ | hayır |

Finans bağlamı bile cevaptan geliyordu — "Borsa Haber Hisse" bir **kanal adı**. Kullanıcı borsadan hiç söz etmemişti.

**Asıl bulgu:** `collectRankingAnchorTickers` kara listeyi uyguladığı için "BORSA"yı zaten eliyordu; ama `responseContainsEquityRanking` onu **çağırmıyor**, ham deseni test ediyordu. Aynı sorunun iki cevabı vardı ve biri yanlıştı. Bu, §4.8'deki "kaç kopyası var" dersinin **üçüncü** tekrarı.

**Yapılan:** `isRecognizedTicker()` tek karar noktası olarak çıkarıldı (sicil varsa allowlist, yoksa kara liste); hem `extractBistTickers` hem `collectRankingAnchorTickers` oradan geçiyor. `responseContainsEquityRanking` artık dil marker'larını koşulsuz, çapaları **sicil doğrulamasından geçirerek** değerlendiriyor. Birleşik `RANKING_RESPONSE_MARKERS` listesi kaldırıldı — ham hâlde test edilmesi hatanın kaynağıydı.

**Doğrulama:** `tests/ranking-intent-gate.test.mjs`'e 5 regresyon testi eklendi (fixture gerçek hesaptan okunan kanal adları). Mutasyonla sınandı: eski davranış geri konduğunda 3 test düşüyor. Kapsam daralmadığı ayrıca test edildi — `1) TUREX / 2) SSAAT / 3) BRSAN` hâlâ yakalanıyor, kod geçmeyen üstünlük dili ("en sağlam 3 hisse") hâlâ yakalanıyor.

### 3.8 Telegram tarama kapsamı — EKLENDİ (15 Ağustos 2026)

**İstek (Kaptan):** *"Telegramdaki birçok şeyi ÇAKAL'ın görmesi gereksiz, çok fazla gürültü olur... kullanıcı şu kanala gir vs diye tek tek söylemez, gürültü azalır, tokenizasyon kontrol altına alınır. Bir de default olarak kullanıcı aksini söylemedikçe telegram taramasında sadece o günün mesajları taranır."*

**Yapılan:**
- **Takip listesi.** Ayarlar → Telegram Kanal Okuyucu'ya çift panelli seçici eklendi: *Tara* → hesaptaki kanallar solda, `›`/`‹` ile sağa/sola aktarım, *Kaydet*. Kaydedilmemiş değişiklik ekranda uyarı olarak duruyor — sessiz kalırsa ÇAKAL eski listeyi tarardı.
- **Kapsam varsayılanı takip listesidir.** `list_channels` artık takip listesini döndürür (`scope:"all"` ile tüm kanallar, yalnız liste düzenlenirken). `read_messages` `channel_id` OLMADAN çağrılabilir ve takip listesinin tamamını okur — normal kullanım budur.
- **Zaman penceresi varsayılan BUGÜN.** `telegram-scope.cjs` (saf modül) kullanıcının mesajından aralık çıkarır: "son 1 hafta" → week, "son 1 ay" → month, "tüm geçmiş" → all.
- **Genişletme yetkisi modelde değil.** Model `time_window:"month"` yazsa bile kullanıcı öyle bir şey demediyse **today'e kısılır** ve araç sonucuna `[aralık bugün ile sınırlandı]` notu düşer. Bu, "beyan kanıt değildir" kuralının kapsam tarafındaki karşılığı — aksi hâlde model her turda pencereyi açıp gürültüyü ve token maliyetini geri getirebilirdi.
- **"Bugün" İstanbul günüdür**, makinenin günü değil. Kaptan GMT+1'de; onun gece yarısı İstanbul'da ertesi gün.
- **Kapsam beyanı dürüst.** `fetched` ≠ `inWindow` ayrı raporlanıyor; limit dolup aralıkta daha eski mesaj kalmış olabilecekse `truncated` bildiriliyor. Tarihi okunamayan mesaj **elenir** — aralık dışı olmadığını kanıtlayamıyorsak içinde sayamayız.
- **Bir kanal düşerse** diğerleri okunur ama hata kapsam raporunda görünür.

**Doğrulama:** `tests/telegram-scope.test.mjs` (35) + `tests/telegram-channel-digest.test.mjs` (11). Arama sırası mutasyonla sınandı: `slice` filtreden önce yapılırsa aralık dışı eşleşmeler kotayı doldurup bugünün eşleşmesini düşürüyor — test bunu yakalıyor.

**Açık kalan:** Takip listesi seçimi canlıda (gerçek Electron penceresinde) henüz denenmedi; birim testler ve typecheck yeşil, arayüz etkileşimi kullanıcı tarafından doğrulanacak.

### 3.9 Hüküm sızıntısı, kanıt tanımı ayrışması, evren iddiası — DÜZELTİLDİ (12 Eylül 2026)

Kaptan'ın canlı oturumundan çıkan üç kusur. Hepsi **ölçülerek** teşhis edildi; ÇAKAL'ın kendi kök-neden analizinin **ikisi yanlıştı** ve bu da ayrı bir ders.

**(3) Bloke edilmiş hüküm cevapta sızdı.** Kilit ateşledi, footer'a "hüküm İNCELE seviyesine indirildi" yazdı, ama `AL` dört ayrı yerde ayakta kaldı. `neutralizeEquityVerdicts` bağlam kelimesini **aynı satırda** arıyordu; markdown'da bağlam **hiyerarşik** taşınır (tablo başlığı → veri satırları, bölüm başlığı → alt satırlar ve alt başlıklar). Tek yakalanan satır `## Karar: AL` oldu.
*Düzeltme:* **tespit ile yazım ayrıldı.** `isVerdictLine` (tespit) DAR kalır — yanlış pozitif koca bir onarım turu yakar. Nötrleştirici (yazım) GENİŞ olur — kaçan satır bloke hükmü ekrana sızdırır. Yazıma üç kapsam eklendi: tablo başlığı bağlamı, başlık yığını üzerinden devralma, ve satırda sicilde kayıtlı sembol varsa bağlam aranmaması. Hüküm reddi (`VERDICT_NEGATION_RE`) korunur.
*ÇAKAL'ın teşhisi:* "renderer kilitli verdict'i enforce etmiyor / presentation bypass" — **yanlış katman.** Bypass yoktu; renderer ne verildiyse onu bastı.

**(2) İki sistem, iki "kanıt var" tanımı.** Aynı cevabın altında `📋 SÖZLEŞME: [s1] COMPLETE` ile `⚖️ KİLİT: Eksik kanıtlar: Değerleme çarpanı` yan yana basıldı. `investable_candidate` zorunlu setinde `VALUATION` var ve model çıtayı indiremez → s1 COMPLETE ise **çarpan deftereydi**. Sözleşme **deftere**, kilit **cevap metnine** bakıyordu. `get_valuation_multiples` beş sembol için de çalıştı; model çarpanı yalnızca yazmadı.
*Düzeltme:* kilide defter verildi; artık **"toplanmadı"** ile **"toplandı ama gösterilmedi"** ayrı raporlanıyor ve onarım talimatı ikiye bölündü — zaten elde olan veri için yeniden araç çağrılmıyor. `risk_level` bilinçli olarak "toplanamaz" sınıfında: o bir ölçüm değil, analiz çıktısı.
*ÇAKAL'ın teşhisi:* "veri Evidence Ledger'a taşınmamış olabilir" — **kendi altbilgisiyle çürütüldü.**

**(1) Evren iddiası denetlenmiyordu.** Plan üç alt soruyu "BIST100 evreninde…" diye kurdu, `entities` alanına önceki turdan taşınan 5 sembol yazıldı, beşinin kanıtı tam olduğu için COMPLETE kapandı ve cevap "BIST100 içindeki tek temiz aday" dedi. BIST100'ün 95'ine hiç bakılmamıştı. `universeScope` alanı tam bu iş için yazılıyordu ve **hiçbir kapı okumuyordu** (ölçüm: 3 geçiş — tanım, yazım, export; 0 tüketici).
*Düzeltme:* defter artık `universeScope` + `observedCount` taşıyor; alt soru bir evren iddia ediyorsa gözlenen enstrüman sayısı evreni karşılamadan COMPLETE olamıyor (`UNIVERSE_COVERAGE:BIST100`). Ölçülen turda: gereken 100, gözlenen 25 → kapanmaz.
*Kapsam daraltması:* ilk sürüm yalnız endeks adına bakıyordu ve mevcut bir testi düşürdü — `"XU100 gore relatif guc"` bir **benchmark referansı**, evren iddiası değil. Artık seçim dili (`içinde/içinden/arasında/evreninde/hisselerinden`) şart.

**Doğrulama:** `tests/universe-claim-and-evidence-split.test.mjs` (22) + `tests/verdict-negation.test.mjs`'e 9 regresyon. Üç düzeltme de **ayrı ayrı mutasyonla** sınandı: evren kapısı kapatılınca 1, defter ayrımı kapatılınca 1, nötrleştirici daraltılınca 5 test düşüyor.

**(4) Sessiz fren — DÜZELTİLDİ.** Sözleşme onarımı sahipken (`contractOwnsRepair`) kapılar kendi tamamlama turlarını açmaz — bu doğru, yoksa iki sistem aynı anda onarım yapar ve aynı cevapta farklı asOf'lar karışır. Ama bu yolda hüküm indirilip **hiç olay yayılmıyordu**: cevabın altında "hüküm İNCELE seviyesine indirildi" notu, monitörde o saniyede hiçbir 🛑 yok. Kaptan'ın "makine dairesi frene basmış mı?" şüphesinin bir sebebi buydu.

Kör nokta **tek kapıda değil, üçünde birden**ti (sıralama, fiyatlanma, karar kilidi) — birini düzeltip diğerlerini bırakmak hatanın üçte ikisini yerinde bırakırdı (§4.8).
*Düzeltme:* saf `describeContractOwnedLock(kind, lock)` (test edilebilsin diye `decision-guards.cjs`'te) + tek giriş noktası `applyContractOwnedLock`. Monitör satırı artık hem gerekçeyi hem "ek tur AÇILMADI" bilgisini taşıyor — kullanıcı frenin çekildiğini ve neden ikinci bir LLM turu görmediğini aynı satırda görüyor. Karar kilidinde satır "toplanmadı" ile "toplandı ama yazılmadı" ayrımını da taşıyor (§3.9-2).
*Kalıcı koruma:* kaynak seviyesinde kapı — `main.cjs` içindeki her `&& contractOwnsRepair) {` kısa devresi `applyContractOwnedLock(` çağırmak zorunda. Yeni bir kapı aynı kör noktayla eklenemez. Mutasyonla doğrulandı: fiyatlanma kapısı eski sessiz kalıba döndürülünce test düşüyor.

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
11. **Kimlik bilgisinin VAR olması GEÇERLİ olduğunu göstermez.** `isAuthenticated()` yalnızca `TELEGRAM_SESSION.length > 10` kontrol ediyordu; iptal edilmiş oturum da 369 karakterdi. Ayarlar ekranı "hesap bağlı" diye yeşil yakıp giriş formunu gizledi — **kullanıcı için çıkışsız bir kilit**: yeniden giriş yapacak düğme ekranda yoktu. Ölçüm: `hasStoredSession()=true` iken `users.GetUsers` → `401 SESSION_REVOKED`. Bu, "beyan kanıt değildir" kuralının ürün içi teşhis yüzeyine uygulanmamış hâliydi. Bir kimlik/yetki durumunu ekranda göstereceksen **sahibine sor**, dizeyi ölçme. (§3.4)
12. **Her "bağlandı" durumunun geri dönüş yolu olmalı.** Kilit tek başına yanlış durumdan doğmadı; `tgAuthStep === 'done'` dalında hiçbir çıkış/yeniden giriş eylemi olmamasından doğdu. Durum yanlış hesaplandığı an arayüz çıkmaz sokağa dönüştü. Terminal bir "başarılı" durumu çizerken, o durumdan çıkma eylemini de aynı anda çiz.
13. **Kapının YANLIŞ ATEŞLEMESİ de bir arıza sınıfıdır, sessiz geçmemesi kadar önemlidir.** Sıralama kapısı bir Telegram kanal listesini hisse sıralaması sanıp cevabı bloke etti. Kapıları hep "kaçırıyor mu" diye test ettik; "yok yere kapanıyor mu" diye test etmemiştik. Her kapı için en az bir **negatif** vaka yaz: kapının susması gereken, ama şekil olarak benzeyen bir girdi. Aksi hâlde koruma, koruduğu şeyin önüne geçer.
14. **Tespit ile YAZIM aynı genişlikte olmamalı.** Kilit "bu cevapta hüküm var mı?" (tespit) ve "hükmü nereden sileceğim?" (yazım) sorularının ikisini de tek bir `isVerdictLine` ile cevaplıyordu. Oysa hataların maliyeti zıt: tespitte yanlış pozitif koca bir onarım turu yakar, yazımda kaçan satır bloke edilmiş hükmü ekrana sızdırır. Tespit DAR, yazım GENİŞ olmalı. (§3.9)
15. **Aynı cevapta iki sistem zıt sonuç basıyorsa, ikisi aynı kelimeyi farklı tanımlıyordur.** "Kanıt var" sözleşme için DEFTERDE, kilit için CEVAP METNİNDE demekti. Çelişki değil, tanım ayrışmasıydı; ama kullanıcıya çelişki olarak göründü ve olmayan bir ingestion hatası arattı. Kapı mesajları hangi tanıma göre konuştuğunu söylemeli: "veri yok" ile "veri var ama yazılmadı" farklı sorunlardır ve farklı düzeltme gerektirir. (§3.9)
16. **Modelin kök-neden analizi de bir beyandır.** ÇAKAL üç kusurdan ikisini yanlış teşhis etti — ikisi de makul görünen, ölçülmemiş hikâyelerdi ("ledger a taşınmamış olabilir", "renderer bypass"). Kendi kusurunu BİLDİRMESİ kanıt kaynağıdır (§4.10), ama SEBEBİNİ açıklaması değildir. Teşhisi koda bakarak doğrula. (§3.9)
17. **Koruma SESSİZ çalışıyorsa, çalışmıyor sayılır.** Üç kapı sözleşme onarımı sahipken hükmü indiriyor ama hiç olay yaymıyordu; fren çekiliyor, monitörde izi kalmıyordu. Kullanıcı sistemin çalışmadığını sandı ve haklıydı — gözlemleyemediği bir koruma, olmayan bir korumadan ayırt edilemez. Bir kapı hüküm değiştiriyorsa, değiştirdiğini SÖYLEMELİ. (§3.9-4)

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
