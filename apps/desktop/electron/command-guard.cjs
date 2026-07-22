// Self-Dev terminal komutları ve path erişimi için ortak güvenlik katmanı.
// İki kademe: önce allowlist (sadece doğrulama amaçlı komutlar),
// sonra blocklist (Windows/PowerShell/Unix yıkıcı komutları).

const path = require('path');

// Path hapsi: fullPath.startsWith(root) kontrolü kardeş klasörleri içeride
// sayar (root "...\cakal" iken "...\cakal-evil\x" de startsWith'ten geçer).
// path.relative tabanlı kontrol bu sınıfı kapatır; win32'de büyük/küçük harf
// duyarsız karşılaştırmayı path.relative kendisi yapar.
function isInsideRoot(rootDir, candidatePath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const ALLOWED_COMMAND_PATTERNS = [
  /^(npm|pnpm)\s+(test|run\s+(test|lint|build|check|typecheck|dev))\b/i,
  /^npx\s+(tsc|vitest|eslint|playwright|supabase)\b/i,
  // node: yalnız sürüm kontrolü ve İNSAN-YAZIMI scripts/ dizini (LLM'e yazma-korumalı).
  // child_process gerçek bir izolasyon sınırı değildir; LLM'in yazabildiği yollardan
  // (.cakal-sandbox vb.) veya -e ile inline kod çalıştırmak yasaktır.
  /^node\s+(--version|-v)$/i,
  /^node\s+(\.[/\\])?scripts[/\\](?!.*\.\.)[\w\-./\\]+\.(cjs|mjs|js)(\s+[^|;&><`$]*)?$/i,
  /^git\s+(status|diff|log\s+--oneline|rev-parse\s+--short\s+HEAD)$/i,
  /^(dir|ls|Get-ChildItem|type|cat)\b/i,
];

const DANGEROUS_COMMAND_PATTERNS = [
  // Unix silme / disk
  /\brm\s+(-[a-z]*[rf][a-z]*\b|\/)/i,
  /\bmkfs\b/i, /\bdd\s+if=/i,
  // Windows cmd silme / disk
  /\bdel\b/i, /\berase\b/i, /\brd\b/i, /\brmdir\b/i,
  /\bformat\b/i, /\bdiskpart\b/i, /\bcipher\s+\/w/i,
  // PowerShell yıkıcı / çalıştırıcı
  /remove-item/i, /clear-content/i, /invoke-expression/i, /\biex\b/i,
  /invoke-webrequest/i, /invoke-restmethod/i, /start-process/i,
  /set-executionpolicy/i, /\bpowershell\b.*-enc/i, /\bpwsh\b.*-enc/i,
  // Sistem
  /\bshutdown\b/i, /\breboot\b/i, /restart-computer/i, /stop-computer/i,
  /\breg\s+(delete|add|import)\b/i, /\bregedit\b/i, /\bschtasks\b/i,
  /\bsudo\b/i, /\btakeown\b/i, /\bicacls\b/i, /\battrib\b/i,
  // İndir & çalıştır
  /\b(curl|wget)\b[^|]*\|\s*(sh|bash|powershell|pwsh|node|cmd)/i,
  /\bcertutil\b.*-urlcache/i, /\bbitsadmin\b/i, /\bmshta\b/i,
  // Yayınlama / uzak yazma
  /\bnpm\s+publish\b/i, /\bgit\s+push\b/i, /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\b/i, /\bgit\s+checkout\s+--\s/i,
  // DB yıkıcı
  /\bdrop\s+(database|schema|table)\b/i, /\btruncate\b/i,
  // Komut zincirleme ile bypass girişimi
  /[;&|><`$]/,
];

function isCommandAllowed(command) {
  const normalized = String(command || '').trim();
  if (!normalized) return false;
  return ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isDangerousCommand(command) {
  const normalized = String(command || '').trim();
  if (!normalized) return true;
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Tek giriş noktası: allowlist'te olmalı VE blocklist'e takılmamalı.
function checkCommand(command) {
  if (!isCommandAllowed(command)) {
    return { allowed: false, reason: 'Komut izin listesinde değil. Sadece test/build/lint/okuma amaçlı doğrulama komutları çalıştırılabilir.' };
  }
  if (isDangerousCommand(command)) {
    return { allowed: false, reason: 'Tehlikeli komut kalıbı engellendi.' };
  }
  return { allowed: true, reason: null };
}

module.exports = {
  ALLOWED_COMMAND_PATTERNS,
  DANGEROUS_COMMAND_PATTERNS,
  isCommandAllowed,
  isDangerousCommand,
  checkCommand,
  isInsideRoot,
};
