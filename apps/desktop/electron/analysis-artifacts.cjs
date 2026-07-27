// ============================================================
// analysis-artifacts.cjs — analiz çıktısı kayıt defteri
// ============================================================
// Sorun: widget HTML'ini LLM yazabiliyor, WidgetRenderer onu
// `sandbox="allow-scripts"` iframe'inde çalıştırıyor ve iframe
// `postMessage({type:'open-analysis-file', path})` ile main process'e
// KEYFİ bir yol gönderebiliyordu. main tarafı yalnız `existsSync`
// kontrol edip `shell.openPath` çağırdığı için bu, LLM'in yazdığı bir
// .bat/.exe dosyasını çalıştırmaya kadar giden bir zincirdi.
//
// Çözüm: widget'a yol GÖNDERİLMEZ. Uygulama ürettiği her analiz
// dosyasını burada kaydeder ve widget'a yalnızca opak bir artifactId
// gömülür. Açma anında yol kayıt defterinden alınır ve YENİDEN
// doğrulanır (TOCTOU: dosya kayıt sonrası symlink'e çevrilmiş olabilir).
//
// Bu modül tek güvenlik kapısıdır; renderer tarafındaki `e.source`
// kontrolü yalnızca yardımcı katmandır (kötü mesaj doğru iframe'den de
// gelebilir).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_ARTIFACTS = 200;

// Uygulamanın ürettiği analiz dosyası adı — generate_stock_chart'taki
// `cakal_${safeSymbol}_${Date.now()}.html` kalıbıyla birebir eşleşir.
const ARTIFACT_NAME_PATTERN = /^cakal_[A-Za-z0-9_]+_\d+\.html$/;

const ALLOWED_EXTENSIONS = new Set(['.html']);

// İkinci kapı (savunma katmanı): allowlist zaten yalnız .html'e izin verir,
// ama çalıştırılabilir ve yönlendirici uzantılar açıkça de reddedilir ki
// allowlist ileride gevşetilirse bu sınıf yine kapalı kalsın.
const DENIED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp', '.cpl',
  '.jar', '.js', '.jse', '.vbs', '.vbe', '.wsf', '.wsh', '.ps1', '.psm1',
  '.lnk', '.url', '.scf', '.reg', '.hta', '.inf', '.chm', '.msc',
  '.application', '.gadget', '.sh', '.py',
]);

const ARTIFACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** id -> mutlak yol. Ekleme sırası korunur (Map), taşınca en eski atılır. */
const registry = new Map();

function canonicalTmpDir() {
  try {
    return fs.realpathSync.native(os.tmpdir());
  } catch {
    return path.resolve(os.tmpdir());
  }
}

/** Bir yolun geçerli bir analiz çıktısı olup olmadığını denetler. */
function isAllowedArtifactPath(candidatePath) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) return false;

  const ext = path.extname(candidatePath).toLowerCase();
  if (DENIED_EXTENSIONS.has(ext)) return false;
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  if (!ARTIFACT_NAME_PATTERN.test(path.basename(candidatePath))) return false;

  // Gerçek hedefi çöz: symlink başka bir yeri gösteriyorsa burada açığa çıkar.
  let real;
  try {
    real = fs.realpathSync.native(candidatePath);
  } catch {
    return false;
  }

  // Çözülmüş hedef de aynı kurallara uymalı (symlink .html -> .exe engellenir).
  const realExt = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(realExt) || DENIED_EXTENSIONS.has(realExt)) return false;
  if (!ARTIFACT_NAME_PATTERN.test(path.basename(real))) return false;

  // Normal dosya olmalı (dizin, aygıt, FIFO değil).
  let stat;
  try {
    stat = fs.lstatSync(real);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  // tmpdir hapsi.
  const tmpRoot = canonicalTmpDir();
  const relative = path.relative(tmpRoot, real);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false;

  return true;
}

/**
 * Uygulamanın ürettiği bir analiz dosyasını kaydeder.
 * @returns {string|null} artifactId, geçersizse null
 */
function registerAnalysisArtifact(fullPath) {
  if (!isAllowedArtifactPath(fullPath)) return null;

  const id = crypto.randomUUID();
  registry.set(id, fs.realpathSync.native(fullPath));

  while (registry.size > MAX_ARTIFACTS) {
    const oldest = registry.keys().next().value;
    registry.delete(oldest);
  }
  return id;
}

/**
 * artifactId'yi açılabilir mutlak yola çevirir.
 * Kayıt anındaki doğrulama yeterli sayılmaz; açma anında tekrar denetlenir.
 * @returns {string|null}
 */
function resolveAnalysisArtifact(artifactId) {
  if (typeof artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(artifactId)) return null;
  const stored = registry.get(artifactId);
  if (!stored) return null;
  if (!isAllowedArtifactPath(stored)) {
    // Kayıt sonrası dosya değiştirilmiş/silinmiş olabilir.
    registry.delete(artifactId);
    return null;
  }
  return stored;
}

/** Test ve kapatma temizliği için. */
function clearAnalysisArtifacts() {
  registry.clear();
}

function artifactCount() {
  return registry.size;
}

module.exports = {
  ARTIFACT_NAME_PATTERN,
  ARTIFACT_ID_PATTERN,
  ALLOWED_EXTENSIONS,
  DENIED_EXTENSIONS,
  MAX_ARTIFACTS,
  isAllowedArtifactPath,
  registerAnalysisArtifact,
  resolveAnalysisArtifact,
  clearAnalysisArtifacts,
  artifactCount,
};
