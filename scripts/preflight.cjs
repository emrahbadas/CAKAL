#!/usr/bin/env node
// ============================================================
// preflight.cjs — cerrahi bakım kapısı (deterministik)
// ============================================================
// Kodlama ajanı (Copilot Surgeon) ayrı bir worktree/branch üzerinde çalışır.
// Bu script ANA çalışma alanından çağrılır ve feature branch'in diff'ini
// denetler. Karar LLM'e değil, sabit kurallara aittir.
//
// KRİTİK: Bu script ajanın worktree'sindeki kopyadan DEĞİL, ana ağaçtaki
// güvenilir kopyadan çalıştırılmalıdır. Ajan kendi kopyasını değiştirirse
// "korunan yola dokunuldu" bulgusu üretilir; sabotaj çalıştırılmaz, tespit
// edilir.
//
// Kullanım:
//   node scripts/preflight.cjs --base main --head cakal/feature-CR-001
//   node scripts/preflight.cjs --base main --head HEAD --verify
//   node scripts/preflight.cjs --base main --head HEAD --verify-full --json
//
// Çıkış kodları:
//   0 → PASS   : onaya hazır
//   1 → BLOCK  : kesin blok, merge edilemez
//   2 → REVIEW : insan incelemesi gerekli
//   3 → ERROR  : kapı çalıştırılamadı (fail-closed; PASS sayılmaz)

const { execFileSync } = require('child_process');
const path = require('path');

// ============================================================
// KONFİGÜRASYON
// Korunan yol / secret listesi TEK KAYNAKTAN gelir: surgery/protected-paths.
// Böylece merge kapısı (bu dosya) ile canlı izin kancası aynı sınırı korur.
// Bu blok kapının anayasasıdır; değiştirilmesi mimari inceleme gerektirir.
// ============================================================

const {
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  SECRET_PATTERNS,
  isProtectedPath: sharedIsProtectedPath,
  isSecretPath: sharedIsSecretPath,
} = require('../apps/desktop/electron/surgery/protected-paths.cjs');

const TEST_PATH_PATTERN = /(^tests\/|\.test\.|\.spec\.)/i;

// Migration dosyaları — geri alma planı olmadan merge edilemez
const MIGRATION_PATH_PATTERN = /(^supabase\/migrations\/|(^|\/)migrations\/)/i;
const ROLLBACK_HINT_PATTERN = /(^|\/)(down|rollback|revert)[^/]*\.(sql|cjs|mjs|js|ts)$/i;
const ROLLBACK_CONTENT_PATTERN = /(--\s*rollback|--\s*down|DROP\s+|ROLLBACK)/i;

// Kapsam eşikleri — aşılırsa REVIEW (blok değil)
const SCOPE_LIMITS = {
  maxFiles: 25,
  maxLines: 1500,
};

// Bağımlılık beyanı içeren dosyalar
const MANIFEST_PATTERN = /(^|\/)package\.json$/i;

// ============================================================
// Yardımcılar
// ============================================================

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/').trim();
}

// Paylaşılan tek kaynağa devret (surgery/protected-paths). Yerel kopya yok.
const isProtectedPath = sharedIsProtectedPath;
const isSecretPath = sharedIsSecretPath;

/** `git diff --name-status base...head` çıktısını yapılandırır. */
function parseNameStatus(raw) {
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0].trim();
    // Rename/copy: R100 eski yeni
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({ status: status[0], from: normalize(parts[1]), file: normalize(parts[2]) });
    } else {
      entries.push({ status: status[0], file: normalize(parts[1]) });
    }
  }
  return entries;
}

/**
 * Unified diff'i dosya bazında ayırır.
 * Bulgunun HANGİ dosyadan geldiğini bilmek şart: aksi halde rapor, dokunulan
 * tüm dosyaları suçlu gösterir ve insan yanlış yere bakar.
 * @returns {Map<string, {added: string[], removed: string[]}>}
 */
function splitPatchByFile(patch) {
  const files = new Map();
  let current = null;

  for (const line of String(patch || '').split('\n')) {
    const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (header) {
      current = normalize(header[2]);
      if (!files.has(current)) files.set(current, { added: [], removed: [] });
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('index ')) continue;
    if (line.startsWith('+')) files.get(current).added.push(line.slice(1));
    else if (line.startsWith('-')) files.get(current).removed.push(line.slice(1));
  }
  return files;
}

/**
 * Satırdan string literallerini ve satır yorumlarını temizler.
 *
 * Gerekçe: kapının kendi testi `'it.only("x", ...)'` gibi bir fixture STRING'i
 * içerir. Ham metin üzerinde arama yapılırsa kapı kendi testini bloklar —
 * gerçek bir yanlış pozitif. Yanlış pozitif veren kapıya insan güvenmeyi
 * bırakır, o yüzden bu ayrım güvenlik açısından kritiktir.
 *
 * Bu bir sezgisel (heuristic) temizliktir, JS parser değildir; tek satır
 * kapsamında çalışır ve amaç için yeterlidir.
 */
function stripNonCode(line) {
  let text = String(line);
  // Önce string literalleri: içlerindeki // veya .only kod sayılmamalı.
  text = text.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  text = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  text = text.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  // Sonra satır yorumu.
  text = text.replace(/\/\/.*$/, '');
  return text;
}

/** Unified diff'ten eklenen/silinen satırları ayırır. */
function splitDiffLines(patch) {
  const added = [];
  const removed = [];
  for (const line of String(patch || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

function countMatches(lines, pattern) {
  let total = 0;
  for (const line of lines) {
    const found = line.match(pattern);
    if (found) total += found.length;
  }
  return total;
}

// ============================================================
// Kontroller
// Her kontrol findings dizisine ekler. severity: BLOCK | REVIEW | INFO
// ============================================================

function checkProtectedPaths(entries, findings) {
  const hits = entries.filter((e) => isProtectedPath(e.file) || (e.from && isProtectedPath(e.from)));
  if (hits.length > 0) {
    findings.push({
      severity: 'BLOCK',
      code: 'PROTECTED_PATH',
      message: 'Korunan çekirdek dosyalara dokunulmuş. Bu değişiklik mimari inceleme gerektirir (REQUIRES_ARCHITECTURAL_REVIEW).',
      files: hits.map((e) => e.file),
    });
  }
}

function checkSecrets(entries, findings) {
  const hits = entries.filter((e) => isSecretPath(e.file) || (e.from && isSecretPath(e.from)));
  if (hits.length > 0) {
    findings.push({
      severity: 'BLOCK',
      code: 'SECRET_FILE_TOUCHED',
      message: 'Secret/kimlik dosyası değiştirilmiş. Secret işlemleri yalnız Secret Broker üzerinden yapılır.',
      files: hits.map((e) => e.file),
    });
  }
}

function checkTests(entries, findings, ctx) {
  const deleted = entries.filter((e) => e.status === 'D' && TEST_PATH_PATTERN.test(e.file));
  if (deleted.length > 0) {
    findings.push({
      severity: 'BLOCK',
      code: 'TEST_DELETED',
      message: 'Test dosyası silinmiş. Test silme her koşulda bloklanır.',
      files: deleted.map((e) => e.file),
    });
  }

  const touched = entries.filter((e) => e.status !== 'D' && TEST_PATH_PATTERN.test(e.file));
  if (touched.length === 0) return;

  const patch = ctx.diffFor(touched.map((e) => e.file));
  const byFile = splitPatchByFile(patch);

  const ONLY_PATTERN = /\b(?:describe|it|test)\.only\b/g;
  const SKIP_PATTERN = /\b(?:describe|it|test)\.(?:skip|todo)\b|\bxit\b|\bxdescribe\b/g;
  const ASSERTION_PATTERN = /\bexpect\s*\(|\bassert\w*\s*\(/g;

  const only = { files: [], total: 0 };
  const skip = { files: [], total: 0 };
  const assertions = { files: [], total: 0 };

  // Dosya bazında say: bulgu yalnız gerçekten eşleşen dosyayı gösterir.
  for (const [file, lines] of byFile) {
    if (!TEST_PATH_PATTERN.test(file)) continue;

    // Kod/metin ayrımı: fixture string'i içindeki `.only` gerçek `.only` değildir.
    const added = lines.added.map(stripNonCode);
    const removed = lines.removed.map(stripNonCode);

    const onlyDelta = countMatches(added, ONLY_PATTERN) - countMatches(removed, ONLY_PATTERN);
    if (onlyDelta > 0) {
      only.files.push(file);
      only.total += onlyDelta;
    }

    const skipDelta = countMatches(added, SKIP_PATTERN) - countMatches(removed, SKIP_PATTERN);
    if (skipDelta > 0) {
      skip.files.push(file);
      skip.total += skipDelta;
    }

    const assertionDelta = countMatches(added, ASSERTION_PATTERN) - countMatches(removed, ASSERTION_PATTERN);
    if (assertionDelta < 0) {
      assertions.files.push(file);
      assertions.total += assertionDelta;
    }
  }

  // .only → testleri sessizce daraltır, blok
  if (only.files.length > 0) {
    findings.push({
      severity: 'BLOCK',
      code: 'TEST_ONLY_ADDED',
      message: `.only kullanımı eklenmiş (${only.total}). Diğer testleri sessizce devre dışı bırakır.`,
      files: only.files,
    });
  }

  // skip/todo → gerekçe gerektirir, insan incelemesi
  if (skip.files.length > 0) {
    findings.push({
      severity: 'REVIEW',
      code: 'TEST_SKIPPED',
      message: `Atlanan test sayısı artmış (+${skip.total}). Gerekçe gerekiyor.`,
      files: skip.files,
    });
  }

  // Assertion azalması → OTOMATİK BLOK DEĞİL.
  // Üç zayıf assertion tek güçlü assertion'a dönüşmüş olabilir; kapı
  // hüküm vermez, insana işaret eder.
  if (assertions.files.length > 0) {
    findings.push({
      severity: 'REVIEW',
      code: 'ASSERTION_COUNT_DROPPED',
      message: `Assertion sayısı net ${Math.abs(assertions.total)} azalmış. Zayıflatma olabilir; sadeleştirme de olabilir. İnceleme gerekli.`,
      files: assertions.files,
    });
  }
}

function checkDependencies(entries, findings, ctx) {
  const manifests = entries.filter((e) => e.status !== 'D' && MANIFEST_PATTERN.test(e.file));
  if (manifests.length === 0) return;

  const patch = ctx.diffFor(manifests.map((e) => e.file));
  const { added } = splitDiffLines(patch);
  // package.json içinde "paket": "sürüm" satırı eklenmiş mi
  const newDeps = added
    .map((line) => line.match(/^\s*"([^"]+)"\s*:\s*"([^"]+)"/))
    .filter(Boolean)
    .filter((m) => /^[@a-z0-9][\w./-]*$/i.test(m[1]) && /^[\^~>=<*\d]/.test(m[2]))
    .map((m) => `${m[1]}@${m[2]}`);

  if (newDeps.length > 0) {
    findings.push({
      severity: 'REVIEW',
      code: 'NEW_DEPENDENCY',
      message: `Yeni bağımlılık beyanı eklenmiş (${newDeps.length}). Supply-chain incelemesi gerekli.`,
      files: manifests.map((e) => e.file),
      details: newDeps.slice(0, 20),
    });
  }
}

function checkMigrations(entries, findings, ctx) {
  const migrations = entries.filter((e) => e.status !== 'D' && MIGRATION_PATH_PATTERN.test(e.file));
  if (migrations.length === 0) return;

  const allFiles = entries.map((e) => e.file);
  const hasRollbackFile = allFiles.some((f) => ROLLBACK_HINT_PATTERN.test(f));
  const patch = ctx.diffFor(migrations.map((e) => e.file));
  const { added } = splitDiffLines(patch);
  const hasRollbackContent = added.some((line) => ROLLBACK_CONTENT_PATTERN.test(line));

  if (!hasRollbackFile && !hasRollbackContent) {
    findings.push({
      severity: 'BLOCK',
      code: 'MIGRATION_WITHOUT_ROLLBACK',
      message: 'Migration eklenmiş fakat geri alma planı bulunamadı. Kod rollback\'i şema rollback\'i değildir; down/rollback script\'i zorunlu.',
      files: migrations.map((e) => e.file),
    });
  } else {
    findings.push({
      severity: 'REVIEW',
      code: 'MIGRATION_PRESENT',
      message: 'Migration içeriyor. Merge öncesi DB snapshot alınmalı ve geri alma planı doğrulanmalı.',
      files: migrations.map((e) => e.file),
    });
  }
}

function checkScope(entries, stats, findings) {
  if (entries.length > SCOPE_LIMITS.maxFiles) {
    findings.push({
      severity: 'REVIEW',
      code: 'SCOPE_FILES',
      message: `Değişen dosya sayısı eşiği aşıyor (${entries.length} > ${SCOPE_LIMITS.maxFiles}). Cerrahi paket küçük ve bağımsız olmalı.`,
    });
  }
  const totalLines = stats.insertions + stats.deletions;
  if (totalLines > SCOPE_LIMITS.maxLines) {
    findings.push({
      severity: 'REVIEW',
      code: 'SCOPE_LINES',
      message: `Değişen satır sayısı eşiği aşıyor (${totalLines} > ${SCOPE_LIMITS.maxLines}).`,
    });
  }
}

// ============================================================
// Doğrulama komutları (opsiyonel, yavaş)
// ============================================================

function runCommand(label, args, cwd, findings, checks) {
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    checks[label] = 'PASS';
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    // Script tanımlı değilse veya araç kurulu değilse: FAIL değil SKIPPED.
    // (Bu repoda lint scripti var ama eslint kurulu değil — kapı bu yüzden
    // sürekli bloklamamalı; durumu görünür kılmalı.)
    if (/Missing script|is not recognized|command not found|ENOENT/i.test(output)) {
      checks[label] = 'SKIPPED';
      findings.push({
        severity: 'REVIEW',
        code: `${label.toUpperCase()}_UNAVAILABLE`,
        message: `${label} çalıştırılamadı (script veya araç yok). Kapı bunu başarı saymaz.`,
      });
      return;
    }
    checks[label] = 'FAIL';
    findings.push({
      severity: 'BLOCK',
      code: `${label.toUpperCase()}_FAILED`,
      message: `${label} başarısız. Doğrulama geçmeden merge edilemez.`,
      details: output.split('\n').filter(Boolean).slice(-15),
    });
  }
}

// ============================================================
// Ana akış
// ============================================================

function parseArgs(argv) {
  const args = { base: 'main', head: 'HEAD', cwd: process.cwd(), json: false, verify: false, verifyFull: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--head') args.head = argv[++i];
    else if (a === '--cwd') args.cwd = path.resolve(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--verify-full') { args.verify = true; args.verifyFull = true; }
  }
  return args;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const findings = [];
  const checks = {};

  // Üç nokta (base...head): ortak atadan itibaren yalnız head'in getirdikleri.
  const range = `${args.base}...${args.head}`;

  const nameStatus = git(['diff', '--name-status', range], { cwd: args.cwd });
  const entries = parseNameStatus(nameStatus);

  const shortstat = git(['diff', '--shortstat', range], { cwd: args.cwd });
  const stats = {
    filesChanged: entries.length,
    insertions: Number((shortstat.match(/(\d+) insertion/) || [])[1] || 0),
    deletions: Number((shortstat.match(/(\d+) deletion/) || [])[1] || 0),
  };

  const ctx = {
    diffFor(files) {
      if (!files || files.length === 0) return '';
      return git(['diff', range, '--', ...files], { cwd: args.cwd });
    },
  };

  checkProtectedPaths(entries, findings);
  checkSecrets(entries, findings);
  checkTests(entries, findings, ctx);
  checkDependencies(entries, findings, ctx);
  checkMigrations(entries, findings, ctx);
  checkScope(entries, stats, findings);

  if (args.verify) {
    runCommand('test', ['test'], args.cwd, findings, checks);
    runCommand('typecheck', ['run', 'typecheck'], args.cwd, findings, checks);
    runCommand('lint', ['run', 'lint'], args.cwd, findings, checks);
    if (args.verifyFull) {
      runCommand('build', ['run', 'build', '--workspace=apps/desktop'], args.cwd, findings, checks);
    }
  }

  const hasBlock = findings.some((f) => f.severity === 'BLOCK');
  const hasReview = findings.some((f) => f.severity === 'REVIEW');
  const verdict = hasBlock ? 'BLOCK' : hasReview ? 'REVIEW' : 'PASS';
  const exitCode = hasBlock ? 1 : hasReview ? 2 : 0;

  return {
    verdict,
    exitCode,
    base: args.base,
    head: args.head,
    range,
    stats,
    checks,
    findings,
    files: entries.map((e) => ({ status: e.status, file: e.file })),
  };
}

function formatHuman(result) {
  const lines = [];
  const icon = { PASS: 'PASS', BLOCK: 'BLOK', REVIEW: 'INCELEME' }[result.verdict];
  lines.push('='.repeat(64));
  lines.push(`PREFLIGHT: ${icon}   (${result.range})`);
  lines.push('='.repeat(64));
  lines.push(`Dosya: ${result.stats.filesChanged}  +${result.stats.insertions} / -${result.stats.deletions}`);

  if (Object.keys(result.checks).length > 0) {
    lines.push('');
    lines.push('Doğrulama:');
    for (const [name, state] of Object.entries(result.checks)) {
      lines.push(`  ${state.padEnd(8)} ${name}`);
    }
  }

  if (result.findings.length === 0) {
    lines.push('');
    lines.push('Bulgu yok.');
  } else {
    for (const severity of ['BLOCK', 'REVIEW', 'INFO']) {
      const group = result.findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push('');
      lines.push(`--- ${severity} (${group.length}) ---`);
      for (const f of group) {
        lines.push(`  [${f.code}] ${f.message}`);
        for (const file of (f.files || []).slice(0, 10)) lines.push(`      - ${file}`);
        for (const detail of (f.details || []).slice(0, 10)) lines.push(`      | ${detail}`);
      }
    }
  }

  lines.push('');
  lines.push(`Sonuç: ${result.verdict} (exit ${result.exitCode})`);
  return lines.join('\n');
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = run();
    console.log(args.json ? JSON.stringify(result, null, 2) : formatHuman(result));
    process.exit(result.exitCode);
  } catch (err) {
    // Fail-closed: kapı çalışamadıysa bu bir PASS değildir.
    console.error(`PREFLIGHT HATASI: ${err.message}`);
    process.exit(3);
  }
}

module.exports = {
  run,
  formatHuman,
  parseArgs,
  parseNameStatus,
  splitDiffLines,
  splitPatchByFile,
  stripNonCode,
  countMatches,
  isProtectedPath,
  isSecretPath,
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  SECRET_PATTERNS,
  SCOPE_LIMITS,
};
