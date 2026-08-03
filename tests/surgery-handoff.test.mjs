import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import handoff from '../apps/desktop/electron/surgery/handoff.cjs';
import { CopilotSurgeon, redact } from '../apps/desktop/electron/surgery/copilot-surgeon.cjs';

const temps = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, stdio: 'pipe' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-handoff-'));
  temps.push(dir);
  try { git(['init', '-b', 'main'], dir); } catch { git(['init'], dir); git(['checkout', '-b', 'main'], dir); }
  git(['config', 'user.email', 'test@cakal.local'], dir);
  git(['config', 'user.name', 'Handoff Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf-8');
  git(['add', '-A'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
  }
});

describe('değişiklik talebi manifesti', () => {
  it('orijinal talebi DEĞİŞTİRMEDEN taşır', () => {
    const original = 'Kripto varliklarini su siteden surekli takip et';
    const cr = handoff.buildChangeRequest({
      originalUserRequest: original,
      cakalInterpretation: 'Yeni veri kaynagi entegrasyonu gerekiyor',
    });
    expect(cr.originalUserRequest).toBe(original);
    expect(cr.cakalInterpretation).not.toBe(cr.originalUserRequest);
    expect(cr.changeRequestId).toMatch(/^CR-\d{8}-[0-9a-f]{6}$/);
    expect(cr.requestedOutcome).toBe('IMPLEMENT_AND_INTEGRATE');
    expect(cr.activationRequested).toBe(false);
  });

  it('boş talebi reddeder', () => {
    expect(() => handoff.buildChangeRequest({ originalUserRequest: '   ' })).toThrow(/zorunlu/i);
    expect(() => handoff.buildChangeRequest({})).toThrow();
  });

  it('benzersiz kimlik üretir', () => {
    const ids = new Set();
    for (let i = 0; i < 20; i += 1) {
      ids.add(handoff.buildChangeRequest({ originalUserRequest: 'x' }).changeRequestId);
    }
    expect(ids.size).toBe(20);
  });

  it('dal adını güvenli hale getirir', () => {
    expect(handoff.branchNameFor('CR-20260101-abc123')).toBe('cakal/feature-CR-20260101-abc123');

    // Sabit önek dışındaki kısım temizlenmeli; git'in reddettiği kalıplar kalmamalı.
    const suffix = handoff.branchNameFor('kotu/../isim; rm -rf').replace(/^cakal\/feature-/, '');
    expect(suffix).not.toMatch(/[;/\s]/);
    expect(suffix).not.toMatch(/\.\./);   // git check-ref-format `..` reddeder
  });

  it('git geçersiz dal adını fiilen kabul etmez (sanitizasyon şart)', () => {
    const repo = makeRepo();
    const branch = handoff.branchNameFor('kotu/../isim; rm -rf');
    // Sanitize edilmiş ad git tarafından geçerli sayılmalı
    expect(() => git(['check-ref-format', `refs/heads/${branch}`], repo)).not.toThrow();
    // Ham ad ise geçersiz olmalı — sanitizasyonun neden gerektiğinin kanıtı
    expect(() => git(['check-ref-format', 'refs/heads/cakal/feature-kotu/../isim'], repo)).toThrow();
  });
});

describe('worktree yaşam döngüsü', () => {
  it('izole worktree açar, listeler ve kaldırır', () => {
    const repo = makeRepo();
    const cr = handoff.buildChangeRequest({ originalUserRequest: 'test gorevi' });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-wt-base-'));
    temps.push(base);

    const wt = handoff.createWorktree(repo, cr.changeRequestId, { baseDir: base });
    expect(fs.existsSync(wt.worktreePath)).toBe(true);
    expect(wt.branch).toBe(`cakal/feature-${cr.changeRequestId}`);

    // Worktree repo DIŞINDA olmalı: kendi diff'ine sızmasın
    const relToRepo = path.relative(repo, wt.worktreePath);
    expect(relToRepo.startsWith('..') || path.isAbsolute(relToRepo)).toBe(true);

    const listed = handoff.listSurgicalWorktrees(repo);
    expect(listed.some((w) => w.branch?.includes(cr.changeRequestId))).toBe(true);

    handoff.removeWorktree(repo, wt.worktreePath);
    expect(fs.existsSync(wt.worktreePath)).toBe(false);

    // Dal korunur (merge kararı sonrası silinir)
    const branches = git(['branch', '--list', wt.branch], repo);
    expect(branches).toContain(cr.changeRequestId);

    handoff.deleteBranch(repo, wt.branch);
    expect(git(['branch', '--list', wt.branch], repo).trim()).toBe('');
  });

  it('ana çalışma ağacını etkilemez', () => {
    const repo = makeRepo();
    const before = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
    const cr = handoff.buildChangeRequest({ originalUserRequest: 'izolasyon testi' });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-wt-base2-'));
    temps.push(base);

    const wt = handoff.createWorktree(repo, cr.changeRequestId, { baseDir: base });
    fs.writeFileSync(path.join(wt.worktreePath, 'cerrah-dosyasi.txt'), 'cerrah yazdi\n', 'utf-8');

    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(before);
    expect(fs.existsSync(path.join(repo, 'cerrah-dosyasi.txt'))).toBe(false);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');

    handoff.removeWorktree(repo, wt.worktreePath);
    handoff.deleteBranch(repo, wt.branch);
  });
});

describe('redaksiyon', () => {
  it('token benzeri desenleri maskeler', () => {
    expect(redact('token: ghp_' + 'a'.repeat(36))).toMatch(/REDACTED_GH_TOKEN/);
    expect(redact('Authorization: Bearer abc.def.ghi')).toMatch(/REDACTED/);
    expect(redact('github_pat_' + 'b'.repeat(30))).toMatch(/REDACTED_GH_PAT/);
  });

  it('normal metni bozmaz', () => {
    expect(redact('dosya guncellendi: src/a.ts')).toBe('dosya guncellendi: src/a.ts');
  });
});

// ── Sahte SDK istemcisi: güvenlik mantığı gerçek SDK olmadan uçtan uca sınanır ──
function fakeClient(scriptedRequests = []) {
  const calls = { started: false, stopped: false, sessionCreated: false, aborted: false, disconnected: false };
  let capturedHandler = null;

  return {
    calls,
    get handler() { return capturedHandler; },
    async start() { calls.started = true; },
    async stop() { calls.stopped = true; return []; },
    async forceStop() { calls.stopped = true; },
    async getAuthStatus() { return { isAuthenticated: true }; },
    async createSession(config) {
      calls.sessionCreated = true;
      capturedHandler = config.onPermissionRequest;
      return {
        on(handler) { handler({ type: 'session.start' }); return () => {}; },
        async sendAndWait() {
          // Cerrah ajanının deneyeceği işlemleri simüle et
          for (const req of scriptedRequests) capturedHandler(req);
          return { text: 'gorev tamamlandi' };
        },
        async abort() { calls.aborted = true; },
        async disconnect() { calls.disconnected = true; },
      };
    },
  };
}

describe('CopilotSurgeon — enjekte edilmiş istemciyle', () => {
  it('bağlanır ve kimlik durumunu döner', async () => {
    const client = fakeClient();
    const surgeon = new CopilotSurgeon({ clientFactory: () => client });
    const res = await surgeon.connect();
    expect(res.authenticated).toBe(true);
    expect(client.calls.started).toBe(true);
    await surgeon.disconnect();
    expect(client.calls.stopped).toBe(true);
  });

  it('connect() olmadan runSurgery reddeder', async () => {
    const surgeon = new CopilotSurgeon({ clientFactory: () => fakeClient() });
    await expect(surgeon.runSurgery({ worktreePath: '/tmp/x', prompt: 'y' })).rejects.toThrow(/connect/i);
  });

  it('cerrahın korunan yola yazmasını engeller ve raporlar', async () => {
    const wt = path.resolve('/tmp/cakal-surgery-wt');
    const client = fakeClient([
      { kind: 'write', fileName: path.join(wt, 'src', 'ozellik.ts'), diff: '' },
      { kind: 'write', fileName: path.join(wt, 'scripts', 'preflight.cjs'), diff: '' },
      { kind: 'shell', fullCommandText: 'git push origin main', possiblePaths: [] },
    ]);

    const surgeon = new CopilotSurgeon({ clientFactory: () => client });
    await surgeon.connect();
    const result = await surgeon.runSurgery({
      changeRequest: handoff.buildChangeRequest({ originalUserRequest: 'ozellik ekle' }),
      worktreePath: wt,
      prompt: 'ozellik ekle',
    });

    expect(result.status).toBe('COMPLETED_WITH_DENIALS');
    expect(result.rejectedCount).toBe(2);

    const reasons = result.decisions.map((d) => d.reason);
    expect(reasons).toContain('ok');
    expect(reasons).toContain('protected-write');
    expect(reasons).toContain('forbidden-command');

    await surgeon.disconnect();
  });

  it('tamamen temiz görevde COMPLETED döner', async () => {
    const wt = path.resolve('/tmp/cakal-surgery-wt2');
    const client = fakeClient([{ kind: 'write', fileName: path.join(wt, 'src', 'a.ts'), diff: '' }]);
    const surgeon = new CopilotSurgeon({ clientFactory: () => client });
    await surgeon.connect();

    const result = await surgeon.runSurgery({ worktreePath: wt, prompt: 'kucuk degisiklik' });
    expect(result.status).toBe('COMPLETED');
    expect(result.rejectedCount).toBe(0);
    await surgeon.disconnect();
  });

  it('aktivite olaylarını redaksiyondan geçirir', async () => {
    const events = [];
    const client = fakeClient();
    const surgeon = new CopilotSurgeon({ clientFactory: () => client, onEvent: (e) => events.push(e) });
    await surgeon.connect();
    await surgeon.disconnect();

    expect(events.some((e) => e.type === 'surgeon_connected')).toBe(true);
    expect(events.some((e) => e.type === 'surgeon_disconnected')).toBe(true);
    for (const e of events) expect(e.detail).not.toMatch(/ghp_[A-Za-z0-9]{16,}/);
  });
});
