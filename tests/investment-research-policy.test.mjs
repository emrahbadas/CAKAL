import { describe, expect, it } from 'vitest';
import {
  buildResearchPlan,
  createInvestmentDecision,
  createRedTeamAssignment,
  createUniverseSnapshot,
  detectResearchMode,
  buildResearchMandateGuidance,
  evaluateResearchWorkflow,
  evaluateSuitability,
  runInvestmentScreening,
  validateRedTeamIsolation,
  validateEvidenceAndClaims,
  validateMetricComparison,
  validateValuation,
} from '../packages/core/investment-research/src/index.ts';

const completeStates = [
  'RESEARCH_CHARTER_CREATED',
  'UNIVERSE_FROZEN',
  'SOURCE_PLAN_CREATED',
  'DISCOVERY_RESEARCH',
  'CANDIDATE_SCREENING',
  'DEEP_DIVE_RESEARCH',
  'VALUATION_ANALYSIS',
  'SCENARIO_ANALYSIS',
  'RISK_ANALYSIS',
  'RED_TEAM_REVIEW',
  'SUITABILITY_REVIEW',
  'EVIDENCE_VALIDATION',
  'DECISION_READY',
  'REPORT_READY',
  'MONITORING_PLAN_CREATED',
];

const mandate = {
  investmentObjective: '12-24 ay vadeli hisse sepeti',
  horizonMonths: 18,
  baseCurrency: 'TRY',
  market: 'BIST',
  riskTolerance: 'medium',
  maxDrawdownPercent: 20,
};

const universe = createUniverseSnapshot({
  market: 'BIST',
  assetType: 'EQUITY',
  rulesVersion: '1.0.0',
  securityCount: 146,
  filters: { minimumAverageDailyVolume: 1000000 },
  excludedReasons: [],
});

const primaryEvidence = {
  evidenceId: 'ev-1',
  sourceTier: 'TIER_A_PRIMARY_OFFICIAL',
  sourceType: 'official_filing',
  publisher: 'KAP',
  title: 'Financial statements',
  retrievedAt: '2026-07-18T10:00:00.000Z',
  reportingPeriod: 'FY2025',
  currency: 'TRY',
  unit: 'TRY',
  supportsClaimIds: ['claim-1'],
  contradictsClaimIds: [],
  freshnessStatus: 'FRESH',
};

const metric = {
  metric: 'net_income',
  value: 100,
  currency: 'TRY',
  unit: 'million',
  reportingPeriod: 'FY2025',
  periodType: 'ANNUAL',
  sourceEvidenceId: 'ev-1',
  restated: false,
};

describe('investment research policy', () => {
  it('detects fresh market scan and builds deterministic plan', () => {
    expect(detectResearchMode('BIST icin sifirdan sepet adaylari cikar')).toBe('FRESH_MARKET_SCAN');
    expect(buildResearchPlan('FRESH_MARKET_SCAN')).toContain('UNIVERSE_FROZEN');
    expect(buildResearchPlan('FRESH_MARKET_SCAN')).toContain('RED_TEAM_REVIEW');
  });

  it('blocks fresh market scan when memory, watchlist or recent gainers shortcuts are used', () => {
    const result = evaluateResearchWorkflow({
      mode: 'FRESH_MARKET_SCAN',
      completedStates: completeStates,
      mandate,
      universe,
      memoryCandidatesUsed: true,
      watchlistSeedUsed: true,
      usedShortcuts: ['select_only_recent_gainers'],
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain('select_only_recent_gainers');
    expect(result.blockingReasons.join(' ')).toContain('use_watchlist_as_seed');
  });

  it('allows watchlist refresh to use watchlist seed but not old recommendations as evidence', () => {
    const seedResult = evaluateResearchWorkflow({
      mode: 'WATCHLIST_REFRESH',
      completedStates: completeStates,
      mandate,
      watchlistSeedUsed: true,
    });
    expect(seedResult.blockingReasons.join(' ')).not.toContain('use_watchlist_as_seed');

    const evidenceResult = evaluateResearchWorkflow({
      mode: 'WATCHLIST_REFRESH',
      completedStates: completeStates,
      mandate,
      previousRecommendationEvidenceUsed: true,
    });
    expect(evidenceResult.passed).toBe(false);
    expect(evidenceResult.blockingReasons.join(' ')).toContain('use_previous_recommendations_as_evidence');
  });

  it('rejects search snippets and tier D as material fact evidence', () => {
    const result = validateEvidenceAndClaims([
      {
        ...primaryEvidence,
        evidenceId: 'ev-snippet',
        sourceTier: 'TIER_D_UNVERIFIED',
        sourceType: 'search_snippet',
        supportsClaimIds: ['claim-1'],
      },
    ], [
      {
        claimId: 'claim-1',
        text: 'Company net debt decreased.',
        type: 'FACT',
        materiality: 'CRITICAL',
        evidenceIds: ['ev-snippet'],
        contradictionEvidenceIds: [],
        confidence: 0.8,
        status: 'VERIFIED',
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain("arama snippet'i");
    expect(result.blockingReasons.join(' ')).toContain('TIER_D');
  });

  it('blocks mixed annual and TTM financial comparisons', () => {
    const result = validateMetricComparison([
      metric,
      { ...metric, metric: 'ebitda_ttm', periodType: 'TTM' },
    ]);

    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain('ANNUAL ve TTM');
  });

  it('requires valuation assumptions and valid scenario probabilities', () => {
    const result = validateValuation([
      {
        method: 'DCF',
        inputMetrics: [metric],
        assumptions: {},
        formulaVersion: '1.0.0',
        estimatedValue: 120,
        currency: 'TRY',
        sensitivityAnalysis: [],
        evidenceIds: ['ev-1'],
      },
    ], [
      { name: 'BEAR', assumptions: {}, probability: 0.2, probabilityRationale: 'stress', invalidationConditions: [] },
      { name: 'BASE', assumptions: {}, probability: 0.5, probabilityRationale: 'base', invalidationConditions: [] },
      { name: 'BULL', assumptions: {}, probability: 0.4, probabilityRationale: 'upside', invalidationConditions: [] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain('varsayimsiz');
    expect(result.blockingReasons.join(' ')).toContain('toplami 1');
  });

  it('blocks personalized buy when mandate is incomplete', () => {
    const suitability = evaluateSuitability(undefined, {
      securityQualityScore: 88,
      portfolioFitScore: 70,
    });

    const decision = createInvestmentDecision({
      candidateId: 'SISE',
      researchMode: 'COMPANY_DEEP_DIVE',
      completedStates: [
        'RESEARCH_CHARTER_CREATED',
        'SOURCE_PLAN_CREATED',
        'DEEP_DIVE_RESEARCH',
        'VALUATION_ANALYSIS',
        'RISK_ANALYSIS',
        'RED_TEAM_REVIEW',
        'EVIDENCE_VALIDATION',
        'REPORT_READY',
      ],
      claims: [
        {
          claimId: 'claim-1',
          text: 'Financial data is verified.',
          type: 'FACT',
          materiality: 'HIGH',
          evidenceIds: ['ev-1'],
          contradictionEvidenceIds: [],
          confidence: 0.9,
          status: 'VERIFIED',
        },
      ],
      evidence: [primaryEvidence],
      financialMetrics: [metric],
      valuationModels: [
        {
          method: 'MULTIPLE',
          inputMetrics: [metric],
          assumptions: { peerMultiple: 7 },
          formulaVersion: '1.0.0',
          estimatedRange: [90, 120],
          currency: 'TRY',
          sensitivityAnalysis: [{ variable: 'peerMultiple', value: 7, estimatedValue: 105 }],
          evidenceIds: ['ev-1'],
        },
      ],
      scenarios: [
        { name: 'BEAR', assumptions: {}, probability: 0.25, probabilityRationale: 'downside', invalidationConditions: [] },
        { name: 'BASE', assumptions: {}, probability: 0.5, probabilityRationale: 'base', invalidationConditions: [] },
        { name: 'BULL', assumptions: {}, probability: 0.25, probabilityRationale: 'upside', invalidationConditions: [] },
      ],
      counterThesis: {
        thesisId: 'ct-1',
        candidateId: 'SISE',
        strongestBearCase: 'Margins may normalize.',
        supportingEvidenceIds: ['ev-1'],
        thesisInvalidationRisks: ['margin_collapse'],
        unresolvedQuestions: [],
        severity: 'MEDIUM',
      },
      suitability,
      scores: {
        securityQualityScore: 88,
        valuationScore: 72,
        financialQualityScore: 84,
        riskScore: 45,
        evidenceConfidence: 0.9,
      },
      requestedDecision: 'AL',
    });

    expect(decision.decision).toBe('BEKLE');
    expect(decision.mainReasons.join(' ')).toContain('bekliyor');
  });

  it('builds blind red team assignment and detects leaked ratings', () => {
    const assignment = createRedTeamAssignment({
      candidateId: 'SISE',
      claims: [
        {
          claimId: 'claim-1',
          text: 'Financial data is verified.',
          type: 'FACT',
          materiality: 'HIGH',
          evidenceIds: ['ev-1'],
          contradictionEvidenceIds: [],
          confidence: 0.95,
          status: 'VERIFIED',
        },
      ],
      evidence: [primaryEvidence],
    });

    expect(assignment.promptPackage.requiredQuestions).toContain('Ana tez neden yanlis olabilir?');
    expect(assignment.promptPackage.candidateFacts[0].confidence).toBe(0.75);

    const clean = validateRedTeamIsolation(assignment, { candidateId: 'SISE', facts: [] });
    expect(clean.passed).toBe(true);

    const leaked = validateRedTeamIsolation(assignment, { analyst: { security_quality_score: 88 } });
    expect(leaked.passed).toBe(false);
    expect(leaked.leakedFields).toContain('security_quality_score');
  });

  it('runs hard filter and soft ranking for investment screening', () => {
    const result = runInvestmentScreening({
      mode: 'FRESH_MARKET_SCAN',
      universe: { ...universe, securityCount: 20 },
      snapshots: [
        {
          symbol: 'SISE.IS',
          price: 50,
          currency: 'TRY',
          changePercent: 1.2,
          ret20d: 8,
          volatility: 18,
          avgVolume: 500000,
          volumeRatio: 1.3,
          rangePosition: 72,
          trend: 'YUKARI',
          sampleSize: 80,
          sourceEvidenceId: 'ev-sise-yahoo',
          dataAsOf: '2026-07-18T10:00:00.000Z',
        },
        {
          symbol: 'LOWLQ.IS',
          price: 10,
          currency: 'TRY',
          changePercent: 9,
          ret20d: 2,
          volatility: 42,
          avgVolume: 1000,
          volumeRatio: 4,
          rangePosition: 98,
          trend: 'YUKARI',
          sampleSize: 8,
          sourceEvidenceId: 'ev-lowlq-yahoo',
          dataAsOf: '2026-07-18T10:00:00.000Z',
        },
      ],
    });

    expect(result.status).toBe('SCREENING_READY');
    expect(result.researchable[0].symbol).toBe('SISE.IS');
    expect(result.eliminated[0].hardFilterFailures.join(' ')).toContain('Likidite');
  });

  it('builds mandate guidance with all-BIST, horizon and risk assumptions', () => {
    const guidance = buildResearchMandateGuidance({});

    expect(guidance.mandate.market).toBe('BIST');
    expect(guidance.mandate.horizonMonths).toBe(18);
    expect(guidance.mandate.riskTolerance).toBe('medium');
    expect(guidance.clarificationQuestions.join(' ')).toContain('sektor');
    expect(guidance.paidDataPolicy.defaultMode).toBe('FREE_FIRST');
    expect(guidance.paidDataPolicy.allowPaidData).toBe(false);
  });

  it('honors explicit user risk override', () => {
    const guidance = buildResearchMandateGuidance({
      riskPreference: 'high',
      riskOverrideRequested: true,
      maxDrawdownPercent: 12,
    });

    expect(guidance.mandate.riskTolerance).toBe('high');
    expect(guidance.riskAssessmentNote).toContain('acikca high istedi');
  });
});
