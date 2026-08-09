// Hükümden KAÇINAN cevap hüküm sayılmamalı, benchmark kanıtsız kalmamalı,
// seans hesabı borsa saat dilimine bağlı olmalı.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const { detectEquityVerdict, evaluateVerdictEvidenceLock, buildEvidenceLedger, hasFreshEvidence } = guards;
const { createResearchRun, submitPlan, evaluateContract, SUB_QUESTION_STATUS } = contract;

const ok = (data = {}) => ({ success: true, data, source: 'test' });

describe('Negatif hüküm — reddi hüküm sayma', () => {
  it('REGRESYON — "AL/SAT demiyorum" hüküm değildir', () => {
    // Canlı vakada bu cümle KARAR KİLİDİ'ni tetikledi ve tam bir onarım turu
    // başlattı; oysa cevap tam olarak istenen şeyi yapıyordu.
    const line = 'Kaptan, sözleşme onarımını uyguladım; AL/SAT demiyorum. Doğru hüküm kelimeleri: KCHOL = İNCELE';
    expect(detectEquityVerdict(line)).toBe(false);
  });

  it('diğer reddetme kalıpları da hüküm sayılmaz', () => {
    for (const s of [
      'Bu veri setiyle AL demek doğru olmaz',
      'Karar: AL hükmü vermiyorum, İNCELE diyorum',
      'AL/SAT yerine İZLE kullanıyorum',
      'Kanıt yetersiz; AL hükmü yok',
    ]) {
      expect(detectEquityVerdict(s), s).toBe(false);
    }
  });

  it('gerçek hüküm hâlâ yakalanır', () => {
    expect(detectEquityVerdict('Karar: AL')).toBe(true);
    expect(detectEquityVerdict('THYAO: SAT')).toBe(true);
    expect(detectEquityVerdict('Sonuç → AL')).toBe(true);
  });

  it('hüküm reddeden cevapta karar kilidi çalışmaz', () => {
    const response = 'Borsa değerlendirmesi: AL/SAT demiyorum. KCHOL = İNCELE, ASELS = İZLE.';
    expect(evaluateVerdictEvidenceLock('borsada hisse alım', response)).toBeNull();
  });
});

describe('Benchmark kanıtsız bırakılmaz', () => {
  it('benchmark bildirilirse BENCHMARK_PRICE_SERIES zorunlu olur', () => {
    const run = createResearchRun({ userQuestion: 'test' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'XU100 gore relatif guc', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: ['THYAO', 'XU100'], coverage: 'ALL',
      }],
    });
    expect(res.ok).toBe(true);
    const sq = res.contract.subQuestions[0];
    expect(sq.benchmarks).toEqual(['XU100']);
    expect(sq.requiredEvidence).toContain('BENCHMARK_PRICE_SERIES');
    run.set(res.contract);

    // Şirket kanıtı tam ama benchmark serisi yok → tamamlanmaz.
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));
    run.record('analyze_finance_signal', { asset: 'THYAO' }, ok({}));
    let out = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(out.subQuestions[0].missingEvidence).toContain('BENCHMARK_PRICE_SERIES');

    // Benchmark serisi gelince tamamlanır.
    run.record('analyze_earnings_pricing', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    out = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(out.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });

  it('benchmark yoksa BENCHMARK_PRICE_SERIES dayatılmaz', () => {
    const run = createResearchRun({ userQuestion: 'test' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'teknik', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: ['THYAO'],
      }],
    });
    expect(res.contract.subQuestions[0].requiredEvidence).not.toContain('BENCHMARK_PRICE_SERIES');
  });
});

describe('Seans hesabı borsa saat dilimine bağlı', () => {
  const src = fs.readFileSync('apps/desktop/electron/ai-service.cjs', 'utf8');
  const fn = new Function(`${src.match(/^function describeBistSession[\s\S]*?\n}/m)[0]}\nreturn describeBistSession;`)();

  it('Europe/Istanbul kullanır ve saat dilimini raporlar', () => {
    const s = fn(new Date('2026-08-09T12:00:00Z'));
    expect(s.exchangeTimeZone).toBe('Europe/Istanbul');
    expect(s.nowUtc).toBe('2026-08-09T12:00:00.000Z');
  });

  it('hafta sonu KAPALI', () => {
    expect(fn(new Date('2026-08-09T12:00:00Z')).marketSession).toBe('CLOSED'); // Pazar
  });

  it('REGRESYON — belirli gün adı vermez, tatil takvimi doğrulanmadığını bildirir', () => {
    const s = fn(new Date('2026-08-09T12:00:00Z'));
    expect(s.nextSession).toMatch(/bir sonraki açık/);
    expect(s.nextSession).not.toMatch(/Pazartesi/);
    expect(s.holidayCalendarChecked).toBe(false);
    expect(s.sessionNote).toMatch(/Resmî tatil takvimi DOĞRULANMADI/);
  });

  it('hafta içi seans saatinde AÇIK', () => {
    // Salı 12:00 Istanbul = 09:00Z
    expect(fn(new Date('2026-08-11T09:00:00Z')).marketSession).toBe('OPEN');
    expect(fn(new Date('2026-08-11T16:00:00Z')).marketSession).toBe('CLOSED'); // 19:00 Istanbul
  });
});
