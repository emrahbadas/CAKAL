const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { parseFinancialReportLineItems } = require('./kap-sync-worker.cjs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function reparseCurrentKapReport(input) {
  const symbols = input.symbols.map((symbol) => String(symbol).toUpperCase());
  const results = [];
  for (const symbol of symbols) {
    results.push(await reparseSymbol({ ...input, symbol }));
  }
  return {
    success: results.every((result) => result.success),
    count: results.length,
    results,
  };
}

async function reparseSymbol(input) {
  const { supabaseClient: supabase, symbol, fetchImpl = fetch } = input;
  const { data: pointer, error: pointerError } = await supabase
    .from('kap_current_financial_reports')
    .select('*')
    .eq('symbol', symbol)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pointerError) throw pointerError;
  if (!pointer?.current_report_id) {
    return { success: false, symbol, action: 'NO_CURRENT_REPORT' };
  }

  const { data: currentReport, error: reportError } = await supabase
    .from('kap_financial_reports')
    .select('*')
    .eq('report_id', pointer.current_report_id)
    .maybeSingle();
  if (reportError) throw reportError;
  if (!currentReport?.source_url) {
    return { success: false, symbol, action: 'CURRENT_REPORT_MISSING_SOURCE_URL' };
  }

  const nextVersion = Number(currentReport.version || pointer.version || 1) + 1;
  const nextReportId = `${currentReport.report_id}-parser-v${nextVersion}`;
  const { data: existing } = await supabase
    .from('kap_financial_reports')
    .select('report_id')
    .eq('report_id', nextReportId)
    .maybeSingle();
  if (existing) {
    return { success: true, symbol, action: 'ALREADY_REPARSED', reportId: nextReportId };
  }

  const response = await fetchImpl(currentReport.source_url, {
    method: 'GET',
    headers: {
      Accept: 'text/html, */*;q=0.8',
      'User-Agent': 'CakalKapReparse/1.0',
    },
  });
  if (!response.ok) throw new Error(`KAP report page failed: ${response.status} ${response.statusText}`);

  const checkedAt = new Date().toISOString();
  const html = await response.text();
  const rawItems = parseFinancialReportLineItems(html, {
    reportId: nextReportId,
    symbol,
    sourceUrl: currentReport.source_url,
    retrievedAt: checkedAt,
    currency: currentReport.currency,
    unit: currentReport.unit,
  });
  const valuedCount = rawItems.filter((item) => item.raw_value !== null && item.raw_value !== undefined && item.raw_value !== '').length;

  const nextReport = {
    ...withoutGeneratedColumns(currentReport),
    report_id: nextReportId,
    version: nextVersion,
    replaces_report_id: currentReport.report_id,
    retrieved_at: checkedAt,
    fetched_at: checkedAt,
    last_checked_at: checkedAt,
    validation_status: 'pending',
    validation_errors: [],
    raw: {
      ...(currentReport.raw || {}),
      parser_correction: true,
      parser_correction_reason: 'escaped_next_payload_and_nested_table_rows',
      previous_report_id: currentReport.report_id,
    },
  };

  const { error: insertReportError } = await supabase.from('kap_financial_reports').insert(nextReport);
  if (insertReportError) throw insertReportError;

  for (let index = 0; index < rawItems.length; index += 100) {
    const { error } = await supabase.from('kap_raw_financial_items').insert(rawItems.slice(index, index + 100));
    if (error) throw error;
  }

  const { error: pointerUpdateError } = await supabase.from('kap_current_financial_reports').upsert({
    ...pointer,
    current_report_id: nextReportId,
    version: nextVersion,
    updated_at: checkedAt,
    raw: {
      ...(pointer.raw || {}),
      parser_correction: true,
      previous_report_id: currentReport.report_id,
    },
  }, { onConflict: 'symbol,fiscal_period,basis' });
  if (pointerUpdateError) throw pointerUpdateError;

  return {
    success: true,
    symbol,
    action: 'REPARSED_CURRENT_REPORT',
    previousReportId: currentReport.report_id,
    reportId: nextReportId,
    rawItemCount: rawItems.length,
    valuedCount,
  };
}

function withoutGeneratedColumns(row) {
  const {
    id,
    created_at,
    updated_at,
    ...rest
  } = row;
  return rest;
}

function createSupabaseClientFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const symbols = process.argv.slice(2).map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) throw new Error('En az bir sembol gerekli. Ornek: npm run kap:reparse-current -- THYAO');
  const result = await reparseCurrentKapReport({
    supabaseClient: createSupabaseClientFromEnv(),
    symbols,
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
  reparseCurrentKapReport,
};
