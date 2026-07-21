const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_MAPPING_VERSION = 'kap-industrial-default-v2';

const DEFAULT_MAPPINGS = [
  ['BALANCE_SHEET', 'total_assets', 'Toplam varliklar', '^toplam varliklar$'],
  ['BALANCE_SHEET', 'total_liabilities', 'Toplam yukumlulukler', '^toplam yukumlulukler$'],
  ['BALANCE_SHEET', 'total_equity', 'Toplam ozkaynaklar', '^toplam ozkaynaklar$'],
  ['BALANCE_SHEET', 'current_assets', 'Donen varliklar', '^toplam donen varliklar$'],
  ['BALANCE_SHEET', 'current_liabilities', 'Kisa vadeli yukumlulukler', '^toplam kisa vadeli yukumlulukler$'],
  ['BALANCE_SHEET', 'short_term_borrowings', 'Kisa vadeli borclanmalar', '^kisa vadeli borclanmalar$'],
  ['BALANCE_SHEET', 'current_portion_long_debt', 'Uzun vadeli borclanmalarin kisa vadeli kisimlari', '^uzun vadeli borclanmalarin kisa vadeli kisimlari$'],
  ['BALANCE_SHEET', 'long_term_borrowings', 'Uzun vadeli borclanmalar', '^uzun vadeli borclanmalar$'],
  ['CASH_FLOW', 'cash_and_equivalents', 'Nakit ve nakit benzerleri', '^nakit ve nakit benzerleri$'],
  ['CASH_FLOW', 'cash_begin', 'Donem basi nakit ve nakit benzerleri', '^donem basi nakit ve nakit benzerleri$'],
  ['CASH_FLOW', 'cash_end', 'Donem sonu nakit ve nakit benzerleri', '^donem sonu nakit ve nakit benzerleri$'],
  ['CASH_FLOW', 'net_change_cash', 'Nakit ve nakit benzerlerindeki net artis azalis', '^nakit ve nakit benzerlerindeki net artis.*azalis$'],
  ['CASH_FLOW', 'operating_cash_flow', 'Isletme faaliyetlerinden nakit akislari', '^isletme faaliyetlerinden nakit akislari$'],
  ['CASH_FLOW', 'investing_cash_flow', 'Yatirim faaliyetlerinden kaynaklanan nakit akislari', '^yatirim faaliyetlerinden kaynaklanan nakit akislari$'],
  ['INCOME_STATEMENT', 'net_sales', 'Hasilat', '^hasilat$'],
  ['INCOME_STATEMENT', 'gross_profit', 'Brut kar zarar', '^brut kar.*zarar$'],
  ['INCOME_STATEMENT', 'operating_profit', 'Esas faaliyet kari zarari', '^esas faaliyet kari.*zarari$'],
  ['INCOME_STATEMENT', 'pre_finance_operating_profit', 'Finansman gideri oncesi faaliyet kari zarari', '^finansman geliri.*gideri.*oncesi faaliyet kari.*zarari$'],
  ['INCOME_STATEMENT', 'net_income', 'Donem kari zarari', '^donem kari.*zarari$'],
  ['INCOME_STATEMENT', 'depreciation_amortization', 'Amortisman ve itfa gideri', '^amortisman ve itfa gideri.*duzeltmeler$'],
  ['BALANCE_SHEET', 'cash_and_equivalents', 'Nakit ve nakit benzerleri', '^nakit ve nakit benzerleri$'],
  ['BALANCE_SHEET', 'trade_receivables', 'Ticari alacaklar', '^ticari alacaklar$'],
  ['BALANCE_SHEET', 'inventories', 'Stoklar', '^stoklar$'],
  ['BALANCE_SHEET', 'property_plant_equipment', 'Maddi duran varliklar', '^maddi duran varliklar$'],
  ['BALANCE_SHEET', 'intangible_assets', 'Maddi olmayan duran varliklar', '^maddi olmayan duran varliklar$'],
  ['BALANCE_SHEET', 'paid_in_capital', 'Odenmis sermaye', '^odenmis sermaye$'],
  ['BALANCE_SHEET', 'retained_earnings', 'Gecmis yillar karlari zararlari', '^gecmis yillar kar.*zarar.*$'],
  ['BALANCE_SHEET', 'total_debt', 'Finansal borclar', '^(finansal borclar|toplam finansal borc.*)$'],
  ['BALANCE_SHEET', 'bank_loans', 'Banka kredileri', '^banka kredileri$'],
  ['BALANCE_SHEET', 'lease_liabilities', 'Kiralama islemlerinden borclar', '^kiralama islemlerinden borclar$'],
  ['BALANCE_SHEET', 'issued_debt_securities', 'Ihrac edilmis borclanma araclari', '^ihrac edilmis borclanma araclari$'],
  ['BALANCE_SHEET', 'trade_payables', 'Ticari borclar', '^ticari borclar$'],
  ['BALANCE_SHEET', 'other_receivables', 'Diger alacaklar', '^diger alacaklar$'],
  ['BALANCE_SHEET', 'other_payables', 'Diger borclar', '^diger borclar$'],
  ['BALANCE_SHEET', 'financial_investments', 'Finansal yatirimlar', '^finansal yatirimlar$'],
  ['CASH_FLOW', 'capex', 'Yatirim harcamalari', '^(yatirim harcamalari|maddi ve maddi olmayan duran varlik alimlari|maddi duran varlik alimlari)$'],
  ['CASH_FLOW', 'financing_cash_flow', 'Finansman faaliyetlerinden nakit akislari', '^finansman faaliyetlerinden kaynaklanan nakit akislari$'],
  ['INCOME_STATEMENT', 'net_sales', 'Net satislar', '^(net satislar|satis gelirleri)$'],
  ['INCOME_STATEMENT', 'cost_of_sales', 'Satislarin maliyeti', '^satislarin maliyeti.*$'],
  ['INCOME_STATEMENT', 'general_admin_expenses', 'Genel yonetim giderleri', '^genel yonetim giderleri$'],
  ['INCOME_STATEMENT', 'marketing_expenses', 'Pazarlama giderleri', '^pazarlama.*giderleri$'],
  ['INCOME_STATEMENT', 'research_development_expenses', 'Arastirma gelistirme giderleri', '^arastirma.*gelistirme giderleri$'],
  ['INCOME_STATEMENT', 'finance_income', 'Finansman gelirleri', '^finansman gelirleri$'],
  ['INCOME_STATEMENT', 'finance_expense', 'Finansman giderleri', '^finansman giderleri$'],
  ['INCOME_STATEMENT', 'tax_expense', 'Vergi gideri geliri', '^vergi.*gideri.*geliri.*$'],
  ['INCOME_STATEMENT', 'ebitda', 'FAVOK', '^(favok|favok.*)$'],
].map(([statement, standardCode, standardLabel, rawLabelPattern], index) => ({
  mapping_id: `kap-default-${standardCode}-${index}`,
  statement,
  standard_code: standardCode,
  standard_label: standardLabel,
  raw_label_pattern: rawLabelPattern,
  company_profile: 'INDUSTRIAL',
  multiplier: null,
  confidence: 0.92,
  version: DEFAULT_MAPPING_VERSION,
  is_active: true,
}));

async function processKapFinancialAnalysis(input) {
  const supabase = input.supabaseClient;
  if (!supabase) throw new Error('supabaseClient gerekli');

  const symbols = input.symbols?.length
    ? input.symbols.map((symbol) => String(symbol).toUpperCase())
    : await loadCurrentSymbols(supabase, input.limit ?? 25);

  await seedDefaultMappings(supabase);

  const results = [];
  for (const symbol of symbols.slice(0, input.limit ?? symbols.length)) {
    results.push(await processSymbol({ supabase, symbol, force: Boolean(input.force) }));
  }

  return {
    success: results.every((result) => result.success),
    count: results.length,
    results,
  };
}

async function processSymbol(input) {
  const { supabase, symbol } = input;
  try {
    const pointer = await loadCurrentPointer(supabase, symbol);
    if (!pointer?.current_report_id) return { success: false, symbol, action: 'NO_CURRENT_REPORT' };

    const report = await loadReport(supabase, pointer.current_report_id);
    if (!report) return { success: false, symbol, action: 'REPORT_NOT_FOUND', reportId: pointer.current_report_id };

    const existingSnapshot = await hasAnalysisSnapshot(supabase, report.report_id);
    if (existingSnapshot && !input.force) {
      return { success: true, symbol, action: 'SKIPPED_EXISTING_ANALYSIS', reportId: report.report_id };
    }

    const [rawItems, mappings] = await Promise.all([
      loadRawItems(supabase, report.report_id),
      loadMappings(supabase),
    ]);
    const normalization = normalizeRawItems({ report, rawItems, mappings });
    const facts = addDerivedFacts({ report, facts: normalization.facts });

    await insertFactsIgnoreDuplicates(supabase, facts);

    const validation = validateFacts({ report, facts, normalizationIssues: normalization.issues });
    await insertValidation(supabase, validation);

    const ratios = calculateRatios({ report, facts, calculatedAt: validation.validated_at });
    await insertRatios(supabase, ratios);

    const snapshot = createSnapshot({ report, facts, validation, ratios });
    await insertSnapshot(supabase, snapshot);

    return {
      success: true,
      symbol,
      action: 'ANALYSIS_CREATED',
      reportId: report.report_id,
      rawItemCount: rawItems.length,
      factCount: facts.length,
      unmappedCount: normalization.unmappedItems.length,
      validationPassed: validation.passed,
      readiness: snapshot.readiness,
      qualityFlags: ratios.quality_flags,
    };
  } catch (error) {
    return {
      success: false,
      symbol,
      action: 'ANALYSIS_ERROR',
      error: error.message,
    };
  }
}

async function seedDefaultMappings(supabase) {
  const { error } = await supabase.from('financial_line_item_mappings').upsert(DEFAULT_MAPPINGS, {
    onConflict: 'mapping_id',
  });
  if (error) throw error;
}

async function loadCurrentSymbols(supabase, limit) {
  const { data, error } = await supabase
    .from('kap_current_financial_reports')
    .select('symbol')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return [...new Set((data || []).map((row) => row.symbol).filter(Boolean))];
}

async function loadCurrentPointer(supabase, symbol) {
  const { data, error } = await supabase
    .from('kap_current_financial_reports')
    .select('*')
    .eq('symbol', symbol)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadReport(supabase, reportId) {
  const { data, error } = await supabase
    .from('kap_financial_reports')
    .select('*')
    .eq('report_id', reportId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadRawItems(supabase, reportId) {
  const { data, error } = await supabase
    .from('kap_raw_financial_items')
    .select('*')
    .eq('report_id', reportId)
    .not('raw_value', 'is', null)
    .order('raw_item_id', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadMappings(supabase) {
  const { data, error } = await supabase
    .from('financial_line_item_mappings')
    .select('*')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

async function hasAnalysisSnapshot(supabase, reportId) {
  const { count, error } = await supabase
    .from('company_analysis_snapshots')
    .select('*', { count: 'exact', head: true })
    .contains('raw', { report_id: reportId });
  if (error) throw error;
  return (count || 0) > 0;
}

function normalizeRawItems(input) {
  const facts = [];
  const unmappedItems = [];
  const issues = [];
  const seenByCode = new Set();

  for (const item of input.rawItems) {
    const rawValue = coerceFinancialNumber(item.raw_value);
    if (rawValue === null) {
      issues.push(issue('WARN', 'NON_NUMERIC_RAW_VALUE', `${item.raw_label} sayisal degere donusturulemedi.`, [item.raw_item_id]));
      continue;
    }

    const mapping = findMapping(item, input.mappings);
    if (!mapping) {
      unmappedItems.push(item);
      continue;
    }

    const uniqueKey = `${mapping.standard_code}|${rawValue}`;
    if (seenByCode.has(uniqueKey)) continue;
    seenByCode.add(uniqueKey);

    const multiplier = Number(mapping.multiplier || unitMultiplier(item.unit || input.report.unit));
    const normalizedValue = rawValue * multiplier;
    facts.push({
      fact_id: `${input.report.report_id}-${mapping.standard_code}-${item.raw_item_id}`.replace(/[^a-zA-Z0-9_.-]/g, '-'),
      report_id: input.report.report_id,
      raw_item_id: item.raw_item_id,
      symbol: input.report.symbol,
      fiscal_year: input.report.fiscal_year,
      fiscal_period: input.report.fiscal_period,
      fiscal_quarter: input.report.fiscal_quarter,
      period_type: input.report.period_type,
      basis: input.report.basis,
      statement: item.statement,
      standard_code: mapping.standard_code,
      standard_label: mapping.standard_label,
      raw_label: item.raw_label,
      raw_value: rawValue,
      normalized_value: normalizedValue,
      currency: item.currency || input.report.currency,
      unit: item.unit || input.report.unit,
      audit_status: input.report.audit_status,
      source_url: item.source_url || input.report.source_url,
      source_timestamp: item.source_timestamp || input.report.retrieved_at,
      confidence: Math.max(0, Math.min(1, Number(mapping.confidence || 0))),
      mapping_version: mapping.version,
      restated: Boolean(input.report.is_restatement),
      raw: {
        mapping_id: mapping.mapping_id,
        source: 'kap-financial-analysis-processor',
      },
    });
  }

  return { facts: selectPreferredFacts(facts), unmappedItems, issues };
}

function selectPreferredFacts(facts) {
  const selected = new Map();
  for (const fact of facts) {
    const current = selected.get(fact.standard_code);
    if (!current || isPreferredFact(fact, current)) {
      selected.set(fact.standard_code, fact);
    }
  }
  return [...selected.values()];
}

function isPreferredFact(candidate, current) {
  const candidateAbs = Math.abs(candidate.normalized_value);
  const currentAbs = Math.abs(current.normalized_value);
  if (currentAbs === 0 && candidateAbs !== 0) return true;
  if (candidateAbs === 0 && currentAbs !== 0) return false;
  if (candidate.confidence !== current.confidence) return candidate.confidence > current.confidence;
  return String(candidate.raw_label).length < String(current.raw_label).length;
}

function addDerivedFacts(input) {
  const facts = [...input.facts];
  const byCode = groupByCode(facts);
  const components = [
    'short_term_borrowings',
    'current_portion_long_debt',
    'long_term_borrowings',
    'bank_loans',
    'lease_liabilities',
    'issued_debt_securities',
  ]
    .map((code) => firstFact(byCode, code))
    .filter(Boolean);
  if (components.length >= 2 && !firstFact(byCode, 'total_debt')) {
    const value = components.reduce((sum, fact) => sum + fact.normalized_value, 0);
    facts.push({
      ...components[0],
      fact_id: `${input.report.report_id}-derived-total_debt`,
      raw_item_id: components.map((fact) => fact.raw_item_id).join('|'),
      standard_code: 'total_debt',
      standard_label: 'Toplam finansal borc',
      raw_label: 'Derived: short_term_borrowings + current_portion_long_debt + long_term_borrowings',
      raw_value: value,
      normalized_value: value,
      confidence: Math.min(...components.map((fact) => fact.confidence), 0.9),
      mapping_version: `${DEFAULT_MAPPING_VERSION}:derived`,
      raw: {
        source: 'kap-financial-analysis-processor',
        derived_from_fact_ids: components.map((fact) => fact.fact_id),
      },
    });
  }

  const depreciation = firstFact(byCode, 'depreciation_amortization');
  const operatingProfit = firstFact(byCode, 'operating_profit');
  if (depreciation && operatingProfit && !firstFact(byCode, 'ebitda')) {
    const value = operatingProfit.normalized_value + Math.abs(depreciation.normalized_value);
    facts.push({
      ...operatingProfit,
      fact_id: `${input.report.report_id}-derived-ebitda`,
      raw_item_id: `${operatingProfit.raw_item_id}|${depreciation.raw_item_id}`,
      standard_code: 'ebitda',
      standard_label: 'FAVOK yaklasik',
      raw_label: 'Derived: operating_profit + depreciation_amortization',
      raw_value: value,
      normalized_value: value,
      confidence: Math.min(operatingProfit.confidence, depreciation.confidence, 0.78),
      mapping_version: `${DEFAULT_MAPPING_VERSION}:derived`,
      raw: {
        source: 'kap-financial-analysis-processor',
        derived_from_fact_ids: [operatingProfit.fact_id, depreciation.fact_id],
        caveat: 'Approximate EBITDA derived from operating profit plus depreciation/amortization adjustment.',
      },
    });
  }

  return facts;
}

function validateFacts(input) {
  const issues = [...input.normalizationIssues];
  const facts = input.facts;
  const byCode = groupByCode(facts);
  const basisSet = new Set(facts.map((fact) => fact.basis));
  const currencySet = new Set(facts.map((fact) => fact.currency));
  const reportSet = new Set(facts.map((fact) => fact.report_id));
  const periodSet = new Set(facts.map((fact) => fact.fiscal_period));

  if (facts.length === 0) issues.push(issue('BLOCKER', 'NO_NORMALIZED_FACTS', 'Normalize edilebilir finansal kalem bulunamadi.', []));
  if (basisSet.size > 1) issues.push(issue('BLOCKER', 'MIXED_REPORT_BASIS', 'Solo ve konsolide finansallar ayni analiz setinde karistirildi.', facts.map((fact) => fact.fact_id)));
  if (currencySet.size > 1) issues.push(issue('ERROR', 'MIXED_CURRENCY', 'Finansal kalemlerde birden fazla para birimi var.', facts.map((fact) => fact.fact_id)));
  if (reportSet.size > 1 || periodSet.size > 1) issues.push(issue('ERROR', 'MIXED_PERIOD_OR_REPORT', 'Tek dogrulama seti tek rapor ve tek donemden olusmali.', facts.map((fact) => fact.fact_id)));

  const totalAssets = firstFact(byCode, 'total_assets');
  const totalLiabilities = firstFact(byCode, 'total_liabilities');
  const totalEquity = firstFact(byCode, 'total_equity');
  if (totalAssets && totalLiabilities && totalEquity) {
    const expected = totalLiabilities.normalized_value + totalEquity.normalized_value;
    const tolerance = financialTolerance(totalAssets.normalized_value);
    if (Math.abs(totalAssets.normalized_value - expected) > tolerance) {
      issues.push(issue('BLOCKER', 'BALANCE_SHEET_EQUATION_FAILED', 'Bilanco denkligi tutmuyor: varliklar = yukumlulukler + ozkaynak.', [totalAssets.fact_id, totalLiabilities.fact_id, totalEquity.fact_id], expected, totalAssets.normalized_value, tolerance));
    }
  } else if (facts.some((fact) => fact.statement === 'BALANCE_SHEET')) {
    issues.push(issue('ERROR', 'BALANCE_SHEET_EQUATION_INCOMPLETE', 'Bilanco denkligi icin total_assets, total_liabilities ve total_equity kalemleri gerekli.', [totalAssets, totalLiabilities, totalEquity].filter(Boolean).map((fact) => fact.fact_id)));
  }

  const cashBegin = firstFact(byCode, 'cash_begin');
  const cashEnd = firstFact(byCode, 'cash_end') || firstFact(byCode, 'cash_and_equivalents');
  const netChangeCash = firstFact(byCode, 'net_change_cash');
  if (cashBegin && cashEnd && netChangeCash) {
    const expected = cashBegin.normalized_value + netChangeCash.normalized_value;
    const tolerance = financialTolerance(cashEnd.normalized_value);
    if (Math.abs(cashEnd.normalized_value - expected) > tolerance) {
      issues.push(issue('ERROR', 'CASH_RECONCILIATION_FAILED', 'Nakit akisi mutabakati tutmuyor: donem basi nakit + net degisim = donem sonu nakit.', [cashBegin.fact_id, netChangeCash.fact_id, cashEnd.fact_id], expected, cashEnd.normalized_value, tolerance));
    }
  }

  for (const fact of facts) {
    if (fact.confidence < 0.7) issues.push(issue('WARN', 'LOW_MAPPING_CONFIDENCE', `${fact.standard_code} esleme guveni dusuk.`, [fact.fact_id]));
    if (fact.currency !== input.report.currency) issues.push(issue('ERROR', 'FACT_REPORT_CURRENCY_MISMATCH', `${fact.standard_code} para birimi rapor para birimi ile uyumsuz.`, [fact.fact_id]));
  }

  const blockingIssues = issues.filter((item) => item.severity === 'BLOCKER' || item.severity === 'ERROR');
  const validatedAt = new Date().toISOString();
  return {
    report_id: input.report.report_id,
    symbol: input.report.symbol,
    passed: blockingIssues.length === 0,
    blocking_issues: blockingIssues,
    issues,
    validated_at: validatedAt,
    raw: {
      report_id: input.report.report_id,
      fact_count: facts.length,
      source: 'kap-financial-analysis-processor',
    },
  };
}

function calculateRatios(input) {
  const byCode = groupByCode(input.facts);
  const qualityFlags = [];
  const value = (code) => firstFact(byCode, code)?.normalized_value ?? null;
  const ratio = (numerator, denominator, code) => {
    if (numerator === null || denominator === null || denominator === 0) {
      qualityFlags.push(`${code}_missing_or_zero_input`);
      return null;
    }
    return roundFinancial(numerator / denominator, 4);
  };

  const totalAssets = value('total_assets');
  const totalLiabilities = value('total_liabilities');
  const totalEquity = value('total_equity');
  const currentAssets = value('current_assets');
  const currentLiabilities = value('current_liabilities');
  const cash = value('cash_and_equivalents') ?? value('cash_end');
  const totalDebt = value('total_debt');
  const netSales = value('net_sales');
  const grossProfit = value('gross_profit');
  const operatingProfit = value('operating_profit');
  const netIncome = value('net_income');
  const operatingCashFlow = value('operating_cash_flow');
  const investingCashFlow = value('investing_cash_flow');
  const capex = value('capex');
  const ebitda = value('ebitda');
  const freeCashFlow = operatingCashFlow === null
    ? null
    : capex === null
      ? operatingCashFlow + Math.min(0, investingCashFlow ?? 0)
      : operatingCashFlow - Math.abs(capex);
  const netDebt = totalDebt === null ? null : totalDebt - (cash ?? 0);

  if (freeCashFlow === null) qualityFlags.push('free_cash_flow_missing_input');
  if (netDebt === null) qualityFlags.push('net_debt_missing_input');

  return {
    symbol: input.report.symbol,
    fiscal_period: input.report.fiscal_period,
    basis: input.report.basis,
    currency: input.report.currency,
    ratios: {
      gross_margin: ratio(grossProfit, netSales, 'gross_margin'),
      operating_margin: ratio(operatingProfit, netSales, 'operating_margin'),
      net_margin: ratio(netIncome, netSales, 'net_margin'),
      roe: ratio(netIncome, totalEquity, 'roe'),
      roa: ratio(netIncome, totalAssets, 'roa'),
      debt_to_assets: ratio(totalLiabilities, totalAssets, 'debt_to_assets'),
      debt_to_equity: ratio(totalDebt, totalEquity, 'debt_to_equity'),
      current_ratio: ratio(currentAssets, currentLiabilities, 'current_ratio'),
      cash_ratio: ratio(cash, currentLiabilities, 'cash_ratio'),
      ocf_to_net_income: ratio(operatingCashFlow, netIncome, 'ocf_to_net_income'),
      fcf_margin: ratio(freeCashFlow, netSales, 'fcf_margin'),
      net_debt_to_ebitda: ratio(netDebt, ebitda, 'net_debt_to_ebitda'),
      asset_turnover: ratio(netSales, totalAssets, 'asset_turnover'),
    },
    quality_flags: [...new Set(qualityFlags)],
    calculated_at: input.calculatedAt || new Date().toISOString(),
    raw: {
      report_id: input.report.report_id,
      source: 'kap-financial-analysis-processor',
    },
  };
}

function createSnapshot(input) {
  const blockingReasons = input.validation.blocking_issues.map((item) => item.message);
  const readiness = blockingReasons.length > 0
    ? 'BLOCKED'
    : input.ratios.quality_flags.length > 4
      ? 'PARTIAL_DATA'
      : 'READY_FOR_ANALYSIS';

  return {
    symbol: input.report.symbol,
    fiscal_period: input.report.fiscal_period,
    basis: input.report.basis,
    readiness,
    blocking_reasons: blockingReasons,
    ratios: input.ratios,
    validation: input.validation,
    raw: {
      report_id: input.report.report_id,
      fact_count: input.facts.length,
      source: 'kap-financial-analysis-processor',
    },
  };
}

async function insertFactsIgnoreDuplicates(supabase, facts) {
  if (facts.length === 0) return;
  const reportId = facts[0].report_id;
  const { data: existingRows, error: existingError } = await supabase
    .from('normalized_financial_facts')
    .select('fact_id')
    .eq('report_id', reportId);
  if (existingError) throw existingError;
  const existingIds = new Set((existingRows || []).map((row) => row.fact_id));
  const missing = facts.filter((fact) => !existingIds.has(fact.fact_id));
  for (let index = 0; index < missing.length; index += 100) {
    const { error } = await supabase.from('normalized_financial_facts').insert(missing.slice(index, index + 100));
    if (error) throw error;
  }
}

async function insertValidation(supabase, validation) {
  const { error } = await supabase.from('financial_validation_results').insert(validation);
  if (error) throw error;
}

async function insertRatios(supabase, ratios) {
  const { error } = await supabase.from('company_financial_ratios').insert(ratios);
  if (error) throw error;
}

async function insertSnapshot(supabase, snapshot) {
  const { error } = await supabase.from('company_analysis_snapshots').insert(snapshot);
  if (error) throw error;
}

function findMapping(item, mappings) {
  const normalizedLabel = normalizeText(item.raw_label);
  return mappings
    .filter((mapping) => mapping.statement === item.statement)
    .filter((mapping) => !mapping.company_profile || mapping.company_profile === 'INDUSTRIAL')
    .filter((mapping) => mapping.raw_label_pattern && new RegExp(mapping.raw_label_pattern, 'i').test(normalizedLabel))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];
}

function groupByCode(facts) {
  const grouped = new Map();
  for (const fact of facts) {
    const list = grouped.get(fact.standard_code) || [];
    list.push(fact);
    grouped.set(fact.standard_code, list);
  }
  return grouped;
}

function firstFact(grouped, code) {
  return grouped.get(code)?.[0];
}

function issue(severity, code, message, factIds, expectedValue, actualValue, tolerance) {
  return {
    issueId: `fin-issue-${code}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    severity,
    code,
    message,
    factIds,
    expectedValue,
    actualValue,
    tolerance,
  };
}

function coerceFinancialNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/^\((.*)\)$/, '-$1');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitMultiplier(unit) {
  const normalized = String(unit || '').toUpperCase();
  if (normalized === 'THOUSAND_TRY' || normalized === 'BIN_TL' || normalized === 'THOUSAND') return 1000;
  if (normalized === 'MILLION_TRY' || normalized === 'MILYON_TL' || normalized === 'MILLION') return 1000000;
  return 1;
}

function financialTolerance(referenceValue) {
  return Math.max(10, Math.abs(referenceValue) * 0.001);
}

function roundFinancial(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function createSupabaseClientFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('force');
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 25;
  const symbols = args
    .filter((arg) => !arg.startsWith('--'))
    .filter((arg) => arg !== 'force')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const result = await processKapFinancialAnalysis({
    supabaseClient: createSupabaseClientFromEnv(),
    symbols,
    limit,
    force,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_MAPPINGS,
  processKapFinancialAnalysis,
  normalizeRawItems,
  addDerivedFacts,
  validateFacts,
  calculateRatios,
  createSnapshot,
};
