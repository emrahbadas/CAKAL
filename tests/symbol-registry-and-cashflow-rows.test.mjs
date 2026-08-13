import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import guards from '../apps/desktop/electron/decision-guards.cjs';
import contractLib from '../apps/desktop/electron/research-contract.cjs';
import registry from '../apps/desktop/electron/bist-symbol-registry.cjs';

const { extractBistTickers } = guards;
const { requiresResearchContract } = contractLib;

/**
 * CANLI TUR BULGULARI — 13 Ağustos 2026
 *
 * İki ayrı kusur, ikisi de gerçek veriyle ölçüldü.
 */

describe('sembol sicili — Türkçe kelimeler hisse sanılmıyor', () => {
  /**
   * ÖLÇÜLEN: "BRSAN'ın son dönemini GEÇEN YILIN AYNI DÖNEMİYLE karşılaştır"
   *   → ['BRSAN', 'YILIN', 'AYNI'] → "coklu sirket (3)" → skor 4/4
   *   → gereksiz araştırma sözleşmesi → tek şirketlik soru 81 saniye sürdü.
   * Kara liste yapısal olarak yetersizdi: Türkçede büyük harfli kelime kümesi
   * sınırsız. Çözüm allowlist — sicilde olmayan dizi sembol sayılmaz.
   */
  const message = "BRSAN'ın son açıklanan mali tablo dönemini GEÇEN YILIN AYNI DÖNEMİYLE karşılaştır.";

  it('REGRESYON — YILIN ve AYNI hisse sayılmıyor', () => {
    expect(extractBistTickers(message)).toEqual(['BRSAN']);
  });

  it('REGRESYON — tek şirketlik soru sözleşme tetiklemiyor', () => {
    const complexity = requiresResearchContract(message);
    expect(complexity.required).toBe(false);
    expect(complexity.signals.join(' ')).not.toContain('coklu sirket');
  });

  it('gerçek çoklu şirket hâlâ yakalanıyor (kapsam daralmadı)', () => {
    const complexity = requiresResearchContract('BRSAN ve MEYSU bilanço + fiyatlama karşılaştırması yap.');
    expect(complexity.required).toBe(true);
    expect(complexity.signals.join(' ')).toContain('coklu sirket (2)');
  });

  it('işlem kararı sorusu hâlâ sözleşme gerektiriyor', () => {
    expect(requiresResearchContract('THYAO bugün alınır mı?').required).toBe(true);
  });

  it('basit fiyat sorusu serbest kalıyor', () => {
    expect(requiresResearchContract('THYAO kaç TL?').required).toBe(false);
  });

  it('sicil makul büyüklükte ve bilinen semboller içinde', () => {
    // Sıfır dönen bir sicil her şeyi eler ve testi sessizce anlamsızlaştırır.
    expect(registry.REGISTRY_SIZE).toBeGreaterThan(400);
    for (const s of ['THYAO', 'BRSAN', 'MEYSU', 'KCHOL', 'ASELS', 'GARAN']) {
      expect(registry.isKnownBistSymbol(s), `${s} sicilde yok`).toBe(true);
    }
  });

  it('endeks kodları şirket sayılmıyor', () => {
    // XU100 bir şirket değil; "coklu sirket" sayımını şişirmemeli.
    expect(extractBistTickers('THYAO ve XU100 karşılaştır')).toEqual(['THYAO']);
  });
});

describe('nakit akışı satır eşlemesi', () => {
  /**
   * ÖLÇÜLEN (BRSAN 2026/6, İş Yatırım MaliTablo, 147 satır):
   *   "Yatırım Faaliyetlerinden Gelirler"          =    143.888.000  ← eskiden seçilen
   *   "Yatırım Faaliyetlerinden Kaynaklanan Nakit" = -3.554.310.000  ← doğrusu
   *   "Finansman FaaliyetlerDEN Kaynaklanan Nakit" =   -194.124.000  ← hiç eşleşmiyordu
   * Birincisi gelir tablosu kalemi; yatırım geliri nakit akışı değildir.
   * İkincisinde İş Yatırım "Faaliyetlerden" yazıyor, desen "Faaliyetlerinden"
   * arıyordu.
   */
  const source = readFileSync(new URL('../apps/desktop/electron/ai-service.cjs', import.meta.url), 'utf8');
  const norm = (s) => String(s || '').toLocaleLowerCase('tr-TR').trim();

  /** Üretim desenlerini kaynaktan okur — test kendi kopyasını uydurmasın. */
  function patternFor(key) {
    const re = new RegExp(`\\{ key: '${key}'[^}]*re: (/[^/]+/)`);
    const m = source.match(re);
    if (!m) throw new Error(`${key} deseni bulunamadı`);
    // eslint-disable-next-line no-eval
    return eval(m[1]);
  }

  const rows = [
    '  Yatırım Faaliyetlerinden Gelirler',
    '  Yatırım Faaliyetlerinden Giderler (-)',
    ' Yatırım Faaliyetlerinden Kaynaklanan Nakit',
    ' Finansman Faaliyetlerden Kaynaklanan Nakit',
    'İşletme Faaliyetlerinden Kaynaklanan Net Nakit',
  ];
  const firstMatch = (re) => rows.find((r) => re.test(norm(r)));

  it('REGRESYON — yatırım geliri, yatırım nakit akışı sanılmıyor', () => {
    expect(firstMatch(patternFor('yatirimNakitAkisi'))).toBe(' Yatırım Faaliyetlerinden Kaynaklanan Nakit');
  });

  it('REGRESYON — finansman satırı "Faaliyetlerden" yazımıyla da yakalanıyor', () => {
    expect(firstMatch(patternFor('finansmanNakitAkisi'))).toBe(' Finansman Faaliyetlerden Kaynaklanan Nakit');
  });

  it('işletme satırı bozulmadı', () => {
    expect(firstMatch(patternFor('isletmeNakitAkisi'))).toBe('İşletme Faaliyetlerinden Kaynaklanan Net Nakit');
  });

  it('gelir/gider kalemleri hiçbir nakit akışı desenine uymuyor', () => {
    for (const key of ['isletmeNakitAkisi', 'yatirimNakitAkisi', 'finansmanNakitAkisi']) {
      const re = patternFor(key);
      expect(re.test(norm('  Yatırım Faaliyetlerinden Gelirler')), `${key} gelir satırına uydu`).toBe(false);
      expect(re.test(norm('  Yatırım Faaliyetlerinden Giderler (-)')), `${key} gider satırına uydu`).toBe(false);
    }
  });
});
