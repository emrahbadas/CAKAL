import { describe, it, expect } from 'vitest';

import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const {
  resolveEvidenceClasses,
  extractEvidenceProducingToolNames,
  extractCommanderToolNames,
  buildEvidenceLedger,
  hasFreshEvidence,
  hasFreshEvidenceForEntity,
  entitiesWithEvidence,
  evaluateUngovernedRankingGate,
} = guards;

const { createResearchRun } = contract;

/**
 * YOL HARİTASI ADIM 2 — sonuç-duyarlı kanıt sınıfı.
 *
 * ÖLÇÜLEN ESKİ DAVRANIŞ (11 Ağustos 2026):
 *   status 'BLOCKED' + success true dönen bir run_investment_research_scan
 *   olayı → defterde CURRENT_EQUITY_PRICE, LIQUIDITY, RESEARCH_EVIDENCE;
 *   entity düzeyinde "BRSAN kanıtlı"; ve yönetilmiş sıralama kapısı AÇILDI.
 *
 * Kural: aracın ÇALIŞMASI kanıt değildir; ÜRETMESİ kanıttır.
 */

const now = Date.now();

const blockedScan = {
  type: 'tool_call',
  tool: 'run_investment_research_scan',
  timestamp: now,
  entities: ['BRSAN'],
  success: true,              // tarayıcı BLOCKED iken bile böyle dönüyor
  status: 'BLOCKED',
  result: { status: 'BLOCKED', reason: 'kaynak limiti' },
};

const okScan = {
  type: 'tool_call',
  tool: 'run_investment_research_scan',
  timestamp: now,
  entities: ['BRSAN'],
  success: true,
  result: { success: true },
};

describe('resolveEvidenceClasses — sonuç kanıt sınıfını belirler', () => {
  it('BLOCKED sonuç hiçbir kanıt sınıfı üretmez', () => {
    expect(resolveEvidenceClasses('run_investment_research_scan', blockedScan)).toEqual([]);
  });

  it('success:false hiçbir kanıt sınıfı üretmez', () => {
    expect(resolveEvidenceClasses('get_stock_price', { success: false })).toEqual([]);
  });

  it('sonuç nesnesinin içindeki status da okunur', () => {
    expect(resolveEvidenceClasses('get_bist_board', { result: { status: 'TIMEOUT' } })).toEqual([]);
  });

  it('beyan yoksa statik tablo geçerlidir', () => {
    expect(resolveEvidenceClasses('run_investment_research_scan', okScan))
      .toEqual(['CURRENT_EQUITY_PRICE', 'LIQUIDITY', 'RESEARCH_EVIDENCE']);
  });

  it('olayın KENDİ beyanı tabloyu daraltabilir', () => {
    // Gerçek ihtiyaç: analyze_earnings_pricing çalıştı ama XU100 serisini
    // çekemedi → benchmark kanıtı iddia edemez.
    const daraltilmis = resolveEvidenceClasses('analyze_earnings_pricing', {
      success: true,
      evidenceClasses: ['EARNINGS_PRICE_REACTION'],
    });
    expect(daraltilmis).toEqual(['EARNINGS_PRICE_REACTION']);
  });

  it('BOŞ beyan "kanıt yok" demektir, yokluk sayılmaz', () => {
    expect(resolveEvidenceClasses('get_stock_price', { success: true, evidenceClasses: [] })).toEqual([]);
  });

  it('tabloda olmayan araç kanıt üretmez', () => {
    expect(resolveEvidenceClasses('bilinmeyen_arac', { success: true })).toEqual([]);
  });
});

describe('kanıt defteri — bloke çağrı deftere girmez', () => {
  it('BLOCKED tarama hiçbir kanıt sınıfı basmaz', () => {
    const ledger = buildEvidenceLedger([blockedScan], now);
    expect([...ledger.keys()]).toEqual([]);
    expect(hasFreshEvidence(ledger, 'RESEARCH_EVIDENCE', now)).toBe(false);
    expect(hasFreshEvidenceForEntity(ledger, 'RESEARCH_EVIDENCE', 'BRSAN', now)).toBe(false);
    expect(entitiesWithEvidence(ledger, 'RESEARCH_EVIDENCE')).toEqual([]);
  });

  it('başarılı tarama eskisi gibi kanıt basar (kapsam daralmadı)', () => {
    const ledger = buildEvidenceLedger([okScan], now);
    expect(hasFreshEvidence(ledger, 'RESEARCH_EVIDENCE', now)).toBe(true);
    expect(entitiesWithEvidence(ledger, 'RESEARCH_EVIDENCE')).toEqual(['BRSAN']);
  });
});

describe('sıralama kapısı — bloke tarama kapıyı AÇAMAZ', () => {
  const ranking = 'BIST adaylar:\n1) TUREX — güçlü\n2) SSAAT — orta\n3) BRSAN — zayıf';

  it('BLOCKED tarama ile sıralama üretilirse kapı ateşler', () => {
    const lock = evaluateUngovernedRankingGate('bist en sağlam 3 hisseyi sırala', ranking, [blockedScan]);
    expect(lock).toBeTruthy();
    expect(lock.status).toBe('BLOCKED_UNGOVERNED_RANKING');
  });

  it('başarılı tarama ile kapı susar', () => {
    expect(evaluateUngovernedRankingGate('bist en sağlam 3 hisseyi sırala', ranking, [okScan])).toBeNull();
  });

  it('çalışan araç listesi ile kanıt üreten araç listesi ayrışır', () => {
    expect(extractCommanderToolNames([blockedScan])).toEqual(['run_investment_research_scan']);
    expect(extractEvidenceProducingToolNames([blockedScan])).toEqual([]);
  });
});

describe('sözleşme kayıt yolu — bloke sonuç deftere yazılmaz', () => {
  it('record() BLOCKED sonucu kanıt saymaz', () => {
    const run = createResearchRun({ userQuestion: 'BRSAN ve MEYSU için tarama yap ve sırala' });
    run.record('run_investment_research_scan', { symbol: 'BRSAN' }, { success: true, status: 'BLOCKED' });
    expect(run.size()).toBe(0);
  });

  it('record() başarılı sonucu kanıt sayar ve sınıfları damgalar', () => {
    const run = createResearchRun({ userQuestion: 'BRSAN ve MEYSU için tarama yap ve sırala' });
    run.record('run_investment_research_scan', { symbol: 'BRSAN' }, { success: true });
    expect(run.size()).toBe(1);
    expect(run.events()[0].evidenceClasses).toContain('RESEARCH_EVIDENCE');
  });
});
