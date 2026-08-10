'use strict';

/**
 * SERBEST METİNDEN BIST ŞİRKETİ ÇÖZÜMLEYİCİ.
 *
 * NEDEN VAR: `web_search`, `search_youtube_insights` ve `verify_claim` sembolü
 * argümanda değil `query`/`claim` METNİNDE taşır. `extractEntities` yalnız
 * `symbol/asset/symbols` alanlarına baktığı için bu araçların kanıt olayları
 * ENTITY'SİZ yazılıyordu; sözleşme BRSAN hakkında kanıt aradığında sekiz araç
 * gerçekten çalışmış olsa bile hiçbirini bulamıyor ve alt soru BLOCKED kalıyordu.
 *
 * NEDEN `resolveBistSymbol` KULLANILMIYOR: o fonksiyon TEK bir kullanıcı
 * argümanını çözmek için yazılmış ve serbest metinde felaket olur —
 * `/^[A-Z]{3,6}$/` testiyle ÜÇ HARFLİ HER KELİMEYİ sembole çevirir
 * ("son" → SON.IS), ayrıca `q.includes(k) || k.includes(q)` kısmi eşleşmesi
 * çok gevşektir. Metin madenciliği ayrı bir iştir.
 *
 * TEMEL KURAL: sembol UYDURULMAZ, yalnız BİLİNEN kümeden tanınır.
 *
 * KAYNAK ÖNCELİĞİ (sırası önemli):
 *  1. Araştırma sözleşmesindeki `subQuestions[].entities` — EN GÜVENİLİR.
 *     Plan zaten hangi şirketler hakkında olduğunu açıkça taşıyor (2026-08-09'dan
 *     beri entity-kapsamlı alt sorularda ZORUNLU). Bu kaynak sayesinde MEYSU'nun
 *     herhangi bir statik listede bulunmasına GEREK YOK.
 *  2. Canlı Mynet panosu sembolleri (628) — sözleşme yoksa devreye girer.
 *  3. Statik evren / sembol haritası — yalnız fallback.
 *
 * `DEFAULT_BIST_EQUITY_UNIVERSE` (104 sembol) BIST şirket sicili DEĞİLDİR;
 * tarama bütçesi listesidir. Onu otorite kabul etmek MEYSU/MCARD/ISGSY gibi
 * gerçek hisseleri sessizce kaybettirirdi — bu yüzden 1. ve 2. kaynak önce gelir.
 *
 * ŞİRKET ADI TANIMA İSTEĞE BAĞLIDIR (varsayılan KAPALI). Bu tamirat canlı bir
 * hatayı kapatmak içindir; "Türkiye'deki tüm şirket adlarını tanıma motoru"na
 * dönüşmemeli. Ad katmanı açıldığında da belirsiz eşleşme çözülmez.
 */

/**
 * Şirket adı slug'larında ONLARCA şirkette geçen jenerik parçalar. Tek başına
 * eşleşirlerse "yatirim" kelimesi düzinelerce hisseyi işaretler.
 */
const GENERIC_NAME_TOKENS = new Set([
  'holding', 'holdings', 'sanayi', 'ticaret', 'yatirim', 'yatirimlar', 'anonim',
  'sirketi', 'sirket', 'gayrimenkul', 'ortakligi', 'ortaklik', 'menkul',
  'degerler', 'enerji', 'insaat', 'turizm', 'gida', 'tekstil', 'kimya',
  'teknoloji', 'elektrik', 'otomotiv', 'saglik', 'finansal', 'kiralama',
  'faktoring', 'sigorta', 'bankasi', 'banka', 'grup', 'grubu', 'is', 've',
  'urunleri', 'urun', 'malzemeleri', 'metal', 'demir', 'celik', 'cimento',
  'madencilik', 'tarim', 'hizmetleri', 'hizmet', 'iletisim', 'elektronik',
  'girisim', 'sermayesi', 'pazarlama', 'dagitim', 'lojistik', 'uluslararasi',
]);

/** Büyük harfli olup sembol OLMAYAN yaygın sözcükler (BIST tuzağının aynısı). */
const DEFAULT_TEXT_STOPWORDS = new Set([
  'BIST', 'BORSA', 'VIOP', 'ENDEKS', 'KAP', 'TCMB', 'BDDK', 'SPK',
  'XU030', 'XU050', 'XU100', 'USD', 'EUR', 'TRY',
  'MARKET', 'SCAN', 'FRESH', 'ANALIZ', 'RAPOR', 'VERI', 'KAYNAK',
  'HISSE', 'PIYASA', 'FIYAT', 'HEDEF', 'TOPLAM', 'ORTALAMA',
]);

/** Türkçe harfleri ASCII'ye indirger; karşılaştırma bunun üzerinden yapılır. */
function foldTurkish(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g');
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.IS$/i, '');
}

/**
 * Mynet pano url'inden şirket adı parçalarını çıkarır.
 * "hisseler/brsan-borusan-mannesmann/" → ['borusan', 'mannesmann']
 * Kodun kendisi ve jenerik parçalar atılır.
 */
function nameTokensFromSourceUrl(sourceUrl, symbol) {
  const match = String(sourceUrl || '').match(/hisseler\/([^/?#]+)/i);
  if (!match) return [];
  const code = normalizeSymbol(symbol).toLowerCase();
  return foldTurkish(match[1])
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && part !== code && !GENERIC_NAME_TOKENS.has(part));
}

/**
 * Tanıma indeksini kurar. `boardItems` Mynet panosundan gelir (symbol +
 * sourceUrl); `extraSymbols` statik evren gibi ek kaynaklardır.
 *
 * Ad → sembol eşlemesi ÇOK ANLAMLIYSA kullanılmaz: "borusan" hem BRSAN hem
 * BRYAT'ta geçer. Böyle bir parça tek başına hiçbir şeye çözülmez — yanlış
 * şirkete kanıt yazmaktansa eksik yazmak yeğdir.
 */
function buildEntityIndex({ boardItems = [], extraSymbols = [] } = {}) {
  const symbols = new Set();
  const tokenOwners = new Map(); // ad parçası → Set<sembol>

  for (const item of Array.isArray(boardItems) ? boardItems : []) {
    const symbol = normalizeSymbol(item?.symbol);
    if (!symbol) continue;
    symbols.add(symbol);
    for (const token of nameTokensFromSourceUrl(item?.sourceUrl, symbol)) {
      if (!tokenOwners.has(token)) tokenOwners.set(token, new Set());
      tokenOwners.get(token).add(symbol);
    }
  }
  for (const raw of extraSymbols) {
    const symbol = normalizeSymbol(raw);
    if (symbol) symbols.add(symbol);
  }

  // Tek sahibi olan ad parçaları güvenilir; çok sahipli olanlar atılır.
  const nameIndex = new Map();
  const ambiguousTokens = new Set();
  for (const [token, owners] of tokenOwners.entries()) {
    if (owners.size === 1) nameIndex.set(token, [...owners][0]);
    else ambiguousTokens.add(token);
  }

  return { symbols, nameIndex, ambiguousTokens };
}

/**
 * Metinden BİLİNEN BIST şirketlerini çıkarır.
 *
 * İki geçiş:
 *  1) Ticker: metindeki büyük harfli 3-8 karakterli diziler — yalnız evrende
 *     varsa ve stopword değilse kabul edilir.
 *  2) Ad: indekste tek sahipli ad parçaları metinde geçiyorsa kabul edilir.
 *
 * Desen tek başına kanıt değildir: evrende olmayan hiçbir dizi sembol sayılmaz.
 */
function resolveKnownBistEntities(text, index, { stopwords = DEFAULT_TEXT_STOPWORDS, useNameIndex = false } = {}) {
  const raw = String(text || '');
  if (!raw.trim() || !index) return [];
  const out = new Set();

  // 1) Ticker geçişi — orijinal metindeki BÜYÜK harfli diziler.
  for (const token of uppercaseTokens(raw)) {
    const candidate = normalizeSymbol(token);
    if (stopwords.has(candidate)) continue;
    if (index.symbols.has(candidate)) out.add(candidate);
  }

  // 2) Ad geçişi — VARSAYILAN KAPALI (bkz. dosya başı: kapsam kararı).
  if (useNameIndex && index.nameIndex) {
    const folded = ` ${foldTurkish(raw).replace(/[^a-z0-9]+/g, ' ').trim()} `;
    for (const [token, symbol] of index.nameIndex.entries()) {
      if (folded.includes(` ${token} `)) out.add(symbol);
    }
  }

  return [...out];
}

function uppercaseTokens(text) {
  return String(text || '').match(/\b[A-ZÇĞİÖŞÜ0-9]{3,8}\b/g) || [];
}

/** Metinde sembol TAM SINIRLA geçiyor mu? Alt dize eşleşmesi kabul edilmez. */
function containsExactTicker(text, symbol) {
  const target = normalizeSymbol(symbol);
  if (!target) return false;
  return uppercaseTokens(text).some((token) => normalizeSymbol(token) === target);
}

/**
 * `coveredEntities` üretici — üç araç (web_search, search_youtube_insights,
 * verify_claim) bunu çağırır.
 *
 * `unresolved`: metinde sembol gibi duran ama hiçbir kaynakta tanınmayan
 * diziler. Tahmin YÜRÜTÜLMEZ; boşluk açıkça raporlanır ki "kanıt yok" ile
 * "şirketi çözemedik" karışmasın.
 */
function resolveCoveredEntities({
  text,
  plannedEntities = [],
  index = null,
  useNameIndex = false,
  stopwords = DEFAULT_TEXT_STOPWORDS,
} = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return { entities: [], unresolved: [] };

  const found = new Set();

  // 1) Sözleşmede planlanmış şirketler — en güvenilir kaynak.
  for (const planned of plannedEntities) {
    const symbol = normalizeSymbol(planned);
    if (symbol && containsExactTicker(raw, symbol)) found.add(symbol);
  }

  // 2) Bilinen sembol evreni (canlı pano ya da fallback).
  for (const symbol of resolveKnownBistEntities(raw, index, { stopwords, useNameIndex })) {
    found.add(symbol);
  }

  // Tanınmayan sembol adayları — sessizce yutulmaz.
  const unresolved = [...new Set(
    uppercaseTokens(raw)
      .map(normalizeSymbol)
      .filter((token) => token.length >= 4 && !stopwords.has(token) && !found.has(token)),
  )];

  return { entities: [...found], unresolved };
}

module.exports = {
  GENERIC_NAME_TOKENS,
  DEFAULT_TEXT_STOPWORDS,
  foldTurkish,
  nameTokensFromSourceUrl,
  buildEntityIndex,
  resolveKnownBistEntities,
  containsExactTicker,
  resolveCoveredEntities,
};
