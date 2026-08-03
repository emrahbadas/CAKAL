// ============================================================
// handoff.cjs — ÇAKAL → cerrah devir sözleşmesi ve worktree yaşam döngüsü
// ============================================================
// Kullanıcı talebi Kademe 2 (kaynak kod) olarak sınıflandırıldığında:
//   1. buildChangeRequest — orijinal talebi DEĞİŞTİRMEDEN manifeste sarar
//   2. createWorktree     — cakal/feature-<id> dalında ayrı çalışma alanı
//   3. (cerrah çalışır)
//   4. removeWorktree     — çalışma alanını temizler (dal kalır)
//
// Cerrah canlı uygulama dizininde ASLA çalışmaz; her görev izole worktree'de.

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Kullanıcının değiştirilmemiş talebini makine-okunur bir vakaya sarar.
 * originalUserRequest ASLA yeniden ifade edilmez — ÇAKAL'ın yorumu ayrı alanda.
 */
function buildChangeRequest(input = {}) {
  const originalUserRequest = String(input.originalUserRequest || '').trim();
  if (!originalUserRequest) {
    throw new Error('originalUserRequest zorunlu ve boş olamaz.');
  }
  const changeRequestId = `CR-${todayStamp()}-${crypto.randomBytes(3).toString('hex')}`;
  return {
    changeRequestId,
    originalUserRequest,                                   // birebir, değiştirilmez
    cakalInterpretation: input.cakalInterpretation ? String(input.cakalInterpretation) : null, // yardımcı bağlam
    sourceMessageId: input.sourceMessageId ? String(input.sourceMessageId) : null,
    currentVersion: input.currentVersion ? String(input.currentVersion) : null,
    requestedOutcome: input.requestedOutcome || 'IMPLEMENT_AND_INTEGRATE',
    activationRequested: input.activationRequested === true,
    createdAt: new Date().toISOString(),
  };
}

function branchNameFor(changeRequestId) {
  // Yalnız güvenli karakterler; ayrıca `..` kaldırılır — git, `..` içeren ref
  // adını reddeder (check-ref-format) ve worktree oluşturma patlardı.
  const safe = String(changeRequestId)
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!safe) throw new Error('changeRequestId geçerli bir dal adı üretmiyor.');
  return `cakal/feature-${safe}`;
}

/**
 * Ayrı bir git worktree + dal oluşturur. Çalışma alanı repo DIŞINDA (temp)
 * konumlanır: böylece worktree, repo taramalarına veya kendi diff'ine sızmaz.
 * @returns {{ worktreePath:string, branch:string, changeRequestId:string }}
 */
function createWorktree(repoRoot, changeRequestId, options = {}) {
  const branch = branchNameFor(changeRequestId);
  const baseDir = options.baseDir || path.join(os.tmpdir(), 'cakal-surgery');
  const worktreePath = path.join(baseDir, changeRequestId);

  const fs = require('fs');
  fs.mkdirSync(baseDir, { recursive: true });

  const startPoint = options.startPoint || 'HEAD';
  git(['worktree', 'add', '-b', branch, worktreePath, startPoint], repoRoot);

  return { worktreePath, branch, changeRequestId };
}

/**
 * Worktree'yi kaldırır. Dal (ve commit'leri) korunur — merge kararı sonrası
 * silinebilir. force: kirli çalışma alanını da kaldırır.
 */
function removeWorktree(repoRoot, worktreePath, options = {}) {
  const args = ['worktree', 'remove', worktreePath];
  if (options.force !== false) args.push('--force');
  git(args, repoRoot);
  return { removed: true };
}

/** Cerrahi dalı siler (worktree kaldırıldıktan sonra). Merge edilmediyse -D gerekir. */
function deleteBranch(repoRoot, branch, options = {}) {
  git(['branch', options.force === false ? '-d' : '-D', branch], repoRoot);
  return { deleted: true };
}

function listSurgicalWorktrees(repoRoot) {
  const out = git(['worktree', 'list', '--porcelain'], repoRoot);
  const items = [];
  let current = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length).trim() };
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).trim();
    else if (line.trim() === '') { if (current.path) items.push(current); current = {}; }
  }
  if (current.path) items.push(current);
  return items.filter((w) => /\/cakal\/feature-/.test(w.branch || ''));
}

module.exports = {
  buildChangeRequest,
  branchNameFor,
  createWorktree,
  removeWorktree,
  deleteBranch,
  listSurgicalWorktrees,
};
