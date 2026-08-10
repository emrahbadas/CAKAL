import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const resolver = require(path.join(here, '..', 'apps', 'desktop', 'electron', 'bist-entity-resolver.cjs'));

const {
  buildEntityIndex,
  resolveKnownBistEntities,
  nameTokensFromSourceUrl,
  containsExactTicker,
  resolveCoveredEntities,
} = resolver;

// Gerçek Mynet url biçimi: hisseler/<kod>-<sirket-adi-slug>/
function boardItem(symbol, slug) {
  return { symbol, sourceUrl: `https://finans.mynet.com/hisseler/${slug}/` };
}

const BOARD = [
  boardItem('BRSAN', 'brsan-borusan-mannesmann-boru-sanayi'),
  boardItem('BRYAT', 'bryat-borusan-yatirim-ve-pazarlama'),
  boardItem('MEYSU', 'meysu-meysu-gida-sanayi'),
  boardItem('MCARD', 'mcard-multinet-kurumsal-hizmetler'),
  boardItem('ISGSY', 'isgsy-is-girisim-sermayesi-yatirim-ortakligi'),
  boardItem('THYAO', 'thyao-turk-hava-yollari'),
  boardItem('ASELS', 'asels-aselsan-elektronik-sanayi'),
];

const index = buildEntityIndex({ boardItems: BOARD });

describe('ad parçası çıkarımı', () => {
  it('kodu ve jenerik parçaları atar, ayırt edici adı bırakır', () => {
    expect(nameTokensFromSourceUrl('hisseler/brsan-borusan-mannesmann-boru-sanayi/', 'BRSAN'))
      .toEqual(['borusan', 'mannesmann', 'boru']);
  });

  it('yalnız jenerik parçadan oluşan ad boş döner', () => {
    expect(nameTokensFromSourceUrl('hisseler/xxxxx-sanayi-ve-ticaret-holding/', 'XXXXX')).toEqual([]);
  });
});

describe('indeks kurulumu', () => {
  it('panodaki tüm semboller evrene girer', () => {
    expect(index.symbols.has('MEYSU')).toBe(true);
    expect(index.symbols.has('MCARD')).toBe(true);
  });

  // "borusan" hem BRSAN hem BRYAT'ta geçiyor — yanlış şirkete kanıt yazmaktansa
  // hiç yazmamak yeğdir.
  it('birden çok şirkette geçen ad parçası belirsiz sayılır', () => {
    expect(index.ambiguousTokens.has('borusan')).toBe(true);
    expect(index.nameIndex.has('borusan')).toBe(false);
  });

  it('tek sahipli ad parçası indekse girer', () => {
    expect(index.nameIndex.get('mannesmann')).toBe('BRSAN');
    expect(index.nameIndex.get('aselsan')).toBe('ASELS');
  });
});

describe('kabul testleri', () => {
  it('"BRSAN son haberler" → [BRSAN]', () => {
    expect(resolveKnownBistEntities('BRSAN son haberler', index)).toEqual(['BRSAN']);
  });

  it('"BRSAN ve MEYSU karşılaştır" → [BRSAN, MEYSU]', () => {
    const out = resolveKnownBistEntities('BRSAN ve MEYSU karşılaştır', index);
    expect(out.sort()).toEqual(['BRSAN', 'MEYSU']);
  });

  // Ad katmanı varsayılan KAPALI — açıkça istenirse çalışır.
  it('ad katmanı kapalıyken şirket adı eşleşmez', () => {
    expect(resolveKnownBistEntities('Borusan Mannesmann son haber', index)).toEqual([]);
  });

  it('ad katmanı açıkken "Borusan Mannesmann" → [BRSAN]', () => {
    expect(resolveKnownBistEntities('Borusan Mannesmann son haber', index, { useNameIndex: true }))
      .toEqual(['BRSAN']);
  });

  it('"FRESH MARKET SCAN" → [] (hiçbiri evrende değil)', () => {
    expect(resolveKnownBistEntities('FRESH MARKET SCAN', index)).toEqual([]);
  });

  it('boş/anlamsız metin → []', () => {
    expect(resolveKnownBistEntities('', index)).toEqual([]);
    expect(resolveKnownBistEntities('bugün piyasa nasıl', index)).toEqual([]);
  });
});

describe('yanlış pozitif koruması', () => {
  // resolveBistSymbol serbest metinde her 3-6 harfli kelimeyi sembole çevirirdi.
  it('evrende olmayan büyük harfli kelime sembol sayılmaz', () => {
    expect(resolveKnownBistEntities('NET FOR ABC XYZ', index)).toEqual([]);
  });

  it('BIST ve endeks adları sembol sayılmaz', () => {
    expect(resolveKnownBistEntities('BIST ve XU100 endeksinde', index)).toEqual([]);
  });

  it('küçük harfli sembol adı ticker sayılmaz, ad indeksi de eşleşmez', () => {
    // "brsan" küçük harfli — ticker geçişi büyük harf arar, ad indeksinde de yok
    // (kod slug'dan atılıyor). Sessiz yanlış eşleşme olmamalı.
    expect(resolveKnownBistEntities('brsan hakkında ne var', index)).toEqual([]);
  });

  it('belirsiz ad parçası tek başına çözülmez', () => {
    // "Borusan" tek başına: BRSAN mı BRYAT mı belli değil → hiçbiri.
    expect(resolveKnownBistEntities('Borusan grubu haberleri', index)).toEqual([]);
  });

  it('jenerik kelime düzinelerce şirketi işaretlemez', () => {
    expect(resolveKnownBistEntities('sanayi ve ticaret yatirim holding', index)).toEqual([]);
  });
});

describe('Türkçe karakter katlaması', () => {
  it('şirket adı Türkçe harflerle yazılsa da eşleşir (ad katmanı açıkken)', () => {
    const trIndex = buildEntityIndex({
      boardItems: [boardItem('THYAO', 'thyao-turk-hava-yollari')],
    });
    expect(resolveKnownBistEntities('Türk Hava Yolları bilançosu', trIndex, { useNameIndex: true }))
      .toEqual(['THYAO']);
  });

  it('İ/ı dönüşümü sembolü bozmaz', () => {
    const isIndex = buildEntityIndex({ boardItems: [boardItem('ISCTR', 'isctr-is-bankasi-c')] });
    expect(resolveKnownBistEntities('ISCTR fiyatı', isIndex)).toEqual(['ISCTR']);
  });
});

describe('ek sembol kaynağı', () => {
  it('pano alınamazsa statik evren yine tanınır', () => {
    const fallback = buildEntityIndex({ boardItems: [], extraSymbols: ['BRSAN.IS', 'THYAO.IS'] });
    expect(resolveKnownBistEntities('BRSAN ve THYAO', fallback).sort()).toEqual(['BRSAN', 'THYAO']);
    // Ad indeksi yok — yalnız ticker tanınır.
    expect(resolveKnownBistEntities('Borusan Mannesmann', fallback, { useNameIndex: true })).toEqual([]);
  });
});

describe('tam sınır eşleşmesi', () => {
  it('alt dize eşleşmesi kabul edilmez', () => {
    expect(containsExactTicker('BRSANLAR toplandı', 'BRSAN')).toBe(false);
    expect(containsExactTicker('BRSAN son haber', 'BRSAN')).toBe(true);
  });

  it('.IS eki ve küçük/büyük harf farkı sorun değil', () => {
    expect(containsExactTicker('THYAO bilanço', 'thyao.is')).toBe(true);
  });
});

describe('coveredEntities üretimi — kaynak önceliği', () => {
  // ASIL REGRESYON VAKASI: MEYSU hiçbir statik listede yok ama sözleşme onu
  // planlamış. Kanıt bu yüzden kaybolmamalı.
  it('sözleşme entity\'si statik listede olmasa da çözülür', () => {
    const emptyIndex = buildEntityIndex({ boardItems: [], extraSymbols: [] });
    const result = resolveCoveredEntities({
      text: 'MEYSU son 3 ay haberler ve KAP bildirimleri',
      plannedEntities: ['ISGSY', 'MEYSU', 'BRSAN', 'MCARD'],
      index: emptyIndex,
    });
    expect(result.entities).toEqual(['MEYSU']);
  });

  it('planda olup metinde geçmeyen şirket kapsanmış sayılmaz', () => {
    const result = resolveCoveredEntities({
      text: 'BRSAN son haberler',
      plannedEntities: ['BRSAN', 'MEYSU', 'ISGSY'],
    });
    expect(result.entities).toEqual(['BRSAN']);
  });

  it('sözleşme yoksa pano evreni devreye girer', () => {
    const result = resolveCoveredEntities({
      text: 'MCARD hakkında ne yazılmış',
      plannedEntities: [],
      index,
    });
    expect(result.entities).toEqual(['MCARD']);
  });

  it('iki kaynak birleşir, tekrar üretmez', () => {
    const result = resolveCoveredEntities({
      text: 'BRSAN ve MEYSU karşılaştırması',
      plannedEntities: ['BRSAN', 'MEYSU'],
      index,
    });
    expect(result.entities.sort()).toEqual(['BRSAN', 'MEYSU']);
  });

  it('FRESH MARKET SCAN hisse sanılmaz', () => {
    const result = resolveCoveredEntities({ text: 'FRESH MARKET SCAN', plannedEntities: [], index });
    expect(result.entities).toEqual([]);
  });

  // Tahmin yürütmek yerine boşluğu bildir: "kanıt yok" ile "şirketi çözemedik"
  // aynı şey değildir.
  it('tanınmayan sembol adayı unresolved olarak raporlanır', () => {
    const result = resolveCoveredEntities({
      text: 'ZZZZZ hakkında haberler',
      plannedEntities: ['BRSAN'],
      index,
    });
    expect(result.entities).toEqual([]);
    expect(result.unresolved).toEqual(['ZZZZZ']);
  });

  it('çözülen sembol unresolved listesine düşmez', () => {
    const result = resolveCoveredEntities({
      text: 'BRSAN son haber',
      plannedEntities: ['BRSAN'],
      index,
    });
    expect(result.unresolved).toEqual([]);
  });

  it('boş metin kanıt üretmez', () => {
    expect(resolveCoveredEntities({ text: '', plannedEntities: ['BRSAN'] }))
      .toEqual({ entities: [], unresolved: [] });
  });
});
