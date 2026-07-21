import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAPPINGS,
  addDerivedFacts,
  calculateRatios,
  createSnapshot,
  normalizeRawItems,
  validateFacts,
} from '../scripts/process-kap-financial-analysis.cjs';

const report = {
  report_id: 'kap-report-test-2026q1',
  symbol: 'TEST',
  fiscal_year: 2026,
  fiscal_period: '2026Q1',
  fiscal_quarter: 1,
  period_type: 'CUMULATIVE',
  basis: 'CONSOLIDATED',
  audit_status: 'UNKNOWN',
  currency: 'TRY',
  unit: 'TRY',
  source_url: 'https://www.kap.org.tr/tr/Bildirim/1',
  retrieved_at: '2026-07-19T00:00:00.000Z',
  is_restatement: false,
};

function raw(id, statement, label, value) {
  return {
    raw_item_id: id,
    report_id: report.report_id,
    symbol: report.symbol,
    statement,
    raw_label: label,
    raw_value: value,
    currency: 'TRY',
    unit: 'TRY',
    source_url: report.source_url,
    source_timestamp: report.retrieved_at,
  };
}

describe('KAP financial analysis processor', () => {
  it('normalizes current KAP labels and derives debt/EBITDA facts', () => {
    const rawItems = [
      raw('assets', 'BALANCE_SHEET', 'TOPLAM VARLIKLAR', '1000'),
      raw('liab', 'BALANCE_SHEET', 'TOPLAM YÜKÜMLÜLÜKLER', '600'),
      raw('equity', 'BALANCE_SHEET', 'TOPLAM ÖZKAYNAKLAR', '400'),
      raw('current-assets', 'BALANCE_SHEET', 'TOPLAM DÖNEN VARLIKLAR', '300'),
      raw('current-liab', 'BALANCE_SHEET', 'TOPLAM KISA VADELİ YÜKÜMLÜLÜKLER', '150'),
      raw('short-debt', 'BALANCE_SHEET', 'Kısa Vadeli Borçlanmalar', '70'),
      raw('current-long-debt', 'BALANCE_SHEET', 'Uzun Vadeli Borçlanmaların Kısa Vadeli Kısımları', '90'),
      raw('long-debt', 'BALANCE_SHEET', 'Uzun Vadeli Borçlanmalar', '240'),
      raw('cash', 'CASH_FLOW', 'Nakit ve Nakit Benzerleri', '120'),
      raw('cash-begin', 'CASH_FLOW', 'DÖNEM BAŞI NAKİT VE NAKİT BENZERLERİ', '80'),
      raw('cash-change', 'CASH_FLOW', 'NAKİT VE NAKİT BENZERLERİNDEKİ NET ARTIŞ (AZALIŞ)', '40'),
      raw('cash-end', 'CASH_FLOW', 'DÖNEM SONU NAKİT VE NAKİT BENZERLERİ', '120'),
      raw('ocf', 'CASH_FLOW', 'İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI', '95'),
      raw('icf', 'CASH_FLOW', 'YATIRIM FAALİYETLERİNDEN KAYNAKLANAN NAKİT AKIŞLARI', '-25'),
      raw('sales', 'INCOME_STATEMENT', 'Hasılat', '500'),
      raw('gross', 'INCOME_STATEMENT', 'BRÜT KAR (ZARAR)', '180'),
      raw('op', 'INCOME_STATEMENT', 'ESAS FAALİYET KARI (ZARARI)', '90'),
      raw('net', 'INCOME_STATEMENT', 'DÖNEM KARI (ZARARI)', '70'),
      raw('net-zero-duplicate', 'INCOME_STATEMENT', 'Dönem Karı (Zararı)', '0'),
      raw('da', 'INCOME_STATEMENT', 'Amortisman ve İtfa Gideri İle İlgili Düzeltmeler', '20'),
    ];

    const normalized = normalizeRawItems({ report, rawItems, mappings: DEFAULT_MAPPINGS });
    const facts = addDerivedFacts({ report, facts: normalized.facts });

    expect(facts.find((fact) => fact.standard_code === 'total_assets').normalized_value).toBe(1000);
    expect(facts.filter((fact) => fact.standard_code === 'net_income')).toHaveLength(1);
    expect(facts.find((fact) => fact.standard_code === 'net_income').normalized_value).toBe(70);
    expect(facts.find((fact) => fact.standard_code === 'total_debt').normalized_value).toBe(400);
    expect(facts.find((fact) => fact.standard_code === 'ebitda').normalized_value).toBe(110);

    const validation = validateFacts({ report, facts, normalizationIssues: normalized.issues });
    expect(validation.passed).toBe(true);

    const ratios = calculateRatios({ report, facts, calculatedAt: validation.validated_at });
    expect(ratios.ratios.gross_margin).toBe(0.36);
    expect(ratios.ratios.current_ratio).toBe(2);
    expect(ratios.ratios.net_debt_to_ebitda).toBeCloseTo(2.5455, 4);

    const snapshot = createSnapshot({ report, facts, validation, ratios });
    expect(snapshot.readiness).toBe('READY_FOR_ANALYSIS');
  });

  it('covers common BIST industrial KAP label variants', () => {
    const rawItems = [
      raw('cash-bs', 'BALANCE_SHEET', 'Nakit ve Nakit Benzerleri', '125'),
      raw('receivables', 'BALANCE_SHEET', 'Ticari Alacaklar', '210'),
      raw('inventories', 'BALANCE_SHEET', 'Stoklar', '180'),
      raw('ppe', 'BALANCE_SHEET', 'Maddi Duran Varlıklar', '600'),
      raw('intangibles', 'BALANCE_SHEET', 'Maddi Olmayan Duran Varlıklar', '45'),
      raw('capital', 'BALANCE_SHEET', 'Ödenmiş Sermaye', '100'),
      raw('bank-loans', 'BALANCE_SHEET', 'Banka Kredileri', '200'),
      raw('lease-liabilities', 'BALANCE_SHEET', 'Kiralama İşlemlerinden Borçlar', '75'),
      raw('issued-debt', 'BALANCE_SHEET', 'İhraç Edilmiş Borçlanma Araçları', '45'),
      raw('sales-net', 'INCOME_STATEMENT', 'Net Satışlar', '900'),
      raw('cogs', 'INCOME_STATEMENT', 'Satışların Maliyeti (-)', '-620'),
      raw('ga', 'INCOME_STATEMENT', 'Genel Yönetim Giderleri', '-45'),
      raw('marketing', 'INCOME_STATEMENT', 'Pazarlama, Satış ve Dağıtım Giderleri', '-35'),
      raw('rd', 'INCOME_STATEMENT', 'Araştırma ve Geliştirme Giderleri', '-12'),
      raw('finance-expense', 'INCOME_STATEMENT', 'Finansman Giderleri', '-80'),
      raw('tax', 'INCOME_STATEMENT', 'Vergi Gideri/Geliri', '-18'),
      raw('ebitda-direct', 'INCOME_STATEMENT', 'FAVÖK', '155'),
      raw('capex', 'CASH_FLOW', 'Maddi ve Maddi Olmayan Duran Varlık Alımları', '-70'),
      raw('financing-cf', 'CASH_FLOW', 'Finansman Faaliyetlerinden Kaynaklanan Nakit Akışları', '-25'),
    ];

    const normalized = normalizeRawItems({ report, rawItems, mappings: DEFAULT_MAPPINGS });
    const facts = addDerivedFacts({ report, facts: normalized.facts });
    const codes = facts.map((fact) => fact.standard_code);

    expect(normalized.unmappedItems).toHaveLength(0);
    expect(facts.find((fact) => fact.standard_code === 'total_debt').normalized_value).toBe(320);
    expect(codes).toEqual(expect.arrayContaining([
      'cash_and_equivalents',
      'trade_receivables',
      'inventories',
      'property_plant_equipment',
      'intangible_assets',
      'paid_in_capital',
      'bank_loans',
      'lease_liabilities',
      'issued_debt_securities',
      'total_debt',
      'net_sales',
      'cost_of_sales',
      'general_admin_expenses',
      'marketing_expenses',
      'research_development_expenses',
      'finance_expense',
      'tax_expense',
      'ebitda',
      'capex',
      'financing_cash_flow',
    ]));
  });
});
