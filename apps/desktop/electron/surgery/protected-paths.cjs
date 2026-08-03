// ============================================================
// protected-paths.cjs — korunan-yol tek doğruluk kaynağı
// ============================================================
// İki ayrı zorlayıcı aynı sınırı korur:
//   1. onPermissionRequest kancası (oturum anında, cerrah ajanı canlı durdurur)
//   2. preflight.cjs (merge anında, diff'i denetler)
//
// Bu iki liste ayrı tutulursa zamanla ayrışır ve zayıf olan kazanır. O yüzden
// korunan yollar, secret desenleri ve yasak komutlar YALNIZ burada tanımlanır.
// Bu dosyanın kendisi de korunan bir yoldur.

const path = require('path');

// Cerrahın dokunamayacağı çekirdek dosyalar (repo-göreli).
// Güvenlik sınırını tanımlayan veya kapının kendisini oluşturan her şey.
const PROTECTED_PATHS = [
  // Güvenlik katmanları
  'apps/desktop/electron/safe-path.cjs',
  'apps/desktop/electron/command-guard.cjs',
  'apps/desktop/electron/secret-broker.cjs',
  'apps/desktop/electron/sandbox-plugin-fsm.cjs',
  'apps/desktop/electron/decision-guards.cjs',
  'apps/desktop/electron/analysis-artifacts.cjs',
  'apps/desktop/electron/execution-contract.cjs',
  'packages/core/investment-research/shared/policy-core.cjs',
  // Cerrahi altyapının kendisi — cerrah kendi kapısını/kancasını ayarlayamaz
  'scripts/preflight.cjs',
  'apps/desktop/electron/surgery/protected-paths.cjs',
  'apps/desktop/electron/surgery/permission-hook.cjs',
  'apps/desktop/electron/surgery/handoff.cjs',
  'apps/desktop/electron/surgery/copilot-surgeon.cjs',
  'apps/desktop/electron/surgery/session-manager.cjs',
  'apps/desktop/electron/surgery/review-service.cjs',
  'apps/desktop/electron/surgery/index.cjs',
];

// Dizin bazlı korumalar (prefix eşleşmesi)
const PROTECTED_PREFIXES = [
  '.github/workflows/',
];

// Secret / kimlik dosyaları — hiçbir koşulda okunmaz/yazılmaz
const SECRET_PATTERNS = [
  /^\.env(\.|$)/i,
  /\.(pem|key|p12|pfx|asc|gpg|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)credentials?(\.|$)/i,
  /(^|\/)[^/]*service[-_]?account[^/]*\.json$/i,
  /(^|\/)[^/]*secrets?[^/]*\.json$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)cakal-secrets\.json$/i,
  /(^|\/)\.cakal-sandbox\/secrets\//i,
];

// Uzak depoya yazan / yayınlayan / indir-çalıştır komutları.
// Cerrah yerel worktree'de çalışır; upstream'e hiçbir şey gönderemez.
const FORBIDDEN_COMMAND_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+remote\s+(add|set-url|remove|rename)\b/i,
  /\bgit\s+(config)\b[^\n]*\b(user\.|url\.|credential)/i,
  /\bnpm\s+publish\b/i,
  /\byarn\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|node|python|pwsh|powershell|cmd)/i,
  /\bgh\s+(pr|release|repo|api)\b/i,
];

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isProtectedPath(repoRelPath) {
  const p = normalize(repoRelPath);
  if (!p) return false;
  return PROTECTED_PATHS.includes(p) || PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function isSecretPath(repoRelPath) {
  const p = normalize(repoRelPath);
  if (!p) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(p));
}

function isForbiddenCommand(commandText) {
  const c = String(commandText || '');
  if (!c.trim()) return false;
  return FORBIDDEN_COMMAND_PATTERNS.some((pattern) => pattern.test(c));
}

/**
 * Mutlak bir hedef yolun, cerrahi worktree köküne göre repo-göreli halini
 * çıkarır. Hedef worktree DIŞINDA ise null döner (bu durum çağıran tarafça
 * reddedilir: cerrah yalnız kendi worktree'sinde çalışabilir).
 * @returns {string|null} repo-göreli yol veya worktree dışıysa null
 */
function toRepoRelative(worktreeRoot, absoluteTarget) {
  if (!worktreeRoot || !absoluteTarget) return null;
  const rel = path.relative(path.resolve(worktreeRoot), path.resolve(absoluteTarget));
  if (rel === '') return null;                                   // kökün kendisi
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // worktree dışı
  return rel.replace(/\\/g, '/');
}

module.exports = {
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  SECRET_PATTERNS,
  FORBIDDEN_COMMAND_PATTERNS,
  normalize,
  isProtectedPath,
  isSecretPath,
  isForbiddenCommand,
  toRepoRelative,
};
