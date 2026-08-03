import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSessionManager, STATUS } from '../apps/desktop/electron/surgery/session-manager.cjs';

// Gerçek SDK olmadan uçtan uca sınanır: surgeonFactory enjekte edilebilir.
// Böylece orkestrasyon mantığı (kilit, worktree yaşam döngüsü, hata yolu)
// ağ ve Copilot oturumu olmadan doğrulanır.

const repos = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, stdio: 'pipe' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-session-'));
  repos.push(dir);
  try { git(['init', '-b', 'main'], dir); } catch { git(['init'], dir); git(['checkout', '-b', 'main'], dir); }
  git(['config', 'user.email', 'test@cakal.local'], dir);
  git(['config', 'user.name', 'Session Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf-8');
  git(['add', '-A'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

/** Sahte cerrah: gerçek SDK'ya dokunmadan davranışı taklit eder. */
function fakeSurgeon(behaviour = {}) {
  return () => ({
    connect: async () => ({ authenticated: behaviour.authenticated !== false }),
    runSurgery: async () => {
      if (behaviour.throwOnRun) throw new Error('cerrah patladi');
      return {
        status: behaviour.status || 'COMPLETED',
        decisions: behaviour.decisions || [],
        reply: 'is bitti',
        eventCounts: {},
        rejectedCount: behaviour.rejectedCount ?? 0,
      };
    },
    abort: async () => {},
    disconnect: async () => {},
  });
}

afterAll(() => {
  for (const dir of repos) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
  }
});

describe('talep kaydı', () => {
  let mgr;
  beforeEach(() => { mgr = createSessionManager({ repoRoot: makeRepo(), surgeonFactory: fakeSurgeon() }); });

  it('orijinal talebi değiştirmeden saklar', () => {
    const original = 'kripto verisi çeken bir özellik ekle';
    const cr = mgr.registerRequest({ originalUserRequest: original, cakalInterpretation: 'yeni tool gerekiyor' });
    expect(cr.originalUserRequest).toBe(original);
    expect(cr.cakalInterpretation).toBe('yeni tool gerekiyor');
    expect(cr.changeRequestId).toMatch(/^CR-\d{8}-[0-9a-f]{6}$/);
  });

  it('boş talebi reddeder', () => {
    expect(() => mgr.registerRequest({ originalUserRequest: '   ' })).toThrow();
  });

  it('bekleyen listede görünür', () => {
    mgr.registerRequest({ originalUserRequest: 'a' });
    mgr.registerRequest({ originalUserRequest: 'b' });
    expect(mgr.listRequests()).toHaveLength(2);
    expect(mgr.getStatus().pendingCount).toBe(2);
  });

  it('kayıt tek başına cerrahiyi BAŞLATMAZ', () => {
    mgr.registerRequest({ originalUserRequest: 'a' });
    expect(mgr.getStatus().status).toBe(STATUS.IDLE);
    expect(mgr.getStatus().active).toBeNull();
  });
});

describe('cerrahi başlatma', () => {
  it('worktree açar, çalıştırır ve incelemeye bırakır', async () => {
    const repo = makeRepo();
    const mgr = createSessionManager({ repoRoot: repo, surgeonFactory: fakeSurgeon({ rejectedCount: 2 }) });
    const cr = mgr.registerRequest({ originalUserRequest: 'ozellik ekle' });

    const result = await mgr.startSurgery(cr.changeRequestId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(STATUS.AWAITING_REVIEW);
    expect(result.branch).toBe(`cakal/feature-${cr.changeRequestId}`);
    expect(result.rejectedCount).toBe(2);
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    // Talep kuyruktan düşer, oturum serbest kalır
    expect(mgr.listRequests()).toHaveLength(0);
    expect(mgr.getStatus().active).toBeNull();
  });

  it('bilinmeyen talep id reddedilir', async () => {
    const mgr = createSessionManager({ repoRoot: makeRepo(), surgeonFactory: fakeSurgeon() });
    const result = await mgr.startSurgery('CR-yok');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bulunamadı/i);
  });

  it('Copilot oturumu kapalıysa başlatmaz', async () => {
    const repo = makeRepo();
    const mgr = createSessionManager({ repoRoot: repo, surgeonFactory: fakeSurgeon({ authenticated: false }) });
    const cr = mgr.registerRequest({ originalUserRequest: 'x' });

    const result = await mgr.startSurgery(cr.changeRequestId);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(STATUS.FAILED);
    expect(result.error).toMatch(/oturumu açık değil/i);
  });

  it('cerrah patlarsa worktree SİLİNMEZ (inceleme için korunur)', async () => {
    const repo = makeRepo();
    const mgr = createSessionManager({ repoRoot: repo, surgeonFactory: fakeSurgeon({ throwOnRun: true }) });
    const cr = mgr.registerRequest({ originalUserRequest: 'x' });

    const result = await mgr.startSurgery(cr.changeRequestId);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(STATUS.FAILED);
    expect(fs.existsSync(result.worktreePath)).toBe(true);
  });
});

describe('eşzamanlılık kilidi', () => {
  it('aynı anda ikinci cerrahi başlatılamaz', async () => {
    const repo = makeRepo();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const mgr = createSessionManager({
      repoRoot: repo,
      surgeonFactory: () => ({
        connect: async () => ({ authenticated: true }),
        runSurgery: async () => { await gate; return { status: 'COMPLETED', decisions: [], reply: '', eventCounts: {}, rejectedCount: 0 }; },
        abort: async () => {},
        disconnect: async () => {},
      }),
    });

    const a = mgr.registerRequest({ originalUserRequest: 'birinci' });
    const b = mgr.registerRequest({ originalUserRequest: 'ikinci' });

    const first = mgr.startSurgery(a.changeRequestId);
    await new Promise((r) => setTimeout(r, 30));           // birincinin kilidi alması için

    const second = await mgr.startSurgery(b.changeRequestId);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/zaten çalışan/i);

    release();
    await first;
    expect(mgr.getStatus().active).toBeNull();
  });
});

describe('iptal', () => {
  it('çalışan cerrahi yoksa iptal reddedilir', async () => {
    const mgr = createSessionManager({ repoRoot: makeRepo(), surgeonFactory: fakeSurgeon() });
    const result = await mgr.abortSurgery();
    expect(result.ok).toBe(false);
  });
});

describe('görev metni', () => {
  it('orijinal talebi ve bağlayıcı kısıtları içerir', () => {
    const mgr = createSessionManager({ repoRoot: makeRepo(), surgeonFactory: fakeSurgeon() });
    const cr = mgr.registerRequest({ originalUserRequest: 'BENZERSIZ_TALEP_METNI' });
    const prompt = mgr.buildSurgeryPrompt(cr);

    expect(prompt).toContain('BENZERSIZ_TALEP_METNI');
    expect(prompt).toMatch(/git push.*YASAK/i);
    expect(prompt).toMatch(/secret/i);
    expect(prompt).toMatch(/testleri silme/i);
    expect(prompt).toMatch(/worktree içinde çalış/i);
  });
});

describe('olay yayını', () => {
  it('dinleyiciye olay iletir ve abonelik iptal edilebilir', async () => {
    const mgr = createSessionManager({ repoRoot: makeRepo(), surgeonFactory: fakeSurgeon() });
    const seen = [];
    const off = mgr.onEvent((e) => seen.push(e.type));

    mgr.registerRequest({ originalUserRequest: 'x' });
    expect(seen).toContain('request_registered');

    off();
    mgr.registerRequest({ originalUserRequest: 'y' });
    expect(seen.filter((t) => t === 'request_registered')).toHaveLength(1);
  });
});
