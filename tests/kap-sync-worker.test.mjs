import { describe, expect, it } from 'vitest';
import {
  buildKapReport,
  evaluateCacheDecision,
  inferFiscalPeriod,
  inferStatementKind,
  latestDisclosure,
  parseFinancialReportLineItems,
} from '../scripts/kap-sync-worker.cjs';

describe('KAP sync worker', () => {
  it('uses DB when next_check_at is still in the future', () => {
    const decision = evaluateCacheDecision({
      now: new Date('2026-07-19T12:00:00.000Z'),
      currentReport: { report_id: 'r1', disclosure_id: 'd1' },
      syncState: {
        next_check_at: '2026-07-20T12:00:00.000Z',
        sync_status: 'fresh',
      },
    });

    expect(decision.decision).toBe('USE_DB');
  });

  it('respects backoff retry_after', () => {
    const decision = evaluateCacheDecision({
      now: new Date('2026-07-19T12:00:00.000Z'),
      currentReport: { report_id: 'r1', disclosure_id: 'd1' },
      syncState: {
        sync_status: 'backoff',
        retry_after: '2026-07-19T13:00:00.000Z',
      },
    });

    expect(decision.decision).toBe('BACKOFF');
  });

  it('selects latest disclosure by Turkish publish date', () => {
    const latest = latestDisclosure([
      { disclosureIndex: 1, publishDate: '29.04.2026 18:20:52', year: 2026, period: 1 },
      { disclosureIndex: 2, publishDate: '09.05.2026 18:20:52', year: 2026, period: 1 },
    ], 'THYAO');

    expect(latest.disclosureIndex).toBe('2');
  });

  it('infers fiscal periods and statement kinds', () => {
    expect(inferFiscalPeriod(2026, 1)).toBe('2026Q1');
    expect(inferFiscalPeriod(2026, '6 Aylık')).toBe('2026Q2');
    expect(inferStatementKind('Toplam Özkaynaklar')).toBe('BALANCE_SHEET');
    expect(inferStatementKind('Net Dönem Karı')).toBe('INCOME_STATEMENT');
    expect(inferStatementKind('Nakit ve Nakit Benzerleri')).toBe('CASH_FLOW');
    expect(inferStatementKind('Banka Kredileri')).toBe('BALANCE_SHEET');
  });

  it('builds versioned KAP report row', () => {
    const report = buildKapReport({
      symbol: 'THYAO',
      disclosure: {
        disclosure_id: '1598897',
        published_at: '2026-04-29T15:20:52.000Z',
        kap_url: 'https://www.kap.org.tr/tr/Bildirim/1598897',
      },
      rawDisclosure: { disclosureIndex: '1598897', year: 2026, period: 1 },
      previousCurrentReport: { report_id: 'old', version: 1 },
      checkedAt: '2026-07-19T12:00:00.000Z',
      nextCheckAt: '2026-07-20T12:00:00.000Z',
    });

    expect(report.report_id).toBe('kap-report-THYAO-2026Q1-1598897');
    expect(report.version).toBe(2);
    expect(report.replaces_report_id).toBe('old');
  });

  it('parses raw line items from report html', () => {
    const html = `
      <tr class="x data-input-row y">
        <td><span class="gwt-Label multi-language-content content-tr">Toplam Varlıklar</span></td>
        <td class="taxonomy-context-value">100</td>
      </tr>
    `;
    const rows = parseFinancialReportLineItems(html, {
      reportId: 'r1',
      symbol: 'SISE',
      sourceUrl: 'https://www.kap.org.tr/tr/Bildirim/1',
      retrievedAt: '2026-07-19T12:00:00.000Z',
      currency: 'TRY',
      unit: 'TRY',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].raw_label).toBe('Toplam Varlıklar');
  });

  it('parses escaped KAP report rows and title values', () => {
    const html = String.raw`
      \u003ctr class=\"x data-input-row y\"\u003e
        \u003ctd class=\"taxonomy-field-title\"\u003e
          \u003cdiv class=\"gwt-Label multi-language-content content-tr\"\u003eTOPLAM VARLIKLAR\u003c/div\u003e
        \u003c/td\u003e
        \u003ctd class=\"taxonomy-context-value col-order-class-4\"\u003e
          \u003cdiv\u003e\u003cdiv class=\"gwt-Label taxonomy-label-field\" title=\"2158033\"\u003e2.158.033\u003c/div\u003e\u003c/div\u003e
        \u003c/td\u003e
      \u003c/tr\u003e
    `;
    const rows = parseFinancialReportLineItems(html, {
      reportId: 'r1',
      symbol: 'THYAO',
      sourceUrl: 'https://www.kap.org.tr/tr/Bildirim/1598897',
      retrievedAt: '2026-07-19T12:00:00.000Z',
      currency: 'TRY',
      unit: 'TRY',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].raw_label).toBe('TOPLAM VARLIKLAR');
    expect(rows[0].raw_value).toBe('2158033');
  });
});
