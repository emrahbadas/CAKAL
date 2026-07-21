const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { runKapSyncOnce } = require('./kap-sync-worker.cjs');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseSchedulerArgs(args) {
  const intervalArg = args.find((arg) => arg.startsWith('--interval-minutes='));
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const runImmediately = !args.includes('--no-immediate');

  const intervalMinutes = intervalArg ? Number(intervalArg.split('=')[1]) : 30;
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 25;

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error('--interval-minutes pozitif bir sayi olmali.');
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('--limit pozitif bir sayi olmali.');
  }

  return {
    intervalMinutes,
    limit,
    runImmediately,
  };
}

function createScheduler(input) {
  let timer = null;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await input.runOnce();
      input.onResult?.(result);
    } catch (error) {
      input.onError?.(error);
    } finally {
      running = false;
      if (!stopped) {
        timer = setTimeout(tick, input.intervalMs);
      }
    }
  };

  return {
    start() {
      if (timer || running) return;
      if (input.runImmediately) {
        void tick();
      } else {
        timer = setTimeout(tick, input.intervalMs);
      }
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function createSupabaseClientFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const args = parseSchedulerArgs(process.argv.slice(2));
  const supabaseClient = createSupabaseClientFromEnv();
  const intervalMs = args.intervalMinutes * 60 * 1000;

  const scheduler = createScheduler({
    intervalMs,
    runImmediately: args.runImmediately,
    runOnce: () => runKapSyncOnce({ supabaseClient, limit: args.limit }),
    onResult(result) {
      console.log(JSON.stringify({
        scheduler: 'kap-sync',
        intervalMinutes: args.intervalMinutes,
        limit: args.limit,
        result,
      }, null, 2));
    },
    onError(error) {
      console.error('[kap-sync-scheduler]', error);
    },
  });

  const stop = () => {
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  scheduler.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createScheduler,
  parseSchedulerArgs,
};
