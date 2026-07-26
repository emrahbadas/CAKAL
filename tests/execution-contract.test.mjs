import { describe, expect, it } from 'vitest';
import contract from '../apps/desktop/electron/execution-contract.cjs';

const {
  STATUS,
  createExecutionContract,
  registerPlan,
  canMutate,
  recordMutation,
  registerVerification,
  verifyArtifactsOnDisk,
  computeStatus,
  buildStatusRecord,
} = contract;

function planned(limits) {
  const c = createExecutionContract({ limits });
  registerPlan(c, {
    taskId: 'test-task',
    artifacts: ['.cakal-sandbox/a.md', '.cakal-sandbox/b.json'],
    acceptanceCriteria: ['a.md dolu olacak', 'b.json geçerli JSON olacak'],
  });
  return c;
}

describe('plan kilidi', () => {
  it('planı kaydeder ve yolları normalize eder', () => {
    const c = createExecutionContract();
    const res = registerPlan(c, { artifacts: ['./.cakal-sandbox\\x.md'], acceptanceCriteria: ['dolu olacak'] });
    expect(res.ok).toBe(true);
    expect(c.plannedArtifacts).toEqual(['.cakal-sandbox/x.md']);
  });

  it('artifact yoksa planı reddeder', () => {
    const c = createExecutionContract();
    expect(registerPlan(c, { artifacts: [], acceptanceCriteria: ['x'] }).ok).toBe(false);
  });

  it('plan revizyonuna izin vermez (maxPlanRevisions=1)', () => {
    const c = planned();
    const second = registerPlan(c, { artifacts: ['.cakal-sandbox/c.md'], acceptanceCriteria: ['y'] });
    expect(second.ok).toBe(false);
    expect(second.message).toContain('PLAN_LOCKED');
    expect(c.plannedArtifacts).toHaveLength(2);
  });
});

describe('mutasyon limitleri', () => {
  it('dosya başına düzeltme limitini uygular', () => {
    const c = planned({ maxEditsPerFile: 2 });
    const f = '.cakal-sandbox/a.md';
    expect(canMutate(c, f).allowed).toBe(true);
    recordMutation(c, { file: f, mode: 'create', finalContent: 'v1' });
    expect(canMutate(c, f).allowed).toBe(true);
    recordMutation(c, { file: f, mode: 'overwrite', finalContent: 'v2' });

    const gate = canMutate(c, f);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('düzeltme limiti');
    // başka dosya hâlâ yazılabilir
    expect(canMutate(c, '.cakal-sandbox/b.json').allowed).toBe(true);
  });

  it('toplam mutasyon limitinde yürütmeyi durdurur', () => {
    const c = planned({ maxTotalMutations: 2, maxEditsPerFile: 5 });
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'create', finalContent: '1' });
    recordMutation(c, { file: '.cakal-sandbox/b.json', mode: 'create', finalContent: '2' });

    expect(canMutate(c, '.cakal-sandbox/c.md').allowed).toBe(false);
    expect(c.stopped).toBe(true);
    expect(c.stopReason).toBe(STATUS.ITERATION_LIMIT);
  });

  it('durdurulmuş sözleşmede yeni yazmayı reddeder', () => {
    const c = planned();
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'create', finalContent: 'x' });
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'overwrite', finalContent: 'y' });
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'overwrite', finalContent: 'x' }); // salınım
    expect(canMutate(c, '.cakal-sandbox/b.json').allowed).toBe(false);
  });
});

describe('salınım tespiti', () => {
  it('dosya eski bir içeriğe geri dönerse yakalar', () => {
    const c = planned({ maxEditsPerFile: 9, maxTotalMutations: 9 });
    const f = '.cakal-sandbox/a.md';
    expect(recordMutation(c, { file: f, mode: 'create', finalContent: 'A' }).oscillation).toBe(false);
    expect(recordMutation(c, { file: f, mode: 'overwrite', finalContent: 'B' }).oscillation).toBe(false);
    const third = recordMutation(c, { file: f, mode: 'overwrite', finalContent: 'A' });

    expect(third.oscillation).toBe(true);
    expect(c.stopReason).toBe(STATUS.OSCILLATION_DETECTED);
  });

  it('ilerleyen farklı içerikleri salınım saymaz', () => {
    const c = planned({ maxEditsPerFile: 9, maxTotalMutations: 9 });
    const f = '.cakal-sandbox/a.md';
    for (const v of ['A', 'B', 'C', 'D']) {
      expect(recordMutation(c, { file: f, mode: 'overwrite', finalContent: v }).oscillation).toBe(false);
    }
    expect(c.stopped).toBe(false);
  });
});

describe('doğrulama döngüsü', () => {
  const cov = (aStatus, bStatus) => ([
    { artifact: '.cakal-sandbox/a.md', status: aStatus },
    { artifact: '.cakal-sandbox/b.json', status: bStatus },
  ]);

  it('hepsi PASS ise görevi COMPLETED kilitler', () => {
    const c = planned();
    const res = registerVerification(c, { coverage: cov('PASS', 'PASS'), findings: [], overall: 'COMPLETED' });
    expect(res.shouldContinue).toBe(false);
    expect(c.done).toBe(true);
    expect(computeStatus(c, [])).toBe(STATUS.COMPLETED);
  });

  it('düzeltilebilir bulguda sınırlı düzeltme hakkı verir', () => {
    const c = planned({ maxVerificationPasses: 2 });
    const res = registerVerification(c, {
      coverage: cov('PASS', 'PARTIAL'),
      findings: [{ file: '.cakal-sandbox/b.json', ruleId: 'schema-invalid', description: 'enum eksik', violatesAcceptance: true }],
      overall: 'PARTIAL',
    });
    expect(res.shouldContinue).toBe(true);
    expect(c.stopped).toBe(false);
  });

  it('aynı bulgu tekrar gelirse BLOCKED ile keser (parmak izi)', () => {
    const c = planned({ maxVerificationPasses: 3 });
    const finding = { file: '.cakal-sandbox/b.json', ruleId: 'schema-invalid', description: 'satır 12 enum eksik', violatesAcceptance: true };
    registerVerification(c, { coverage: cov('PASS', 'PARTIAL'), findings: [finding], overall: 'PARTIAL' });

    // sayı farklı ama normalize edilince aynı bulgu → tekrar sayılır
    const res2 = registerVerification(c, {
      coverage: cov('PASS', 'FAIL'),
      findings: [{ ...finding, description: 'satır 47 enum eksik' }],
      overall: 'PARTIAL',
    });

    expect(res2.shouldContinue).toBe(false);
    expect(c.stopReason).toBe(STATUS.BLOCKED);
    expect(computeStatus(c, [])).toBe(STATUS.BLOCKED);
  });

  it('PASS sayısı artmıyorsa NO_PROGRESS ile durur', () => {
    const c = planned({ maxVerificationPasses: 4 });
    registerVerification(c, {
      coverage: cov('PASS', 'PARTIAL'),
      findings: [{ file: '.cakal-sandbox/b.json', ruleId: 'r1', description: 'ilk sorun', violatesAcceptance: true }],
      overall: 'PARTIAL',
    });
    const res2 = registerVerification(c, {
      coverage: cov('PASS', 'PARTIAL'),
      findings: [{ file: '.cakal-sandbox/b.json', ruleId: 'r2', description: 'bambaska yeni sorun', violatesAcceptance: true }],
      overall: 'PARTIAL',
    });

    expect(res2.shouldContinue).toBe(false);
    expect(c.stopReason).toBe(STATUS.NO_PROGRESS);
  });

  it('pas limiti aşılırsa verdict kabul etmez', () => {
    const c = planned({ maxVerificationPasses: 1 });
    registerVerification(c, { coverage: cov('PASS', 'PARTIAL'), findings: [], overall: 'PARTIAL' });
    const res2 = registerVerification(c, { coverage: cov('PASS', 'PASS'), findings: [], overall: 'COMPLETED' });

    expect(res2.accepted).toBe(false);
    expect(c.done).toBe(false);
    expect(c.stopReason).toBe(STATUS.ITERATION_LIMIT);
  });

  it('ihlal etmeyen bulgu düzeltme döngüsü açmaz', () => {
    const c = planned({ maxVerificationPasses: 2 });
    const res = registerVerification(c, {
      coverage: cov('PASS', 'PASS'),
      findings: [{ file: '.cakal-sandbox/a.md', ruleId: 'style', description: 'daha iyi olabilir', violatesAcceptance: false }],
      overall: 'PARTIAL',
    });
    expect(res.shouldContinue).toBe(false);
  });
});

describe('disk doğrulaması ve durum kaydı', () => {
  const fakeDisk = (files) => (rel) => (
    Object.prototype.hasOwnProperty.call(files, rel)
      ? { exists: true, content: files[rel] }
      : { exists: false, content: null }
  );

  it('eksik, boş ve bozuk JSON dosyalarını yakalar', () => {
    const c = planned();
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'create', finalContent: 'dolu' });
    recordMutation(c, { file: '.cakal-sandbox/b.json', mode: 'create', finalContent: '{bozuk' });

    const report = verifyArtifactsOnDisk(c, fakeDisk({
      '.cakal-sandbox/a.md': 'dolu',
      '.cakal-sandbox/b.json': '{bozuk',
    }));

    const a = report.find(r => r.file === '.cakal-sandbox/a.md');
    const b = report.find(r => r.file === '.cakal-sandbox/b.json');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.note).toContain('JSON');
  });

  it('planlanmış ama yazılmamış dosyayı raporlar', () => {
    const c = planned();
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'create', finalContent: 'dolu' });
    const report = verifyArtifactsOnDisk(c, fakeDisk({ '.cakal-sandbox/a.md': 'dolu' }));
    const b = report.find(r => r.file === '.cakal-sandbox/b.json');
    expect(b.exists).toBe(false);
    expect(b.note).toContain('hiç yazılmadı');
  });

  it('yazılan dosya bozuksa COMPLETED yerine VERIFICATION_FAILED verir', () => {
    const c = planned();
    recordMutation(c, { file: '.cakal-sandbox/b.json', mode: 'create', finalContent: '{bozuk' });
    registerVerification(c, {
      coverage: [{ artifact: '.cakal-sandbox/b.json', status: 'PASS' }],
      findings: [],
      overall: 'COMPLETED',
    });
    const report = verifyArtifactsOnDisk(c, fakeDisk({ '.cakal-sandbox/b.json': '{bozuk' }));
    expect(computeStatus(c, report)).toBe(STATUS.VERIFICATION_FAILED);
  });

  it('doğrulama hiç yapılmadıysa PARTIAL kalır (asıl olay senaryosu)', () => {
    const c = planned();
    recordMutation(c, { file: '.cakal-sandbox/a.md', mode: 'create', finalContent: '# readme' });
    const report = verifyArtifactsOnDisk(c, fakeDisk({ '.cakal-sandbox/a.md': '# readme' }));
    const record = buildStatusRecord(c, report);

    expect(record.status).toBe(STATUS.PARTIAL);
    expect(record.createdFiles).toEqual(['.cakal-sandbox/a.md']);
    expect(record.verificationPasses).toBe(0);
  });

  it('hiç iş yapılmadıysa durum kaydı üretmez', () => {
    expect(buildStatusRecord(createExecutionContract(), [])).toBeNull();
  });
});
