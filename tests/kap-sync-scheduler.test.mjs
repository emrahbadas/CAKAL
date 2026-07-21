import { describe, expect, it } from 'vitest';
import { createScheduler, parseSchedulerArgs } from '../scripts/kap-sync-scheduler.cjs';

describe('KAP sync scheduler', () => {
  it('parses scheduler arguments', () => {
    expect(parseSchedulerArgs(['--interval-minutes=15', '--limit=10'])).toEqual({
      intervalMinutes: 15,
      limit: 10,
      runImmediately: true,
    });

    expect(parseSchedulerArgs(['--no-immediate'])).toEqual({
      intervalMinutes: 30,
      limit: 25,
      runImmediately: false,
    });
  });

  it('rejects invalid interval and limit values', () => {
    expect(() => parseSchedulerArgs(['--interval-minutes=0'])).toThrow(/interval-minutes/);
    expect(() => parseSchedulerArgs(['--limit=0'])).toThrow(/limit/);
  });

  it('does not run overlapping sync ticks', async () => {
    let calls = 0;
    let release;
    const blocker = new Promise((resolve) => {
      release = resolve;
    });

    const scheduler = createScheduler({
      intervalMs: 1,
      runImmediately: true,
      runOnce: async () => {
        calls += 1;
        await blocker;
        return { success: true };
      },
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);

    release();
    scheduler.stop();
  });
});
