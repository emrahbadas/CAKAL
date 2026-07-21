import { describe, expect, it } from 'vitest';
import { FinanceWatcherAgent } from '../packages/agents/src/finance.ts';
import { OpportunityJudgeAgent } from '../packages/agents/src/judge.ts';
import { TravelHunterAgent } from '../packages/agents/src/travel.ts';
import { runDeterministicAgent } from '../apps/desktop/electron/deterministic-agents.cjs';

const context = {
  userId: 'test-user',
  userProfile: {
    riskTolerance: 'medium',
  },
};

describe('agent calculation guards', () => {
  it('keeps zero price change in finance signal output', async () => {
    const agent = new FinanceWatcherAgent();

    const result = await agent.run({
      data: {
        action: 'analyze_signal',
        asset: 'THYAO',
        currentPrice: 100,
        previousPrice: 100,
      },
    }, context);

    expect(result.success).toBe(true);
    expect(result.data.priceChange).toBe(0);
  });

  it('keeps zero discounts in travel deal output', async () => {
    const agent = new TravelHunterAgent();

    const flight = await agent.run({
      data: {
        action: 'analyze_flight_deal',
        from: 'IST',
        to: 'ESB',
        price: 1000,
        averagePrice: 1000,
      },
    }, context);

    const hotel = await agent.run({
      data: {
        action: 'analyze_hotel_deal',
        city: 'Ankara',
        pricePerNight: 1000,
        averagePrice: 1000,
      },
    }, context);

    expect(flight.data.discount).toBe(0);
    expect(hotel.data.discount).toBe(0);
  });

  it('does not replace explicit zero score or confidence in the TypeScript judge agent', async () => {
    const agent = new OpportunityJudgeAgent();

    const result = await agent.run({
      data: {
        action: 'judge_single',
        opportunity: {
          title: 'Riskli deneme',
          category: 'finans',
          source: 'unknown',
          score: 0,
          expectedProfit: 0,
          riskLevel: 100,
        },
      },
    }, {
      ...context,
      recentPatterns: [
        { tags: ['finans'], status: 'active', confidence: 0 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data.scoring.factors.profitPotential).toBe(0);
    expect(result.data.scoring.factors.riskLevel).toBe(100);
    expect(result.data.scoring.factors.patternConfidence).toBe(0);
  });

  it('calculates deterministic judge batch average from all judged opportunities', () => {
    const opportunities = [
      { title: 'A', category: 'arbitraj', source: 'sahibinden', score: 90, urgency: 'high' },
      { title: 'B', category: 'finans', source: 'unknown', score: 10, urgency: 'low', riskLevel: 100 },
      { title: 'C', category: 'diger', source: 'letgo', score: 40, urgency: 'medium' },
    ];

    const singles = opportunities.map((opportunity) =>
      runDeterministicAgent('judge', {
        action: 'judge_single',
        opportunity,
      }, context)
    );
    const expectedAverage = Math.round(
      singles.reduce((sum, item) => sum + item.scoring.totalScore, 0) / singles.length
    );

    const batch = runDeterministicAgent('judge', {
      action: 'judge_batch',
      opportunities,
      limit: 1,
    }, context);

    expect(batch.returned).toBe(1);
    expect(batch.averageScore).toBe(expectedAverage);
    expect(batch.averageScore).not.toBe(batch.results[0].totalScore);
  });
});
