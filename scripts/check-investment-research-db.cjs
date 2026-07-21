const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const requiredTables = [
  'investment_research_sessions',
  'investment_research_audit_events',
  'investment_research_evidence',
  'investment_research_claims',
  'investment_research_decisions',
  'investment_research_red_team_runs',
  'investment_thesis_monitor_snapshots',
  'investment_policy_improvement_proposals',
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
    console.log(`${result.ready ? 'OK ' : 'MISS'} ${result.table}${result.error ? ` — ${result.error}` : ''}`);
  }

  const missing = results.filter((result) => !result.ready);
  if (missing.length > 0) {
    console.error(`\n${missing.length} investment research tablosu eksik. Migration'i uygula: supabase/migrations/20260718000100_investment_research_audit.sql`);
    process.exit(1);
  }

  console.log('\nInvestment research DB audit tablolari hazir.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
