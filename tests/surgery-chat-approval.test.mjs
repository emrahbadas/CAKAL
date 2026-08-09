import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPermissionHandler } from '../apps/desktop/electron/surgery/permission-hook.cjs';
import { createSessionManager, STATUS } from '../apps/desktop/electron/surgery/session-manager.cjs';

// Etkileşimli onay akışı (VS Code Copilot tarzı "Onayla/Reddet").
//
// Bu dosyanın koruduğu ASIL kural: onay kartı bir GENİŞLEME değil, bir
// DARALTMA katmanıdır. Daha önce sessizce onaylanan işlemler artık kullanıcıya
// sorulur; daha önce reddedilen işlemler sorulmadan reddedilmeye DEVAM eder.
// Sert redlerin onaya sunulması, güvenlik sınırını pazarlığa açardı.

const WT = path.resolve('/tmp/cakal-chat-wt');
const abs = (rel) => path.join(WT, rel.replace(/\//g, path.sep));

const write = (fileName, extra = {}) => ({ kind: 'write', fileName, diff: '+yeni satır', ...extra });
const read = (p) => ({ kind: 'read', path: p });
const shell = (fullCommandText, possiblePaths = []) => ({ kind: 'shell', fullCommandText, possiblePaths });

/** askUser'ı kaydeden ve sabit cevap dönen yardımcı. */
function recorder(answer) {
  const calls = [];
  const askUser = async (ask) => { calls.push(ask); return answer; };
  return { calls, askUser };
}

describe('etkileşimli izin kapısı — onay katmanı', () => {
  it('yazma isteği kullanıcıya sorulur ve onaylanırsa geçer', async () => {
    const { calls, askUser } = recorder({ approved: true });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    const verdict = await h(write(abs('src/yeni.ts')));

    expect(verdict).toEqual({ kind: 'approve-once' });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('write');
    expect(calls[0].file).toBe('src/yeni.ts');   // UI'a repo-göreli yol taşınır
    expect(calls[0].diff).toBe('+yeni satır');
  });

  it('cerrahın kendi gerekçesi (intention) onay kartına taşınır', async () => {
    const { calls, askUser } = recorder({ approved: true });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    await h(write(abs('src/a.ts'), { intention: 'Testte eksik olan sınır kontrolünü ekliyorum.' }));

    expect(calls[0].intention).toBe('Testte eksik olan sınır kontrolünü ekliyorum.');
  });

  it('reddedilirse cerraha kullanıcının gerekçesi döner', async () => {
    const { askUser } = recorder({ approved: false, feedback: 'Bu dosyaya dokunma, önce testi yaz.' });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    const verdict = await h(write(abs('src/yeni.ts')));

    expect(verdict.kind).toBe('reject');
    expect(verdict.feedback).toBe('Bu dosyaya dokunma, önce testi yaz.');
  });

  it('gerekçesiz redde bile cerraha yön veren bir metin gider', async () => {
    const { askUser } = recorder({ approved: false });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });
    const verdict = await h(shell('rm -rf build'));
    expect(verdict.kind).toBe('reject');
    expect(verdict.feedback).toMatch(/reddetti/i);
  });

  it('komut ve ağ istekleri de onaya sunulur', async () => {
    const { calls, askUser } = recorder({ approved: true });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    await h(shell('npm run build', [abs('src/a.ts')]));
    await h({ kind: 'url', url: 'https://example.com/x' });

    expect(calls.map((c) => c.kind)).toEqual(['shell', 'url']);
    expect(calls[0].command).toBe('npm run build');
    expect(calls[1].url).toBe('https://example.com/x');
  });

  it('bilinmeyen tür artık sessizce onaylanmaz, sorulur', async () => {
    const { calls, askUser } = recorder({ approved: false });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    const verdict = await h({ kind: 'gelecekte-eklenen-tur', toolName: 'x' });

    expect(calls).toHaveLength(1);
    expect(verdict.kind).toBe('reject');
  });
});

describe('etkileşimli izin kapısı — sert red katmanı SORULMAZ', () => {
  // En kritik testler: bu istekler kullanıcının önüne KART OLARAK ÇIKMAMALI.
  // Çıkarsa, yeterince yorulan kullanıcı eninde sonunda onaylar.
  const cases = [
    ['secret yazma', write(abs('.env'))],
    ['korunan çekirdek dosyaya yazma', write(abs('apps/desktop/electron/command-guard.cjs'))],
    ['kendi kancasına yazma', write(abs('apps/desktop/electron/surgery/permission-hook.cjs'))],
    ['çalışma alanı dışına yazma', write(path.resolve('/tmp/baska/x.ts'))],
    ['yasak komut', shell('git push origin main')],
    ['korunan dosyaya dokunan komut', shell('rm x', [abs('scripts/preflight.cjs')])],
    ['secret okuma', read(abs('.env'))],
    ['sandbox bypass', write(abs('src/a.ts'), { requestSandboxBypass: true })],
    ['eklenti yönetimi', { kind: 'extension-management' }],
  ];

  for (const [name, request] of cases) {
    it(`${name} — kullanıcıya sorulmadan reddedilir`, async () => {
      const { calls, askUser } = recorder({ approved: true }); // onaylamaya HAZIR
      const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

      const verdict = await h(request);

      expect(verdict.kind).toBe('reject');
      expect(calls).toHaveLength(0); // hiç sorulmadı
    });
  }

  it('normal okuma da sorulmaz — onaylanır (her okuma için kart arayüzü boğar)', async () => {
    const { calls, askUser } = recorder({ approved: false });
    const h = buildPermissionHandler({ worktreeRoot: WT, askUser });

    const verdict = await h(read(abs('apps/desktop/electron/ai-service.cjs')));

    expect(verdict.kind).toBe('approve-once');
    expect(calls).toHaveLength(0);
  });
});

describe('etkileşimli izin kapısı — cevapsızlık onay değildir', () => {
  it('zaman aşımı reddeder', async () => {
    const h = buildPermissionHandler({
      worktreeRoot: WT,
      askTimeoutMs: 20,
      askUser: () => new Promise(() => {}), // asla cevaplanmaz
    });

    const verdict = await h(write(abs('src/a.ts')));

    expect(verdict.kind).toBe('reject');
    expect(verdict.feedback).toMatch(/yanıt vermedi/i);
  });

  it('onay kanalı patlarsa reddeder', async () => {
    const h = buildPermissionHandler({
      worktreeRoot: WT,
      askUser: async () => { throw new Error('IPC koptu'); },
    });

    const verdict = await h(write(abs('src/a.ts')));

    expect(verdict.kind).toBe('reject');
    expect(verdict.feedback).toMatch(/onay kanalı/i);
  });

  it('kullanıcı kararı denetim kaydına yazılır', async () => {
    const seen = [];
    const h = buildPermissionHandler({
      worktreeRoot: WT,
      onDecision: (d) => seen.push(d),
      askUser: async () => ({ approved: true }),
    });

    await h(write(abs('src/a.ts')));

    expect(seen[0].decision).toBe('approve-once');
    expect(seen[0].reason).toMatch(/^user-approved/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Sohbet orkestrasyonu
// ══════════════════════════════════════════════════════════════════════

const repos = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, stdio: 'pipe' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-chat-'));
  repos.push(dir);
  try { git(['init', '-b', 'main'], dir); } catch { git(['init'], dir); git(['checkout', '-b', 'main'], dir); }
  git(['config', 'user.email', 'test@cakal.local'], dir);
  git(['config', 'user.name', 'Chat Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf-8');
  git(['add', '-A'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

afterAll(() => {
  for (const dir of repos) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
  }
});

/** Etkileşimli oturumu taklit eden sahte cerrah; askUser'ı testin eline verir. */
function fakeInteractiveSurgeon(state, behaviour = {}) {
  return () => ({
    connect: async () => ({ authenticated: behaviour.authenticated !== false }),
    startInteractive: async (params) => {
      state.askUser = params.askUser;
      state.worktreePath = params.worktreePath;
      state.model = params.model;
      return { ok: true };
    },
    sendMessage: async (text) => {
      state.messages = state.messages || [];
      state.messages.push(text);
      if (behaviour.throwOnSend) throw new Error('tur patladi');
      return { reply: behaviour.reply || 'tamam', decisions: [], rejectedCount: 0 };
    },
    runSurgery: async () => ({ status: 'COMPLETED', decisions: [], reply: '', eventCounts: {}, rejectedCount: 0 }),
    abort: async () => {},
    disconnect: async () => { state.disconnected = true; },
  });
}

function fakeReview(merged = true) {
  const calls = [];
  return {
    calls,
    approveAndMerge: async (opts) => {
      calls.push(opts);
      return merged
        ? { merged: true, branch: opts.head, rollbackCommand: 'git reset --hard abc123' }
        : { merged: false, reason: 'GATE_BLOCKED', message: 'Kapı bloke etti.' };
    },
  };
}

describe('sohbet oturumu — yaşam döngüsü', () => {
  it('oturum açar, mesaj gönderir ve onay köprüsünü kurar', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
    });

    const started = await mgr.startChat({ title: 'test oturumu', model: 'claude-sonnet-5' });
    expect(started.ok).toBe(true);
    expect(started.branch).toMatch(/^cakal\/feature-CR-/);
    expect(fs.existsSync(started.worktreePath)).toBe(true);
    expect(mgr.getStatus().status).toBe(STATUS.CHATTING);
    expect(typeof state.askUser).toBe('function');

    const turn = await mgr.sendChat('README dosyasına bir satır ekle');
    expect(turn.ok).toBe(true);
    expect(turn.reply).toBe('tamam');
    // Bağlayıcı çerçeve YALNIZ ilk turda gider.
    expect(state.messages[0]).toMatch(/Bağlayıcı kısıtlar/);
    await mgr.sendChat('bir satır daha');
    expect(state.messages[1]).not.toMatch(/Bağlayıcı kısıtlar/);
  });

  it('ikinci oturum açılamaz', async () => {
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: fakeReview(),
    });
    await mgr.startChat({ title: 'ilk' });
    const second = await mgr.startChat({ title: 'ikinci' });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/zaten çalışan/i);
  });

  it('Copilot oturumu kapalıysa sohbet açılmaz', async () => {
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}, { authenticated: false }),
      reviewService: fakeReview(),
    });
    const res = await mgr.startChat({ title: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/oturumu açık değil/i);
    expect(mgr.getStatus().chat).toBeNull();
  });

  it('tur sürerken ikinci mesaj kabul edilmez', async () => {
    const state = {};
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      reviewService: fakeReview(),
      surgeonFactory: () => ({
        connect: async () => ({ authenticated: true }),
        startInteractive: async (p) => { state.askUser = p.askUser; },
        sendMessage: async () => { await gate; return { reply: 'ok', rejectedCount: 0 }; },
        abort: async () => {},
        disconnect: async () => {},
      }),
    });

    await mgr.startChat({ title: 'x' });
    const first = mgr.sendChat('bir');
    await new Promise((r) => setTimeout(r, 20));

    const second = await mgr.sendChat('iki');
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/hâlâ çalışıyor/i);

    release();
    await first;
  });
});

describe('sohbet oturumu — onay köprüsü', () => {
  it('izin isteği olay olarak düşer ve onay cerrahı serbest bırakır', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
    });
    const events = [];
    mgr.onEvent((e) => events.push(e));

    await mgr.startChat({ title: 'x' });

    // Cerrah izin istiyor — cevap gelene kadar bu söz çözülmez.
    const asking = state.askUser({ kind: 'write', file: 'src/a.ts', diff: '+x', target: 'src/a.ts' });

    const requestEvent = events.find((e) => e.type === 'permission_request');
    expect(requestEvent).toBeTruthy();
    expect(requestEvent.payload.file).toBe('src/a.ts');
    expect(mgr.getStatus().chat.pendingPermissions).toHaveLength(1);

    const res = mgr.respondPermission(requestEvent.permissionId, true);
    expect(res.ok).toBe(true);
    await expect(asking).resolves.toMatchObject({ approved: true });
    expect(mgr.getStatus().chat.pendingPermissions).toHaveLength(0);
  });

  it('red kararı gerekçesiyle birlikte cerraha döner', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
    });
    const events = [];
    mgr.onEvent((e) => events.push(e));
    await mgr.startChat({ title: 'x' });

    const asking = state.askUser({ kind: 'shell', command: 'rm -rf .', target: 'rm -rf .' });
    const { permissionId } = events.find((e) => e.type === 'permission_request');

    mgr.respondPermission(permissionId, false, 'Olmaz, bunu yapma.');
    await expect(asking).resolves.toEqual({ approved: false, feedback: 'Olmaz, bunu yapma.' });
  });

  it('token benzeri içerik UI’a gitmeden maskelenir', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
    });
    const events = [];
    mgr.onEvent((e) => events.push(e));
    await mgr.startChat({ title: 'x' });

    state.askUser({ kind: 'write', file: 'a.ts', diff: '+const t = "ghp_abcdefghijklmnopqrstuvwxyz0123";' });
    const { payload } = events.find((e) => e.type === 'permission_request');

    expect(payload.diff).not.toMatch(/ghp_abcdefghij/);
    expect(payload.diff).toMatch(/REDACTED/);
  });

  it('bilinmeyen izin kimliği reddedilir', async () => {
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: fakeReview(),
    });
    await mgr.startChat({ title: 'x' });
    expect(mgr.respondPermission('yok-boyle-bir-id', true).ok).toBe(false);
  });

  it('zaman aşımı isteği reddeder', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
      permissionTimeoutMs: 30,
    });
    await mgr.startChat({ title: 'x' });

    const asking = state.askUser({ kind: 'write', file: 'a.ts', diff: '+x' });
    await expect(asking).resolves.toMatchObject({ approved: false });
  });

  it('oturum kapanınca bekleyen istekler düşer (asılı kalmaz)', async () => {
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: fakeReview(),
    });
    await mgr.startChat({ title: 'x' });

    const asking = state.askUser({ kind: 'write', file: 'a.ts', diff: '+x' });
    await mgr.endChat({ apply: false });

    await expect(asking).resolves.toMatchObject({ approved: false });
  });
});

describe('sohbet oturumu — uygulama (canlı koda iniş)', () => {
  it('değişiklik yoksa merge denenmez', async () => {
    const review = fakeReview();
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: review,
    });
    await mgr.startChat({ title: 'x' });

    const res = await mgr.applyChat();

    expect(res.applied).toBeFalsy();
    expect(res.reason).toBe('NO_CHANGES');
    expect(review.calls).toHaveLength(0);
  });

  it('commit’lenmemiş iş kaybolmaz: uygulama önce commit eder', async () => {
    const review = fakeReview();
    const state = {};
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon(state),
      reviewService: review,
    });
    const started = await mgr.startChat({ title: 'x' });

    // Cerrah dosyayı yazdı ama commit etmedi (sohbet ortasında kapanma hâli).
    fs.writeFileSync(path.join(started.worktreePath, 'yeni.txt'), 'merhaba\n', 'utf-8');

    const res = await mgr.applyChat();

    expect(res.applied).toBe(true);
    expect(res.commits).toBe(1);
    expect(review.calls[0]).toMatchObject({ head: started.branch, approved: true });
  });

  it('kapı bloke ederse iş inmez ve dal incelemede kalır', async () => {
    const review = fakeReview(false);
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: review,
    });
    const started = await mgr.startChat({ title: 'x' });
    fs.writeFileSync(path.join(started.worktreePath, 'yeni.txt'), 'x\n', 'utf-8');

    const ended = await mgr.endChat({ apply: true });

    expect(ended.applied).toBe(false);
    expect(ended.status).toBe(STATUS.AWAITING_REVIEW);
    expect(fs.existsSync(started.worktreePath)).toBe(true); // inceleme için korunur
  });

  it('apply:false ile kapanan oturum merge denemez', async () => {
    const review = fakeReview();
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: review,
    });
    const started = await mgr.startChat({ title: 'x' });
    fs.writeFileSync(path.join(started.worktreePath, 'yeni.txt'), 'x\n', 'utf-8');

    const ended = await mgr.endChat({ apply: false });

    expect(review.calls).toHaveLength(0);
    expect(ended.applied).toBe(false);
    expect(mgr.getStatus().chat).toBeNull();
  });

  it('başarılı uygulamadan sonra oturum serbest kalır', async () => {
    const mgr = createSessionManager({
      repoRoot: makeRepo(),
      surgeonFactory: fakeInteractiveSurgeon({}),
      reviewService: fakeReview(),
    });
    const started = await mgr.startChat({ title: 'x' });
    fs.writeFileSync(path.join(started.worktreePath, 'yeni.txt'), 'x\n', 'utf-8');

    const ended = await mgr.endChat({ apply: true });

    expect(ended.applied).toBe(true);
    expect(mgr.getStatus().chat).toBeNull();
    expect(mgr.getStatus().status).toBe(STATUS.IDLE);

    // Oturum kapandıktan sonra mesaj gönderilemez.
    const after = await mgr.sendChat('hâlâ orada mısın');
    expect(after.ok).toBe(false);
  });
});
