import { describe, expect, it } from 'vitest';
import agentsModule from '../apps/desktop/electron/deterministic-agents.cjs';

const { getSupportedAgentActions, runDeterministicAgent } = agentsModule;

describe('commerce-vision deterministic agent', () => {
  it('supports ecommerce strategy actions', () => {
    const actions = getSupportedAgentActions('commerce-vision');
    expect(actions).toContain('evaluate_unit_economics');
    expect(actions).toContain('rank_product_candidates');
    expect(actions).toContain('build_dropshipping_strategy');
  });

  it('builds full unit economics with A-Z cost table', () => {
    const result = runDeterministicAgent('commerce-vision', {
      action: 'evaluate_unit_economics',
      productName: 'Telefon standi',
      sourcePlatform: 'aliexpress',
      targetPlatform: 'trendyol',
      sourcePrice: 2.8,
      sourceCurrency: 'USD',
      fxRate: 38,
      quantity: 50,
      targetSellPriceTRY: 199,
      adCostTRY: 1200,
      packagingTRY: 400,
      competitionScore: 45,
      demandTrendScore: 72,
      returnRate: 6,
    });

    expect(result.action).toBe('unit_economics');
    expect(result.economics.costTable.totalCostTRY).toBeGreaterThan(0);
    expect(result.economics.pricing.breakEvenSellPriceTRY).toBeGreaterThan(0);
    expect(result.economics.unitEconomics.opportunityScore).toBeGreaterThan(0);
  });

  it('creates an end-to-end dropshipping strategy from candidate products', () => {
    const result = runDeterministicAgent('commerce-vision', {
      action: 'build_dropshipping_strategy',
      candidates: [
        {
          productName: 'Pilates direnç bandı seti',
          sourcePlatform: 'aliexpress',
          targetPlatform: 'trendyol',
          sourcePrice: 3.2,
          sourceCurrency: 'USD',
          fxRate: 38,
          quantity: 40,
          targetSellPriceTRY: 249,
          adCostTRY: 1600,
          packagingTRY: 500,
          demandTrendScore: 78,
          competitionScore: 52,
          sourceReliability: 76,
        },
        {
          productName: 'Arac ici telefon tutucu',
          sourcePlatform: 'aliexpress',
          targetPlatform: 'sahibinden',
          sourcePrice: 1.9,
          sourceCurrency: 'USD',
          fxRate: 38,
          quantity: 50,
          targetSellPriceTRY: 159,
          adCostTRY: 1100,
          packagingTRY: 350,
          demandTrendScore: 64,
          competitionScore: 40,
          sourceReliability: 70,
        },
      ],
    }, {
      userProfile: { riskTolerance: 'medium' },
    });

    expect(result.action).toBe('dropshipping_strategy');
    expect(result.candidateSummary.length).toBe(2);
    expect(result.phases.length).toBeGreaterThanOrEqual(8);
    expect(result.scenarios.length).toBe(3);
  });
});
