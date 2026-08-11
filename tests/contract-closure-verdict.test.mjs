import { describe, it, expect } from 'vitest';

import contract from '../apps/desktop/electron/research-contract.cjs';
import guards from '../apps/desktop/electron/decision-guards.cjs';

const { evaluateContract, createResearchContract, submitPlan, SUB_QUESTION_STATUS } = contract;
const { buildEvidenceLedger, neutralizeEquityVerdicts, detectEquityVerdict } = guards;

/**
 * YOL HARİTASI ADIM 3 — sözleşme kapanışı hükmü indirmeli.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026, 3. tur):
 *   Üç alt soru da PARTIAL. Kapanış "cevaplanabilir: yok; bloke: yok" dedi —
 *   çünkü PARTIAL hiçbir listeye düşmüyordu. Rapor cevabın ALTINA eklendi,
 *   üstteki hükme dokunulmadı. Sözleşme kapı değil, tutanak tutan zabitti.
 *
 * README'nin istediği iki test:
 *   (a) AL/SAT nötrleşiyor mu
 *   (b) bloke alt soruya ait NİTEL hüküm kalıyor mu
 */

const now = Date.now();

function coverageWith(events) {
  const base = createResearchContract({ runId: 'R-test', userQuestion: 'BRSAN ve MEYSU karşılaştır' });
  const planned = submitPlan(base, {
    subQuestions: [
      {
        id: 's1',
        question: 'BRSAN teknik sinyali nedir',
        outputKind: 'current_leader',
        entities: ['BRSAN'],
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
      },
      {
        id: 's2',
        question: 'BRSAN likiditesi yeterli mi',
        outputKind: 'current_leader',
        entities: ['BRSAN'],
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'LIQUIDITY'],
      },
    ],
  });
  // Plan reddi sessizce PLAN_REQUIRED kapanışına düşer ve test yanlış şeyi
  // ölçer; kurulum hatası burada patlasın.
  expect(planned.ok, `plan reddedildi: ${(planned.errors || []).join(' | ')}`).toBe(true);
  return evaluateContract(planned.contract, buildEvidenceLedger(events, now), now);
}

describe('kapanış muhasebesi — PARTIAL kaybolmaz', () => {
  it('kısmen kanıtlı alt soru partialIds ve unresolvedIds içinde görünür', () => {
    // Yalnız fiyat kanıtı var; teknik/likidite yok → PARTIAL.
    const coverage = coverageWith([
      { type: 'tool_call', tool: 'get_stock_price', timestamp: now, entities: ['BRSAN'], success: true },
    ]);

    const partialVar = coverage.subQuestions.some((sq) => sq.status === SUB_QUESTION_STATUS.PARTIAL);
    expect(partialVar).toBe(true);

    // ASIL REGRESYON: PARTIAL varsa iki liste birden boş OLAMAZ.
    expect(coverage.partialIds.length).toBeGreaterThan(0);
    expect(coverage.unresolvedIds.length).toBeGreaterThan(0);
    expect(coverage.answerableIds.length + coverage.blockedIds.length + coverage.partialIds.length)
      .toBe(coverage.subQuestions.length);
  });

  it('hiç kanıt yokken alt sorular bloke sayılır ve yine unresolvedIds içindedir', () => {
    const coverage = coverageWith([]);
    expect(coverage.answerableIds).toEqual([]);
    expect(coverage.unresolvedIds.length).toBe(coverage.subQuestions.length);
  });
});

describe('hüküm indirme — (a) AL/SAT nötrleşir', () => {
  it('hüküm satırındaki AL → İNCELE, SAT → RİSKLİ olur', () => {
    const cevap = [
      '## Sonuç',
      'BRSAN: AL',
      'MEYSU: SAT',
    ].join('\n');

    expect(detectEquityVerdict(cevap)).toBe(true);
    const indirilmis = neutralizeEquityVerdicts(cevap);
    expect(indirilmis).toContain('BRSAN: İNCELE');
    expect(indirilmis).toContain('MEYSU: RİSKLİ');
    expect(indirilmis).not.toMatch(/BRSAN: AL$/m);
  });

  it('indirme yinelenebilir — iki kez uygulanınca bozulmaz', () => {
    const bir = neutralizeEquityVerdicts('BRSAN: AL');
    expect(neutralizeEquityVerdicts(bir)).toBe(bir);
  });
});

describe('hüküm indirme — (b) nitel bulgu KALIR', () => {
  it('bloke katmana ait nitel cümleler silinmez', () => {
    const cevap = [
      'BRSAN: AL',
      '',
      'Haber akışı kirli; spekülatif doğa baskın.',
      'Net borç ölçekli şirkete göre taşınabilir görünüyor.',
      'Halka arz sonrası volatilite yüksek.',
    ].join('\n');

    const indirilmis = neutralizeEquityVerdicts(cevap);

    // Hüküm indi...
    expect(indirilmis).toContain('BRSAN: İNCELE');
    // ...ama araştırmanın nitel bulguları aynen duruyor.
    expect(indirilmis).toContain('Haber akışı kirli; spekülatif doğa baskın.');
    expect(indirilmis).toContain('Net borç ölçekli şirkete göre taşınabilir görünüyor.');
    expect(indirilmis).toContain('Halka arz sonrası volatilite yüksek.');
  });

  it('hükümden KAÇINAN cümle hüküm sayılmaz, dokunulmaz', () => {
    // Doğru davranışı cezalandırmama kuralı.
    const cevap = 'AL/SAT demiyorum; doğru hüküm kelimesi İNCELE.';
    expect(detectEquityVerdict(cevap)).toBe(false);
    expect(neutralizeEquityVerdicts(cevap)).toBe(cevap);
  });

  it('düz metindeki "al" fiili hüküm sanılmaz', () => {
    const cevap = 'Bu veriyi kaynağından al ve tabloya yaz.';
    expect(neutralizeEquityVerdicts(cevap)).toBe(cevap);
  });
});
