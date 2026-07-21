const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { runLiveInvestmentResearchScan } = require('../apps/desktop/electron/ai-service.cjs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabaseClient = url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null;

  const result = await runLiveInvestmentResearchScan({
    mode: 'FRESH_MARKET_SCAN',
    scanLimit: 10,
    limit: 3,
    userRequest: 'smoke test investment research scan',
  }, { supabaseClient });

  console.log(JSON.stringify({
    success: result.success,
    status: result.data.status,
    universeCount: result.data.universe.securityCount,
    researchableCount: result.data.researchable.length,
    topSymbols: result.data.researchable.map((candidate) => candidate.symbol),
    audit: result.data.audit,
    policyWarnings: result.data.policyWarnings,
  }, null, 2));

  if (!result.success) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
