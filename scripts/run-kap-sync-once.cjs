const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { runKapSyncOnce } = require('./kap-sync-worker.cjs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('--fresh') || args.includes('fresh');
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 25;
  const symbols = args
    .filter((arg) => !arg.startsWith('--'))
    .filter((arg) => arg !== 'fresh')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  const result = await runKapSyncOnce({
    supabaseClient,
    symbols,
    limit,
    force,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
