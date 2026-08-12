import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import identity from '../apps/desktop/electron/cakal-identity.cjs';
import protectedPaths from '../apps/desktop/electron/surgery/protected-paths.cjs';

const { IMMUTABLE_CORE } = identity;

/**
 * LİSANS ↔ ANAYASA HİZASI
 *
 * ÇAKAL'ın sınırları üç belgede yaşıyor ve üçü ayrışabilir:
 *   - MEKANİK: cakal-identity.cjs IMMUTABLE_CORE + preflight + protected-paths.
 *     Kodu değiştirmeye çalışanı durdurur.
 *   - İŞLEVSEL: SECURITY_BOUNDARIES.md. Hangi KORUMANIN kaldırılamayacağını
 *     sürüm bazında, dosya yolundan bağımsız tanımlar.
 *   - HUKUKİ: LICENSE Additional Use Grant. Kodu alıp götüreni bağlar; işlev
 *     listesine ATIFLA gönderme yapar.
 * Ayrışırlarsa boşluk oluşur: mekanizmayı söken yükümlülükten de kurtulur.
 *
 * TASARIM NOTU — neden lisans dosya yolu saymıyor:
 * Lisans `surgery/decision-guards.cjs` gibi yollara bağlanırsa, dosyayı yeniden
 * adlandırmak koruma kaldırmakla aynı ihlal olur; bu hem haksızdır hem kodun
 * evrimini dondurur. Bu yüzden lisans işlevi bağlar, SECURITY_BOUNDARIES.md
 * işlevi tanımlar, uygulamayı yalnızca yol gösterici olarak listeler.
 *
 * KAPSAM SINIRI: bu bir hukuki denetim DEĞİL. Kavramların ilgili belgede
 * geçtiğini doğrular; maddelerin hukuken yeterli olduğunu iddia etmez. Amaç,
 * anayasaya madde eklendiğinde diğer iki belgenin sessizce geride kalmaması.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Belgeler ~80 sütuna sarılıyor: aranan ifade satır sonuna denk gelince düz
// substring araması boşuna düşer (ölçüldü: "general-purpose autonomous operator"
// iki satıra bölünmüştü). Sarma biçimi anlamı değiştirmez, normalize edilir.
const flatten = (text) => text.toLowerCase().replace(/\s+/g, ' ');

const license = read('../LICENSE');
const boundaries = read('../SECURITY_BOUNDARIES.md');
const trademarks = read('../TRADEMARKS.md');
const boundariesFlat = flatten(boundaries);

/**
 * Anayasa maddesi → SECURITY_BOUNDARIES.md'de bulunması beklenen kavram izleri.
 * Her madde için EN AZ BİR iz yeterli (aynı fikir farklı sözcüklerle yazılabilir),
 * ama hiçbiri yoksa o madde işlev listesinde karşılıksız kalmış demektir.
 */
const CHARTER_TO_BOUNDARIES = [
  { charter: /adı, karakteri ve ürün kimliği/i, traces: ['ürün kimliği ve rolü'] },
  { charter: /Ana rolü/i, traces: ['ürün kimliği ve rolü', 'product_principle'] },
  { charter: /Genel amaçlı otonom operatöre/i, traces: ['genel amaçlı otonom operatöre'] },
  { charter: /kaynak, kanıt ve güven seviyesi/i, traces: ['kanıt kapılı hüküm', 'kanıt defteri'] },
  { charter: /Veri yetersizse kesin hüküm/i, traces: ['veri yetersiz', 'hüküm üretmemeye devam'] },
  { charter: /Gerçek para, varlık veya finansal hesaplar/i, traces: ['finansal işlem yeteneğinin yokluğu'] },
  { charter: /Güvenlik duvarı, sandbox, secret broker, preflight/i, traces: ['sandbox plugin çalıştırıcı', 'secret broker'] },
  { charter: /Denetim kayıtları silinemez/i, traces: ['denetim ve aktivite kayıtları'] },
  { charter: /kendi kaynak kodunu doğrudan değiştiremez/i, traces: ['cerrahi izin kapısı', 'korunan yollar'] },
  { charter: /Kodlama ajanı \(Copilot\) geçici cerrahtır/i, traces: ['geçici cerrah'] },
];

describe('anayasa ↔ SECURITY_BOUNDARIES.md', () => {
  it('anayasa madde sayısı eşleme tablosuyla aynı', () => {
    // Anayasaya madde eklenip tablo güncellenmezse düşer; yeni sınırın diğer
    // belgelerde karşılığı olup olmadığı SORULMAK ZORUNDA kalır.
    expect(IMMUTABLE_CORE).toHaveLength(CHARTER_TO_BOUNDARIES.length);
  });

  it('eşleme tablosu var olmayan maddeyi kontrol ediyormuş gibi yapmıyor', () => {
    for (const { charter } of CHARTER_TO_BOUNDARIES) {
      const found = IMMUTABLE_CORE.some((rule) => charter.test(rule));
      expect(found, `Anayasada ${charter} kalıbına uyan madde yok — tablo eskimiş`).toBe(true);
    }
  });

  it('her anayasa maddesinin işlev listesinde karşılığı var', () => {
    for (const { charter, traces } of CHARTER_TO_BOUNDARIES) {
      const rule = IMMUTABLE_CORE.find((r) => charter.test(r));
      const covered = traces.some((t) => boundariesFlat.includes(t.toLowerCase()));
      expect(covered, `Anayasa maddesi SECURITY_BOUNDARIES.md'de karşılıksız: "${rule}"`).toBe(true);
    }
  });
});

describe('LICENSE yapısı — BUSL uyumu', () => {
  it('şartlar Production Use\'a bağlı, tüm haklara değil', () => {
    // ESKİ HÂLİ: "grants you the right to use, copy, modify, and redistribute
    // ... provided that all of the following conditions are met" — bu, BUSL'nin
    // koşulsuz verdiği kopyalama/değiştirme haklarına şart bağlıyordu. BUSL'de
    // sınırlama yalnız Production Use üzerinden kurulabilir.
    expect(flatten(license)).toContain('you may make production use of the licensed work, provided that');
    expect(flatten(license)).not.toContain('right to use, copy, modify, and redistribute the licensed work, provided that');
  });

  it('resmî BUSL gövdesi bozulmamış', () => {
    // Parametreler ve Additional Use Grant dışında metin değiştirilmemeli;
    // yoksa "Business Source License" adını kullanma hakkı düşer.
    expect(license).toContain('License text copyright (c) 2017 MariaDB Corporation Ab');
    expect(license).toContain('Covenants of Licensor');
    expect(license).toContain('is not an Open\nSource license');
  });

  it('non-production hakların sınırlanmadığı açıkça yazılı', () => {
    expect(flatten(license)).toContain('nothing in this additional use grant limits the non-production rights');
  });

  it('güvenlik şartı dosya yolu değil, belge atfı kullanıyor', () => {
    expect(license).toContain('SECURITY_BOUNDARIES.md');
    // Lisans metni tek tek modül yollarına bağlanmamalı (kırılgan ve haksız).
    expect(license).not.toMatch(/decision-guards\.cjs|surgery\/|protected-paths/);
  });

  it('yeniden adlandırma/taşıma serbestliği korunuyor', () => {
    expect(flatten(license)).toContain('renamed or relocated only where equivalent or stronger protection remains');
  });

  it('finansal işlem yasağında onay kaçamağı yok', () => {
    // ESKİ HÂLİ: "without explicit per-action user confirmation" — her işlemde
    // onay alınırsa gerçek para üzerinde işlem yapılabileceğini ima ediyordu.
    // Anayasa koşulsuz yasaklıyor; lisans da öyle olmalı.
    const flat = flatten(license);
    expect(flat).not.toContain('without explicit per-action user confirmation');
    expect(flat).toContain('this condition is absolute');
    expect(flat).toContain('does not satisfy it');
  });

  it('atıf, isim zorlaması yerine türev beyanı istiyor', () => {
    // ESKİ HÂLİ: "ÇAKAL adı kaldırılamaz" — bir fork'u aynı adı taşımaya
    // zorlamak kullanıcıyı yanıltır; korumaları sökülmüş sürüm "ÇAKAL" diye
    // dolaşır ve itibar zararı asıl esere döner.
    expect(license).toContain('Derived from ÇAKAL');
    expect(flatten(license)).not.toContain('must not be removed or replaced when distributing');
  });

  it('ticari lisans için gerçek bir iletişim adresi var', () => {
    expect(license).toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe('belge zinciri', () => {
  it('SECURITY_BOUNDARIES.md hangi sürüme uygulandığını söylüyor', () => {
    // Lisans "for the applicable version" diyor; belge sürümsüzse şart belirsiz.
    expect(boundaries).toMatch(/Uygulandığı sürüm:\*{0,2}\s*\d+\.\d+\.\d+/);
  });

  it('SECURITY_BOUNDARIES.md korunan işlev ile uygulamayı ayırıyor', () => {
    expect(boundaries).toContain('**Korunan işlev:**');
    expect(boundaries).toContain('**Bu sürümdeki uygulaması:**');
  });

  it('Change Date sonrası durum saklanmıyor', () => {
    // Dürüstlük maddesi: 2030'dan sonra bu koşullar lisans yükümlülüğü olmaktan
    // çıkar. Belgenin bunu açıkça söylemesi gerekir.
    expect(boundaries).toContain('Change Date');
    expect(flatten(boundaries)).toContain('lisans yükümlülüğü olmaktan çıkar');
  });

  it('TRADEMARKS.md marka hakkının lisans dışı olduğunu söylüyor', () => {
    expect(trademarks).toContain('does not grant you any right in any trademark');
    expect(flatten(trademarks)).toContain('official çakal build');
  });

  it('imzalama durumu olduğundan iyi gösterilmiyor', () => {
    // Henüz sürüm imzalama yok; "imzalı yapı" iddiası kurulmamış bir süreci
    // varmış gibi göstermemeli.
    expect(flatten(trademarks)).toContain('sürüm imzalama henüz kurulmadı');
  });
});

describe('korunan yollar', () => {
  it('cerrah lisansı ve bağlı belgeleri değiştiremez', () => {
    for (const file of ['LICENSE', 'SECURITY_BOUNDARIES.md', 'TRADEMARKS.md']) {
      expect(protectedPaths.PROTECTED_PATHS, `${file} korunmuyor`).toContain(file);
    }
  });

  it('anayasa dosyası da korunmaya devam ediyor (regresyon)', () => {
    expect(protectedPaths.PROTECTED_PATHS).toContain('apps/desktop/electron/cakal-identity.cjs');
  });
});
