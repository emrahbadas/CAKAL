import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const aiServiceSource = fs.readFileSync(
  path.join(here, '..', 'apps', 'desktop', 'electron', 'ai-service.cjs'),
  'utf8',
);

// ai-service.cjs Electron bağımlıdır; saf fonksiyonu kaynaktan izole edip
// değerlendiriyoruz (mynet-live-board.test.mjs ile aynı yöntem).
function loadScopeBuilder() {
  const match = aiServiceSource.match(/^function buildBistBoardScope\([\s\S]*?^}$/m);
  if (!match) throw new Error('ai-service.cjs içinde bulunamadı: buildBistBoardScope');
  return new Function(`${match[0]}\nreturn buildBistBoardScope;`)();
}

const buildBistBoardScope = loadScopeBuilder();

describe('get_bist_board kapsam raporu', () => {
  // 10 Ağustos 2026 vakası: "bugünün en çok artanları" sorusuna index=XU100 ile
  // cevap verildi; %10 tavan yapan MCARD/OFSYM/ENDAE listede yoktu çünkü hiçbiri
  // XU100 üyesi değil. Kullanıcı yanlış listeyi doğru sandı.
  it('endeks filtresi varsa piyasa geneli SAYILMAZ ve uyarı üretir', () => {
    const scope = buildBistBoardScope({
      indexFilter: 'XU100',
      symbolCount: 0,
      indexMemberCount: 100,
      boardSize: 632,
    });
    expect(scope.isMarketWide).toBe(false);
    expect(scope.warning).toBeTruthy();
    expect(scope.warning).toContain('XU100');
    expect(scope.universe).toContain('100 hisse');
  });

  it('filtresiz çağrıda piyasa geneli sayılır ve uyarı üretmez', () => {
    const scope = buildBistBoardScope({
      indexFilter: '',
      symbolCount: 0,
      indexMemberCount: 632,
      boardSize: 632,
    });
    expect(scope.isMarketWide).toBe(true);
    expect(scope.warning).toBeNull();
    expect(scope.universe).toContain('632 hisse');
  });

  it('sembol listesi verilmişse sıralama evreni sayılmaz', () => {
    const scope = buildBistBoardScope({
      indexFilter: '',
      symbolCount: 3,
      indexMemberCount: 632,
      boardSize: 632,
    });
    expect(scope.isMarketWide).toBe(false);
    // Sembol filtresi kullanıcının kendi seçimi; endeks gibi gizli daraltma değil.
    expect(scope.warning).toBeNull();
  });

  it('uyarı metni modele ne yapacağını söyler (filtreyi kaldır ya da kapsamı yaz)', () => {
    const scope = buildBistBoardScope({
      indexFilter: 'XU030',
      symbolCount: 0,
      indexMemberCount: 30,
      boardSize: 632,
    });
    expect(scope.warning).toMatch(/index filtresi KULLANMA/);
    expect(scope.warning).toMatch(/AÇIKÇA belirt/);
  });
});

describe('get_bist_board sıralama varsayılanı', () => {
  // GEÇMİŞ HATA: "%9 üstü ilk 10" isteğinde model sortBy vermeyince varsayılan
  // turnover devreye giriyor, "en çok artan" sorusuna hacim sıralaması dönüyordu.
  const source = aiServiceSource;

  it('değişim filtresi varsa varsayılan sıralama change olur', () => {
    expect(source).toMatch(/hasChangeFilter \? 'change' : 'turnover'/);
  });

  it('hasChangeFilter hem min hem max değişim parametresine bakar', () => {
    const block = source.match(/const hasChangeFilter =[\s\S]*?;/)[0];
    expect(block).toContain('minChangePercent');
    expect(block).toContain('maxChangePercent');
  });
});
