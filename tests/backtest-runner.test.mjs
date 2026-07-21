import { describe, expect, it } from 'vitest';
import backtestModule from '../apps/desktop/electron/backtest-runner.cjs';

const { buildBacktestSummary, runFinanceSignalBacktest } = backtestModule;

describe('backtest-runner', () => {
  it('counts executed trades and skipped entries', () => {
    const dataset = [
      {
        id: 'eq-1',
        asset: 'SISE',
        riskTolerance: 'medium',
        volatility: 4,
        sampleSize: 30,
        sourceReliability: 82,
        confidence: 75,
        patternAgeDays: 1,
        contradictorySources: 0,
        signalRiskLevel: 'low',
        realizedReturnPercent: 4.5,
        expectedDirection: 'YUKARI',
        regime: 'trend',
      },
      {
        id: 'cr-1',
        asset: 'BTCUSDT',
        riskTolerance: 'low',
        volatility: 12,
        sampleSize: 35,
        sourceReliability: 80,
        confidence: 79,
        patternAgeDays: 1,
        contradictorySources: 0,
        signalRiskLevel: 'high',
        realizedReturnPercent: 9,
        expectedDirection: 'YUKARI',
        regime: 'trend',
      },
      {
        id: 'fx-1',
        asset: 'USDTRY',
        riskTolerance: 'medium',
        volatility: 3,
        sampleSize: 25,
        sourceReliability: 85,
        confidence: 72,
        patternAgeDays: 1,
        contradictorySources: 0,
        signalRiskLevel: 'low',
        realizedReturnPercent: -1.5,
        expectedDirection: 'YUKARI',
        regime: 'range',
      },
    ];

    const report = runFinanceSignalBacktest(dataset, { initialCapital: 100000 });

    expect(report.metrics.trades).toBe(2);
    expect(report.metrics.wins).toBe(1);
    expect(report.metrics.losses).toBe(1);
    expect(report.metrics.skipped.no_signal).toBe(1);
    expect(buildBacktestSummary(report)).toContain('Trades: 2');
  });
});