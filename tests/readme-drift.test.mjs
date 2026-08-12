import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * DOKÜMANTASYON DRIFT KAPISI
 *
 * README'deki sayılar elle yazılıyor ve sessizce eskiyor. Ölçülen üç vaka:
 *   - "660 test / 49 dosya" yazarken gerçek 732'ydi
 *   - "866 test / 65 dosya" yazarken yeni dosyalar eklenmişti
 *   - "57 tool" yazarken get_cash_flow_breakdown ile 58 olmuştu
 * Üçü de gözle yakalandı. Gözle yakalanan kontrol, kontrol değildir.
 *
 * KAPSAM SINIRI — bilerek dar tutuldu:
 * Bu dosya yalnız STATİK olarak KESİN doğrulanabilen iki sayıyı kilitler
 * (araç sayısı, test DOSYASI sayısı). Çalışma anındaki TOPLAM test sayısı
 * kilitlenmiyor; çünkü kaynak metninden sayılamaz — bazı `it()` çağrıları
 * döngü gövdesinde durur ve tek literal birden çok test üretir (ölçüm:
 * 830 literal ↔ 883 gerçek test). Eşitlik iddia etmek sahte kesinlik olur.
 * Toplam için yalnız alt sınır kontrolü var; gerçek doğrulama CI'daki
 * `npx vitest run` çıktısıdır.
 */

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const aiService = readFileSync(new URL('../apps/desktop/electron/ai-service.cjs', import.meta.url), 'utf8');

/** ai-service.cjs içindeki TOOLS dizisinde tanımlı benzersiz araç adları. */
function countDefinedTools() {
  const start = aiService.indexOf('const TOOLS = [');
  if (start === -1) throw new Error('TOOLS dizisi bulunamadı — sayaç kalıbı eskimiş olabilir');
  const names = [...aiService.slice(start).matchAll(/type: 'function',\s*function: \{\s*name: '([a-z_0-9]+)'/g)]
    .map((m) => m[1]);
  return new Set(names).size;
}

const testFiles = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.test.mjs'));

describe('README — araç sayısı', () => {
  const defined = countDefinedTools();

  it('sayaç kalıbı hâlâ çalışıyor (sıfır dönerse test kendini kandırır)', () => {
    // Regex bozulursa 0 sayıp "eşleşti" demesin diye önce sağlık kontrolü.
    expect(defined).toBeGreaterThan(40);
  });

  it('README\'de geçen HER araç sayısı gerçek sayıya eşit', () => {
    // Sayı üç yerde geçiyor: yetenek maddesi, mimari diyagramı ve rozet.
    // Hepsi güncellenmeli — biri güncellenip diğeri unutulursa bu test düşer.
    const mentions = [...readme.matchAll(/(\d+)\s+tool/g)].map((m) => Number(m[1]));
    expect(mentions.length).toBeGreaterThan(0);
    for (const mentioned of mentions) {
      expect(mentioned, `README ${mentioned} tool diyor, gerçek ${defined}`).toBe(defined);
    }
  });

  it('rozetteki sayı da kilitli (URL kodlaması boşluğu gizliyordu)', () => {
    // shields.io rozeti boşluğu %20 olarak kodluyor: "agent-58%20tools".
    // Üstteki \s+ kalıbı bunu görmez — rozet sessizce eskiyebilirdi.
    const badges = [...readme.matchAll(/-(\d+)%20tools?-/g)].map((m) => Number(m[1]));
    for (const badge of badges) {
      expect(badge, `Rozet ${badge} tool diyor, gerçek ${defined}`).toBe(defined);
    }
  });
});

describe('README — test sayıları', () => {
  it('dosya sayısı gerçek dosya sayısına eşit', () => {
    const match = readme.match(/(\d+)\s+birim testi\s*\((\d+)\s+dosya\)/);
    expect(match, 'README kurulum bölümündeki test satırı bulunamadı').toBeTruthy();
    expect(Number(match[2]), `README ${match[2]} dosya diyor, gerçek ${testFiles.length}`)
      .toBe(testFiles.length);
  });

  it('bildirilen toplam, kaynaktaki literal it/test sayısının ALTINDA değil', () => {
    // Alt sınır kontrolü: her `it(` literali en az bir test üretir, döngü
    // içindekiler daha fazlasını üretir. README bu sınırın altına düşerse
    // sayı kesinlikle eskimiştir. Üstünde olması normaldir.
    const match = readme.match(/(\d+)\s+birim testi/);
    const declared = Number(match[1]);
    let literals = 0;
    for (const file of testFiles) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      literals += (source.match(/^\s*(?:it|test)\s*\(/gm) || []).length;
    }
    expect(literals).toBeGreaterThan(0);
    expect(declared, `README ${declared} test diyor ama kaynakta en az ${literals} it/test literali var`)
      .toBeGreaterThanOrEqual(literals);
  });
});

describe('README — modül listesi', () => {
  it('proje yapısında adı geçen electron modülleri gerçekten var', () => {
    const listed = [...readme.matchAll(/^\s{4}([a-z-]+\.cjs)\s+#/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(3);
    const actual = new Set(readdirSync(new URL('../apps/desktop/electron', import.meta.url)));
    for (const file of listed) {
      expect(actual.has(file), `README ${file} listeliyor ama dosya yok`).toBe(true);
    }
  });
});
