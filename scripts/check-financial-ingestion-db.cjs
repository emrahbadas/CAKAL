const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const requiredTables = [
  'kap_companies',
  'kap_disclosures',
  'kap_financial_reports',
  'kap_raw_financial_items',
  'financial_line_item_mappings',
  'normalized_financial_facts',
  'financial_validation_results',
  'financial_cross_checks',
  'company_financial_ratios',
  'company_analysis_snapshots',
  'kap_current_financial_reports',
  'kap_sync_state',
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const results = [];

  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    results.push({
      table,
      ready: !error,
      error: error ? `${error.code || 'ERROR'}: ${error.message}` : null,
    });
  }

  for (const result of results) {
    console.log(`${result.ready ? 'OK ' : 'MISS'} ${result.table}${result.error ? ` - ${result.error}` : ''}`);
  }

  const missing = results.filter((result) => !result.ready);
  if (missing.length > 0) {
    console.error(`\n${missing.length} financial ingestion tablosu eksik.`);
    console.error('Migration dosyalarini Supabase SQL Editor veya CLI ile calistir:');
    console.error('- supabase/migrations/20260718000200_financial_ingestion_pipeline.sql');
    console.error('- supabase/migrations/20260719000100_kap_cache_policy.sql');
    process.exit(1);
  }

  console.log('\nFinancial ingestion DB tablolari hazir.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
