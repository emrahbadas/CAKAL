import { describe, expect, it } from 'vitest';
import {
  archiveKapFinancialReport,
  calculateKapErrorRetryAfter,
  calculateNextKapCheckAt,
  calculateFinancialRatios,
  createCompanyAnalysisSnapshot,
  createKapSyncState,
  crossCheckFinancialFacts,
  deriveQuarterlyFactsFromCumulative,
  evaluateKapCache,
  normalizeKapFinancialLineItems,
  planVersionedKapReport,
  validateFinancialStatementSet,
} from '../packages/core/investment-research/src/index.ts';

const report = {
  reportId: 'kap-report-sise-2026q2',
  disclosureId: 'kap-disc-1',
  symbol: 'SISE',
  fiscalYear: 2026,
  fiscalPeriod: '2026Q2',
  fiscalQuarter: 2,
  periodType: 'CUMULATIVE',
  basis: 'CONSOLIDATED',
  auditStatus: 'REVIEWED',
  currency: 'TRY',
  unit: 'THOUSAND_TRY',
  sourceUrl: 'https://www.kap.org.tr/tr/Bildirim/1',
  publishedAt: '2026-07-18T10:00:00.000Z',
  retrievedAt: '2026-07-18T10:05:00.000Z',
};

const mappings = [
  ['BALANCE_SHEET', 'total_assets', 'Toplam varliklar', 'toplam varliklar'],
  ['BALANCE_SHEET', 'total_liabilities', 'Toplam yukumlulukler', 'toplam yukumlulukler'],
  ['BALANCE_SHEET', 'total_equity', 'Toplam ozkaynaklar', 'toplam ozkaynaklar'],
  ['BALANCE_SHEET', 'current_assets', 'Donen varliklar', 'donen varliklar'],
  ['BALANCE_SHEET', 'current_liabilities', 'Kisa vadeli yukumlulukler', 'kisa vadeli yukumlulukler'],
  ['BALANCE_SHEET', 'cash_and_equivalents', 'Nakit ve nakit benzerleri', 'nakit ve nakit benzerleri'],
  ['BALANCE_SHEET', 'total_debt', 'Finansal borclar', 'finansal borclar'],
  ['INCOME_STATEMENT', 'net_sales', 'Net satislar', 'net satislar'],
  ['INCOME_STATEMENT', 'gross_profit', 'Brut kar', 'brut kar'],
  ['INCOME_STATEMENT', 'operating_profit', 'Faaliyet kari', 'faaliyet kari'],
  ['INCOME_STATEMENT', 'net_income', 'Net donem kari', 'net donem kari'],
  ['INCOME_STATEMENT', 'ebitda', 'FAVOK', 'favok'],
  ['CASH_FLOW', 'cash_begin', 'Donem basi nakit', 'donem basi nakit'],
  ['CASH_FLOW', 'net_change_cash', 'Nakit net degisim', 'nakit net degisim'],
  ['CASH_FLOW', 'cash_end', 'Donem sonu nakit', 'donem sonu nakit'],
  ['CASH_FLOW', 'operating_cash_flow', 'Isletme faaliyetlerinden nakit', 'isletme faaliyetlerinden nakit'],
  ['CASH_FLOW', 'capex', 'Yatirim harcamalari', 'yatirim harcamalari'],
].map(([statement, standardCode, standardLabel, rawLabelPattern], index) => ({
  mappingId: `map-${index}`,
  statement,
  standardCode,
  standardLabel,
  rawLabelPattern,
  companyProfile: 'INDUSTRIAL',
  confidence: 0.95,
  version: 'kap-industrial-v1',
}));

function raw(rawItemId, statement, rawLabel, rawValue) {
  return {
    rawItemId,
    reportId: report.reportId,
    symbol: report.symbol,
    statement,
    rawLabel,
    rawValue,
  };
}

const rawItems = [
  raw('r-assets', 'BALANCE_SHEET', 'Toplam Varlıklar', 1000),
  raw('r-liab', 'BALANCE_SHEET', 'Toplam Yükümlülükler', 600),
  raw('r-equity', 'BALANCE_SHEET', 'Toplam Özkaynaklar', 400),
  raw('r-current-assets', 'BALANCE_SHEET', 'Dönen Varlıklar', 300),
  raw('r-current-liab', 'BALANCE_SHEET', 'Kısa Vadeli Yükümlülükler', 150),
  raw('r-cash', 'BALANCE_SHEET', 'Nakit ve Nakit Benzerleri', 120),
  raw('r-debt', 'BALANCE_SHEET', 'Finansal Borçlar', 250),
  raw('r-sales', 'INCOME_STATEMENT', 'Net Satışlar', 500),
  raw('r-gross', 'INCOME_STATEMENT', 'Brüt Kar', 180),
  raw('r-op', 'INCOME_STATEMENT', 'Faaliyet Karı', 90),
  raw('r-net', 'INCOME_STATEMENT', 'Net Dönem Karı', 70),
  raw('r-ebitda', 'INCOME_STATEMENT', 'FAVÖK', 110),
  raw('r-cash-begin', 'CASH_FLOW', 'Dönem Başı Nakit', 80),
  raw('r-cash-change', 'CASH_FLOW', 'Nakit Net Değişim', 40),
  raw('r-cash-end', 'CASH_FLOW', 'Dönem Sonu Nakit', 120),
  raw('r-ocf', 'CASH_FLOW', 'İşletme Faaliyetlerinden Nakit', 95),
  raw('r-capex', 'CASH_FLOW', 'Yatırım Harcamaları', -25),
];

function normalizedFacts(customReport = report, items = rawItems) {
  return normalizeKapFinancialLineItems({
    report: customReport,
    rawItems: items,
    mappings,
    companyProfile: 'INDUSTRIAL',
  }).facts;
}

describe('KAP financial ingestion pipeline', () => {
  it('archives KAP raw report with source metadata', () => {
    const archive = archiveKapFinancialReport({ report, rawItems });

    expect(archive.archiveId).toContain(report.reportId);
    expect(archive.rawItems[0].sourceUrl).toBe(report.sourceUrl);
    expect(archive.rawItems[0].sourceTimestamp).toBe(report.retrievedAt);
  });

  it('normalizes KAP line items and validates balance sheet equation', () => {
    const result = normalizeKapFinancialLineItems({
      report,
      rawItems,
      mappings,
      companyProfile: 'INDUSTRIAL',
    });

    expect(result.unmappedItems).toHaveLength(0);
    expect(result.facts.find((fact) => fact.standardCode === 'total_assets').normalizedValue).toBe(1000000);

    const validation = validateFinancialStatementSet({ report, facts: result.facts });
    expect(validation.passed).toBe(true);
  });

  it('blocks invalid balance sheet equation and mixed solo/consolidated sets', () => {
    const badFacts = normalizedFacts(report, [
      raw('r-assets', 'BALANCE_SHEET', 'Toplam Varlıklar', 1000),
      raw('r-liab', 'BALANCE_SHEET', 'Toplam Yükümlülükler', 600),
      raw('r-equity', 'BALANCE_SHEET', 'Toplam Özkaynaklar', 300),
    ]);

    const equation = validateFinancialStatementSet({ report, facts: badFacts });
    expect(equation.passed).toBe(false);
    expect(equation.blockingIssues.map((issue) => issue.code)).toContain('BALANCE_SHEET_EQUATION_FAILED');

    const mixedBasis = validateFinancialStatementSet({
      report,
      facts: [
        ...badFacts,
        { ...badFacts[0], factId: 'solo-fact', basis: 'SOLO' },
      ],
    });
    expect(mixedBasis.blockingIssues.map((issue) => issue.code)).toContain('MIXED_REPORT_BASIS');
  });

  it('derives quarterly income statement facts from cumulative filings', () => {
    const current = normalizedFacts(report, [
      raw('q2-sales', 'INCOME_STATEMENT', 'Net Satışlar', 500),
      raw('q2-net', 'INCOME_STATEMENT', 'Net Dönem Karı', 70),
    ]);
    const previous = normalizedFacts({ ...report, reportId: 'kap-report-sise-2026q1', fiscalPeriod: '2026Q1', fiscalQuarter: 1 }, [
      raw('q1-sales', 'INCOME_STATEMENT', 'Net Satışlar', 220),
      raw('q1-net', 'INCOME_STATEMENT', 'Net Dönem Karı', 30),
    ]);

    const quarterly = deriveQuarterlyFactsFromCumulative({ currentCumulative: current, previousCumulative: previous });
    expect(quarterly.find((fact) => fact.standardCode === 'net_sales').normalizedValue).toBe(280000);
    expect(quarterly.find((fact) => fact.standardCode === 'net_income').normalizedValue).toBe(40000);
  });

  it('cross-checks normalized facts against secondary providers', () => {
    const facts = normalizedFacts();
    const checks = crossCheckFinancialFacts({
      facts,
      crossChecks: [{
        provider: 'FINTABLES',
        symbol: 'SISE',
        fiscalPeriod: '2026Q2',
        checkedAt: '2026-07-18T11:00:00.000Z',
        facts: [
          { standardCode: 'total_assets', value: 1000000 },
          { standardCode: 'net_income', value: 65000 },
        ],
      }],
    });

    expect(checks[0].passed).toBe(false);
    expect(checks[0].issues.map((issue) => issue.code)).toContain('CROSS_CHECK_VALUE_MISMATCH');
  });

  it('calculates ratio set and creates analysis readiness snapshot', () => {
    const facts = normalizedFacts();
    const ratios = calculateFinancialRatios({
      symbol: 'SISE',
      fiscalPeriod: '2026Q2',
      basis: 'CONSOLIDATED',
      facts,
    });

    expect(ratios.ratios.gross_margin).toBe(0.36);
    expect(ratios.ratios.current_ratio).toBe(2);
    expect(ratios.ratios.net_debt_to_ebitda).toBeCloseTo(1.1818, 4);

    const snapshot = createCompanyAnalysisSnapshot({ report, facts });
    expect(snapshot.readiness).toBe('READY_FOR_ANALYSIS');
    expect(snapshot.validation.passed).toBe(true);
  });

  it('uses DB financial report until next KAP check time', () => {
    const state = createKapSyncState({
      symbol: 'SISE',
      dataType: 'FINANCIAL_REPORT',
      lastDisclosureId: 'kap-disc-1',
      lastCheckedAt: '2026-07-19T08:00:00.000Z',
      nextCheckAt: '2026-07-20T08:00:00.000Z',
    });

    const evaluation = evaluateKapCache({
      now: '2026-07-19T12:00:00.000Z',
      dataType: 'FINANCIAL_REPORT',
      syncState: state,
      currentReport: {
        ...report,
        lastCheckedAt: '2026-07-19T08:00:00.000Z',
        nextCheckAt: '2026-07-20T08:00:00.000Z',
      },
    });

    expect(evaluation.decision).toBe('USE_DB');
    expect(evaluation.shouldUseDb).toBe(true);
    expect(evaluation.shouldCheckKap).toBe(false);
  });

  it('checks only KAP disclosure list when cache check time arrives', () => {
    const evaluation = evaluateKapCache({
      now: '2026-07-20T09:00:00.000Z',
      dataType: 'FINANCIAL_REPORT',
      syncState: createKapSyncState({
        symbol: 'SISE',
        dataType: 'FINANCIAL_REPORT',
        lastDisclosureId: 'kap-disc-1',
        lastCheckedAt: '2026-07-19T08:00:00.000Z',
        nextCheckAt: '2026-07-20T08:00:00.000Z',
        consecutiveNoChange: 2,
      }),
      currentReport: {
        ...report,
        lastCheckedAt: '2026-07-19T08:00:00.000Z',
      },
    });

    expect(evaluation.decision).toBe('CHECK_KAP_DISCLOSURES');
    expect(evaluation.shouldFetchReport).toBe(false);
    expect(evaluation.nextCheckAt).toBe('2026-07-23T09:00:00.000Z');
  });

  it('fetches a new report when KAP disclosure id changes and plans a new version', () => {
    const evaluation = evaluateKapCache({
      now: '2026-07-19T12:00:00.000Z',
      dataType: 'FINANCIAL_REPORT',
      currentReport: { ...report, version: 1 },
      latestKapDisclosureId: 'kap-disc-2',
    });

    expect(evaluation.decision).toBe('FETCH_NEW_REPORT');

    const plan = planVersionedKapReport({
      report: {
        ...report,
        reportId: 'kap-report-sise-2026q2-v2',
        disclosureId: 'kap-disc-2',
        isRestatement: true,
      },
      previousCurrentReport: { ...report, version: 1 },
      now: '2026-07-19T12:10:00.000Z',
    });

    expect(plan.report.version).toBe(2);
    expect(plan.supersedesReportId).toBe(report.reportId);
    expect(plan.currentPointer.currentReportId).toBe('kap-report-sise-2026q2-v2');
  });

  it('applies exponential backoff for KAP errors', () => {
    expect(calculateKapErrorRetryAfter({
      now: '2026-07-19T12:00:00.000Z',
      errorCount: 0,
    })).toBe('2026-07-19T12:05:00.000Z');

    const evaluation = evaluateKapCache({
      now: '2026-07-19T12:10:00.000Z',
      dataType: 'FINANCIAL_REPORT',
      syncState: createKapSyncState({
        symbol: 'SISE',
        dataType: 'FINANCIAL_REPORT',
        syncStatus: 'backoff',
        retryAfter: '2026-07-19T13:00:00.000Z',
      }),
      currentReport: report,
    });

    expect(evaluation.decision).toBe('BACKOFF');
    expect(evaluation.shouldUseDb).toBe(true);
  });

  it('uses short checks after a newly published report', () => {
    const nextCheckAt = calculateNextKapCheckAt({
      now: '2026-07-19T12:00:00.000Z',
      dataType: 'FINANCIAL_REPORT',
      currentReport: {
        ...report,
        publishedAt: '2026-07-19T10:30:00.000Z',
      },
    });

    expect(nextCheckAt).toBe('2026-07-19T14:00:00.000Z');
  });
});
