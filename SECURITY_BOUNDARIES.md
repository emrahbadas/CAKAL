# Güvenlik Sınırları — ÇAKAL

> Bu belge `LICENSE` dosyasındaki **Additional Use Grant, 3. şart** tarafından atıf yoluyla bağlayıcıdır: burada sayılan korumalar kaldırılamaz, atlatılamaz, devre dışı bırakılamaz veya esaslı biçimde zayıflatılamaz.

**Uygulandığı sürüm:** 2.0.0
**Son güncelleme:** 12 Ağustos 2026

---

## Nasıl okunmalı

Her sınır iki şeyi ayrı yazar:

- **Korunan işlev** — bağlayıcı olan budur. Kaldırılamaz.
- **Bu sürümdeki uygulaması** — yalnızca yol göstericidir, bağlayıcı değildir.

Bu ayrım bilinçlidir. Lisans dosya yollarına bağlanırsa, dosyayı yeniden adlandırmak koruma kaldırmakla aynı ihlal sayılır — bu hem haksız hem de kodun evrimini dondurur. Bu yüzden şart şunu söyler: **bileşenler yeniden adlandırılabilir veya taşınabilir; eşdeğer ya da daha güçlü koruma çalışır kaldığı sürece.** Sorulacak soru "dosya yerinde mi" değil, "koruma hâlâ işliyor mu"dur.

Yeni sürümlerde bu belge güncellenir. Her sürüm kendi `SECURITY_BOUNDARIES.md`'sine tabidir; lisans "applicable version" diyerek bunu kasteder.

---

## 1. Kanıt kapılı hüküm (karar kilidi)

**Korunan işlev:** Yeterli ve **taze** kanıt olmadan kesin AL/SAT hükmü üretilememeli. Kanıt eksikse sistem hüküm üretmemeye devam etmeli — İNCELE / İZLE / RİSKLİ / VERİ YETERSİZ gibi nötr sonuçlar verebilmeli. Kapı, cevap metnindeki kelimeye değil, aracın gerçekten ürettiği kanıta bakmalı.

**Bu sürümdeki uygulaması:** `apps/desktop/electron/decision-guards.cjs` — kanıt sınıfları, sınıf başına TTL, entity boyutu, `evaluateCommanderDecisionGate`, `evaluateVerdictEvidenceLock`, `evaluateEarningsPricingGate`, `evaluatePriceLevelProvenanceGate`, `evaluateDebtQualityGate`, `evaluateUngovernedRankingGate`.

**Zayıflatma sayılan örnekler:** TTL'leri anlamsız büyütmek; kapıyı araç **adına** bakacak şekilde geri almak; `BLOCKED` dönen sonucu kanıt saymak; somut giriş/stop rakamını ölçüm izi olmadan geçirmek.

## 2. Araştırma sözleşmesi ve kanıt defteri

**Korunan işlev:** Karmaşık finans sorularında yürütmeden önce kilitlenen, makine tarafından denetlenen bir kanıt planı bulunmalı. Tamamlanma modelin beyanından değil, kanıt defterinden hesaplanmalı. Kanıt çıtası çalışma sırasında indirilememeli.

**Bu sürümdeki uygulaması:** `research-contract.cjs` — `submit_research_plan` kilidi, `amend_research_plan`'ın çıta indirememesi, `research_run_id` kapsamı, entity + `asOf` boyutlu kanıt defteri.

## 3. Cerrahi izin kapısı ve korunan yollar

**Korunan işlev:** Kaynak kod değişikliği iki katmanlı bir izin kapısından geçmeli: hiç sorulmadan reddedilen sert blok katmanı ve kullanıcıya sorulan onay katmanı. Güvenlik sınırını tanımlayan veya kapının kendisini oluşturan dosyalar otomatik ajanın yazımına kapalı olmalı. Chat içindeki "onaylıyorum" ifadesi, arayüzdeki merge onayının yerine geçememeli.

**Bu sürümdeki uygulaması:** `apps/desktop/electron/surgery/` — `permission-hook.cjs`, `protected-paths.cjs`, `scripts/preflight.cjs`, `session-manager.cjs`.

## 4. Sandbox plugin çalıştırıcı

**Korunan işlev:** Model tarafından üretilen yetenekler serbest kod yürütememeli. Genişleme yolu deklaratif kalmalı; ağ erişimi kısıtlı olmalı (yerel/özel ağlar engelli, yönlendirme takip edilmez, yanıt boyutu sınırlı).

**Bu sürümdeki uygulaması:** `sandbox-plugin-fsm.cjs` — manifest tabanlı, yalnızca HTTPS GET.

## 5. Secret Broker

**Korunan işlev:** API anahtarları ve sırlar şifreli saklanmalı, dil modelinin bağlamına asla girmemeli. Her anahtar ilk kullanıldığı host'a sabitlenmeli (TOFU domain pin), böylece çalınan bir anahtar başka bir hedefe yönlendirilememeli.

**Bu sürümdeki uygulaması:** `secret-broker.cjs` — `safeStorage` şifreleme, domain pin, `.env` ve anahtar dosyası desenlerinin okuma/yazmaya kapalı olması.

## 6. Yol ve komut korumaları

**Korunan işlev:** Yazma alanı sandbox dizini ile sınırlı kalmalı; dizin dışına çıkma (path traversal) fail-closed reddedilmeli. Komut yürütme allowlist/blocklist ile sınırlı olmalı; zincirleme, eval ve yıkıcı kalıplar engellenmeli.

**Bu sürümdeki uygulaması:** `safe-path.cjs`, `command-guard.cjs`.

## 7. Denetim ve aktivite kayıtları

**Korunan işlev:** Ajan koşusunun araç çağrıları, kararları ve kapı olayları kaydedilmeli; bu kayıtlar silinememeli, gizlenememeli veya doğrulanamaz hâle getirilememeli.

**Bu sürümdeki uygulaması:** Aktivite Monitörü olay akışı, `buildActionLedger` / `distillToolFacts` kayıtları.

## 8. Finansal işlem yeteneğinin yokluğu

**Korunan işlev:** Ürün gerçek para, menkul kıymet, kripto varlık veya finansal hesap üzerinde **hiçbir** işlem yapamaz; broker, borsa veya ödeme sistemine bu amaçla bağlanamaz. Bu koruma bir kapı değil, bir **yokluk**tur: eklenmemesi gereken bir yetenektir.

**Neden onay kaçamağı yok:** "Her işlemde kullanıcı onayı alınır" kaydı bu sınırı karşılamaz. Ürün anayasası (`cakal-identity.cjs` → `IMMUTABLE_CORE`) işlemi koşulsuz yasaklar; lisans şartı da bu yüzden koşulsuz yazılmıştır. Onaya bağlı bir yürütme yolu, ilk yanlış onayda geri dönüşü olmayan finansal sonuç üretir — ÇAKAL'ın ürün ilkesi tam olarak bunu dışarıda tutar.

## 9. Ürün kimliği ve rolü

**Korunan işlev:** Ürün, kullanıcı adına geri dönüşü zor, kamusal, finansal veya hukuki sonuç doğuran eylemler yapan bir yapıya dönüştürülemez. Genel amaçlı otonom operatöre çevrilemez. Kodlama ajanı geçici cerrah olarak kalmalı, kalıcı ikinci kimliğe dönüşmemeli.

**Bu sürümdeki uygulaması:** `cakal-identity.cjs` — `PRODUCT_PRINCIPLE`, `IMMUTABLE_CORE`, `DEFAULT_REJECTED`; `surgery/capability-policy.cjs` ürün anayasası kapısı.

---

## Change Date sonrası

`LICENSE`'taki Change Date (2030-01-01) geldiğinde eser MIT altında kullanılabilir hâle gelir ve **bu belgedeki koşullar lisans yükümlülüğü olmaktan çıkar**. Bu, BUSL'nin tasarımı gereğidir; saklanacak bir şey değildir.

O tarihten sonra da geçerli kalan tek koruma **marka**dır: kilitleri sökülmüş bir türev dağıtılabilir, ama ona "ÇAKAL" denemez. Bkz. `TRADEMARKS.md`.
