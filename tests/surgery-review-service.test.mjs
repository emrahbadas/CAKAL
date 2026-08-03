import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import review from '../apps/desktop/electron/surgery/review-service.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const temps = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, stdio: 'pipe' });
}

/**
 * Gerçek preflight'ı çalıştırabilen fixture repo: scripts/preflight.cjs ve
 * paylaşılan protected-paths modülü kopyalanır, böylece kapı gerçekten koşar.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-review-'));
  temps.push(dir);
  try { git(['init', '-b', 'main'], dir); } catch { git(['init'], dir); git(['checkout', '-b', 'main'], dir); }
  git(['config', 'user.email', 'test@cakal.local'], dir);
  git(['config', 'user.name', 'Review Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps/desktop/electron/surgery'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts/preflight.cjs'), path.join(dir, 'scripts/preflight.cjs'));
  fs.copyFileSync(
    path.join(REPO, 'apps/desktop/electron/surgery/protected-paths.cjs'),
    path.join(dir, 'apps/desktop/electron/surgery/protected-paths.cjs'),
  );
  fs.copyFileSync(
    path.join(REPO, 'apps/desktop/electron/command-guard.cjs'),
    path.join(dir, 'apps/desktop/electron/command-guard.cjs'),
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf-8');
  git(['add', '-A'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

function surgicalBranch(dir, name, mutate) {
  git(['checkout', '-b', `cakal/feature-${name}`], dir);
  mutate(dir);
  git(['add', '-A'], dir);
  git(['commit', '-m', `cerrahi: ${name}`], dir);
  git(['checkout', 'main'], dir);
  return `cakal/feature-${name}`;
}

afterAll(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
  }
});

describe('cerrahi dal listesi', () => {
  it('yalnız cakal/feature-* dallarını döner', () => {
    const dir = makeRepo();
    surgicalBranch(dir, 'CR-001', (d) => fs.writeFileSync(path.join(d, 'a.ts'), 'export const a = 1;\n'));
    git(['branch', 'alakasiz-dal'], dir);

    const branches = review.listSurgicalBranches(dir);
    expect(branches.map((b) => b.branch)).toEqual(['cakal/feature-CR-001']);
  });
});

describe('kapı çalıştırma', () => {
  it('temiz pakette PASS döner', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-temiz', (d) =>
      fs.writeFileSync(path.join(d, 'src.ts'), 'export const x = 1;\n'));

    const gate = review.runPreflight({ head: branch, cwd: dir });
    expect(gate.verdict).toBe('PASS');
    expect(gate.exitCode).toBe(0);
    expect(gate.stats.filesChanged).toBe(1);
  });

  it('korunan dosyaya dokunan pakette BLOCK döner', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-kotu', (d) =>
      fs.writeFileSync(path.join(d, 'apps/desktop/electron/command-guard.cjs'), '// devre disi\n'));

    const gate = review.runPreflight({ head: branch, cwd: dir });
    expect(gate.verdict).toBe('BLOCK');
    expect(gate.findings.map((f) => f.code)).toContain('PROTECTED_PATH');
  });

  it('head verilmezse hata verir', () => {
    expect(() => review.runPreflight({ cwd: makeRepo() })).toThrow(/head/i);
  });
});

describe('diff getirme', () => {
  it('değişiklikleri döner', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-diff', (d) =>
      fs.writeFileSync(path.join(d, 'yeni.ts'), 'export const y = 2;\n'));

    const res = review.getDiff({ head: branch, cwd: dir });
    expect(res.diff).toContain('yeni.ts');
    expect(res.diff).toContain('+export const y = 2;');
    expect(res.truncated).toBe(false);
  });

  it('tek dosya diff\'i alabilir', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-coklu', (d) => {
      fs.writeFileSync(path.join(d, 'bir.ts'), 'export const b = 1;\n');
      fs.writeFileSync(path.join(d, 'iki.ts'), 'export const i = 2;\n');
    });

    const only = review.getFileDiff({ head: branch, file: 'bir.ts', cwd: dir });
    expect(only).toContain('bir.ts');
    expect(only).not.toContain('iki.ts');
  });
});

describe('onaylı merge — güvenlik güvenceleri', () => {
  it('onay olmadan merge YAPMAZ', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-onaysiz', (d) =>
      fs.writeFileSync(path.join(d, 'x.ts'), 'export const x = 1;\n'));

    const res = review.approveAndMerge({ head: branch, approved: false, cwd: dir, verify: false });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe('NOT_APPROVED');
  });

  it('approved alanı eksikse merge YAPMAZ', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-eksik', (d) =>
      fs.writeFileSync(path.join(d, 'x.ts'), 'export const x = 1;\n'));

    expect(review.approveAndMerge({ head: branch, cwd: dir, verify: false }).merged).toBe(false);
  });

  it('KAPI BLOKE ETTİYSE kullanıcı onayı bile merge açmaz', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-bloke', (d) =>
      fs.writeFileSync(path.join(d, 'apps/desktop/electron/command-guard.cjs'), '// devre disi\n'));

    const res = review.approveAndMerge({ head: branch, approved: true, cwd: dir, verify: false });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe('GATE_BLOCKED');
    expect(res.gate.verdict).toBe('BLOCK');

    // Korunan dosya main'de bozulmamış olmalı
    const onMain = git(['show', 'main:apps/desktop/electron/command-guard.cjs'], dir);
    expect(onMain).not.toContain('devre disi');
  });

  it('kirli çalışma ağacında merge YAPMAZ', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-kirli', (d) =>
      fs.writeFileSync(path.join(d, 'x.ts'), 'export const x = 1;\n'));
    fs.writeFileSync(path.join(dir, 'kirli.txt'), 'commit edilmemis\n', 'utf-8');

    const res = review.approveAndMerge({ head: branch, approved: true, cwd: dir, verify: false });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe('DIRTY_WORKTREE');
  });

  it('yanlış dalda merge YAPMAZ', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-yanlis', (d) =>
      fs.writeFileSync(path.join(d, 'x.ts'), 'export const x = 1;\n'));
    git(['checkout', '-b', 'baska-dal'], dir);

    const res = review.approveAndMerge({ head: branch, approved: true, cwd: dir, verify: false });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe('WRONG_BRANCH');
  });

  it('temiz paketi onayla merge eder ve geri dönüş noktası verir', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-iyi', (d) =>
      fs.writeFileSync(path.join(d, 'ozellik.ts'), 'export const ozellik = true;\n'));
    const beforeHead = git(['rev-parse', 'HEAD'], dir).trim();

    const res = review.approveAndMerge({ head: branch, approved: true, cwd: dir, verify: false });
    expect(res.merged).toBe(true);
    expect(res.previousHead).toBe(beforeHead);
    expect(res.rollbackCommand).toContain(beforeHead);
    expect(fs.existsSync(path.join(dir, 'ozellik.ts'))).toBe(true);
  });

  it('geri dönüş komutu gerçekten çalışır', () => {
    const dir = makeRepo();
    const branch = surgicalBranch(dir, 'CR-rollback', (d) =>
      fs.writeFileSync(path.join(d, 'gecici.ts'), 'export const g = 1;\n'));

    const res = review.approveAndMerge({ head: branch, approved: true, cwd: dir, verify: false });
    expect(res.merged).toBe(true);
    expect(fs.existsSync(path.join(dir, 'gecici.ts'))).toBe(true);

    git(['reset', '--hard', res.previousHead], dir);
    expect(fs.existsSync(path.join(dir, 'gecici.ts'))).toBe(false);
    expect(git(['rev-parse', 'HEAD'], dir).trim()).toBe(res.previousHead);
  });
});
