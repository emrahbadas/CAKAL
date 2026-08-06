// ============================================================
// review-service.cjs — diff inceleme ve onaylı merge
// ============================================================
// Kullanıcının "bir şeylerin yanlış gittiğini anlaması zor" derdinin çözümü:
// cerrahın ürettiği değişiklik INMEDEN ÖNCE kapı sonucu + diff gösterilir.
//
// Merge kararı ÇAKAL'a veya cerraha ait DEĞİLDİR. Bu servis yalnız kullanıcı
// açık onay verdiğinde merge eder ve BLOCK durumunda onayı bile kabul etmez.

const path = require('path');
const { execFileSync, spawn } = require('child_process');

const PREFLIGHT_SCRIPT = path.resolve(__dirname, '../../../../scripts/preflight.cjs');
const MAX_DIFF_BYTES = 400 * 1024;

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function repoRoot() {
  return path.resolve(__dirname, '../../../..');
}

/** Cerrahi dalları listeler (cakal/feature-*). */
function listSurgicalBranches(cwd = repoRoot()) {
  const out = git(['branch', '--list', 'cakal/feature-*', '--format=%(refname:short)%09%(subject)'], cwd);
  return out.split('\n').filter(Boolean).map((line) => {
    const [branch, subject] = line.split('\t');
    return { branch: branch.trim(), subject: (subject || '').trim() };
  });
}

/**
 * Kapıyı çalıştırır. preflight AYRI PROCESS olarak, ANA çalışma alanındaki
 * kopyadan koşar: cerrahın kendi worktree'sinde kapıyı bozması sonucu
 * değiştiremez.
 * @returns {{verdict:string, exitCode:number, findings:object[], stats:object, ...}}
 */
function preflightErrorResult(message) {
  return {
    verdict: 'ERROR',
    exitCode: 3,
    findings: [{ severity: 'BLOCK', code: 'PREFLIGHT_ERROR', message }],
    stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    checks: {},
    files: [],
  };
}

/**
 * Preflight'ı ASENKRON çalıştırır.
 *
 * NEDEN SENKRON DEĞİL: burası Electron main process'i. `--verify` ile
 * `npm test` + `typecheck` çalışıyor ve bu 60+ saniye sürüyor. execFileSync
 * kullanıldığında main process tamamen bloke oluyordu: pencere donuyor,
 * render durmuyor, IPC cevap vermiyor. Kullanıcı bunu "Electron kasıyor"
 * diye bildirdi — haklıydı.
 *
 * spawn + stream toplama ile main process yanıt vermeye devam eder.
 */
function runPreflight({ base = 'main', head, verify = false, cwd = repoRoot(), timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!head) return Promise.reject(new Error('head (cerrahi dal) zorunlu.'));
  const args = [PREFLIGHT_SCRIPT, '--base', base, '--head', head, '--json'];
  if (verify) args.push('--verify');

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(process.execPath, args, { cwd, windowsHide: true });
    } catch (err) {
      finish(preflightErrorResult(`Preflight başlatılamadı: ${err.message}`));
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* yoksay */ }
      finish(preflightErrorResult('Preflight zaman aşımına uğradı.'));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish(preflightErrorResult(`Preflight hatası: ${err.message}`));
    });

    child.on('close', () => {
      clearTimeout(timer);
      // BLOCK/REVIEW durumunda çıkış kodu sıfır değildir ama çıktı yine JSON'dur.
      try {
        finish(JSON.parse(stdout));
      } catch {
        finish(preflightErrorResult(stderr.trim() || 'Preflight çıktısı okunamadı.'));
      }
    });
  });
}

/** İnsan incelemesi için diff. Büyük diff'ler kırpılır (UI'yı boğmasın). */
function getDiff({ base = 'main', head, cwd = repoRoot() } = {}) {
  if (!head) throw new Error('head zorunlu.');
  const raw = git(['diff', `${base}...${head}`], cwd);
  const bytes = Buffer.byteLength(raw, 'utf-8');
  if (bytes > MAX_DIFF_BYTES) {
    return {
      diff: raw.slice(0, MAX_DIFF_BYTES),
      truncated: true,
      bytes,
      note: `Diff ${(bytes / 1024).toFixed(0)} KB — ilk ${MAX_DIFF_BYTES / 1024} KB gösteriliyor.`,
    };
  }
  return { diff: raw, truncated: false, bytes, note: null };
}

/** Tek dosyanın diff'i (detay incelemesi için). */
function getFileDiff({ base = 'main', head, file, cwd = repoRoot() } = {}) {
  if (!head || !file) throw new Error('head ve file zorunlu.');
  return git(['diff', `${base}...${head}`, '--', file], cwd);
}

/**
 * Onaylı merge. İKİ kapı birden geçmeden merge YAPILMAZ:
 *   1. approved === true (kullanıcının açık onayı)
 *   2. preflight BLOCK vermemiş olmalı
 * REVIEW durumunda kullanıcı onayı yeterlidir; BLOCK'ta onay bile geçersizdir.
 */
async function approveAndMerge({ base = 'main', head, approved, cwd = repoRoot(), verify = true } = {}) {
  if (approved !== true) {
    return { merged: false, reason: 'NOT_APPROVED', message: 'Kullanıcı onayı olmadan merge yapılmaz.' };
  }
  if (!head) throw new Error('head zorunlu.');

  const gate = await runPreflight({ base, head, verify, cwd });
  if (gate.verdict === 'BLOCK' || gate.verdict === 'ERROR') {
    return {
      merged: false,
      reason: 'GATE_BLOCKED',
      message: 'Kapı bloke etti; kullanıcı onayı bu durumu geçersiz kılamaz.',
      gate,
    };
  }

  const dirty = git(['status', '--porcelain'], cwd).trim();
  if (dirty) {
    return { merged: false, reason: 'DIRTY_WORKTREE', message: 'Ana çalışma ağacı temiz değil; merge güvenli değil.' };
  }

  const previousHead = git(['rev-parse', 'HEAD'], cwd).trim();
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
  if (currentBranch !== base) {
    return { merged: false, reason: 'WRONG_BRANCH', message: `Merge için ${base} dalında olunmalı (şu an: ${currentBranch}).` };
  }

  try {
    git(['merge', '--no-ff', head, '-m', `merge: cerrahi paket ${head}`], cwd);
  } catch (err) {
    try { git(['merge', '--abort'], cwd); } catch { /* yoksay */ }
    return { merged: false, reason: 'MERGE_FAILED', message: err.message, rollbackPoint: previousHead };
  }

  return {
    merged: true,
    branch: head,
    previousHead,                                   // geri dönüş noktası
    newHead: git(['rev-parse', 'HEAD'], cwd).trim(),
    gate,
    rollbackCommand: `git reset --hard ${previousHead}`,
  };
}

module.exports = {
  listSurgicalBranches,
  runPreflight,
  getDiff,
  getFileDiff,
  approveAndMerge,
  repoRoot,
  MAX_DIFF_BYTES,
};
