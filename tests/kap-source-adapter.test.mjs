import { describe, expect, it } from 'vitest';
import {
  buildHistoricalDisclosureCriteria,
  financialReportFromDisclosure,
  inferStatementKind,
  kapDisclosureFromRaw,
  parseBistCompaniesFromHtml,
  parseFinancialReportLineItems,
  parseKapCompanySearchResults,
} from '../packages/sources/kap/src/index.ts';

describe('KAP source adapter', () => {
  it('builds KAP historical financial disclosure criteria', () => {
    const criteria = buildHistoricalDisclosureCriteria({
      symbol: 'THYAO',
      companyId: 'member-1',
      fromDate: '2026-01-01',
      toDate: '2026-07-19',
    });

    expect(criteria).toMatchObject({
      fromDate: '2026-01-01',
      toDate: '2026-07-19',
      disclosureClass: 'FR',
      mkkMemberOidList: ['member-1'],
      inactiveMkkMemberOidList: [],
      bdkMemberOidList: [],
      fromSrc: false,
      disclosureIndexList: [],
    });
    expect(criteria.subjectList).toHaveLength(1);
  });

  it('parses KAP combined search company results', () => {
    const results = parseKapCompanySearchResults([
      { category: 'other', results: [] },
      {
        category: 'companyOrFunds',
        results: [
          { searchType: 'C', searchValue: 'TURK HAVA YOLLARI A.O.', cmpOrFundCode: 'THYAO', memberOrFundOid: 'oid-thy' },
          { searchType: 'F', searchValue: 'FON', cmpOrFundCode: 'AAA', memberOrFundOid: 'oid-fund' },
        ],
      },
    ]);

    expect(results).toEqual([
      { name: 'TURK HAVA YOLLARI A.O.', ticker: 'THYAO', companyId: 'oid-thy' },
    ]);
  });

  it('parses BIST companies from embedded Next payload', () => {
    const embedded = JSON.stringify(
      '"mkkMemberOid":"oid-1","kapMemberTitle":"ŞİŞE VE CAM FABRİKALARI A.Ş.","relatedMemberTitle":"","stockCode":"SISE","cityName":"İSTANBUL"' +
      '"mkkMemberOid":"oid-2","kapMemberTitle":"TÜRK HAVA YOLLARI A.O.","relatedMemberTitle":"","stockCode":"THYAO, THYAO.P","cityName":"İSTANBUL"',
    );
    const html = `<script>self.__next_f.push([1,${embedded}])</script>`;
    const companies = parseBistCompaniesFromHtml(html);

    expect(companies.map((company) => company.ticker)).toEqual(['SISE', 'THYAO', 'THYAO.P']);
    expect(companies[0].companyId).toBe('oid-1');
  });

  it('normalizes raw KAP disclosure and creates report metadata', () => {
    const disclosure = kapDisclosureFromRaw({
      disclosureIndex: 1478876,
      title: 'Finansal Rapor',
      stockCode: 'THYAO',
      publishDate: '09.05.2026 18:32:00',
      disclosureClass: 'FR',
      year: 2026,
      ruleTypeTerm: '3 Aylık',
    }, 'THYAO');

    expect(disclosure.disclosureId).toBe('1478876');
    expect(disclosure.hasFinancialReport).toBe(true);
    expect(disclosure.publishedAt).toBe('2026-05-09T15:32:00.000Z');

    const report = financialReportFromDisclosure({ disclosure, retrievedAt: '2026-05-09T15:40:00.000Z' });
    expect(report.reportId).toContain('THYAO-2026Q1-1478876');
    expect(report.fiscalQuarter).toBe(1);
    expect(report.sourceUrl).toContain('/tr/Bildirim/1478876');
  });

  it('infers financial statement kind from Turkish labels', () => {
    expect(inferStatementKind('Toplam Varlıklar')).toBe('BALANCE_SHEET');
    expect(inferStatementKind('Net Dönem Karı')).toBe('INCOME_STATEMENT');
    expect(inferStatementKind('İşletme Faaliyetlerinden Nakit Akışları')).toBe('CASH_FLOW');
    expect(inferStatementKind('Banka Kredileri')).toBe('BALANCE_SHEET');
  });

  it('parses raw financial line items from KAP announcement html rows', () => {
    const report = {
      reportId: 'kap-report-sise-2026q2',
      disclosureId: '1478876',
      symbol: 'SISE',
      fiscalYear: 2026,
      fiscalPeriod: '2026Q2',
      periodType: 'CUMULATIVE',
      basis: 'CONSOLIDATED',
      auditStatus: 'UNKNOWN',
      currency: 'TRY',
      unit: 'TRY',
      sourceUrl: 'https://www.kap.org.tr/tr/Bildirim/1478876',
      publishedAt: '2026-07-19T10:00:00.000Z',
      retrievedAt: '2026-07-19T10:05:00.000Z',
    };
    const html = `
      <table>
        <tr class="abc_role_xyz data-input-row presentation-enabled">
          <td><span class="gwt-Label multi-language-content content-tr">Toplam Varlıklar</span></td>
          <td class="taxonomy-context-value">1.234.567,89</td>
        </tr>
        <tr class="abc_role_xyz data-input-row presentation-enabled">
          <td><span class="gwt-Label multi-language-content content-tr">Net Dönem Karı</span></td>
          <td class="taxonomy-context-value">25.000</td>
        </tr>
      </table>
    `;

    const items = parseFinancialReportLineItems(html, report);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      rawLabel: 'Toplam Varlıklar',
      rawValue: '1.234.567,89',
      statement: 'BALANCE_SHEET',
      symbol: 'SISE',
    });
    expect(items[1].statement).toBe('INCOME_STATEMENT');
  });

  it('parses escaped Next payload report rows with title values', () => {
    const report = {
      reportId: 'kap-report-thyao-2026q1',
      disclosureId: '1598897',
      symbol: 'THYAO',
      fiscalYear: 2026,
      fiscalPeriod: '2026Q1',
      periodType: 'CUMULATIVE',
      basis: 'CONSOLIDATED',
      auditStatus: 'UNKNOWN',
      currency: 'TRY',
      unit: 'TRY',
      sourceUrl: 'https://www.kap.org.tr/tr/Bildirim/1598897',
      publishedAt: '2026-04-29T15:20:52.000Z',
      retrievedAt: '2026-07-19T10:05:00.000Z',
    };
    const html = String.raw`
      \u003ctr class=\"general_role_210015-row-129 data-input-row alternate-row presentation-enabled\"\u003e
        \u003ctd class=\"taxonomy-field-title\"\u003e
          \u003cdiv class=\"gwt-Label multi-language-content content-tr\"\u003eTOPLAM VARLIKLAR\u003c/div\u003e
        \u003c/td\u003e
        \u003ctd class=\"taxonomy-context-value col-order-class-4\"\u003e
          \u003cdiv\u003e\u003cdiv class=\"gwt-Label taxonomy-label-field totalLabel containsTotalLabel monetary-field-default\" title=\"2158033\"\u003e2.158.033\u003c/div\u003e\u003c/div\u003e
        \u003c/td\u003e
      \u003c/tr\u003e
    `;

    const items = parseFinancialReportLineItems(html, report);
    expect(items).toHaveLength(1);
    expect(items[0].rawLabel).toBe('TOPLAM VARLIKLAR');
    expect(items[0].rawValue).toBe('2158033');
  });
});
