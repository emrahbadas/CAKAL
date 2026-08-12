import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import identity from '../apps/desktop/electron/cakal-identity.cjs';
import protectedPaths from '../apps/desktop/electron/surgery/protected-paths.cjs';

const { IMMUTABLE_CORE } = identity;

/**
 * LİSANS ↔ ANAYASA HİZASI
 *
 * ÇAKAL'ın sınırları iki yerde yaşıyor:
 *   - MEKANİK: cakal-identity.cjs IMMUTABLE_CORE + preflight + protected-paths.
 *     Kodu değiştirmeye çalışan durdurulur.
 *   - HUKUKİ: LICENSE Additional Use Grant. Kodu alıp götüren bağlanır.
 * İkisi aynı şeyi söylemezse boşluk oluşur: mekanizmayı söken, yükümlülükten
 * de kurtulmuş olur. Bu dosya ikisinin ayrışmasını yakalar.
 *
 * KAPSAM SINIRI: bu bir hukuki denetim DEĞİL. Anahtar kavramların lisans
 * metninde geçtiğini doğrular; maddelerin hukuken yeterli olduğunu iddia etmez.
 * Amaç, anayasaya yeni bir madde eklendiğinde lisansın sessizce geride
 * kalmasını engellemek.
 */

const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
// Lisans metni ~80 sütuna sarılıyor: aranan ifade satır sonuna denk gelince
// düz substring araması boşuna düşer (ölçüldü: "general-purpose autonomous
// operator" iki satıra bölünmüştü). Karşılaştırma tek boşluğa indirgenmiş
// metin üzerinde yapılır — sarma biçimi anlamı değiştirmez.
const licenseLower = license.toLowerCase().replace(/\s+/g, ' ');

/**
 * Anayasa maddesi → lisans metninde bulunması beklenen kavram izleri.
 * Her madde için EN AZ BİR iz yeterli (aynı fikir farklı sözcüklerle yazılabilir),
 * ama hiçbiri yoksa o madde lisansta karşılıksız kalmış demektir.
 */
const CHARTER_TO_LICENSE = [
  { charter: /adı, karakteri ve ürün kimliği/i, traces: ['project name and identity', 'derivative of çakal'] },
  { charter: /Ana rolü/i, traces: ['core purpose', 'single-user'] },
  { charter: /Genel amaçlı otonom operatöre/i, traces: ['general-purpose autonomous operator'] },
  { charter: /kaynak, kanıt ve güven seviyesi/i, traces: ['source, evidence and confidence'] },
  { charter: /Veri yetersizse kesin hüküm/i, traces: ['data is insufficient', 'withhold a definite verdict'] },
  { charter: /Gerçek para, varlık veya finansal hesaplar/i, traces: ['real money, securities', 'financial accounts'] },
  { charter: /Güvenlik duvarı, sandbox, secret broker, preflight/i, traces: ['sandbox plugin runner', 'secret broker', 'preflight gate'] },
  { charter: /Denetim kayıtları silinemez/i, traces: ['audit integrity', 'audit and activity records'] },
  { charter: /kendi kaynak kodunu doğrudan değiştiremez/i, traces: ['modify its own source code directly'] },
  { charter: /Kodlama ajanı \(Copilot\) geçici cerrahtır/i, traces: ['temporary surgeon'] },
];

describe('LICENSE ↔ ürün anayasası', () => {
  it('anayasa maddesi sayısı eşleme tablosuyla aynı', () => {
    // Anayasaya madde eklenip bu tablo güncellenmezse test düşer; yeni sınırın
    // lisansta karşılığı olup olmadığı SORULMAK ZORUNDA kalır.
    expect(IMMUTABLE_CORE).toHaveLength(CHARTER_TO_LICENSE.length);
  });

  it('her anayasa maddesi eşleme tablosunda gerçekten mevcut', () => {
    // Tablo, var olmayan bir maddeyi kontrol ediyormuş gibi yapmasın.
    for (const { charter } of CHARTER_TO_LICENSE) {
      const found = IMMUTABLE_CORE.some((rule) => charter.test(rule));
      expect(found, `Anayasada ${charter} kalıbına uyan madde yok — tablo eskimiş`).toBe(true);
    }
  });

  it('her anayasa maddesinin lisansta karşılığı var', () => {
    for (const { charter, traces } of CHARTER_TO_LICENSE) {
      const rule = IMMUTABLE_CORE.find((r) => charter.test(r));
      const covered = traces.some((t) => licenseLower.includes(t.toLowerCase()));
      expect(covered, `Anayasa maddesi lisansta karşılıksız: "${rule}"`).toBe(true);
    }
  });

  it('lisans, anayasa dosyasına açıkça atıf yapıyor', () => {
    // Okuyan kişi iki belgenin bağlı olduğunu görmeli.
    expect(license).toContain('cakal-identity.cjs');
    expect(license).toContain('IMMUTABLE_CORE');
  });

  it('finansal işlem yasağında onay kaçamağı yok', () => {
    // ESKİ HÂLİ: "without explicit per-action user confirmation" — bu ifade,
    // her işlemde onay alınırsa gerçek para üzerinde işlem yapılabileceğini
    // ima ediyordu. Anayasa ise koşulsuz yasaklıyor. Boşluk kapatıldı.
    expect(licenseLower).not.toContain('without explicit per-action user confirmation');
    expect(licenseLower).toContain('per-action user confirmation does not lift it');
  });
});

describe('LICENSE korunan yol', () => {
  it('cerrah lisansı değiştiremez', () => {
    // Anayasa korunuyorsa hukuki ikizi de korunmalı.
    expect(protectedPaths.PROTECTED_PATHS).toContain('LICENSE');
  });

  it('anayasa dosyası da korunmaya devam ediyor (regresyon)', () => {
    expect(protectedPaths.PROTECTED_PATHS).toContain('apps/desktop/electron/cakal-identity.cjs');
  });
});
