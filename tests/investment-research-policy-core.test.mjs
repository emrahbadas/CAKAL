import { describe, expect, it } from 'vitest';
import policyCore from '../packages/core/investment-research/shared/policy-core.cjs';
import deterministicAgents from '../apps/desktop/electron/deterministic-agents.cjs';
import {
  buildResearchMandateGuidance,
  buildResearchPlan,
  createResearchStateMachine,
  detectResearchMode,
  evaluateResearchWorkflow,
  evaluateSuitability,
  getInvestmentResearchPolicy,
  validateEvidenceAndClaims,
  validateEvidenceFreshness,
} from '../packages/core/investment-research/src/index.ts';

const MODE_DETECTION_CORPUS = [
  'Piyasayı sıfırdan geniş tara ve sepet çıkar',
  'watchlist hisselerimi guncelle',
  'THYAO şirketini derinlemesine analiz et',
  'Bu hisse portföyüme uygun mu?',
  'ASELS için hedef fiyat ve değerleme yap',
  'SISE risk analizi ve ters tez üret',
  'savunma sektörü araştırması yap',
  'KAP bilanço haberi geldi, tezi güncelle',
];

describe('investment research policy core (tek kaynak)', () => {
  it('TS paketi ile policy-core ayni mod tespitini yapar', () => {
    for (const message of MODE_DETECTION_CORPUS) {
      expect(detectResearchMode(message)).toBe(policyCore.detectResearchMode(message));
    }
  });

  it('TS policy registry policy-core verisinden turetilir (drift yok)', () => {
    for (const mode of policyCore.RESEARCH_MODES) {
      const policy = getInvestmentResearchPolicy(mode);
      const data = policyCore.MODE_POLICY_DATA[mode];
      expect(policy.id).toBe(data.id);
      expect(policy.version).toBe(data.version);
      expect(policy.requiredStates).toEqual([...data.requiredStates]);
      expect(policy.forbiddenShortcuts).toEqual([...data.forbiddenShortcuts]);
      expect(policy.finalDecision).toEqual({ ...data.finalDecision });
    }
  });

  it('Electron runtime plani policy-core ile ayni (TS/CJS esdegerligi)', () => {
    const payload = deterministicAgents.runDeterministicAgent('finance', {
      action: 'evaluate_research_workflow',
      message: 'Piyasayı sıfırdan geniş tara',
      completedStates: [],
    });
    expect(payload.mode).toBe('FRESH_MARKET_SCAN');
    expect(payload.requiredPlan).toEqual([...policyCore.MODE_POLICY_DATA.FRESH_MARKET_SCAN.requiredStates]);
    expect(buildResearchPlan('FRESH_MARKET_SCAN')).toEqual([...policyCore.MODE_POLICY_DATA.FRESH_MARKET_SCAN.requiredStates]);
  });
});

describe('research state machine (gercek FSM)', () => {
  it('gecerli yol boyunca ilerler ve audit uretir', () => {
    const fsm = createResearchStateMachine({ researchId: 'r1', mode: 'FRESH_MARKET_SCAN' });
    expect(fsm.getState()).toBe('INTAKE');
    expect(fsm.advance('MODE_SELECTED').ok).toBe(true);
    expect(fsm.advance('MANDATE_CHECK').ok).toBe(true);
    expect(fsm.advance('RESEARCH_CHARTER_CREATED').ok).toBe(true);
    expect(fsm.advance('UNIVERSE_BUILDING').ok).toBe(true);
    expect(fsm.advance('UNIVERSE_FROZEN').ok).toBe(true);
    const audit = fsm.getAuditEvents();
    expect(audit.length).toBeGreaterThanOrEqual(6);
    expect(audit.every((event) => event.researchId === 'r1')).toBe(true);
  });

  it('yanlis gecisi bastan engeller (checklist degil FSM)', () => {
    const fsm = createResearchStateMachine({ researchId: 'r2', mode: 'FRESH_MARKET_SCAN' });
    const result = fsm.advance('REPORT_READY');
    expect(result.ok).toBe(false);
    expect(fsm.getState()).toBe('INTAKE');
    expect(result.reason).toContain('Gecersiz gecis');
  });

  it('retry limiti asilinca FAILED olur', () => {
    const fsm = createResearchStateMachine({ researchId: 'r3', mode: 'FRESH_MARKET_SCAN', initialState: 'DISCOVERY_RESEARCH' });
    expect(fsm.retry('kaynak hatasi').ok).toBe(true);
    expect(fsm.retry('kaynak hatasi').ok).toBe(true);
    expect(fsm.retry('kaynak hatasi').ok).toBe(false);
    expect(fsm.getState()).toBe('FAILED');
  });

  it('block/unblock kaldigi yerden devam eder', () => {
    const fsm = createResearchStateMachine({ researchId: 'r4', mode: 'FRESH_MARKET_SCAN', initialState: 'DEEP_DIVE_RESEARCH' });
    fsm.block('eksik birincil kanit');
    expect(fsm.getState()).toBe('BLOCKED');
    const result = fsm.unblock();
    expect(result.ok).toBe(true);
    expect(fsm.getState()).toBe('DEEP_DIVE_RESEARCH');
  });

  it('state bazli capability allowlist uygular', () => {
    const fsm = createResearchStateMachine({ researchId: 'r5', mode: 'FRESH_MARKET_SCAN', initialState: 'REPORT_READY' });
    expect(fsm.isCapabilityAllowedNow('web_search')).toBe(false);
    expect(fsm.isCapabilityAllowedNow('verified_research_read')).toBe(true);
    expect(policyCore.isCapabilityAllowed('DISCOVERY_RESEARCH', 'web_search')).toBe(true);
    expect(policyCore.isCapabilityAllowed('VALUATION_ANALYSIS', 'web_search')).toBe(false);
  });

  it('workflow degerlendirmesi sira ihlalini yakalar', () => {
    const result = evaluateResearchWorkflow({
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: ['RESEARCH_CHARTER_CREATED', 'SOURCE_PLAN_CREATED', 'DEEP_DIVE_RESEARCH', 'VALUATION_ANALYSIS', 'RISK_ANALYSIS', 'RED_TEAM_REVIEW', 'EVIDENCE_VALIDATION', 'REPORT_READY'],
      stateHistory: ['INTAKE', 'REPORT_READY'],
    });
    expect(result.passed).toBe(false);
    expect(result.blockingReasons.some((reason) => reason.includes('Gecersiz gecis'))).toBe(true);
  });

  it('Electron runtime capability ihlalini ve sira ihlalini bloklar', () => {
    const payload = deterministicAgents.runDeterministicAgent('finance', {
      action: 'evaluate_research_workflow',
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: [...policyCore.MODE_POLICY_DATA.COMPANY_DEEP_DIVE.requiredStates],
      stateHistory: ['INTAKE', 'REPORT_READY'],
      capabilityRequests: [{ state: 'REPORT_READY', capability: 'web_search' }],
    });
    expect(payload.validation.passed).toBe(false);
    expect(payload.validation.blockingReasons.some((reason) => reason.includes('Capability ihlali'))).toBe(true);
    expect(payload.validation.blockingReasons.some((reason) => reason.includes('Gecersiz gecis'))).toBe(true);
  });
});

describe('kademeli freshness gate', () => {
  const claim = {
    claimId: 'claim_price',
    text: 'Hisse fiyati 100 TL.',
    type: 'FACT',
    materiality: 'HIGH',
    evidenceIds: ['ev_price'],
    contradictionEvidenceIds: [],
    confidence: 0.9,
    status: 'VERIFIED',
  };

  const baseEvidence = {
    evidenceId: 'ev_price',
    sourceTier: 'TIER_C_REPUTABLE_SECONDARY',
    sourceType: 'market_data_provider',
    publisher: 'Yahoo Finance',
    title: 'Guncel fiyat verisi cok onemli baslik',
    retrievedAt: new Date().toISOString(),
    supportsClaimIds: ['claim_price'],
    contradictsClaimIds: [],
    freshnessStatus: 'FRESH',
  };

  it('eski MARKET_PRICE verisini sert bloklar', () => {
    const result = validateEvidenceFreshness(
      [claim],
      [{ ...baseEvidence, dataCategory: 'MARKET_PRICE', freshnessStatus: 'STALE' }],
    );
    expect(result.passed).toBe(false);
  });

  it('tarihsel seri eskimesini bloklamaz', () => {
    const result = validateEvidenceFreshness(
      [claim],
      [{ ...baseEvidence, dataCategory: 'HISTORICAL_SERIES', freshnessStatus: 'STALE' }],
    );
    expect(result.passed).toBe(true);
  });

  it('bilancoda yalniz daha yeni surum bilinirken eskiyi bloklar', () => {
    const warnOnly = validateEvidenceFreshness(
      [claim],
      [{ ...baseEvidence, dataCategory: 'FINANCIAL_STATEMENT', freshnessStatus: 'STALE', newerVersionKnown: false }],
    );
    expect(warnOnly.passed).toBe(true);
    expect(warnOnly.warnings.length).toBeGreaterThan(0);

    const blocked = validateEvidenceFreshness(
      [claim],
      [{ ...baseEvidence, dataCategory: 'FINANCIAL_STATEMENT', freshnessStatus: 'STALE', newerVersionKnown: true }],
    );
    expect(blocked.passed).toBe(false);
  });

  it('kategorisiz eski veri HIGH iddiada bloklanir, LOW iddiada uyaridir', () => {
    const highBlocked = validateEvidenceFreshness(
      [claim],
      [{ ...baseEvidence, freshnessStatus: 'STALE' }],
    );
    expect(highBlocked.passed).toBe(false);

    const lowWarn = validateEvidenceFreshness(
      [{ ...claim, materiality: 'LOW' }],
      [{ ...baseEvidence, freshnessStatus: 'STALE' }],
    );
    expect(lowWarn.passed).toBe(true);
  });
});

describe('kopya kaynak tespiti', () => {
  it('ayni haberin kopyalari bagimsiz kanit sayilmaz', () => {
    const claims = [{
      claimId: 'claim_news',
      text: 'Sirket yeni fabrika sozlesmesi imzaladi.',
      type: 'FACT',
      materiality: 'HIGH',
      evidenceIds: ['ev_a', 'ev_b'],
      contradictionEvidenceIds: [],
      confidence: 0.85,
      status: 'VERIFIED',
    }];
    const copyEvidence = (id, publisher) => ({
      evidenceId: id,
      sourceTier: 'TIER_A_PRIMARY_OFFICIAL',
      sourceType: 'news_article',
      publisher,
      title: 'Sirket yeni fabrika sozlesmesi imzaladi: 500 milyon TL',
      retrievedAt: new Date().toISOString(),
      supportsClaimIds: ['claim_news'],
      contradictsClaimIds: [],
      freshnessStatus: 'FRESH',
    });
    const result = validateEvidenceAndClaims(
      [copyEvidence('ev_a', 'Haber Sitesi A'), copyEvidence('ev_b', 'Haber Sitesi B')],
      claims,
    );
    expect(result.passed).toBe(false);
    expect(result.blockingReasons.some((reason) => reason.includes('kaynak ailesinin kopyalari'))).toBe(true);
  });

  it('farkli bagimsiz kaynaklar kabul edilir', () => {
    expect(policyCore.countIndependentSources([
      { publisher: 'KAP', title: 'Ozel Durum Aciklamasi - Fabrika Yatirimi', contentHash: 'h1' },
      { publisher: 'Sirket IR', title: 'Yatirimci Sunumu 2026' },
    ])).toBe(2);
  });
});

describe('varsayilan mandate sahte kisisellestirme korumasi', () => {
  it('varsayimla dolan mandate kisisellestirilmis oneriyi acamaz', () => {
    const guidance = buildResearchMandateGuidance({});
    expect(guidance.mandate.assumedFields).toContain('riskTolerance');

    const workflow = evaluateResearchWorkflow({
      mode: 'COMPANY_DEEP_DIVE',
      completedStates: [],
      mandate: guidance.mandate,
    });
    const mandateGate = workflow.gates.find((gate) => gate.gate === 'MANDATE_GATE');
    expect(mandateGate.status).toBe('WARN');

    const suitability = evaluateSuitability(guidance.mandate, { securityQualityScore: 90, portfolioFitScore: 80 });
    expect(suitability.personalizedRecommendationAllowed).toBe(false);
  });

  it('kullanici beyanli mandate kisisellestirmeyi acar', () => {
    const guidance = buildResearchMandateGuidance({
      market: 'BIST',
      horizonMonths: 24,
      riskPreference: 'medium',
      maxDrawdownPercent: 25,
      currentPortfolioKnown: true,
    });
    expect(guidance.mandate.assumedFields).not.toContain('riskTolerance');
    const suitability = evaluateSuitability(guidance.mandate, { securityQualityScore: 90, portfolioFitScore: 80 });
    expect(suitability.personalizedRecommendationAllowed).toBe(true);
  });
});
