import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import preflight from '../scripts/preflight.cjs';

const {
  run,
  parseNameStatus,
  splitDiffLines,
  splitPatchByFile,
  stripNonCode,
  countMatches,
  isProtectedPath,
  isSecretPath,
} = preflight;

const repos = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, stdio: 'pipe' });
}

/**
 * Tek kullanımlık fixture repo. Kapı gerçek `git diff` üzerinde çalıştığı için
 * testler de gerçek commit'ler üretir; diff parse'ı mock'lanmaz.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-preflight-'));
  repos.push(dir);
  try {
    git(['init', '-b', 'main'], dir);
  } catch {
    git(['init'], dir);
    git(['checkout', '-b', 'main'], dir);
  }
  git(['config', 'user.email', 'test@cakal.local'], dir);
  git(['config', 'user.name', 'Preflight Test'], dir);
  // Tek kullanımlık fixture; imzalama ortam farklarından bağımsız olsun.
  git(['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

function write(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function commitAll(dir, message) {
  git(['add', '-A'], dir);
  git(['commit', '-m', message], dir);
}

/** main üzerinde temel içerik, sonra feature dalı. */
function seedRepo(dir, baseFiles = {}) {
  write(dir, 'README.md', '# fixture\n');
  for (const [file, content] of Object.entries(baseFiles)) write(dir, file, content);
  commitAll(dir, 'base');
  git(['checkout', '-b', 'feature'], dir);
}

function gate(dir, extra = []) {
  return run(['--base', 'main', '--head', 'feature', '--cwd', dir, ...extra]);
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

afterAll(() => {
  for (const dir of repos) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
  }
});

// ============================================================
// Saf yardımcılar
// ============================================================

describe('yol sınıflandırma', () => {
  it('korunan çekirdek dosyaları tanır', () => {
    expect(isProtectedPath('apps/desktop/electron/safe-path.cjs')).toBe(true);
    expect(isProtectedPath('apps/desktop/electron/command-guard.cjs')).toBe(true);
    expect(isProtectedPath('packages/core/investment-research/shared/policy-core.cjs')).toBe(true);
    expect(isProtectedPath('.github/workflows/ci.yml')).toBe(true);
  });

  it('kapının kendisini korur', () => {
    expect(isProtectedPath('scripts/preflight.cjs')).toBe(true);
  });

  it('normal dosyaları korumalı saymaz', () => {
    expect(isProtectedPath('apps/desktop/electron/ai-service.cjs')).toBe(false);
    expect(isProtectedPath('apps/desktop/src/screens/ChatScreen.tsx')).toBe(false);
    expect(isProtectedPath('README.md')).toBe(false);
  });

  it('secret dosyalarını tanır', () => {
    for (const p of [
      '.env', '.env.local', 'certs/a.pem', 'certs/a.key', '.ssh/id_rsa',
      'credentials.json', 'gcp-service-account.json', '.npmrc', '.netrc',
      '.cakal-sandbox/secrets/dev-secrets.json',
    ]) {
      expect(isSecretPath(p), `secret sayılmalıydı: ${p}`).toBe(true);
    }
    expect(isSecretPath('apps/desktop/src/App.tsx')).toBe(false);
  });
});

describe('diff ayrıştırma', () => {
  it('name-status satırlarını çözer', () => {
    const parsed = parseNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\nR100\told.ts\tnew.ts\n');
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({ status: 'M', file: 'src/a.ts' });
    expect(parsed[2].status).toBe('D');
    expect(parsed[3]).toEqual({ status: 'R', from: 'old.ts', file: 'new.ts' });
  });

  it('eklenen ve silinen satırları ayırır, başlıkları atlar', () => {
    const { added, removed } = splitDiffLines('--- a/x\n+++ b/x\n+yeni\n-eski\n boş\n');
    expect(added).toEqual(['yeni']);
    expect(removed).toEqual(['eski']);
  });

  it('eşleşme sayar', () => {
    expect(countMatches(['expect(a)', 'expect(b); expect(c)'], /\bexpect\s*\(/g)).toBe(3);
  });

  it('patch\'i dosya bazında ayırır', () => {
    const patch = [
      'diff --git a/tests/a.test.mjs b/tests/a.test.mjs',
      'index 111..222 100644',
      '--- a/tests/a.test.mjs',
      '+++ b/tests/a.test.mjs',
      '@@ -1,1 +1,1 @@',
      '+a-eklenen',
      '-a-silinen',
      'diff --git a/tests/b.test.mjs b/tests/b.test.mjs',
      '--- a/tests/b.test.mjs',
      '+++ b/tests/b.test.mjs',
      '+b-eklenen',
    ].join('\n');

    const byFile = splitPatchByFile(patch);
    expect([...byFile.keys()]).toEqual(['tests/a.test.mjs', 'tests/b.test.mjs']);
    expect(byFile.get('tests/a.test.mjs')).toEqual({ added: ['a-eklenen'], removed: ['a-silinen'] });
    expect(byFile.get('tests/b.test.mjs').added).toEqual(['b-eklenen']);
  });
});

describe('kod/metin ayrımı (stripNonCode)', () => {
  it('string literali içindeki kodu kod saymaz', () => {
    expect(stripNonCode(`write(dir, 'x', 'it.only("a", () => {});')`)).not.toMatch(/\.only/);
    expect(stripNonCode('const s = "it.skip(1)";')).not.toMatch(/\.skip/);
    expect(stripNonCode('const t = `expect(x)`;')).not.toMatch(/expect\(/);
  });

  it('satır yorumundaki kodu kod saymaz', () => {
    expect(stripNonCode('// it.only burada aciklama')).not.toMatch(/\.only/);
  });

  it('gerçek kodu bozmaz', () => {
    expect(stripNonCode('it.only("x", () => {});')).toMatch(/it\.only/);
    expect(stripNonCode('  expect(a).toBe(b);')).toMatch(/expect\(/);
  });

  it('string içindeki // gerçek yorum sanılmaz', () => {
    expect(stripNonCode(`const url = 'https://ornek.com'; it.only("x");`)).toMatch(/it\.only/);
  });
});

// ============================================================
// Kapı davranışı — gerçek git repoları üzerinde
// ============================================================

describe('temiz değişiklik', () => {
  it('sorunsuz değişikliği geçirir (PASS / exit 0)', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'src/feature.ts', 'export const x = 1;\n');
    commitAll(dir, 'feat: yeni dosya');

    const result = gate(dir);
    expect(result.verdict).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.stats.filesChanged).toBe(1);
  });
});

describe('korunan yol', () => {
  it('çekirdek güvenlik dosyası değişirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'apps/desktop/electron/command-guard.cjs': 'module.exports = {};\n' });
    write(dir, 'apps/desktop/electron/command-guard.cjs', 'module.exports = { hacked: true };\n');
    commitAll(dir, 'guard degistir');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(result.exitCode).toBe(1);
    expect(codes(result)).toContain('PROTECTED_PATH');
  });

  it('kapının kendisi değiştirilirse bloklar (self-protection)', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'scripts/preflight.cjs': '// kapi\n' });
    write(dir, 'scripts/preflight.cjs', '// kapi devre disi\nprocess.exit(0);\n');
    commitAll(dir, 'kapiyi ayarla');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('PROTECTED_PATH');
  });

  it('CI workflow değişirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir, { '.github/workflows/ci.yml': 'name: CI\n' });
    write(dir, '.github/workflows/ci.yml', 'name: CI\n# testler kaldirildi\n');
    commitAll(dir, 'ci degistir');

    expect(gate(dir).verdict).toBe('BLOCK');
  });
});

describe('secret dosyaları', () => {
  it('.env değişirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, '.env', 'OPENAI_API_KEY=sahte\n');
    commitAll(dir, 'env ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('SECRET_FILE_TOUCHED');
  });

  it('secret json eklenirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'config/app-secrets.json', '{}\n');
    commitAll(dir, 'secret ekle');

    expect(codes(gate(dir))).toContain('SECRET_FILE_TOUCHED');
  });
});

describe('test bütünlüğü', () => {
  it('test silinirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'tests/a.test.mjs': 'it("x", () => { expect(1).toBe(1); });\n' });
    fs.rmSync(path.join(dir, 'tests/a.test.mjs'));
    commitAll(dir, 'testi sil');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('TEST_DELETED');
  });

  it('.only eklenirse bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'tests/a.test.mjs': 'it("x", () => { expect(1).toBe(1); });\n' });
    write(dir, 'tests/a.test.mjs', 'it.only("x", () => { expect(1).toBe(1); });\n');
    commitAll(dir, 'only ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('TEST_ONLY_ADDED');
  });

  it('skip eklenirse insan incelemesi ister (blok değil)', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'tests/a.test.mjs': 'it("x", () => { expect(1).toBe(1); });\n' });
    write(dir, 'tests/a.test.mjs', 'it.skip("x", () => { expect(1).toBe(1); });\n');
    commitAll(dir, 'skip ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    expect(result.exitCode).toBe(2);
    expect(codes(result)).toContain('TEST_SKIPPED');
  });

  it('assertion azalması otomatik bloklamaz, işaretler', () => {
    const dir = makeRepo();
    seedRepo(dir, {
      'tests/a.test.mjs': 'it("x", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n  expect(3).toBe(3);\n});\n',
    });
    write(dir, 'tests/a.test.mjs', 'it("x", () => {\n  expect(1).toBe(1);\n});\n');
    commitAll(dir, 'assertion azalt');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    expect(codes(result)).toContain('ASSERTION_COUNT_DROPPED');
    expect(codes(result)).not.toContain('TEST_DELETED');
  });

  it('string içindeki .only bloklamaz (yanlış pozitif regresyonu)', () => {
    // Kapının KENDİ testi bu şekilde bir fixture string'i içerir; ham metin
    // araması yapılırsa kapı kendi testini bloklardı.
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'tests/kapi.test.mjs', [
      "it('kapi .only yakalar', () => {",
      "  write(dir, 'tests/a.test.mjs', 'it.only(\"x\", () => {});');",
      '  expect(gate(dir).verdict).toBe(\'BLOCK\');',
      '});',
      '',
    ].join('\n'));
    commitAll(dir, 'kapi testi ekle');

    const result = gate(dir);
    expect(codes(result)).not.toContain('TEST_ONLY_ADDED');
    expect(result.verdict).toBe('PASS');
  });

  it('bulgu yalnızca suçlu dosyayı gösterir', () => {
    const dir = makeRepo();
    seedRepo(dir, {
      'tests/temiz.test.mjs': 'it("t", () => { expect(1).toBe(1); });\n',
      'tests/suclu.test.mjs': 'it("s", () => { expect(1).toBe(1); });\n',
    });
    write(dir, 'tests/temiz.test.mjs', 'it("t", () => { expect(1).toBe(1); expect(2).toBe(2); });\n');
    write(dir, 'tests/suclu.test.mjs', 'it.only("s", () => { expect(1).toBe(1); });\n');
    commitAll(dir, 'biri suclu');

    const result = gate(dir);
    const finding = result.findings.find((f) => f.code === 'TEST_ONLY_ADDED');
    expect(finding).toBeTruthy();
    expect(finding.files).toEqual(['tests/suclu.test.mjs']);
    expect(finding.files).not.toContain('tests/temiz.test.mjs');
  });

  it('test eklemek serbesttir (PASS)', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'tests/yeni.test.mjs', 'it("y", () => { expect(1).toBe(1); });\n');
    commitAll(dir, 'test ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('PASS');
  });
});

describe('bağımlılıklar', () => {
  it('yeni dependency insan incelemesi ister', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'package.json': '{\n  "name": "fx",\n  "dependencies": {\n    "a": "^1.0.0"\n  }\n}\n' });
    write(dir, 'package.json', '{\n  "name": "fx",\n  "dependencies": {\n    "a": "^1.0.0",\n    "kotu-paket": "^9.9.9"\n  }\n}\n');
    commitAll(dir, 'dep ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    const finding = result.findings.find((f) => f.code === 'NEW_DEPENDENCY');
    expect(finding).toBeTruthy();
    expect(finding.details.join(' ')).toMatch(/kotu-paket/);
  });
});

describe('migration', () => {
  it('geri alma planı yoksa bloklar', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'supabase/migrations/20260101_add_col.sql', 'ALTER TABLE t ADD COLUMN c text;\n');
    commitAll(dir, 'migration ekle');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('MIGRATION_WITHOUT_ROLLBACK');
  });

  it('rollback dosyası varsa inceleme ister (blok değil)', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'supabase/migrations/20260101_add_col.sql', 'ALTER TABLE t ADD COLUMN c text;\n');
    write(dir, 'supabase/migrations/20260101_add_col.down.sql', 'ALTER TABLE t DROP COLUMN c;\n');
    commitAll(dir, 'migration + rollback');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    expect(codes(result)).toContain('MIGRATION_PRESENT');
    expect(codes(result)).not.toContain('MIGRATION_WITHOUT_ROLLBACK');
  });
});

describe('kapsam', () => {
  it('çok büyük değişiklik insan incelemesi ister', () => {
    const dir = makeRepo();
    seedRepo(dir);
    for (let i = 0; i < 30; i += 1) {
      write(dir, `src/f${i}.ts`, `export const v${i} = ${i};\n`);
    }
    commitAll(dir, 'buyuk degisiklik');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    expect(codes(result)).toContain('SCOPE_FILES');
  });
});

describe('ürün anayasası kapısı', () => {
  it('KULLANICI ÖRNEĞİ — sosyal medyaya video paylaşan tool BLOKLANIR', () => {
    const dir = makeRepo();
    seedRepo(dir);
    // Gerçek üretim kodu: string fixture değil, çalışacak kod.
    write(dir, 'apps/desktop/electron/social-publisher.cjs', [
      "const CONFIG = { scope: 'tweet.write' };",
      'async function publishVideo(client, media) {',
      "  return client.post('/2/tweets', { media });",
      '}',
      'module.exports = { publishVideo };',
      '',
    ].join('\n'));
    commitAll(dir, 'sosyal medya yayinlayici');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(codes(result)).toContain('CHARTER_VIOLATION');
    const finding = result.findings.find((f) => f.code === 'CHARTER_VIOLATION');
    expect(finding.details.join(' ')).toMatch(/yazma/i);
  });

  it('KULLANICI ÖRNEĞİ — hava durumu tool\'u BLOKLANMAZ', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'apps/desktop/electron/weather.cjs', [
      'async function getWeather(city) {',
      '  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}`);',
      '  return res.json();',
      '}',
      'module.exports = { getWeather };',
      '',
    ].join('\n'));
    commitAll(dir, 'hava durumu');

    const result = gate(dir);
    expect(result.verdict).not.toBe('BLOCK');
    expect(codes(result)).not.toContain('CHARTER_VIOLATION');
    // Yeni dış kaynak yine de insana gösterilir.
    expect(codes(result)).toContain('NEW_EXTERNAL_HOST');
  });

  it('ödeme/broker entegrasyonu BLOKLANIR', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'src/pay.cjs', 'const stripe = require("stripe")(key);\nmodule.exports = stripe;\n');
    commitAll(dir, 'odeme');

    expect(gate(dir).verdict).toBe('BLOCK');
    expect(codes(gate(dir))).toContain('CHARTER_VIOLATION');
  });

  it('zamanlanmış iş insan incelemesi ister, bloklamaz', () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, 'src/tick.cjs', "cron.schedule('0 9 * * *', run);\n");
    commitAll(dir, 'zamanlanmis is');

    const result = gate(dir);
    expect(result.verdict).toBe('REVIEW');
    expect(codes(result)).toContain('CHARTER_REVIEW');
  });

  it('test fixture\'ındaki kalıp üretim ihlali sayılmaz', () => {
    const dir = makeRepo();
    seedRepo(dir);
    // Kalıplar string literali içinde — çalışan kod değil.
    write(dir, 'tests/ornek.test.mjs', [
      "it('yakalar', () => {",
      "  expect(collect([\"await api.post('/2/tweets')\"]).externalWrite).toBe(true);",
      '});',
      '',
    ].join('\n'));
    commitAll(dir, 'test fixture');

    const result = gate(dir);
    expect(codes(result)).not.toContain('CHARTER_VIOLATION');
  });
});

describe('karar önceliği', () => {
  it('BLOCK ve REVIEW birlikteyse sonuç BLOCK olur', () => {
    const dir = makeRepo();
    seedRepo(dir, { 'tests/a.test.mjs': 'it("x", () => { expect(1).toBe(1); });\n' });
    write(dir, '.env', 'GIZLI=1\n');                                    // BLOCK
    write(dir, 'tests/a.test.mjs', 'it.skip("x", () => { expect(1).toBe(1); });\n'); // REVIEW
    commitAll(dir, 'karisik');

    const result = gate(dir);
    expect(result.verdict).toBe('BLOCK');
    expect(result.exitCode).toBe(1);
    expect(codes(result)).toEqual(expect.arrayContaining(['SECRET_FILE_TOUCHED', 'TEST_SKIPPED']));
  });
});
