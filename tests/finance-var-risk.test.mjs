import { describe, expect, it } from 'vitest';
import { FinanceWatcherAgent } from '../packages/agents/src/finance.ts';
import { runDeterministicAgent } from '../apps/desktop/electron/deterministic-agents.cjs';

const riskPayload = {
  asset: 'THYAO',
  amount: 100000,
  volatility: 20,
  holdingDays: 30,
};

const context = {
  userId: 'test-user',
  userProfile: {
    riskTolerance: 'medium',
  },
};

const expectedVar95 = Math.round(
  riskPayload.amount *
    ((riskPayload.volatility / 100) / Math.sqrt(252)) *
    Math.sqrt(riskPayload.holdingDays) *
    1.645
);

describe('finance VaR calculation', () => {
  it('treats volatility input as a percent in the TypeScript finance agent', async () => {
    const agent = new FinanceWatcherAgent();

    const result = await agent.run({
      data: {
        action: 'risk_assessment',
        ...riskPayload,
      },
    }, context);

    expect(result.success).toBe(true);
    expect(result.data.valueAtRisk.var95).toBe(expectedVar95);
    expect(result.data.valueAtRisk.var95).toBeLessThan(riskPayload.amount);
  });

  it('treats volatility input as a percent in the Electron deterministic finance agent', () => {
    const result = runDeterministicAgent('finance', {
      action: 'risk_assessment',
      ...riskPayload,
    }, context);

    expect(result.valueAtRisk.var95).toBe(expectedVar95);
    expect(result.valueAtRisk.var95).toBeLessThan(riskPayload.amount);
  });
});
