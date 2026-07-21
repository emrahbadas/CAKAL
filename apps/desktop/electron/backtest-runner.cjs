const fs = require('fs');
const path = require('path');
const { evaluateRiskGate } = require('./decision-guards.cjs');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function safeRegime(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'unknown';
}

function buildEmptyRegimeSummary() {
  return { trades: 0, wins: 0, losses: 0, totalReturnPercent: 0 };
}

function getTradeReturnPercent(entry) {
  const explicit = toNumber(entry.realizedReturnPercent ?? entry.returnPercent, null);
  if (explicit !== null) return explicit;

  const entryPrice = toNumber(entry.entryPrice, 0);
  const exitPrice = toNumber(entry.exitPrice, 0);
  if (entryPrice > 0 && exitPrice > 0) {
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  }
  return 0;
}

function loadBacktestDataset(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Backtest dataset JSON array olmalı.');
  }
  return parsed;
}

function runFinanceSignalBacktest(dataset, options = {}) {
  const entries = Array.isArray(dataset) ? dataset : [];
  const initialCapital = Math.max(1, toNumber(options.initialCapital, 100000));
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPercent = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let falsePositives = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const skipped = { veri_yetersiz: 0, no_signal: 0 };
  const regimeBreakdown = {};
  const records = [];

  for (const entry of entries) {
    const riskGate = evaluateRiskGate({
      asset: entry.asset,
      assetClass: entry.assetClass,
      riskTolerance: entry.riskTolerance || options.riskTolerance || 'medium',
      volatility: entry.volatility,
      sampleSize: entry.sampleSize,
      sourceReliability: entry.sourceReliability,
      confidence: entry.confidence,
      patternAgeDays: entry.patternAgeDays ?? 0,
      contradictorySources: entry.contradictorySources ?? 0,
      signalRiskLevel: entry.signalRiskLevel || 'medium',
      recentCloses: entry.recentCloses,
    });

    if (!riskGate.passed) {
      skipped[riskGate.status] = (skipped[riskGate.status] || 0) + 1;
      records.push({
        id: entry.id || entry.asset || `row-${records.length + 1}`,
        asset: entry.asset,
        regime: safeRegime(entry.regime),
        status: riskGate.status,
        reasons: riskGate.reasons,
      });
      continue;
    }

    const returnPercent = getTradeReturnPercent(entry);
    const pnl = equity * (returnPercent / 100);
    equity += pnl;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPercent = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);

    trades += 1;
    if (returnPercent >= 0) {
      wins += 1;
      grossProfit += pnl;
    } else {
      losses += 1;
      grossLoss += Math.abs(pnl);
    }

    const expectedDirection = String(entry.expectedDirection || entry.direction || '').toUpperCase();
    if ((expectedDirection === 'YUKARI' && returnPercent <= 0) || (expectedDirection === 'AŞAĞI' && returnPercent >= 0) || (expectedDirection === 'ASAGI' && returnPercent >= 0)) {
      falsePositives += 1;
    }

    const regime = safeRegime(entry.regime);
    regimeBreakdown[regime] = regimeBreakdown[regime] || buildEmptyRegimeSummary();
    regimeBreakdown[regime].trades += 1;
    regimeBreakdown[regime].totalReturnPercent = round(regimeBreakdown[regime].totalReturnPercent + returnPercent, 2);
    if (returnPercent >= 0) regimeBreakdown[regime].wins += 1;
    else regimeBreakdown[regime].losses += 1;

    records.push({
      id: entry.id || entry.asset || `row-${records.length + 1}`,
      asset: entry.asset,
      regime,
      status: 'executed',
      returnPercent: round(returnPercent, 2),
      equityAfter: round(equity, 2),
    });
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const averageReturnPercent = trades > 0 ? records.filter((record) => record.status === 'executed').reduce((sum, record) => sum + (record.returnPercent || 0), 0) / trades : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const falsePositiveRate = trades > 0 ? (falsePositives / trades) * 100 : 0;

  return {
    initialCapital,
    finalCapital: round(equity, 2),
    metrics: {
      trades,
      wins,
      losses,
      skipped,
      winRate: round(winRate, 2),
      averageReturnPercent: round(averageReturnPercent, 2),
      maxDrawdownPercent: round(maxDrawdownPercent, 2),
      profitFactor: Number.isFinite(profitFactor) ? round(profitFactor, 2) : 'Infinity',
      falsePositiveRate: round(falsePositiveRate, 2),
      regimeBreakdown,
    },
    records,
  };
}

function buildBacktestSummary(report) {
  const metrics = report.metrics || {};
  return [
    `Trades: ${metrics.trades || 0}`,
    `Win rate: %${metrics.winRate || 0}`,
    `Avg return: %${metrics.averageReturnPercent || 0}`,
    `Max DD: %${metrics.maxDrawdownPercent || 0}`,
    `Profit factor: ${metrics.profitFactor || 0}`,
    `False positive: %${metrics.falsePositiveRate || 0}`,
    `Skipped(no_signal): ${(metrics.skipped && metrics.skipped.no_signal) || 0}`,
    `Skipped(veri_yetersiz): ${(metrics.skipped && metrics.skipped.veri_yetersiz) || 0}`,
  ].join(' | ');
}

module.exports = {
  buildBacktestSummary,
  loadBacktestDataset,
  runFinanceSignalBacktest,
};