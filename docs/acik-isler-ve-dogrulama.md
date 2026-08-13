# Açık İşler ve Doğrulama Listesi

**Son güncelleme:** 2026-08-12
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

- **Adım 5 — kademe 5–7 (`DEEP_RESEARCH`, `FINAL_GATE`) yok.** `run_investment_research_scan` charter → evren → eleme yapıp derin kademeleri `nextRequiredStates` ile devrediyor. Huni sözleşmesi `FINAL_GATE`'e ulaşmayan huniyi doğru şekilde `BLOCKED` sayıyor.
- **`CANDIDATE_FUNNEL` kanıt sınıfı kaydedilmedi.** Adım 2 kilidi kalktı ama üretilemeyen bir sınıfı plana açmak kapanamayan duvar üretir. Derin kademeler gelince kaydedilecek.
- **Adım 4'ün kalanı:** `runInvestmentScreening` hâlâ canlı hattan çağrılmıyor. Volatilite *semantiği* tekleşti, **skorlayıcı gövdeleri hâlâ iki yerde**. Aynı çağrı zincirini değiştirdiği için Adım 5 ile birlikte yapılmalı.
- ~~**Kapanışın nihai çözümü.**~~ **YAPILDI (12 Ağustos 2026).** `buildCoverageBriefing(coverage)` alt soruları TAM / KISMİ / BLOKE diye ayırıp eksik kanıt sınıflarıyla birlikte composer'a veriyor; `ai-service.cjs` cevap taslağı hazır olduğunda ve kapanış COMPLETE değilse tek bir yeniden yazım turu açıyor (`tool_choice: 'none'` — araç açılsaydı kapsam brifingden sonra değişir ve brifing yalan olurdu). Kapsam bir kez hesaplanıp hem brifingde hem kapanış raporunda kullanılıyor; iki ayrı hesap ayrışabilirdi.
  **SINIR:** brifing bir KAPI DEĞİL, bilgilendirmedir — modelin uymasını umar, garanti etmez. `neutralizeEquityVerdicts` ve seviye kapısı yerinde kaldı. Model sözü kanıt değildir; brifing kapının yerine geçmez, önüne geçer. Brifing turu başarısız olursa eski davranışa düşülür.
  **MALİYET:** kapanmayan her sözleşmede bir ek LLM çağrısı. Canlıda ölçülmeli (bkz. bölüm 2).
  Test: `tests/coverage-briefing.test.mjs` (13 test).

### 3.2 Kanıt kalitesi

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

- **Zaman etiketi karışık.** Makine UTC+1 (Batı Afrika); cevapta bir yerde `19:07:54Z`, başka yerde etiketsiz "19:07". BIST seansı Europe/Istanbul ile **doğru** hesaplanıyor (seans hükmü sağlam), ama kullanıcıya gösterilen zaman ne makine ne borsa saati. Tek bir sunum kuralı gerekiyor.
- **Aynı adlı metrik, farklı tanım.** `analyze_earnings_pricing` "hacim genişlemesi 0.78x" derken `analyze_finance_signal` "hacim oranı 3.23x" diyor; range pozisyonu da turlar arası 93 → 89, 14 → 39 oynadı. Farklı pencere/tanım olabilir ama cevapta hiç etiketlenmiyor → kanıt çelişkisi görünümü.
- **KAP adaptörü bağlı değil.** `packages/sources/kap` yazılmış ama Commander aracı olarak bağlanmamış; katalizör kademesi ona muhtaç.

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
