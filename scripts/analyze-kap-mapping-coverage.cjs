const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
  DEFAULT_MAPPINGS,
  normalizeRawItems,
} = require('./process-kap-financial-analysis.cjs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function analyzeKapMappingCoverage(input = {}) {
  const supabase = input.supabaseClient;
  if (!supabase) throw new Error('supabaseClient gerekli');

  const limit = input.limit ?? 25;
  const symbols = input.symbols?.length
    ? input.symbols.map((symbol) => String(symbol).toUpperCase())
    : [];

  const reports = await loadReports({ supabase, limit, symbols });
  const unmappedByKey = new Map();
  const summary = [];

  for (const report of reports) {
    const rawItems = await loadRawItems(supabase, report.report_id);
    const normalized = normalizeRawItems({ report, rawItems, mappings: DEFAULT_MAPPINGS });
    summary.push({
      symbol: report.symbol,
      fiscalPeriod: report.fiscal_period,
      reportId: report.report_id,
      rawItemCount: rawItems.length,
      mappedFactCount: normalized.facts.length,
      unmappedCount: normalized.unmappedItems.length,
      coveragePercent: rawItems.length > 0
        ? Math.round(((rawItems.length - normalized.unmappedItems.length) / rawItems.length) * 1000) / 10
        : 0,
    });

    for (const item of normalized.unmappedItems) {
      const key = `${item.statement}|${normalizeLabel(item.raw_label)}`;
      const current = unmappedByKey.get(key) ?? {
        statement: item.statement,
        rawLabel: item.raw_label,
        count: 0,
        symbols: new Set(),
      };
      current.count += 1;
      current.symbols.add(report.symbol);
      unmappedByKey.set(key, current);
    }
  }

  const unmappedTop = [...unmappedByKey.values()]
    .map((item) => ({
      statement: item.statement,
      rawLabel: item.rawLabel,
      count: item.count,
      symbols: [...item.symbols].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.rawLabel.localeCompare(b.rawLabel, 'tr'))
    .slice(0, input.top ?? 30);

  return {
    reportCount: reports.length,
    mappingVersion: DEFAULT_MAPPINGS[0]?.version,
    averageCoveragePercent: summary.length > 0
      ? Math.round((summary.reduce((sum, item) => sum + item.coveragePercent, 0) / summary.length) * 10) / 10
      : 0,
    summary,
    unmappedTop,
  };
}

async function loadReports(input) {
  let pointerQuery = input.supabase
    .from('kap_current_financial_reports')
    .select('symbol,current_report_id,updated_at')
    .order('updated_at', { ascending: false })
    .limit(input.limit);

  if (input.symbols.length > 0) {
    pointerQuery = pointerQuery.in('symbol', input.symbols);
  }

  const { data: pointers, error: pointerError } = await pointerQuery;
  if (pointerError) throw pointerError;

  const reportIds = [...new Set((pointers || []).map((row) => row.current_report_id).filter(Boolean))];
  if (reportIds.length === 0) return [];

  const { data, error } = await input.supabase
    .from('kap_financial_reports')
    .select('*')
    .in('report_id', reportIds);
  if (error) throw error;

  const byId = new Map((data || []).map((report) => [report.report_id, report]));
  return reportIds.map((reportId) => byId.get(reportId)).filter(Boolean);
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

function normalizeLabel(label) {
  return String(label || '')
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
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const topArg = args.find((arg) => arg.startsWith('--top='));
  const symbols = args
    .filter((arg) => !arg.startsWith('--'))
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const result = await analyzeKapMappingCoverage({
    supabaseClient: createSupabaseClientFromEnv(),
    symbols,
    limit: limitArg ? Number(limitArg.split('=')[1]) : 25,
    top: topArg ? Number(topArg.split('=')[1]) : 30,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  analyzeKapMappingCoverage,
};
