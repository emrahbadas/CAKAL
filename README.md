# 🐺 ÇAKAL — Kişisel Fırsat ve Araştırma Motoru

> Kurt gibi konuşur; sermayeye yaklaşırken liman başkanı gibi evrak ister.

ÇAKAL, tek kullanıcı için tasarlanmış, Electron tabanlı bir **kişisel yapay zekâ araştırma ve fırsat asistanıdır**. BIST, döviz, altın, kripto, emlak ve e-ticaret fırsatlarını çoklu kaynaktan araştırır; teknik görünüm, bilanço, haber akışı ve riskleri birlikte değerlendirir — ama yatırım kararını asla kullanıcının yerine vermez.

## Çakalın Doğası

Çakal olmak şunu gerektirir: fırsatın kokusunu uzaktan almak, ama kokuyu kanıt sanmamak. Kalabalığın koştuğu yöne bakmak, ama sürüyle birlikte düşünmeden koşmamak. Gerektiğinde cesur olmak; cesareti kibirle, ihtiyatı korkaklıkla karıştırmamak.

Aslan fazla özgüvenlidir: gücüne inanır, geri çekilmeyi yenilgi sayar. Tavşan her harekette tehdit görür: tehlikeden kaçarken fırsatı da geride bırakır. Piyasa ikisini de sınar — kibri cezalandırır, korkuyu maliyete dönüştürür.

Çakal başka türlü hareket eder. En güçlü olmaya değil, en uyanık kalmaya çalışır. Gürültüye değil, ize bakar. Fiyatın yükselmesini değer, düşmesini fırsat sanmaz. Önce bilginin kaynağını, verinin tazeliğini, kârın kalitesini ve riskin büyüklüğünü sorgular. Kalabalığın ne düşündüğünü izler; kararını kalabalığa teslim etmez.

Çünkü borsada iyi bir şirket, her fiyattan iyi bir yatırım değildir. Güçlü bir bilanço, beklenti önceden satın alınmışsa yeni bir fırsat yaratmaz. Ucuza düşmüş görünen bir hisse, gerçekten değersizleşiyor olabilir. Çakal bu ayrımı yapmadan saldırmaz.

Fırsat varsa yaklaşır. Kanıt varsa değerlendirir. Risk karşılanmıyorsa geri çekilir. Tezi bozulduğunda gurur yapmaz; çünkü piyasada hayatta kalmak, haklı görünmekten daha değerlidir.

Çakalın disiplini basittir:

- Fırsatın varlığı yetmez; yanlış fiyatlanmış olması gerekir.
- Koku alınabilir; karar kanıtla verilir.
- Getiri kadar kaybın büyüklüğü ve kaçış yolu da ölçülür.
- Kalabalık izlenir, körü körüne takip edilmez.
- Veri yetersizse hüküm üretilmez.
- Tez bozulursa pozisyona sadakat gösterilmez.
- Tek fırsat uğruna sermayenin geleceği riske atılmaz.
- Büyük kazançtan önce hayatta kalmak gelir.

Bu depodaki her karar kapısı — fiyatlanma kilidi, hüküm-kanıt kilidi, risk eşikleri, VERİ YETERSİZ hükmü — bu doğanın koda dökülmüş hâlidir. ÇAKAL bu yüzden kullanıcı adına karar veren bir kehanet makinesi değildir: fırsatı arayan, kanıtı sorgulayan, ters tezi dinleyen ve belirsizlik karşısında sınırını bilen bir araştırma motorudur.

**ÇAKAL — fırsatı koklar; kanıtı görmeden ısırmaz.**

## Temel Felsefe

1. **Dili cesur, karar motoru muhafazakâr.** Yeterli kanıt (veri tazeliği + kaynak + değerleme + risk seviyesi) toplanmadan kesin AL/SAT hükmü üretilmez; yalnızca İNCELE / İZLE / RİSKLİ / VERİ YETERSİZ denebilir. Bu kural prompt'ta değil, deterministik **karar kilidi**nde yaşar.
2. **Kontrollü self-evolution.** Çakal eksik yeteneğini fark eder, tek kullanıcı onayıyla kendine yeni "organ" (sandbox plugin) takar — ama kendi omuriliğini (çekirdek kod, güvenlik katmanları) ameliyat edemez.
3. **LLM ham secret görmez.** API anahtarları Secret Broker'da şifreli durur; çalışma anında yalnızca plugin runner çözer.

## Öne Çıkan Yetenekler

- **Commander ajanı** — GPT tabanlı, görev tipine göre model yönlendiren (quick/chat/deep_analysis/code_gen) çok araçlı orkestra: ~90 tool (finans verisi, emlak, scraping, Telegram, öz-gelişim).
- **Otonom entegrasyon akışı (tek onay):** eksik yetenek tespiti → gap kaydı → öneri → kullanıcı onayı → plugin manifesti → Secret Broker'da hazır anahtar alanı → anahtar girilince otomatik test → hata varsa düzelt-tekrar dene döngüsü.
- **Sandbox Plugin FSM:** manifest tabanlı, deklaratif (yalnızca HTTPS GET) plugin çalıştırıcı. Serbest kod yürütme yok.
- **Karar korumaları:** karar kapısı (veri toplanmadan işlem hükmü yok), hüküm-kanıt kilidi, profil kurulum bağlam ayrımı.
- **Kişiselleştirme:** kullanıcı profili (risk toleransı, vade, maksimum kayıp), kalıcı hafıza (user index), strateji pattern çıkarımı.
- **Sesli asistan:** yerel VAD + STT/TTS, yankı önleme (dört katmanlı), token-ekonomik tasarım.
- **Aktivite Monitörü:** her ajan koşusunun tool çağrıları, kararlar ve kapı olayları gerçek zamanlı izlenir.

## Mimari

```mermaid
flowchart TD
    UI["Electron Renderer<br/>(React + Zustand)"] -->|IPC| MAIN["Main Process<br/>(main.cjs)"]
    MAIN --> AI["ai-service.cjs<br/>Commander + ~90 tool"]
    AI --> GUARDS["decision-guards.cjs<br/>Karar kapısı + hüküm kilidi"]
    AI --> FSM["sandbox-plugin-fsm.cjs<br/>Deklaratif plugin çalıştırıcı"]
    FSM --> SB["secret-broker.cjs<br/>safeStorage + domain-pin (TOFU)"]
    AI --> SUPA[("Supabase<br/>profil / hafıza / governance")]
    MAIN --> CRON["node-cron<br/>tarama + bildirim görevleri"]
```

### Governance zinciri (self-evolution)

```
Eksik yetenek → capability_gaps → expansion_proposals → kullanıcı onayı
   → apply_capability_plan (governance kapısı: kayıt yoksa fail-closed)
   → sandbox dosyaları / plugin manifesti → otomatik test
   → çekirdeğe terfi = AYRI ikinci insan onayı (request_core_promotion)
```

## Güvenlik Modeli

| Katman | Kural |
|---|---|
| Yazma alanı | Yalnızca `.cakal-sandbox/` altı; çekirdek dizinler (electron/, src/, packages/, scripts/) LLM'e kapalı |
| Kod yürütme | Yok. Plugin'ler deklaratif HTTPS GET manifestleri; `node` yalnız sürüm + insan-yazımı `scripts/` |
| Secret'lar | safeStorage ile şifreli; LLM context'ine asla girmez; **TOFU domain-pin**: her anahtar ilk kullanıldığı host'a sabitlenir |
| HTTP | Redirect takip edilmez (sızıntı vektörü), yanıt boyutu sınırlı, local/private host engelli |
| Komutlar | Allowlist + blocklist (command-guard); zincirleme/eval kalıpları bloklu |
| Finans hükümleri | Deterministik karar kilidi; kanıt araçları çalışmadan AL/SAT çıkmaz |

## Kurulum

```bash
npm install
cp .env.example .env   # anahtarları doldur (OpenAI, Perplexity, Supabase, Telegram)
npm test               # 164 birim testi
cd apps/desktop && npm run dev
```

API anahtarları iki yerde yaşar: altyapı anahtarları `.env`'de, plugin anahtarları (ör. OpenWeather) uygulama içi **Ayarlar → Secret Broker**'da.

## Proje Yapısı

```
apps/desktop/
  electron/          # Main process: ajan, guard'lar, FSM, Secret Broker
  src/               # React renderer: Chat, Dashboard, Ayarlar, Sesli Asistan
packages/            # Paylaşılan çekirdek (ör. investment-research policy-core)
supabase/            # Şema migration'ları
tests/               # Vitest birim testleri (güvenlik yolları dahil)
docs/                # Denetim ve API notları
```

## Yol Haritası

- [ ] FSM genişlemesi: kontrollü POST, zincirli API çağrıları, JSON dönüşüm DSL'i
- [ ] Deterministik değerleme hesaplayıcı (F/K, PD/DD) — karar kilidine gerçek hesap beslemesi
- [ ] `ai-service.cjs` monolitinin modüllere bölünmesi
- [ ] MCP gateway: tool'ların policy kapısı arkasında dış ajanlara açılması
- [ ] Gerçek kod yürütme ihtiyacı doğarsa: izole executor (container/WASM) — o güne kadar deklaratif kalır

---

*Tasarım ve ürün sahibi: Emrah Badaş — uzakyol gemi kaptanı.*
*Geliştirme: Claude (Anthropic) eşliğinde yapay zekâ destekli oturumlar.*
