// ============================================================
// Execution Contract — plan-güdümlü, doğrulamalı yürütme döngüsü
// ============================================================
// Amaç: "write SUCCESS" != "görev tamamlandı". Bu modül dosya
// mutasyonu yapan görevler için deterministik bir sözleşme tutar:
//   plan → uygula → geri oku → planla karşılaştır → sınırlı düzelt
//
// Sonsuz döngü korumaları (hepsi deterministik, LLM'e güvenmez):
//   1. maxVerificationPasses  — verdict pas sayısı tavanı
//   2. maxEditsPerFile        — dosya başına düzeltme tavanı
//   3. maxTotalMutations      — toplam yazma tavanı
//   4. Bulgu parmak izi       — aynı bulgu ikinci kez gelirse BLOCKED
//   5. Salınım tespiti        — dosya önceki bir içeriğe geri dönerse dur
//   6. İlerleme ölçümü        — PASS sayısı artmıyorsa NO_PROGRESS
//   7. maxVerifyIterations    — doğrulama fazı LLM iterasyon tavanı
//
// Saf mantık: fs/openai bağımlılığı yok (disk kontrolü callback ile).

const crypto = require('crypto');

const DEFAULT_LIMITS = {
  maxVerificationPasses: 2,
  maxEditsPerFile: 2,
  maxTotalMutations: 8,
  maxVerifyIterations: 6,
};

// Terminal durumlar
const STATUS = {
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
  NO_PROGRESS: 'NO_PROGRESS',
  ITERATION_LIMIT: 'ITERATION_LIMIT',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  OSCILLATION_DETECTED: 'OSCILLATION_DETECTED',
};

function sha1(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function normalizePath(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

// Bulgu metnini normalize et: küçük harf, sayılar #, boşluk sadeleştir.
// Böylece "satır 12'de eksik" ve "satır 14'te eksik" aynı parmak izine düşer.
function normalizeFindingText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function findingFingerprint(finding) {
  const file = normalizePath(finding.file);
  const rule = String(finding.ruleId || 'genel').toLowerCase().trim();
  return sha1(`${file}|${rule}|${normalizeFindingText(finding.description)}`);
}

function createExecutionContract(opts = {}) {
  return {
    taskId: opts.taskId || `task-${Date.now()}`,
    createdAt: new Date().toISOString(),
    limits: { ...DEFAULT_LIMITS, ...(opts.limits || {}) },

    // Plan
    planned: false,
    plannedArtifacts: [],
    acceptanceCriteria: [],

    // Mutasyon takibi
    mutations: [],        // { file, mode, hash, ts }
    editCounts: {},       // file -> yazma sayısı
    fileHashHistory: {},  // file -> [hash, ...] (kronolojik)

    // Doğrulama takibi
    verificationPasses: [], // { pass, passedCount, findingCount, repeatedCount, overall }
    findingFingerprints: {}, // fp -> görülme sayısı

    // Durum
    done: false,          // tüm kriterler geçti
    stopped: false,       // bir koruma devreye girdi
    stopReason: null,     // STATUS.* veya null
    guardLog: [],         // { code, detail, ts }
  };
}

function _stop(contract, code, detail) {
  if (!contract.stopped) {
    contract.stopped = true;
    contract.stopReason = code;
  }
  contract.guardLog.push({ code, detail, ts: Date.now() });
}

// ── Plan ──────────────────────────────────────────────────────

function registerPlan(contract, { taskId, artifacts, acceptanceCriteria } = {}) {
  if (contract.planned) {
    // maxPlanRevisions = 1: plan bir kez kilitlenir, revize edilemez.
    return { ok: false, message: 'PLAN_LOCKED: Plan zaten kayıtlı. Mevcut planla devam et; plan revizyonu yok.' };
  }
  const arts = Array.isArray(artifacts) ? artifacts.map(normalizePath).filter(Boolean) : [];
  if (arts.length === 0) {
    return { ok: false, message: 'Plan reddedildi: en az bir artifact (dosya yolu) gerekli.' };
  }
  contract.planned = true;
  if (taskId) contract.taskId = String(taskId);
  contract.plannedArtifacts = [...new Set(arts)];
  contract.acceptanceCriteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map(c => String(c).trim()).filter(Boolean)
    : [];
  return {
    ok: true,
    message: `Plan kilitlendi: ${contract.plannedArtifacts.length} artifact, ${contract.acceptanceCriteria.length} kabul kriteri. Artık yazmaya başlayabilirsin; iş bitince doğrulama fazında submit_task_verdict zorunlu.`,
  };
}

// ── Mutasyon kapısı ───────────────────────────────────────────

// Yazma İZNİ kontrolü — yazmadan ÖNCE çağrılır.
function canMutate(contract, filePath) {
  const file = normalizePath(filePath);

  if (contract.stopped) {
    return { allowed: false, reason: `Yürütme durduruldu (${contract.stopReason}). Yeni yazma yapılamaz; mevcut durumu raporla.` };
  }
  if (contract.mutations.length >= contract.limits.maxTotalMutations) {
    _stop(contract, STATUS.ITERATION_LIMIT, `maxTotalMutations (${contract.limits.maxTotalMutations}) doldu`);
    return { allowed: false, reason: `Toplam yazma limiti (${contract.limits.maxTotalMutations}) doldu. Kalan eksikleri raporla.` };
  }
  const edits = contract.editCounts[file] || 0;
  if (edits >= contract.limits.maxEditsPerFile) {
    return { allowed: false, reason: `${file} için düzeltme limiti (${contract.limits.maxEditsPerFile}) doldu. Bu dosyayı tekrar düzenleme; durumu raporla.` };
  }
  return { allowed: true };
}

// Yazma SONRASI kayıt — dosyanın nihai içerik hash'i ile çağrılır.
// Salınım: dosya, geçmişte sahip olduğu bir içeriğe geri dönerse
// (son hali hariç herhangi bir eski hash'e eşitse) OSCILLATION_DETECTED.
function recordMutation(contract, { file, mode, finalContent }) {
  const norm = normalizePath(file);
  const hash = sha1(finalContent || '');
  const history = contract.fileHashHistory[norm] || [];

  const oscillated = history.length >= 2 && history.slice(0, -1).includes(hash);

  contract.mutations.push({ file: norm, mode: mode || 'unknown', hash, ts: Date.now() });
  contract.editCounts[norm] = (contract.editCounts[norm] || 0) + 1;
  contract.fileHashHistory[norm] = [...history, hash];

  if (oscillated) {
    _stop(contract, STATUS.OSCILLATION_DETECTED, `${norm} önceki bir içeriğe geri döndü (hash ${hash.substring(0, 8)})`);
    return { recorded: true, oscillation: true };
  }
  return { recorded: true, oscillation: false };
}

// ── Doğrulama ─────────────────────────────────────────────────

// LLM'in submit_task_verdict çağrısını işler.
// coverage: [{ artifact, status: PASS|PARTIAL|MISSING|FAIL, evidence }]
// findings: [{ file, ruleId, description, violatesAcceptance }]
// overall: COMPLETED | PARTIAL | FAILED
function registerVerification(contract, { coverage, findings, overall } = {}) {
  const passNo = contract.verificationPasses.length + 1;

  if (passNo > contract.limits.maxVerificationPasses) {
    _stop(contract, STATUS.ITERATION_LIMIT, `maxVerificationPasses (${contract.limits.maxVerificationPasses}) aşıldı`);
    return {
      accepted: false,
      shouldContinue: false,
      message: `Doğrulama pas limiti (${contract.limits.maxVerificationPasses}) doldu. Döngü kapatılıyor; mevcut durum neyse o raporlanacak.`,
    };
  }

  const cov = Array.isArray(coverage) ? coverage : [];
  const finds = Array.isArray(findings) ? findings : [];
  const passedCount = cov.filter(c => c && c.status === 'PASS').length;

  // Bulgu parmak izleri
  let repeatedCount = 0;
  for (const f of finds) {
    const fp = findingFingerprint(f || {});
    const seen = contract.findingFingerprints[fp] || 0;
    if (seen > 0) repeatedCount++;
    contract.findingFingerprints[fp] = seen + 1;
  }

  const prev = contract.verificationPasses[contract.verificationPasses.length - 1] || null;
  contract.verificationPasses.push({
    pass: passNo,
    passedCount,
    coverageCount: cov.length,
    findingCount: finds.length,
    repeatedCount,
    overall: overall || 'PARTIAL',
    ts: Date.now(),
  });

  const allPass = cov.length > 0 && passedCount === cov.length;
  const hasViolations = finds.some(f => f && f.violatesAcceptance !== false);

  // Başarı: her şey geçti, ihlal yok
  if (overall === 'COMPLETED' && allPass && !hasViolations) {
    contract.done = true;
    return { accepted: true, shouldContinue: false, message: 'Tüm kabul kriterleri geçti. Görev COMPLETED olarak kilitlendi.' };
  }

  // Koruma 4: tüm bulgular tekrar → kör düzeltme döngüsüne girme
  if (finds.length > 0 && repeatedCount === finds.length) {
    _stop(contract, STATUS.BLOCKED, `REPEATED_FINDING: ${repeatedCount} bulgunun tamamı önceki pasta da bildirilmişti`);
    return {
      accepted: true,
      shouldContinue: false,
      message: 'Aynı bulgular tekrar bildirildi (REPEATED_FINDING). Kör düzeltme döngüsü engellendi; durum BLOCKED. Eksikleri raporla, yeni yazma yapma.',
    };
  }

  // Koruma 6: ilerleme yoksa dur
  if (prev && passedCount <= prev.passedCount) {
    _stop(contract, STATUS.NO_PROGRESS, `PASS sayısı artmadı (${prev.passedCount} → ${passedCount})`);
    return {
      accepted: true,
      shouldContinue: false,
      message: `İlerleme yok (PASS ${prev.passedCount} → ${passedCount}). Döngü NO_PROGRESS ile kapatılıyor; mevcut durumu raporla.`,
    };
  }

  // Bulgu var ama düzeltilebilir → sınırlı düzeltme hakkı
  if (hasViolations && passNo < contract.limits.maxVerificationPasses) {
    return {
      accepted: true,
      shouldContinue: true,
      message: `Pas ${passNo}: ${passedCount}/${cov.length} PASS, ${finds.length} bulgu (${repeatedCount} tekrar). Kabul kriterini ihlal eden bulguları düzelt, dosyayı geri oku, yeni verdict ver. Kalan pas hakkı: ${contract.limits.maxVerificationPasses - passNo}.`,
    };
  }

  // Bulgu yok ya da pas hakkı bitti → mevcut durumla kapan
  return {
    accepted: true,
    shouldContinue: false,
    message: `Pas ${passNo}: ${passedCount}/${cov.length} PASS. Düzeltme döngüsü kapatıldı; nihai durum deterministik kayda göre belirlenecek.`,
  };
}

// ── Disk doğrulaması (deterministik geri okuma) ───────────────

// readFile: (relPath) => { exists: bool, content: string|null } — fs erişimi
// dışarıdan enjekte edilir (test edilebilirlik + path guard'ı ai-service'te kalır).
function verifyArtifactsOnDisk(contract, readFile) {
  const written = new Set(contract.mutations.map(m => m.file));
  const all = [...new Set([...contract.plannedArtifacts, ...written])];
  const report = [];

  for (const file of all) {
    const entry = {
      file,
      planned: contract.plannedArtifacts.includes(file),
      wasWritten: written.has(file),
      exists: false,
      bytes: 0,
      ok: false,
      note: '',
    };
    try {
      const res = readFile(file);
      entry.exists = !!(res && res.exists);
      if (entry.exists && typeof res.content === 'string') {
        entry.bytes = Buffer.byteLength(res.content, 'utf-8');
        if (entry.bytes === 0) {
          entry.note = 'Dosya boş';
        } else if (/\.json$/i.test(file)) {
          try {
            JSON.parse(res.content);
            entry.ok = true;
          } catch (e) {
            entry.note = `JSON parse hatası: ${e.message}`;
          }
        } else {
          entry.ok = true;
        }
      } else if (!entry.exists) {
        entry.note = entry.planned && !entry.wasWritten ? 'Planlandı ama hiç yazılmadı' : 'Dosya diskte yok';
      }
    } catch (e) {
      entry.note = `Okuma hatası: ${e.message}`;
    }
    report.push(entry);
  }
  return report;
}

// ── Terminal durum ────────────────────────────────────────────

function computeStatus(contract, diskReport = []) {
  if (contract.mutations.length === 0 && !contract.planned) return null;

  // Yazılmış bir dosya disk kontrolünden geçemiyorsa: doğrulama başarısız
  const writtenBroken = diskReport.some(d => d.wasWritten && !d.ok);

  if (contract.done) {
    return writtenBroken ? STATUS.VERIFICATION_FAILED : STATUS.COMPLETED;
  }
  if (contract.stopReason === STATUS.OSCILLATION_DETECTED) return STATUS.OSCILLATION_DETECTED;
  if (contract.stopReason === STATUS.NO_PROGRESS) return STATUS.NO_PROGRESS;
  if (contract.stopReason === STATUS.BLOCKED) return STATUS.BLOCKED;
  if (contract.stopReason === STATUS.ITERATION_LIMIT) return STATUS.ITERATION_LIMIT;
  if (writtenBroken) return STATUS.VERIFICATION_FAILED;
  return STATUS.PARTIAL;
}

function buildStatusRecord(contract, diskReport = []) {
  const status = computeStatus(contract, diskReport);
  if (!status) return null;

  const lastPass = contract.verificationPasses[contract.verificationPasses.length - 1] || null;
  return {
    taskId: contract.taskId,
    status,
    planned: contract.planned,
    plannedArtifacts: contract.plannedArtifacts,
    createdFiles: [...new Set(contract.mutations.map(m => m.file))],
    mutationCount: contract.mutations.length,
    verificationPasses: contract.verificationPasses.length,
    lastCoverage: lastPass ? `${lastPass.passedCount}/${lastPass.coverageCount} PASS` : 'doğrulama yapılmadı',
    stopReason: contract.stopReason,
    disk: diskReport.map(d => ({ file: d.file, ok: d.ok, note: d.note || undefined })),
  };
}

module.exports = {
  STATUS,
  DEFAULT_LIMITS,
  createExecutionContract,
  registerPlan,
  canMutate,
  recordMutation,
  registerVerification,
  verifyArtifactsOnDisk,
  computeStatus,
  buildStatusRecord,
  // test için iç yardımcılar
  _internal: { sha1, normalizePath, normalizeFindingText, findingFingerprint },
};
