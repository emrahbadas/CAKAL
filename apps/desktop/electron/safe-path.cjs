// ============================================================
// safe-path.cjs — kanonik yol çözümleme ve hapsetme
// ============================================================
// Sorun: guard'lar HAM yol üzerinde string/regex çalışırken dosya işlemi
// ÇÖZÜLMÜŞ yolu kullanırsa, `..` içeren bir girdi iki tarafı ayrıştırır ve
// sandbox kaçışı doğar. Bu modül tek bir doğru cevap üretir:
//
//   girdi -> sözdizimi kapısı -> çözümle -> realpath ile kanonikleştir
//         -> kök hapsi -> { fullPath, repoPath }
//
// Dönen `fullPath` TEK gerçek kaynaktır; çağıran taraf onu yeniden
// resolve etmeden doğrudan fs'e vermelidir. `repoPath` de kanonik nihai
// yoldan türetilir; sandbox/denylist kontrolleri onun üzerinde çalışır.
//
// Kapsanan saldırı sınıfları:
//   - `..` traversal (sözdizimi seviyesinde, çözümlemeden önce reddedilir)
//   - symlink / NTFS junction ile dizin dışına kaçış (realpath ile)
//   - mutlak yol, sürücü-göreli (`C:x`), UNC (`\\sunucu\pay`)
//   - NTFS alternate data stream (`dosya.html:kotu.exe`)
//   - Windows ayrılmış aygıt adları (CON, NUL, COM1...)
//   - sondaki nokta/boşluk normalizasyonu (`x.txt.` -> `x.txt`)
//   - null byte ve kontrol karakteri enjeksiyonu
//   - win32 case-insensitive eşleşme farkları

const fs = require('fs');
const path = require('path');
const { isInsideRoot } = require('./command-guard.cjs');

const IS_WINDOWS = process.platform === 'win32';

// Windows ayrılmış aygıt adları — uzantıyla birlikte de aygıta çözülür.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Dosya adında kabul edilmeyen görünür karakterler.
// Not: tire ve boşluk MEŞRUDUR (`.cakal-sandbox`); sınıfa girmez.
// `:` ayrıca ADS kontrolüyle, kontrol karakterleri hasControlChars ile ele alınır.
const INVALID_PATH_CHARS = /[<>"|?*]/;

/**
 * Null byte dahil tüm C0 kontrol karakterlerini ve DEL'i yakalar.
 * Regex escape'i yerine kod noktası kontrolü kullanılıyor: kaynakta ham
 * kontrol karakteri bulunmasın diye (okunabilirlik + kopyalama güvenliği).
 */
function hasControlChars(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Yol dizesini segmentlere ayırır ve her segmenti sözdizimi kapısından geçirir.
 * `..` burada kesin olarak reddedilir: meşru araç kullanımı asla `..` içermez,
 * ve reddetmek çözümleme sonrası karşılaştırmaya güvenmekten daha güvenlidir.
 * @returns {{ ok: true, segments: string[] } | { ok: false, reason: string }}
 */
function parseRelativeSegments(inputPath) {
  const raw = typeof inputPath === 'string' ? inputPath : String(inputPath ?? '');
  if (!raw.trim()) {
    return { ok: false, reason: 'Yol boş olamaz.' };
  }
  if (hasControlChars(raw)) {
    return { ok: false, reason: 'Yol null byte veya kontrol karakteri içeremez.' };
  }

  const unified = raw.replace(/\\/g, '/');

  if (unified.startsWith('//')) {
    return { ok: false, reason: 'UNC ağ yolları kabul edilmez.' };
  }
  if (path.isAbsolute(raw) || path.isAbsolute(unified) || /^[A-Za-z]:/.test(unified)) {
    return { ok: false, reason: 'Mutlak veya sürücü-göreli yol kabul edilmez; proje-göreli yol ver.' };
  }

  const segments = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      return { ok: false, reason: 'Yol ".." içeremez (dizin dışına çıkma girişimi).' };
    }
    if (segment.includes(':')) {
      return { ok: false, reason: 'Yol ":" içeremez (alternate data stream / sürücü belirteci).' };
    }
    if (INVALID_PATH_CHARS.test(segment)) {
      return { ok: false, reason: 'Yol geçersiz karakter içeriyor.' };
    }
    if (WINDOWS_RESERVED_NAME.test(segment)) {
      return { ok: false, reason: `Windows ayrılmış aygıt adı kullanılamaz: ${segment}` };
    }
    if (/[. ]$/.test(segment)) {
      // Windows sondaki nokta/boşluğu sessizce kırpar; kontrol edilen ad ile
      // diskteki ad ayrışır.
      return { ok: false, reason: 'Yol bileşeni nokta veya boşlukla bitemez.' };
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return { ok: false, reason: 'Geçerli bir yol bileşeni bulunamadı.' };
  }
  return { ok: true, segments };
}

/** Var olan en yakın ata dizini bulur (hedef henüz yaratılmamış olabilir). */
function nearestExistingAncestor(fullPath) {
  let current = fullPath;
  for (;;) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** realpath ile kanonikleştirir; symlink/junction çözer, win32'de case düzeltir. */
function canonicalize(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(targetPath);
    }
  }
}

/**
 * Proje köküne göre güvenli yol çözümlemesi.
 * @param {string} rootDir Hapsedilecek kök (proje kökü)
 * @param {string} inputPath Kullanıcı/LLM kaynaklı göreli yol
 * @returns {{ ok: true, fullPath: string, repoPath: string } | { ok: false, reason: string }}
 */
function resolveWithinRoot(rootDir, inputPath) {
  const parsed = parseRelativeSegments(inputPath);
  if (!parsed.ok) return parsed;

  const canonicalRoot = canonicalize(path.resolve(rootDir));
  const candidate = path.resolve(canonicalRoot, parsed.segments.join(path.sep));

  // Sözdizimi kapısı `..`'yı zaten reddetti; yine de çözümleme sonrası
  // kontrol edilir (savunma katmanı).
  if (!isInsideRoot(canonicalRoot, candidate)) {
    return { ok: false, reason: 'Yol proje kökü dışına çıkıyor.' };
  }

  // symlink / junction kaçışı: var olan en yakın ata dizini kanonikleştirip
  // hâlâ kök içinde mi diye bakılır. Hedef dosya henüz yoksa da çalışır.
  const ancestor = nearestExistingAncestor(candidate);
  const realAncestor = canonicalize(ancestor);
  if (!isInsideRoot(canonicalRoot, realAncestor)) {
    return { ok: false, reason: 'Yol bir symlink/junction üzerinden proje kökü dışına çıkıyor.' };
  }

  const remainder = path.relative(ancestor, candidate);
  const fullPath = remainder ? path.join(realAncestor, remainder) : realAncestor;

  if (!isInsideRoot(canonicalRoot, fullPath)) {
    return { ok: false, reason: 'Kanonik yol proje kökü dışına çıkıyor.' };
  }

  const repoPath = path.relative(canonicalRoot, fullPath).replace(/\\/g, '/');
  if (!repoPath || repoPath.startsWith('..')) {
    return { ok: false, reason: 'Kanonik repo yolu üretilemedi.' };
  }

  return { ok: true, fullPath, repoPath };
}

/** win32'de kök karşılaştırması case-insensitive olmalı. */
function startsWithRoot(repoPath, root) {
  return IS_WINDOWS
    ? repoPath.toLowerCase().startsWith(root.toLowerCase())
    : repoPath.startsWith(root);
}

module.exports = {
  IS_WINDOWS,
  INVALID_PATH_CHARS,
  WINDOWS_RESERVED_NAME,
  hasControlChars,
  parseRelativeSegments,
  resolveWithinRoot,
  startsWithRoot,
  canonicalize,
  nearestExistingAncestor,
};
