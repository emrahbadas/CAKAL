import {
  MANDATE_CRITICAL_FIELDS,
  MODE_POLICY_DATA,
  POLICY_CORE_VERSION,
  RESEARCH_STATE_TRANSITIONS,
  RETRYABLE_STATES,
  STATE_CAPABILITIES,
  DEFAULT_VOLATILITY_CAP,
  resolveVolatilityCap,
  countIndependentSources,
  detectResearchMode as detectResearchModeCore,
  evaluateFreshness,
  evidenceFamilyKey,
  isCapabilityAllowed,
  isTransitionAllowed,
  validateStateSequence,
} from '../shared/policy-core.cjs';

export { POLICY_CORE_VERSION, RESEARCH_STATE_TRANSITIONS, STATE_CAPABILITIES };
export { isTransitionAllowed, validateStateSequence, isCapabilityAllowed, evaluateFreshness, evidenceFamilyKey, countIndependentSources };

export type ResearchMode =
  | 'FRESH_MARKET_SCAN'
  | 'COMPANY_DEEP_DIVE'
  | 'PORTFOLIO_FIT'
  | 'WATCHLIST_REFRESH'
  | 'EVENT_DRIVEN_UPDATE'
  | 'SECTOR_RESEARCH'
  | 'RISK_REVIEW'
  | 'VALUATION_UPDATE';

export type ResearchState =
  | 'INTAKE'
  | 'MODE_SELECTED'
  | 'MANDATE_CHECK'
  | 'MANDATE_DEFINED'
  | 'RESEARCH_CHARTER_CREATED'
  | 'UNIVERSE_BUILDING'
  | 'UNIVERSE_FROZEN'
  | 'SOURCE_PLAN_CREATED'
  | 'DISCOVERY_RESEARCH'
  | 'CANDIDATE_SCREENING'
  | 'DEEP_DIVE_RESEARCH'
  | 'VALUATION_ANALYSIS'
  | 'SCENARIO_ANALYSIS'
  | 'RISK_ANALYSIS'
  | 'RED_TEAM_REVIEW'
  | 'SUITABILITY_REVIEW'
  | 'EVIDENCE_VALIDATION'
  | 'DECISION_READY'
  | 'REPORT_READY'
  | 'MONITORING_PLAN_CREATED'
  | 'POST_MORTEM_REVIEW'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED';

export type ResearchCapability = string;

export type EvidenceDataCategory =
  | 'MARKET_PRICE'
  | 'FX_RATE'
  | 'MARKET_CAP'
  | 'FINANCIAL_STATEMENT'
  | 'MANAGEMENT_GUIDANCE'
  | 'HISTORICAL_SERIES'
  | 'SECTOR_STRUCTURE'
  | 'NEWS_EVENT'
  | 'UNSPECIFIED';

export type SourceTier =
  | 'TIER_A_PRIMARY_OFFICIAL'
  | 'TIER_B_OFFICIAL_CORPORATE'
  | 'TIER_C_REPUTABLE_SECONDARY'
  | 'TIER_D_UNVERIFIED';

export type ClaimType =
  | 'FACT'
  | 'CALCULATION'
  | 'INFERENCE'
  | 'MANAGEMENT_GUIDANCE'
  | 'ANALYST_OPINION'
  | 'UNVERIFIED_REPORT';

export type Materiality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ClaimStatus = 'UNVERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'CONTRADICTED' | 'UNRESOLVED';
export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN';
export type DecisionLabel = 'AL' | 'AL_AMA_KONTROLLU' | 'BEKLE' | 'TUT' | 'REDDET' | 'VERI_YETERSIZ';
export type GateStatus = 'PASS' | 'BLOCK' | 'WARN';
export type ScenarioName = 'BEAR' | 'BASE' | 'BULL';

export interface InvestmentResearchPolicy {
  id: string;
  version: string;
  mode: ResearchMode;
  memory: {
    useUserPreferences: boolean;
    usePreviousCandidates: boolean;
    useWatchlistAsSeed: boolean;
    usePreviousRecommendationsAsEvidence: boolean;
  };
  requiredStates: ResearchState[];
  forbiddenShortcuts: string[];
  finalDecision: {
    requireMandateForPersonalizedRecommendation: boolean;
    requireUniverse: boolean;
    requirePrimaryEvidence: boolean;
    requireCounterThesis: boolean;
    requireRiskAnalysis: boolean;
    requireValuationAssumptions: boolean;
    minEvidenceConfidenceForBuy: number;
  };
}

export interface ResearchMandate {
  investmentObjective?: string;
  horizonMonths?: number;
  baseCurrency?: string;
  market?: string;
  riskTolerance?: 'low' | 'medium' | 'high';
  riskCapacity?: 'low' | 'medium' | 'high';
  maxDrawdownPercent?: number;
  liquidityNeed?: string;
  excludedSectors?: string[];
  maxSinglePositionPercent?: number;
  currentPortfolioKnown?: boolean;
  /**
   * Sistem varsayimiyla doldurulan alanlar. Kritik bir alan (risk, ufuk,
   * maksimum kayip) varsayimsa mandate tamamlanmis sayilmaz; genel arastirma
   * yapilabilir ama kisisellestirilmis AL/SAT uretilemez. Bu, "orta risk
   * varsayimi" ile mandate gate'in celismesini (sahte kisisellestirme) onler.
   */
  assumedFields?: string[];
}

export interface ResearchPreferenceInput {
  market?: string;
  sectorPreference?: string;
  horizonMonths?: number;
  riskPreference?: 'low' | 'medium' | 'high';
  riskOverrideRequested?: boolean;
  maxDrawdownPercent?: number;
  liquidityNeed?: string;
  currentPortfolioKnown?: boolean;
}

export interface ResearchMandateGuidance {
  mandate: ResearchMandate;
  assumptions: string[];
  clarificationQuestions: string[];
  riskAssessmentNote: string;
  paidDataPolicy: {
    defaultMode: 'FREE_FIRST';
    allowPaidData: boolean;
    requiresUserApproval: boolean;
    note: string;
  };
}

export interface ResearchCharter {
  researchQuestion: string;
  decisionHorizon?: string;
  benchmark?: string;
  hypothesis?: string;
  nullHypothesis?: string;
  falsificationConditions: string[];
}

export interface UniverseSnapshot {
  universeId: string;
  createdAt: string;
  market: string;
  assetType: 'EQUITY' | 'ETF' | 'CRYPTO' | 'FX' | 'COMMODITY' | 'OTHER';
  rulesVersion: string;
  securityCount?: number;
  filters: Record<string, unknown>;
  excludedReasons: string[];
}

export interface EvidenceItem {
  evidenceId: string;
  sourceTier: SourceTier;
  sourceType: string;
  publisher: string;
  title: string;
  url?: string;
  documentId?: string;
  publishedAt?: string;
  eventDate?: string;
  retrievedAt: string;
  reportingPeriod?: string;
  currency?: string;
  unit?: string;
  excerpt?: string;
  contentHash?: string;
  supportsClaimIds: string[];
  contradictsClaimIds: string[];
  freshnessStatus: FreshnessStatus;
  /** Kademeli freshness kurali icin veri kategorisi; yoksa UNSPECIFIED kabul edilir. */
  dataCategory?: EvidenceDataCategory;
  /** Ayni verinin daha yeni bir surumunun bilinip bilinmedigi (ornegin yeni bilanco). */
  newerVersionKnown?: boolean;
}

export interface ResearchClaim {
  claimId: string;
  text: string;
  type: ClaimType;
  materiality: Materiality;
  evidenceIds: string[];
  contradictionEvidenceIds: string[];
  confidence: number;
  status: ClaimStatus;
}

export interface FinancialMetric {
  metric: string;
  value: number;
  currency: string;
  unit: string;
  reportingPeriod: string;
  periodType: 'QUARTERLY' | 'ANNUAL' | 'TTM' | 'POINT_IN_TIME';
  sourceEvidenceId: string;
  restated: boolean;
  formula?: string;
  inputMetricIds?: string[];
}

export interface SensitivityPoint {
  variable: string;
  value: number;
  estimatedValue: number;
}

export interface ValuationModel {
  method: string;
  inputMetrics: FinancialMetric[];
  assumptions: Record<string, number>;
  formulaVersion: string;
  estimatedValue?: number;
  estimatedRange?: [number, number];
  currency: string;
  sensitivityAnalysis: SensitivityPoint[];
  evidenceIds: string[];
}

export interface InvestmentScenario {
  name: ScenarioName;
  assumptions: Record<string, number>;
  probability?: number;
  probabilityRationale?: string;
  estimatedReturn?: number;
  estimatedDownside?: number;
  invalidationConditions: string[];
}

export interface CounterThesis {
  thesisId: string;
  candidateId: string;
  strongestBearCase: string;
  supportingEvidenceIds: string[];
  thesisInvalidationRisks: string[];
  unresolvedQuestions: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface SuitabilityAssessment {
  securityQualityScore: number;
  portfolioFitScore?: number;
  concentrationImpact?: number;
  liquidityFit?: number;
  horizonFit?: number;
  riskToleranceFit?: number;
  riskCapacityFit?: number;
  currencyExposureImpact?: number;
  sectorExposureImpact?: number;
  personalizedRecommendationAllowed: boolean;
  blockingReasons: string[];
}

export interface GateResult {
  gate: string;
  status: GateStatus;
  reasons: string[];
}

export interface ValidationResult {
  passed: boolean;
  gates: GateResult[];
  blockingReasons: string[];
  warnings: string[];
}

export interface InvestmentDecisionInput {
  candidateId: string;
  researchMode: ResearchMode;
  policy?: InvestmentResearchPolicy;
  completedStates: ResearchState[];
  mandate?: ResearchMandate;
  universe?: UniverseSnapshot;
  claims: ResearchClaim[];
  evidence: EvidenceItem[];
  financialMetrics: FinancialMetric[];
  valuationModels: ValuationModel[];
  scenarios: InvestmentScenario[];
  counterThesis?: CounterThesis;
  suitability: SuitabilityAssessment;
  scores: {
    securityQualityScore: number;
    valuationScore: number;
    financialQualityScore: number;
    riskScore: number;
    evidenceConfidence: number;
  };
  requestedDecision?: DecisionLabel;
  missingInformation?: string[];
  invalidationConditions?: string[];
}

export interface InvestmentDecisionRecord {
  decisionId: string;
  candidateId: string;
  researchMode: ResearchMode;
  securityQualityScore: number;
  valuationScore: number;
  financialQualityScore: number;
  riskScore: number;
  evidenceConfidence: number;
  portfolioFitScore?: number;
  decision: DecisionLabel;
  mainReasons: string[];
  strongestSupportingClaimIds: string[];
  strongestCounterClaimIds: string[];
  valuationRange?: [number, number];
  invalidationConditions: string[];
  missingInformation: string[];
  decisionConfidence: number;
  policyVersion: string;
  createdAt: string;
  gates: GateResult[];
}

export interface ResearchWorkflowInput {
  mode: ResearchMode;
  completedStates: ResearchState[];
  /**
   * FSM'den gelen gercek gecis tarihcesi. Verilirse sira, gecis tablosuna
   * gore dogrulanir (checklist'in aksine sonradan isaretlemeyi yakalar).
   */
  stateHistory?: ResearchState[];
  usedShortcuts?: string[];
  memoryCandidatesUsed?: boolean;
  watchlistSeedUsed?: boolean;
  previousRecommendationEvidenceUsed?: boolean;
  mandate?: ResearchMandate;
  universe?: UniverseSnapshot;
}

export interface AuditEvent {
  eventId: string;
  researchId: string;
  state: ResearchState;
  policyVersion: string;
  createdAt: string;
  details: Record<string, unknown>;
}

export interface ThesisMonitor {
  thesisId: string;
  candidateId: string;
  reviewFrequency: string;
  eventTriggers: MonitoringTrigger[];
  invalidationRules: InvalidationRule[];
  lastReviewedAt?: string;
  nextReviewAt?: string;
  status: 'ACTIVE' | 'INVALIDATED' | 'PAUSED' | 'CLOSED';
}

export type MonitoringTrigger =
  | 'PRICE_CHANGE'
  | 'VOLUME_ANOMALY'
  | 'EARNINGS_RELEASE'
  | 'GUIDANCE_CHANGE'
  | 'DEBT_THRESHOLD'
  | 'MARGIN_THRESHOLD'
  | 'CREDIT_RATING_CHANGE'
  | 'MANAGEMENT_CHANGE'
  | 'INSIDER_TRANSACTION'
  | 'CAPITAL_INCREASE'
  | 'DIVIDEND_CHANGE'
  | 'REGULATORY_EVENT'
  | 'THESIS_INVALIDATION';

export interface InvalidationRule {
  metric: string;
  operator: '>' | '>=' | '<' | '<=' | '==' | '!=';
  threshold: number | string;
  source: string;
}

export type PostMortemClass =
  | 'GOOD_PROCESS_GOOD_OUTCOME'
  | 'GOOD_PROCESS_BAD_OUTCOME'
  | 'BAD_PROCESS_GOOD_OUTCOME'
  | 'BAD_PROCESS_BAD_OUTCOME';

export interface PolicyImprovementProposal {
  proposalId: string;
  sourcePostMortemId: string;
  observedPattern: string;
  proposedChange: string;
  supportingCases: string[];
  confidence: number;
  status: 'PROPOSED' | 'NEEDS_MANUAL_REVIEW' | 'APPROVED' | 'REJECTED';
}

export interface ScreeningMetricSnapshot {
  symbol: string;
  price?: number;
  currency?: string;
  changePercent?: number;
  ret5d?: number | null;
  ret20d?: number | null;
  volatility?: number;
  avgVolume?: number;
  volumeRatio?: number;
  rangePosition?: number;
  trend?: 'YUKARI' | 'ASAGI' | 'YATAY' | string;
  sampleSize?: number;
  sourceEvidenceId: string;
  dataAsOf: string;
}

export interface ScreeningCandidate {
  candidateId: string;
  symbol: string;
  market: string;
  metrics: ScreeningMetricSnapshot;
  discoveryTags: string[];
  hardFilterFailures: string[];
  softScores: {
    liquidity: number;
    relativeStrength: number;
    volatilityControl: number;
    trendQuality: number;
    evidenceConfidence: number;
    composite: number;
  };
  rank?: number;
  status: 'RESEARCHABLE' | 'ELIMINATED' | 'PARTIAL_DATA';
}

export interface ScreeningConfig {
  minimumAverageDailyVolume: number;
  minimumSampleSize: number;
  maximumVolatility: number;
  minimumEvidenceConfidence: number;
  weights: {
    liquidity: number;
    relativeStrength: number;
    volatilityControl: number;
    trendQuality: number;
    evidenceConfidence: number;
  };
}

export interface ScreeningRunResult {
  mode: ResearchMode;
  universe: UniverseSnapshot;
  config: ScreeningConfig;
  candidates: ScreeningCandidate[];
  eliminated: ScreeningCandidate[];
  researchable: ScreeningCandidate[];
  policyWarnings: string[];
  status: 'SCREENING_READY' | 'PARTIAL_RESEARCH' | 'BLOCKED';
}

export interface RedTeamAssignment {
  assignmentId: string;
  candidateId: string;
  isolationKey: string;
  hiddenFields: string[];
  promptPackage: {
    researchQuestion?: string;
    candidateFacts: ResearchClaim[];
    evidence: EvidenceItem[];
    requiredQuestions: string[];
  };
}

export interface RedTeamIsolationResult {
  passed: boolean;
  hiddenFields: string[];
  leakedFields: string[];
  reasons: string[];
}

export type FinancialStatementKind = 'BALANCE_SHEET' | 'INCOME_STATEMENT' | 'CASH_FLOW' | 'EQUITY_CHANGE' | 'NOTES';
export type FinancialReportBasis = 'CONSOLIDATED' | 'SOLO';
export type FinancialReportPeriodType = 'QUARTERLY' | 'CUMULATIVE' | 'ANNUAL' | 'POINT_IN_TIME';
export type FinancialAuditStatus = 'AUDITED' | 'REVIEWED' | 'UNAUDITED' | 'UNKNOWN';
export type CompanyStatementProfile = 'INDUSTRIAL' | 'BANK' | 'INSURANCE' | 'HOLDING' | 'REIT' | 'OTHER';
export type FinancialValidationSeverity = 'INFO' | 'WARN' | 'ERROR' | 'BLOCKER';
export type FinancialCrossCheckProvider = 'FINTABLES' | 'IS_YATIRIM' | 'KAP_REVISED' | 'BORSA_ISTANBUL' | 'OTHER';
export type KapSyncDataType = 'FINANCIAL_REPORT' | 'DISCLOSURE' | 'COMPANY_PROFILE' | 'INDEX_MEMBERSHIP';
export type KapSyncStatus = 'idle' | 'checking' | 'fresh' | 'changed' | 'error' | 'backoff';
export type KapCacheDecision = 'USE_DB' | 'CHECK_KAP_DISCLOSURES' | 'FETCH_NEW_REPORT' | 'BACKOFF';

export interface KapCompany {
  symbol: string;
  kapMemberId?: string;
  title: string;
  market: 'BIST';
  sector?: string;
  statementProfile: CompanyStatementProfile;
  isActive: boolean;
  sourceUrl?: string;
  retrievedAt: string;
}

export interface KapDisclosure {
  disclosureId: string;
  symbol: string;
  title: string;
  disclosureType: string;
  publishedAt: string;
  kapUrl: string;
  hasFinancialReport: boolean;
  rawMetadata?: Record<string, unknown>;
}

export interface KapFinancialReport {
  reportId: string;
  disclosureId: string;
  symbol: string;
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd?: string;
  fiscalQuarter?: 1 | 2 | 3 | 4;
  periodType: FinancialReportPeriodType;
  basis: FinancialReportBasis;
  auditStatus: FinancialAuditStatus;
  currency: string;
  unit: 'TRY' | 'THOUSAND_TRY' | 'MILLION_TRY' | 'OTHER';
  sourceUrl: string;
  publishedAt: string;
  retrievedAt: string;
  isRestatement?: boolean;
  replacesReportId?: string;
  rawDocumentHash?: string;
  version?: number;
  isCurrent?: boolean;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  validationStatus?: 'pending' | 'passed' | 'failed' | 'partial';
  validationErrors?: Record<string, unknown>[];
}

export interface RawFinancialLineItem {
  rawItemId: string;
  reportId: string;
  symbol: string;
  statement: FinancialStatementKind;
  rawLabel: string;
  rawValue: number | string | null;
  taxonomyCode?: string;
  currency?: string;
  unit?: string;
  sourceUrl?: string;
  sourceTimestamp?: string;
  rawPayload?: Record<string, unknown>;
}

export interface RawFinancialArchiveItem {
  archiveId: string;
  report: KapFinancialReport;
  rawItems: RawFinancialLineItem[];
  archivedAt: string;
  sourceHash?: string;
}

export interface FinancialLineItemMapping {
  mappingId: string;
  statement: FinancialStatementKind;
  standardCode: string;
  standardLabel: string;
  taxonomyCode?: string;
  rawLabelPattern?: string;
  companyProfile?: CompanyStatementProfile;
  multiplier?: number;
  confidence: number;
  version: string;
}

export interface NormalizedFinancialFact {
  factId: string;
  reportId: string;
  rawItemId: string;
  symbol: string;
  fiscalYear: number;
  fiscalPeriod: string;
  fiscalQuarter?: 1 | 2 | 3 | 4;
  periodType: FinancialReportPeriodType;
  basis: FinancialReportBasis;
  statement: FinancialStatementKind;
  standardCode: string;
  standardLabel: string;
  rawLabel: string;
  rawValue: number;
  normalizedValue: number;
  currency: string;
  unit: string;
  auditStatus: FinancialAuditStatus;
  sourceUrl: string;
  sourceTimestamp: string;
  confidence: number;
  mappingVersion: string;
  restated: boolean;
}

export interface FinancialStatementSet {
  report: KapFinancialReport;
  facts: NormalizedFinancialFact[];
  companyProfile?: CompanyStatementProfile;
  previousCumulativeFacts?: NormalizedFinancialFact[];
}

export interface FinancialValidationIssue {
  issueId: string;
  severity: FinancialValidationSeverity;
  code: string;
  message: string;
  factIds: string[];
  expectedValue?: number;
  actualValue?: number;
  tolerance?: number;
}

export interface FinancialValidationReport {
  reportId: string;
  symbol: string;
  passed: boolean;
  blockingIssues: FinancialValidationIssue[];
  issues: FinancialValidationIssue[];
  validatedAt: string;
}

export interface FinancialCrossCheckInput {
  provider: FinancialCrossCheckProvider;
  symbol: string;
  fiscalPeriod: string;
  basis?: FinancialReportBasis;
  checkedAt: string;
  facts: Array<{
    standardCode: string;
    value: number;
    currency?: string;
    sourceUrl?: string;
  }>;
}

export interface FinancialCrossCheckReport {
  symbol: string;
  fiscalPeriod: string;
  provider: FinancialCrossCheckProvider;
  passed: boolean;
  issues: FinancialValidationIssue[];
  checkedAt: string;
}

export interface FinancialRatioSet {
  symbol: string;
  fiscalPeriod: string;
  basis: FinancialReportBasis;
  currency: string;
  ratios: Record<string, number | null>;
  qualityFlags: string[];
  calculatedAt: string;
}

export interface CompanyAnalysisSnapshot {
  symbol: string;
  fiscalPeriod: string;
  basis: FinancialReportBasis;
  ratios: FinancialRatioSet;
  validation: FinancialValidationReport;
  readiness: 'READY_FOR_ANALYSIS' | 'PARTIAL_DATA' | 'BLOCKED';
  blockingReasons: string[];
}

export interface KapSyncState {
  symbol: string;
  dataType: KapSyncDataType;
  lastDisclosureId?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  consecutiveNoChange: number;
  syncStatus: KapSyncStatus;
  lastError?: string;
  retryAfter?: string;
}

export interface KapCachePolicyConfig {
  normalCheckHours: number;
  reportingSeasonCheckHours: number;
  postReportCorrectionWindowHours: number;
  postReportCheckHours: number;
  staleAfterHours: number;
  maxNoChangeCheckHours: number;
  errorBackoffMinutes: number[];
}

export interface KapCacheEvaluationInput {
  now?: string;
  dataType: KapSyncDataType;
  syncState?: KapSyncState;
  currentReport?: KapFinancialReport;
  expectedReportDate?: string;
  marketIsInReportingSeason?: boolean;
  latestKapDisclosureId?: string;
  fetchForced?: boolean;
  lastErrorCount?: number;
  policy?: Partial<KapCachePolicyConfig>;
}

export interface KapCacheEvaluation {
  decision: KapCacheDecision;
  reason: string;
  shouldUseDb: boolean;
  shouldCheckKap: boolean;
  shouldFetchReport: boolean;
  nextCheckAt: string;
  checkedAt: string;
  cacheAgeHours?: number;
}

export interface VersionedKapReportPlan {
  report: KapFinancialReport;
  currentPointer: {
    symbol: string;
    fiscalPeriod: string;
    basis: FinancialReportBasis;
    currentReportId: string;
    version: number;
    currentDisclosureId: string;
    updatedAt: string;
  };
  supersedesReportId?: string;
}

// Policy verisi tek kaynaktan (shared/policy-core.cjs) turetilir. Kural
// degisikligi yalnizca orada yapilir; buradaki kod sadece typed goruntusudur.
const POLICY_REGISTRY: Record<ResearchMode, InvestmentResearchPolicy> = Object.fromEntries(
  (Object.keys(MODE_POLICY_DATA) as ResearchMode[]).map((mode) => {
    const data = MODE_POLICY_DATA[mode];
    const policy: InvestmentResearchPolicy = {
      id: data.id,
      version: data.version,
      mode,
      memory: { ...data.memory },
      requiredStates: [...data.requiredStates] as ResearchState[],
      forbiddenShortcuts: [...data.forbiddenShortcuts],
      finalDecision: { ...data.finalDecision },
    };
    return [mode, policy];
  }),
) as Record<ResearchMode, InvestmentResearchPolicy>;

const BUY_DECISIONS = new Set<DecisionLabel>(['AL', 'AL_AMA_KONTROLLU']);
const MATERIAL_FACTS = new Set<Materiality>(['HIGH', 'CRITICAL']);
const PRIMARY_TIERS = new Set<SourceTier>(['TIER_A_PRIMARY_OFFICIAL', 'TIER_B_OFFICIAL_CORPORATE']);

export function getInvestmentResearchPolicy(mode: ResearchMode): InvestmentResearchPolicy {
  return POLICY_REGISTRY[mode];
}

export function detectResearchMode(message: string): ResearchMode {
  return detectResearchModeCore(message) as ResearchMode;
}

export function buildResearchPlan(mode: ResearchMode): ResearchState[] {
  return [...getInvestmentResearchPolicy(mode).requiredStates];
}

export function createUniverseSnapshot(input: Omit<UniverseSnapshot, 'universeId' | 'createdAt'> & { createdAt?: string }): UniverseSnapshot {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const slug = `${input.market}-${input.assetType}-${createdAt.slice(0, 10)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    ...input,
    universeId: `${slug || 'universe'}-${input.rulesVersion}`,
    createdAt,
  };
}

export function buildResearchMandateGuidance(input: ResearchPreferenceInput = {}): ResearchMandateGuidance {
  const assumptions: string[] = [];
  const clarificationQuestions: string[] = [];
  const assumedFields: string[] = [];
  const market = input.market || 'BIST';
  const horizonMonths = input.horizonMonths || 18;
  const maxDrawdownPercent = input.maxDrawdownPercent ?? 20;
  if (!input.market) assumedFields.push('market');
  if (!input.horizonMonths) assumedFields.push('horizonMonths');
  if (input.maxDrawdownPercent === undefined) assumedFields.push('maxDrawdownPercent');
  if (!input.riskPreference) assumedFields.push('riskTolerance', 'riskCapacity');
  const inferredRisk = inferRiskTolerance({
    explicit: input.riskPreference,
    overrideRequested: input.riskOverrideRequested,
    maxDrawdownPercent,
    liquidityNeed: input.liquidityNeed,
  });

  if (!input.sectorPreference) {
    clarificationQuestions.push('Oncelikli sektor var mi? Yoksa tum BIST evreni taranacak.');
    assumptions.push('Sektor belirtilmedi: tum BIST evreni varsayildi.');
  }

  if (!input.horizonMonths) {
    clarificationQuestions.push('Yatirim ufku nedir? Varsayilan olarak 12-24 ay / 18 ay kabul edildi.');
    assumptions.push('Yatirim ufku belirtilmedi: 18 ay varsayildi.');
  }

  if (!input.riskPreference) {
    clarificationQuestions.push('Risk tercihin dusuk/orta/yuksek mi? Profil yeterli degilse orta risk varsayilir.');
    assumptions.push(`Risk tercihi acik degil: ${inferredRisk.riskTolerance} risk varsayildi.`);
  }

  if (!input.currentPortfolioKnown) {
    assumptions.push('Mevcut portfoy bilinmiyor: kisisellestirilmis pozisyon buyuklugu uretilmez.');
  }

  return {
    mandate: {
      investmentObjective: `${market} hisse arastirmasi`,
      horizonMonths,
      baseCurrency: 'TRY',
      market,
      riskTolerance: inferredRisk.riskTolerance,
      riskCapacity: inferredRisk.riskCapacity,
      maxDrawdownPercent,
      liquidityNeed: input.liquidityNeed,
      excludedSectors: input.sectorPreference && input.sectorPreference !== 'ALL_BIST' ? [] : undefined,
      currentPortfolioKnown: Boolean(input.currentPortfolioKnown),
      assumedFields,
    },
    assumptions,
    clarificationQuestions,
    riskAssessmentNote: inferredRisk.note,
    paidDataPolicy: {
      defaultMode: 'FREE_FIRST',
      allowPaidData: false,
      requiresUserApproval: true,
      note: 'Varsayilan veri politikasi free/public kaynaklardir. Ucretli veya kullandikca ode veri saglayici ancak kullanici fiyat/onay verdikten sonra eklenir.',
    },
  };
}

export function inferRiskTolerance(input: {
  explicit?: 'low' | 'medium' | 'high';
  overrideRequested?: boolean;
  maxDrawdownPercent?: number;
  liquidityNeed?: string;
}): { riskTolerance: 'low' | 'medium' | 'high'; riskCapacity: 'low' | 'medium' | 'high'; note: string } {
  if (input.explicit) {
    return {
      riskTolerance: input.explicit,
      riskCapacity: input.explicit,
      note: input.overrideRequested
        ? `Kullanici risk seviyesini acikca ${input.explicit} istedi; arastirma bu risk seviyesine gore filtrelenir.`
        : `Kullanici risk tercihi ${input.explicit} olarak beyan edildi.`,
    };
  }

  const drawdown = input.maxDrawdownPercent ?? 20;
  const liquidityNeed = (input.liquidityNeed || '').toLowerCase();
  if (drawdown <= 10 || liquidityNeed.includes('yüksek') || liquidityNeed.includes('yuksek')) {
    return {
      riskTolerance: 'low',
      riskCapacity: 'low',
      note: 'Risk seviyesi, dusuk maksimum kayip veya yuksek likidite ihtiyaci nedeniyle dusuk kabul edildi.',
    };
  }
  if (drawdown >= 30) {
    return {
      riskTolerance: 'high',
      riskCapacity: 'high',
      note: 'Risk seviyesi, yuksek maksimum kayip toleransi nedeniyle yuksek kabul edildi.',
    };
  }
  return {
    riskTolerance: 'medium',
    riskCapacity: 'medium',
    note: 'Risk seviyesi icin yeterli profil yok; sistem orta risk varsayimi kullandi.',
  };
}

export function evaluateResearchWorkflow(input: ResearchWorkflowInput): ValidationResult {
  const policy = getInvestmentResearchPolicy(input.mode);
  const gates: GateResult[] = [];
  const completed = new Set(input.completedStates);
  const missingStates = policy.requiredStates.filter((state) => !completed.has(state));

  gates.push({
    gate: 'STATE_MACHINE_GATE',
    status: missingStates.length > 0 ? 'BLOCK' : 'PASS',
    reasons: missingStates.map((state) => `Eksik state: ${state}`),
  });

  if (input.stateHistory && input.stateHistory.length > 0) {
    const sequence = validateStateSequence(input.stateHistory);
    gates.push({
      gate: 'STATE_SEQUENCE_GATE',
      status: sequence.valid ? 'PASS' : 'BLOCK',
      reasons: sequence.violations,
    });
  }

  const shortcuts = new Set(input.usedShortcuts ?? []);
  if (input.memoryCandidatesUsed) shortcuts.add('use_memory_as_evidence');
  if (input.watchlistSeedUsed) shortcuts.add('use_watchlist_as_seed');
  if (input.previousRecommendationEvidenceUsed) shortcuts.add('use_previous_recommendations_as_evidence');

  const forbidden = policy.forbiddenShortcuts.filter((shortcut) => shortcuts.has(shortcut));
  gates.push({
    gate: 'FORBIDDEN_SHORTCUT_GATE',
    status: forbidden.length > 0 ? 'BLOCK' : 'PASS',
    reasons: forbidden.map((shortcut) => `Yasak kisa yol kullanildi: ${shortcut}`),
  });

  if (policy.finalDecision.requireUniverse) {
    gates.push({
      gate: 'UNIVERSE_GATE',
      status: input.universe ? 'PASS' : 'BLOCK',
      reasons: input.universe ? [] : ['Arastirma evreni dondurulmeden aday siralanamaz.'],
    });
  }

  const mandateComplete = isMandateComplete(input.mandate);
  gates.push({
    gate: 'MANDATE_GATE',
    status: mandateComplete ? 'PASS' : 'WARN',
    reasons: mandateComplete ? [] : ['Mandate eksik: kisisellestirilmis AL/SAT ve pozisyon buyuklugu uretilemez.'],
  });

  return summarizeGates(gates);
}

export function validateEvidenceAndClaims(evidence: EvidenceItem[], claims: ResearchClaim[]): ValidationResult {
  const gates: GateResult[] = [];
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const reasons: string[] = [];

  for (const item of evidence) {
    if (!item.retrievedAt) reasons.push(`${item.evidenceId}: retrievedAt eksik.`);
    if (!item.publisher) reasons.push(`${item.evidenceId}: publisher eksik.`);
    if (item.sourceType.toLowerCase().includes('snippet')) {
      reasons.push(`${item.evidenceId}: arama snippet'i nihai kanit sayilamaz.`);
    }
  }

  for (const claim of claims) {
    const claimEvidence = claim.evidenceIds.map((id) => evidenceById.get(id)).filter(isDefined);
    const contradictionEvidence = claim.contradictionEvidenceIds.map((id) => evidenceById.get(id)).filter(isDefined);

    if (claim.evidenceIds.length === 0) {
      reasons.push(`${claim.claimId}: maddi iddia kanitsiz.`);
    }
    if (claim.type === 'FACT' && MATERIAL_FACTS.has(claim.materiality)) {
      const hasPrimaryEvidence = claimEvidence.some((item) => PRIMARY_TIERS.has(item.sourceTier));
      if (!hasPrimaryEvidence) {
        reasons.push(`${claim.claimId}: HIGH/CRITICAL FACT icin birincil veya resmi kanit yok.`);
      }
      const onlyTierD = claimEvidence.length > 0 && claimEvidence.every((item) => item.sourceTier === 'TIER_D_UNVERIFIED');
      if (onlyTierD) {
        reasons.push(`${claim.claimId}: TIER_D kaynak tek basina kritik iddia dogrulayamaz.`);
      }
      // Ayni haberin kopyalari bagimsiz kanit sayilmaz: birden fazla kanit
      // gorunse de hepsi ayni kaynak ailesindense tek kaynak kabul edilir.
      const independentSources = countIndependentSources(claimEvidence);
      if (claimEvidence.length > 1 && independentSources < 2) {
        reasons.push(`${claim.claimId}: kanitlar ayni kaynak ailesinin kopyalari; bagimsiz ikinci kaynak yok.`);
      }
    }
    if (claim.type === 'MANAGEMENT_GUIDANCE' && claim.status === 'VERIFIED') {
      reasons.push(`${claim.claimId}: yonetim beklentisi FACT gibi kesin dogrulanmis isaretlenemez.`);
    }
    if (contradictionEvidence.length > 0 && claim.status !== 'UNRESOLVED' && claim.status !== 'CONTRADICTED') {
      reasons.push(`${claim.claimId}: celiskili kanit var ama claim UNRESOLVED/CONTRADICTED degil.`);
    }
    if (claim.confidence < 0 || claim.confidence > 1) {
      reasons.push(`${claim.claimId}: confidence 0-1 araliginda olmali.`);
    }
  }

  gates.push({
    gate: 'CLAIM_VALIDATION_GATE',
    status: reasons.length > 0 ? 'BLOCK' : 'PASS',
    reasons,
  });

  return summarizeGates(gates);
}

/**
 * Kademeli freshness kapisi (DATA_FRESHNESS_GATE).
 *
 * STALE tek bayragina degil, veri kategorisine gore davranir:
 * fiyat/kur gibi anlik veriler eskiyse sert blok; bilanco yalnizca daha yeni
 * surumu bilindigi halde eski kullaniliyorsa blok; tarihsel seriler serbest;
 * kategorisiz eski veri HIGH/CRITICAL iddiada blok, digerlerinde uyari.
 */
export function validateEvidenceFreshness(
  claims: ResearchClaim[],
  evidence: EvidenceItem[],
  now: Date = new Date(),
): ValidationResult {
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  const reasons: string[] = [];
  const warnings: string[] = [];

  for (const claim of claims) {
    for (const evidenceId of claim.evidenceIds) {
      const item = evidenceById.get(evidenceId);
      if (!item) continue;
      const referenceTime = item.publishedAt ?? item.retrievedAt;
      const ageHours = referenceTime
        ? (now.getTime() - new Date(referenceTime).getTime()) / 3_600_000
        : undefined;
      const result = evaluateFreshness({
        dataCategory: item.dataCategory,
        freshnessStatus: item.freshnessStatus,
        ageHours,
        newerVersionKnown: item.newerVersionKnown,
        materiality: claim.materiality,
      });
      if (result.action === 'BLOCK') {
        reasons.push(`${claim.claimId}/${item.evidenceId}: ${result.reason}`);
      } else if (result.action === 'WARN') {
        warnings.push(`${claim.claimId}/${item.evidenceId}: ${result.reason}`);
      }
    }
  }

  const gate: GateResult = {
    gate: 'DATA_FRESHNESS_GATE',
    status: reasons.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS',
    reasons: reasons.length > 0 ? reasons : warnings,
  };
  return summarizeGates([gate]);
}

export interface ResearchStateMachine {
  readonly researchId: string;
  readonly mode: ResearchMode;
  getState(): ResearchState;
  getHistory(): ResearchState[];
  getAuditEvents(): AuditEvent[];
  canAdvance(to: ResearchState): boolean;
  /** Gecis tablosunda izinli degilse ilerletmez; nedenini dondurur. */
  advance(to: ResearchState, details?: Record<string, unknown>): { ok: boolean; state: ResearchState; reason?: string };
  /** Ayni state'te retry; RETRYABLE_STATES limiti asilirsa FAILED'a gecer. */
  retry(reason: string): { ok: boolean; remaining: number };
  block(reason: string): void;
  fail(reason: string): void;
  /** BLOCKED'dan bloklanmadan onceki state'e geri doner. */
  unblock(): { ok: boolean; state: ResearchState };
  isCapabilityAllowedNow(capability: ResearchCapability): boolean;
}

/**
 * Gercek FSM: yanlis asamaya gecisi sonradan degil, baştan engeller.
 * Checklist dogrulamasi (evaluateResearchWorkflow) tamamlanmis kayitlar icin
 * kalir; runtime akisi bu makine uzerinden yurumelidir.
 */
export function createResearchStateMachine(options: {
  researchId: string;
  mode: ResearchMode;
  policyVersion?: string;
  initialState?: ResearchState;
}): ResearchStateMachine {
  const policy = getInvestmentResearchPolicy(options.mode);
  const policyVersion = options.policyVersion ?? `${policy.id}@${policy.version}`;
  let current: ResearchState = options.initialState ?? 'INTAKE';
  let stateBeforeBlock: ResearchState | undefined;
  const history: ResearchState[] = [current];
  const auditEvents: AuditEvent[] = [];
  const retryCounts = new Map<ResearchState, number>();

  const recordAudit = (state: ResearchState, details: Record<string, unknown>) => {
    auditEvents.push(createAuditEvent({
      researchId: options.researchId,
      state,
      policyVersion,
      details,
    }));
  };
  recordAudit(current, { event: 'fsm_created', mode: options.mode });

  return {
    researchId: options.researchId,
    mode: options.mode,
    getState: () => current,
    getHistory: () => [...history],
    getAuditEvents: () => [...auditEvents],
    canAdvance: (to) => isTransitionAllowed(current, to),
    advance(to, details = {}) {
      if (!isTransitionAllowed(current, to)) {
        recordAudit(current, { event: 'transition_rejected', attempted: to, ...details });
        return { ok: false, state: current, reason: `Gecersiz gecis: ${current} -> ${to}` };
      }
      if (to === 'BLOCKED') stateBeforeBlock = current;
      current = to;
      history.push(to);
      recordAudit(to, { event: 'transition', ...details });
      return { ok: true, state: current };
    },
    retry(reason) {
      const limit = (RETRYABLE_STATES as Record<string, number>)[current] ?? 0;
      const used = (retryCounts.get(current) ?? 0) + 1;
      retryCounts.set(current, used);
      if (used > limit) {
        recordAudit(current, { event: 'retry_exhausted', reason, used, limit });
        current = 'FAILED';
        history.push('FAILED');
        recordAudit('FAILED', { event: 'transition', cause: 'retry_exhausted' });
        return { ok: false, remaining: 0 };
      }
      recordAudit(current, { event: 'retry', reason, used, limit });
      return { ok: true, remaining: limit - used };
    },
    block(reason) {
      stateBeforeBlock = current;
      current = 'BLOCKED';
      history.push('BLOCKED');
      recordAudit('BLOCKED', { event: 'transition', reason });
    },
    fail(reason) {
      current = 'FAILED';
      history.push('FAILED');
      recordAudit('FAILED', { event: 'transition', reason });
    },
    unblock() {
      if (current !== 'BLOCKED' || !stateBeforeBlock) {
        return { ok: false, state: current };
      }
      current = stateBeforeBlock;
      history.push(current);
      recordAudit(current, { event: 'unblocked' });
      stateBeforeBlock = undefined;
      return { ok: true, state: current };
    },
    isCapabilityAllowedNow(capability) {
      return isCapabilityAllowed(current, capability);
    },
  };
}

export function validateFinancialMetrics(metrics: FinancialMetric[], evidence: EvidenceItem[] = []): ValidationResult {
  const gates: GateResult[] = [];
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const reasons: string[] = [];

  for (const metric of metrics) {
    if (!Number.isFinite(metric.value)) reasons.push(`${metric.metric}: value sonlu sayi degil.`);
    if (!metric.currency) reasons.push(`${metric.metric}: currency eksik.`);
    if (!metric.unit) reasons.push(`${metric.metric}: unit eksik.`);
    if (!metric.reportingPeriod) reasons.push(`${metric.metric}: reportingPeriod eksik.`);
    if (!metric.sourceEvidenceId) reasons.push(`${metric.metric}: sourceEvidenceId eksik.`);
    if (evidence.length > 0 && metric.sourceEvidenceId && !evidenceIds.has(metric.sourceEvidenceId)) {
      reasons.push(`${metric.metric}: sourceEvidenceId evidence listesinde yok.`);
    }
  }

  gates.push({
    gate: 'FINANCIAL_DATA_GATE',
    status: reasons.length > 0 ? 'BLOCK' : 'PASS',
    reasons,
  });

  return summarizeGates(gates);
}

export function validateMetricComparison(metrics: FinancialMetric[]): ValidationResult {
  const gates: GateResult[] = [];
  const currencies = new Set(metrics.map((metric) => metric.currency));
  const periodTypes = new Set(metrics.map((metric) => metric.periodType));
  const reasons: string[] = [];

  if (currencies.size > 1) reasons.push('Farkli para birimleri sessizce karsilastirilamaz.');
  if (periodTypes.has('ANNUAL') && periodTypes.has('TTM')) reasons.push('ANNUAL ve TTM verileri sessizce karsilastirilamaz.');
  if (periodTypes.has('QUARTERLY') && periodTypes.has('ANNUAL')) reasons.push('QUARTERLY ve ANNUAL verileri donusturulmeden karsilastirilamaz.');

  gates.push({
    gate: 'FINANCIAL_COMPARISON_GATE',
    status: reasons.length > 0 ? 'BLOCK' : 'PASS',
    reasons,
  });

  return summarizeGates(gates);
}

export function validateValuation(models: ValuationModel[], scenarios: InvestmentScenario[]): ValidationResult {
  const gates: GateResult[] = [];
  const reasons: string[] = [];

  for (const model of models) {
    const hasTarget = model.estimatedValue !== undefined || model.estimatedRange !== undefined;
    if (hasTarget && Object.keys(model.assumptions).length === 0) {
      reasons.push(`${model.method}: fiyat hedefi/deger araligi varsayimsiz uretilemez.`);
    }
    if (!model.currency) reasons.push(`${model.method}: currency eksik.`);
    if (!model.formulaVersion) reasons.push(`${model.method}: formulaVersion eksik.`);
    if (model.evidenceIds.length === 0) reasons.push(`${model.method}: evidenceIds eksik.`);
    if (model.method.toUpperCase() === 'DCF' && model.sensitivityAnalysis.length === 0) {
      reasons.push('DCF hassasiyet analizi olmadan yuksek guvenle sunulamaz.');
    }
    if (model.estimatedRange && model.estimatedRange[0] > model.estimatedRange[1]) {
      reasons.push(`${model.method}: estimatedRange sirasi hatali.`);
    }
  }

  const scenarioNames = new Set(scenarios.map((scenario) => scenario.name));
  for (const required of ['BEAR', 'BASE', 'BULL'] as ScenarioName[]) {
    if (!scenarioNames.has(required)) reasons.push(`Senaryo eksik: ${required}`);
  }

  const probabilityScenarios = scenarios.filter((scenario) => scenario.probability !== undefined);
  if (probabilityScenarios.length > 0) {
    const totalProbability = probabilityScenarios.reduce((sum, scenario) => sum + (scenario.probability ?? 0), 0);
    if (Math.abs(totalProbability - 1) > 0.001) reasons.push('Senaryo olasiliklari toplami 1 olmali.');
    for (const scenario of probabilityScenarios) {
      if (!scenario.probabilityRationale) reasons.push(`${scenario.name}: probabilityRationale eksik.`);
    }
  }

  gates.push({
    gate: 'VALUATION_GATE',
    status: reasons.length > 0 ? 'BLOCK' : 'PASS',
    reasons,
  });

  return summarizeGates(gates);
}

export function evaluateSuitability(mandate: ResearchMandate | undefined, partial: Omit<SuitabilityAssessment, 'personalizedRecommendationAllowed' | 'blockingReasons'>): SuitabilityAssessment {
  const blockingReasons: string[] = [];
  if (!isMandateComplete(mandate)) blockingReasons.push('Mandate eksik.');
  if (partial.portfolioFitScore !== undefined && partial.portfolioFitScore < 40) blockingReasons.push('Portfoy uyumu zayif.');
  if (partial.riskToleranceFit !== undefined && partial.riskToleranceFit < 40) blockingReasons.push('Risk toleransi uyumu zayif.');
  if (partial.riskCapacityFit !== undefined && partial.riskCapacityFit < 40) blockingReasons.push('Risk tasima kapasitesi uyumu zayif.');

  return {
    ...partial,
    personalizedRecommendationAllowed: blockingReasons.length === 0,
    blockingReasons,
  };
}

export function validateCounterThesis(counterThesis?: CounterThesis): ValidationResult {
  const reasons: string[] = [];
  if (!counterThesis) {
    reasons.push('Counter thesis zorunlu.');
  } else {
    if (!counterThesis.strongestBearCase) reasons.push('Counter thesis bear case eksik.');
    if (counterThesis.supportingEvidenceIds.length === 0) reasons.push('Counter thesis kanit baglantisi eksik.');
    if (counterThesis.thesisInvalidationRisks.length === 0) reasons.push('Tez gecersizlik riskleri eksik.');
  }

  return summarizeGates([{
    gate: 'COUNTER_THESIS_GATE',
    status: reasons.length > 0 ? 'BLOCK' : 'PASS',
    reasons,
  }]);
}

export function createInvestmentDecision(input: InvestmentDecisionInput): InvestmentDecisionRecord {
  const policy = input.policy ?? getInvestmentResearchPolicy(input.researchMode);
  const workflow = evaluateResearchWorkflow({
    mode: input.researchMode,
    completedStates: input.completedStates,
    mandate: input.mandate,
    universe: input.universe,
  });
  const claims = validateEvidenceAndClaims(input.evidence, input.claims);
  const freshness = validateEvidenceFreshness(input.claims, input.evidence);
  const metrics = validateFinancialMetrics(input.financialMetrics, input.evidence);
  const valuation = validateValuation(input.valuationModels, input.scenarios);
  const counter = validateCounterThesis(input.counterThesis);
  const suitabilityGate: GateResult = {
    gate: 'SUITABILITY_GATE',
    status: input.suitability.personalizedRecommendationAllowed ? 'PASS' : 'WARN',
    reasons: input.suitability.blockingReasons,
  };
  const riskGate: GateResult = {
    gate: 'RISK_GATE',
    status: input.completedStates.includes('RISK_ANALYSIS') ? 'PASS' : 'BLOCK',
    reasons: input.completedStates.includes('RISK_ANALYSIS') ? [] : ['Risk analizi tamamlanmadi.'],
  };

  const gates = [
    ...workflow.gates,
    ...claims.gates,
    ...freshness.gates,
    ...metrics.gates,
    ...valuation.gates,
    ...counter.gates,
    suitabilityGate,
    riskGate,
  ];

  const blockingReasons = gates.flatMap((gate) => gate.status === 'BLOCK' ? gate.reasons : []);
  const requestedDecision = input.requestedDecision ?? inferDecision(input);
  const buyBlocked = BUY_DECISIONS.has(requestedDecision) && (
    input.scores.evidenceConfidence < policy.finalDecision.minEvidenceConfidenceForBuy ||
    !input.suitability.personalizedRecommendationAllowed ||
    blockingReasons.length > 0
  );

  const decision: DecisionLabel = blockingReasons.length > 0
    ? 'VERI_YETERSIZ'
    : buyBlocked
      ? 'BEKLE'
      : requestedDecision;

  const valuationRange = firstValuationRange(input.valuationModels);
  const supportingClaims = input.claims
    .filter((claim) => claim.status === 'VERIFIED' || claim.status === 'PARTIALLY_VERIFIED')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((claim) => claim.claimId);
  const counterClaims = input.claims
    .filter((claim) => claim.status === 'CONTRADICTED' || claim.status === 'UNRESOLVED')
    .slice(0, 3)
    .map((claim) => claim.claimId);

  return {
    decisionId: `decision-${input.candidateId}-${Date.now()}`,
    candidateId: input.candidateId,
    researchMode: input.researchMode,
    securityQualityScore: input.scores.securityQualityScore,
    valuationScore: input.scores.valuationScore,
    financialQualityScore: input.scores.financialQualityScore,
    riskScore: input.scores.riskScore,
    evidenceConfidence: input.scores.evidenceConfidence,
    portfolioFitScore: input.suitability.portfolioFitScore,
    decision,
    mainReasons: blockingReasons.length > 0
      ? blockingReasons
      : buildDecisionReasons(input, decision),
    strongestSupportingClaimIds: supportingClaims,
    strongestCounterClaimIds: counterClaims,
    valuationRange,
    invalidationConditions: input.invalidationConditions ?? input.counterThesis?.thesisInvalidationRisks ?? [],
    missingInformation: [...(input.missingInformation ?? []), ...blockingReasons],
    decisionConfidence: calculateDecisionConfidence(input, gates, decision),
    policyVersion: `${policy.id}@${policy.version}`,
    createdAt: new Date().toISOString(),
    gates,
  };
}

export function composeResearchReport(decision: InvestmentDecisionRecord): ValidationResult & { report?: string } {
  const blocked = decision.gates.filter((gate) => gate.status === 'BLOCK');
  if (blocked.length > 0) {
    const result = summarizeGates(decision.gates);
    return {
      ...result,
      report: [
        'PARTIAL_RESEARCH',
        `Karar: ${decision.decision}`,
        `Policy: ${decision.policyVersion}`,
        'Tamamlanamayan kapilar:',
        ...blocked.map((gate) => `- ${gate.gate}: ${gate.reasons.join(' | ')}`),
      ].join('\n'),
    };
  }

  return {
    passed: true,
    gates: decision.gates,
    blockingReasons: [],
    warnings: decision.gates.flatMap((gate) => gate.status === 'WARN' ? gate.reasons : []),
    report: [
      `Karar: ${decision.decision}`,
      `Policy: ${decision.policyVersion}`,
      `Kanıt güveni: ${decision.evidenceConfidence}`,
      `Ana gerekceler: ${decision.mainReasons.join(' | ')}`,
      `Ters kanit/claim: ${decision.strongestCounterClaimIds.join(', ') || 'yok'}`,
      `Gecersizlik kosullari: ${decision.invalidationConditions.join(' | ') || 'tanimlanmadi'}`,
    ].join('\n'),
  };
}

export function createThesisMonitor(input: Omit<ThesisMonitor, 'status'> & { status?: ThesisMonitor['status'] }): ThesisMonitor {
  return {
    ...input,
    status: input.status ?? 'ACTIVE',
  };
}

export function createRedTeamAssignment(input: {
  candidateId: string;
  researchQuestion?: string;
  claims: ResearchClaim[];
  evidence: EvidenceItem[];
  hiddenFields?: string[];
}): RedTeamAssignment {
  const hiddenFields = input.hiddenFields ?? [
    'main_rating',
    'requested_decision',
    'analyst_recommendation',
    'security_quality_score',
    'valuation_score',
    'decision_confidence',
  ];

  return {
    assignmentId: `red-team-${input.candidateId}-${Date.now()}`,
    candidateId: input.candidateId,
    isolationKey: `blind-${Math.random().toString(36).slice(2, 10)}`,
    hiddenFields,
    promptPackage: {
      researchQuestion: input.researchQuestion,
      candidateFacts: input.claims.map((claim) => ({
        ...claim,
        confidence: Math.min(claim.confidence, 0.75),
      })),
      evidence: input.evidence,
      requiredQuestions: [
        'Ana tez neden yanlis olabilir?',
        'Sirket neden ucuz olabilir?',
        'Kar kalitesi neden dusuk olabilir?',
        'Nakit akisi neden muhasebe karindan ayrisiyor olabilir?',
        'Borc neden sorun olabilir?',
        'Yonetim anlatisi hangi verilerle celisiyor?',
        'Hangi risk fiyatlanmamis olabilir?',
        'En guclu negatif kanit nedir?',
        'Tezi tamamen gecersiz kilacak olay nedir?',
        'Rakip analist bu yatirimi hangi gerekceyle reddederdi?',
      ],
    },
  };
}

export function validateRedTeamIsolation(assignment: RedTeamAssignment, exposedContext: Record<string, unknown>): RedTeamIsolationResult {
  const leakedFields = assignment.hiddenFields.filter((field) => hasDeepKey(exposedContext, field));
  const reasons = leakedFields.map((field) => `Red Team izolasyonu ihlal edildi: ${field} gorunuyor.`);
  return {
    passed: leakedFields.length === 0,
    hiddenFields: assignment.hiddenFields,
    leakedFields,
    reasons,
  };
}

export function classifyPostMortem(processPassed: boolean, outcomePositive: boolean): PostMortemClass {
  if (processPassed && outcomePositive) return 'GOOD_PROCESS_GOOD_OUTCOME';
  if (processPassed && !outcomePositive) return 'GOOD_PROCESS_BAD_OUTCOME';
  if (!processPassed && outcomePositive) return 'BAD_PROCESS_GOOD_OUTCOME';
  return 'BAD_PROCESS_BAD_OUTCOME';
}

export function proposePolicyImprovement(input: Omit<PolicyImprovementProposal, 'proposalId' | 'status'> & { status?: PolicyImprovementProposal['status'] }): PolicyImprovementProposal {
  return {
    ...input,
    proposalId: `policy-proposal-${Date.now()}`,
    status: input.status ?? 'NEEDS_MANUAL_REVIEW',
  };
}

export function createAuditEvent(input: Omit<AuditEvent, 'eventId' | 'createdAt'> & { createdAt?: string }): AuditEvent {
  return {
    ...input,
    eventId: `audit-${input.researchId}-${input.state}-${Date.now()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export const DEFAULT_SCREENING_CONFIG: ScreeningConfig = {
  minimumAverageDailyVolume: 100000,
  minimumSampleSize: 20,
  // BİRİM: günlük getiri standart sapması (%). Eski değer 35'ti ve ARALIK
  // GENİŞLİĞİ semantiğine aitti; canlı taraf 2026-08-09'da std-sapmaya geçti
  // ve iki hesap aynı koşula zıt etiket vermeye başladı. Tek kaynak artık
  // policy-core; bkz. VOLATILITY_UNIT.
  maximumVolatility: DEFAULT_VOLATILITY_CAP,
  minimumEvidenceConfidence: 0.7,
  weights: {
    liquidity: 0.2,
    relativeStrength: 0.25,
    volatilityControl: 0.2,
    trendQuality: 0.2,
    evidenceConfidence: 0.15,
  },
};

export function buildScreeningCandidate(input: {
  symbol: string;
  market?: string;
  metrics: ScreeningMetricSnapshot;
  discoveryTags?: string[];
  config?: Partial<ScreeningConfig>;
}): ScreeningCandidate {
  const config = mergeScreeningConfig(input.config);
  const hardFilterFailures: string[] = [];
  const avgVolume = input.metrics.avgVolume ?? 0;
  const sampleSize = input.metrics.sampleSize ?? 0;
  const volatility = input.metrics.volatility ?? Number.POSITIVE_INFINITY;
  const evidenceConfidence = input.metrics.sourceEvidenceId ? 0.78 : 0.35;

  if (avgVolume < config.minimumAverageDailyVolume) {
    hardFilterFailures.push(`Likidite yetersiz: ${avgVolume} < ${config.minimumAverageDailyVolume}`);
  }
  if (sampleSize < config.minimumSampleSize) {
    hardFilterFailures.push(`Veri gecmisi yetersiz: ${sampleSize} < ${config.minimumSampleSize}`);
  }
  if (volatility > config.maximumVolatility) {
    hardFilterFailures.push(`Volatilite policy ustunde: ${volatility} > ${config.maximumVolatility}`);
  }
  if (evidenceConfidence < config.minimumEvidenceConfidence) {
    hardFilterFailures.push(`Kanıt guveni dusuk: ${evidenceConfidence} < ${config.minimumEvidenceConfidence}`);
  }

  const liquidity = scoreLiquidity(avgVolume, config.minimumAverageDailyVolume);
  const relativeStrength = scoreRelativeStrength(input.metrics.ret20d, input.metrics.changePercent, input.discoveryTags ?? []);
  const volatilityControl = scoreVolatilityControl(volatility, config.maximumVolatility);
  const trendQuality = scoreTrendQuality(input.metrics.trend, input.metrics.rangePosition, input.metrics.volumeRatio);
  const evidenceScore = Math.round(evidenceConfidence * 100);
  const composite = Math.round(
    liquidity * config.weights.liquidity +
    relativeStrength * config.weights.relativeStrength +
    volatilityControl * config.weights.volatilityControl +
    trendQuality * config.weights.trendQuality +
    evidenceScore * config.weights.evidenceConfidence,
  );

  return {
    candidateId: input.symbol.replace(/\.IS$/i, ''),
    symbol: input.symbol,
    market: input.market ?? 'BIST',
    metrics: input.metrics,
    discoveryTags: input.discoveryTags ?? [],
    hardFilterFailures,
    softScores: {
      liquidity,
      relativeStrength,
      volatilityControl,
      trendQuality,
      evidenceConfidence: evidenceScore,
      composite,
    },
    status: hardFilterFailures.length > 0
      ? 'ELIMINATED'
      : sampleSize < config.minimumSampleSize * 1.5
        ? 'PARTIAL_DATA'
        : 'RESEARCHABLE',
  };
}

export function runInvestmentScreening(input: {
  mode: ResearchMode;
  universe: UniverseSnapshot;
  snapshots: ScreeningMetricSnapshot[];
  discoveryTagsBySymbol?: Record<string, string[]>;
  config?: Partial<ScreeningConfig>;
}): ScreeningRunResult {
  const config = mergeScreeningConfig(input.config);
  const candidates = input.snapshots.map((snapshot) => buildScreeningCandidate({
    symbol: snapshot.symbol,
    market: input.universe.market,
    metrics: snapshot,
    discoveryTags: input.discoveryTagsBySymbol?.[snapshot.symbol] ?? [],
    config,
  }));
  const researchable = candidates
    .filter((candidate) => candidate.status !== 'ELIMINATED')
    .sort((a, b) => b.softScores.composite - a.softScores.composite)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const eliminated = candidates.filter((candidate) => candidate.status === 'ELIMINATED');
  const policyWarnings: string[] = [];

  const onlyRecentGainers = candidates.length > 0 && candidates.every((candidate) => candidate.discoveryTags.includes('recent_gainer'));
  if (input.mode === 'FRESH_MARKET_SCAN' && onlyRecentGainers) {
    policyWarnings.push('Fresh market scan sadece recent_gainer discovery evreninden olusamaz.');
  }
  if (!input.universe.securityCount || input.universe.securityCount < 10) {
    policyWarnings.push('Evren dar: genis piyasa taramasi icin daha fazla sembol gerekir.');
  }

  return {
    mode: input.mode,
    universe: input.universe,
    config,
    candidates,
    eliminated,
    researchable,
    policyWarnings,
    status: policyWarnings.some((warning) => warning.includes('sadece recent_gainer'))
      ? 'BLOCKED'
      : researchable.length === 0
        ? 'PARTIAL_RESEARCH'
        : 'SCREENING_READY',
  };
}

export function archiveKapFinancialReport(input: {
  report: KapFinancialReport;
  rawItems: RawFinancialLineItem[];
  archivedAt?: string;
  sourceHash?: string;
}): RawFinancialArchiveItem {
  return {
    archiveId: `kap-archive-${input.report.reportId}-${Date.now()}`,
    report: input.report,
    rawItems: input.rawItems.map((item) => ({
      ...item,
      reportId: input.report.reportId,
      symbol: input.report.symbol,
      sourceUrl: item.sourceUrl ?? input.report.sourceUrl,
      sourceTimestamp: item.sourceTimestamp ?? input.report.retrievedAt,
    })),
    archivedAt: input.archivedAt ?? new Date().toISOString(),
    sourceHash: input.sourceHash ?? input.report.rawDocumentHash,
  };
}

export function normalizeKapFinancialLineItems(input: {
  report: KapFinancialReport;
  rawItems: RawFinancialLineItem[];
  mappings: FinancialLineItemMapping[];
  companyProfile?: CompanyStatementProfile;
}): { facts: NormalizedFinancialFact[]; unmappedItems: RawFinancialLineItem[]; issues: FinancialValidationIssue[] } {
  const facts: NormalizedFinancialFact[] = [];
  const unmappedItems: RawFinancialLineItem[] = [];
  const issues: FinancialValidationIssue[] = [];

  for (const item of input.rawItems) {
    const numericValue = coerceFinancialNumber(item.rawValue);
    if (numericValue === null) {
      issues.push(createFinancialIssue({
        severity: 'WARN',
        code: 'NON_NUMERIC_RAW_VALUE',
        message: `${item.rawLabel} sayisal degere donusturulemedi.`,
        factIds: [item.rawItemId],
      }));
      continue;
    }

    const mapping = findFinancialMapping(item, input.mappings, input.companyProfile);
    if (!mapping) {
      unmappedItems.push(item);
      issues.push(createFinancialIssue({
        severity: 'WARN',
        code: 'UNMAPPED_LINE_ITEM',
        message: `${item.rawLabel} standart finansal kaleme eslenemedi.`,
        factIds: [item.rawItemId],
      }));
      continue;
    }

    const multiplier = mapping.multiplier ?? unitMultiplier(item.unit ?? input.report.unit);
    const normalizedValue = numericValue * multiplier;
    facts.push({
      factId: `${input.report.reportId}-${mapping.standardCode}-${item.rawItemId}`.replace(/[^a-zA-Z0-9_.-]/g, '-'),
      reportId: input.report.reportId,
      rawItemId: item.rawItemId,
      symbol: input.report.symbol,
      fiscalYear: input.report.fiscalYear,
      fiscalPeriod: input.report.fiscalPeriod,
      fiscalQuarter: input.report.fiscalQuarter,
      periodType: input.report.periodType,
      basis: input.report.basis,
      statement: item.statement,
      standardCode: mapping.standardCode,
      standardLabel: mapping.standardLabel,
      rawLabel: item.rawLabel,
      rawValue: numericValue,
      normalizedValue,
      currency: item.currency ?? input.report.currency,
      unit: item.unit ?? input.report.unit,
      auditStatus: input.report.auditStatus,
      sourceUrl: item.sourceUrl ?? input.report.sourceUrl,
      sourceTimestamp: item.sourceTimestamp ?? input.report.retrievedAt,
      confidence: Math.min(1, Math.max(0, mapping.confidence)),
      mappingVersion: mapping.version,
      restated: Boolean(input.report.isRestatement),
    });
  }

  return { facts, unmappedItems, issues };
}

export function deriveQuarterlyFactsFromCumulative(input: {
  currentCumulative: NormalizedFinancialFact[];
  previousCumulative: NormalizedFinancialFact[];
  targetReportId?: string;
}): NormalizedFinancialFact[] {
  const previousByCode = new Map(input.previousCumulative.map((fact) => [quarterlyFactKey(fact), fact]));
  return input.currentCumulative
    .filter((fact) => fact.periodType === 'CUMULATIVE' && fact.statement !== 'BALANCE_SHEET')
    .map((fact) => {
      const previous = previousByCode.get(quarterlyFactKey(fact));
      const derivedValue = previous ? fact.normalizedValue - previous.normalizedValue : fact.normalizedValue;
      return {
        ...fact,
        factId: `${input.targetReportId ?? fact.reportId}-quarterly-${fact.standardCode}`,
        reportId: input.targetReportId ?? fact.reportId,
        periodType: 'QUARTERLY',
        normalizedValue: derivedValue,
        rawValue: derivedValue,
        confidence: previous ? Math.min(fact.confidence, previous.confidence, 0.92) : Math.min(fact.confidence, 0.75),
      };
    });
}

export function validateFinancialStatementSet(input: FinancialStatementSet): FinancialValidationReport {
  const issues: FinancialValidationIssue[] = [];
  const facts = input.facts;
  const byCode = groupFactsByStandardCode(facts);
  const basisSet = new Set(facts.map((fact) => fact.basis));
  const currencySet = new Set(facts.map((fact) => fact.currency));
  const periodSet = new Set(facts.map((fact) => fact.fiscalPeriod));
  const reportIdSet = new Set(facts.map((fact) => fact.reportId));

  if (basisSet.size > 1) {
    issues.push(createFinancialIssue({
      severity: 'BLOCKER',
      code: 'MIXED_REPORT_BASIS',
      message: 'Solo ve konsolide finansallar ayni analiz setinde karistirildi.',
      factIds: facts.map((fact) => fact.factId),
    }));
  }
  if (currencySet.size > 1) {
    issues.push(createFinancialIssue({
      severity: 'ERROR',
      code: 'MIXED_CURRENCY',
      message: 'Finansal kalemlerde birden fazla para birimi var.',
      factIds: facts.map((fact) => fact.factId),
    }));
  }
  if (periodSet.size > 1 || reportIdSet.size > 1) {
    issues.push(createFinancialIssue({
      severity: 'ERROR',
      code: 'MIXED_PERIOD_OR_REPORT',
      message: 'Tek dogrulama seti tek rapor ve tek donemden olusmali.',
      factIds: facts.map((fact) => fact.factId),
    }));
  }

  const totalAssets = firstFact(byCode, 'total_assets');
  const totalLiabilities = firstFact(byCode, 'total_liabilities');
  const totalEquity = firstFact(byCode, 'total_equity');
  if (totalAssets && totalLiabilities && totalEquity) {
    const expected = totalLiabilities.normalizedValue + totalEquity.normalizedValue;
    const tolerance = financialTolerance(totalAssets.normalizedValue);
    if (Math.abs(totalAssets.normalizedValue - expected) > tolerance) {
      issues.push(createFinancialIssue({
        severity: 'BLOCKER',
        code: 'BALANCE_SHEET_EQUATION_FAILED',
        message: 'Bilanço denkliği tutmuyor: varliklar = yukumlulukler + ozkaynak.',
        factIds: [totalAssets.factId, totalLiabilities.factId, totalEquity.factId],
        expectedValue: expected,
        actualValue: totalAssets.normalizedValue,
        tolerance,
      }));
    }
  } else if (facts.some((fact) => fact.statement === 'BALANCE_SHEET')) {
    issues.push(createFinancialIssue({
      severity: 'ERROR',
      code: 'BALANCE_SHEET_EQUATION_INCOMPLETE',
      message: 'Bilanço denkliği icin total_assets, total_liabilities ve total_equity kalemleri gerekli.',
      factIds: [totalAssets, totalLiabilities, totalEquity].filter(isDefined).map((fact) => fact.factId),
    }));
  }

  const cashBegin = firstFact(byCode, 'cash_begin');
  const cashEnd = firstFact(byCode, 'cash_end') ?? firstFact(byCode, 'cash_and_equivalents');
  const netChangeCash = firstFact(byCode, 'net_change_cash');
  if (cashBegin && cashEnd && netChangeCash) {
    const expected = cashBegin.normalizedValue + netChangeCash.normalizedValue;
    const tolerance = financialTolerance(cashEnd.normalizedValue);
    if (Math.abs(cashEnd.normalizedValue - expected) > tolerance) {
      issues.push(createFinancialIssue({
        severity: 'ERROR',
        code: 'CASH_RECONCILIATION_FAILED',
        message: 'Nakit akisi mutabakati tutmuyor: donem basi nakit + net degisim = donem sonu nakit.',
        factIds: [cashBegin.factId, netChangeCash.factId, cashEnd.factId],
        expectedValue: expected,
        actualValue: cashEnd.normalizedValue,
        tolerance,
      }));
    }
  }

  for (const fact of facts) {
    if (fact.confidence < 0.7) {
      issues.push(createFinancialIssue({
        severity: 'WARN',
        code: 'LOW_MAPPING_CONFIDENCE',
        message: `${fact.standardCode} esleme guveni dusuk.`,
        factIds: [fact.factId],
      }));
    }
    if (fact.currency !== input.report.currency) {
      issues.push(createFinancialIssue({
        severity: 'ERROR',
        code: 'FACT_REPORT_CURRENCY_MISMATCH',
        message: `${fact.standardCode} para birimi rapor para birimi ile uyumsuz.`,
        factIds: [fact.factId],
      }));
    }
  }

  const blockingIssues = issues.filter((issue) => issue.severity === 'BLOCKER' || issue.severity === 'ERROR');
  return {
    reportId: input.report.reportId,
    symbol: input.report.symbol,
    passed: blockingIssues.length === 0,
    blockingIssues,
    issues,
    validatedAt: new Date().toISOString(),
  };
}

export function crossCheckFinancialFacts(input: {
  facts: NormalizedFinancialFact[];
  crossChecks: FinancialCrossCheckInput[];
  tolerancePercent?: number;
}): FinancialCrossCheckReport[] {
  const tolerancePercent = input.tolerancePercent ?? 0.01;
  const factByCode = new Map(input.facts.map((fact) => [fact.standardCode, fact]));

  return input.crossChecks.map((check) => {
    const issues: FinancialValidationIssue[] = [];
    for (const externalFact of check.facts) {
      const localFact = factByCode.get(externalFact.standardCode);
      if (!localFact) {
        issues.push(createFinancialIssue({
          severity: 'WARN',
          code: 'CROSS_CHECK_LOCAL_FACT_MISSING',
          message: `${externalFact.standardCode} Cakal finansal veritabaninda yok.`,
          factIds: [],
          actualValue: externalFact.value,
        }));
        continue;
      }

      const tolerance = Math.max(1, Math.abs(localFact.normalizedValue) * tolerancePercent);
      if (Math.abs(localFact.normalizedValue - externalFact.value) > tolerance) {
        issues.push(createFinancialIssue({
          severity: 'ERROR',
          code: 'CROSS_CHECK_VALUE_MISMATCH',
          message: `${externalFact.standardCode} ${check.provider} ile uyusmuyor.`,
          factIds: [localFact.factId],
          expectedValue: externalFact.value,
          actualValue: localFact.normalizedValue,
          tolerance,
        }));
      }
    }

    return {
      symbol: check.symbol,
      fiscalPeriod: check.fiscalPeriod,
      provider: check.provider,
      passed: !issues.some((issue) => issue.severity === 'ERROR' || issue.severity === 'BLOCKER'),
      issues,
      checkedAt: check.checkedAt,
    };
  });
}

export function calculateFinancialRatios(input: {
  symbol: string;
  fiscalPeriod: string;
  basis: FinancialReportBasis;
  currency?: string;
  facts: NormalizedFinancialFact[];
  calculatedAt?: string;
}): FinancialRatioSet {
  const byCode = groupFactsByStandardCode(input.facts);
  const qualityFlags: string[] = [];
  const value = (code: string) => firstFact(byCode, code)?.normalizedValue ?? null;
  const ratio = (numerator: number | null, denominator: number | null, code: string): number | null => {
    if (numerator === null || denominator === null || denominator === 0) {
      qualityFlags.push(`${code}_missing_or_zero_input`);
      return null;
    }
    return roundFinancial(numerator / denominator, 4);
  };

  const totalAssets = value('total_assets');
  const totalLiabilities = value('total_liabilities');
  const totalEquity = value('total_equity');
  const currentAssets = value('current_assets');
  const currentLiabilities = value('current_liabilities');
  const cash = value('cash_and_equivalents');
  const totalDebt = value('total_debt');
  const netSales = value('net_sales');
  const grossProfit = value('gross_profit');
  const operatingProfit = value('operating_profit');
  const netIncome = value('net_income');
  const operatingCashFlow = value('operating_cash_flow');
  const capex = value('capex');
  const ebitda = value('ebitda');
  const freeCashFlow = operatingCashFlow === null || capex === null ? null : operatingCashFlow - Math.abs(capex);
  const netDebt = totalDebt === null ? null : totalDebt - (cash ?? 0);

  if (freeCashFlow === null) qualityFlags.push('free_cash_flow_missing_input');
  if (netDebt === null) qualityFlags.push('net_debt_missing_input');

  return {
    symbol: input.symbol,
    fiscalPeriod: input.fiscalPeriod,
    basis: input.basis,
    currency: input.currency ?? input.facts[0]?.currency ?? 'TRY',
    ratios: {
      gross_margin: ratio(grossProfit, netSales, 'gross_margin'),
      operating_margin: ratio(operatingProfit, netSales, 'operating_margin'),
      net_margin: ratio(netIncome, netSales, 'net_margin'),
      roe: ratio(netIncome, totalEquity, 'roe'),
      roa: ratio(netIncome, totalAssets, 'roa'),
      debt_to_assets: ratio(totalLiabilities, totalAssets, 'debt_to_assets'),
      debt_to_equity: ratio(totalDebt, totalEquity, 'debt_to_equity'),
      current_ratio: ratio(currentAssets, currentLiabilities, 'current_ratio'),
      cash_ratio: ratio(cash, currentLiabilities, 'cash_ratio'),
      ocf_to_net_income: ratio(operatingCashFlow, netIncome, 'ocf_to_net_income'),
      fcf_margin: ratio(freeCashFlow, netSales, 'fcf_margin'),
      net_debt_to_ebitda: ratio(netDebt, ebitda, 'net_debt_to_ebitda'),
      asset_turnover: ratio(netSales, totalAssets, 'asset_turnover'),
    },
    qualityFlags: [...new Set(qualityFlags)],
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
  };
}

export function createCompanyAnalysisSnapshot(input: {
  report: KapFinancialReport;
  facts: NormalizedFinancialFact[];
  validation?: FinancialValidationReport;
}): CompanyAnalysisSnapshot {
  const validation = input.validation ?? validateFinancialStatementSet({ report: input.report, facts: input.facts });
  const ratios = calculateFinancialRatios({
    symbol: input.report.symbol,
    fiscalPeriod: input.report.fiscalPeriod,
    basis: input.report.basis,
    currency: input.report.currency,
    facts: input.facts,
  });
  const blockingReasons = validation.blockingIssues.map((issue) => issue.message);
  const readiness = blockingReasons.length > 0
    ? 'BLOCKED'
    : ratios.qualityFlags.length > 4
      ? 'PARTIAL_DATA'
      : 'READY_FOR_ANALYSIS';

  return {
    symbol: input.report.symbol,
    fiscalPeriod: input.report.fiscalPeriod,
    basis: input.report.basis,
    ratios,
    validation,
    readiness,
    blockingReasons,
  };
}

export const DEFAULT_KAP_CACHE_POLICY: KapCachePolicyConfig = {
  normalCheckHours: 24,
  reportingSeasonCheckHours: 6,
  postReportCorrectionWindowHours: 24,
  postReportCheckHours: 2,
  staleAfterHours: 72,
  maxNoChangeCheckHours: 72,
  errorBackoffMinutes: [5, 15, 60, 360],
};

export function evaluateKapCache(input: KapCacheEvaluationInput): KapCacheEvaluation {
  const policy = mergeKapCachePolicy(input.policy);
  const now = new Date(input.now ?? new Date().toISOString());
  const checkedAt = now.toISOString();
  const currentReport = input.currentReport;
  const nextCheck = input.syncState?.nextCheckAt ? new Date(input.syncState.nextCheckAt) : undefined;
  const retryAfter = input.syncState?.retryAfter ? new Date(input.syncState.retryAfter) : undefined;

  if (input.fetchForced) {
    return buildKapCacheEvaluation({
      decision: 'CHECK_KAP_DISCLOSURES',
      reason: 'Kullanici veya sistem taze KAP kontrolunu zorunlu tuttu.',
      now,
      nextCheckAt: addHours(now, policy.reportingSeasonCheckHours),
      cacheAgeHours: calculateCacheAgeHours(now, currentReport),
    });
  }

  if (input.syncState?.syncStatus === 'error' || input.syncState?.syncStatus === 'backoff') {
    if (retryAfter && retryAfter > now) {
      return buildKapCacheEvaluation({
        decision: 'BACKOFF',
        reason: 'KAP kontrolu hata backoff suresi dolmadan tekrar denenmeyecek.',
        now,
        nextCheckAt: retryAfter,
        cacheAgeHours: calculateCacheAgeHours(now, currentReport),
      });
    }
  }

  if (currentReport && input.latestKapDisclosureId && input.latestKapDisclosureId !== currentReport.disclosureId) {
    return buildKapCacheEvaluation({
      decision: 'FETCH_NEW_REPORT',
      reason: 'KAP bildirim listesinde mevcut rapordan farkli yeni bildirim bulundu.',
      now,
      nextCheckAt: addHours(now, policy.postReportCheckHours),
      cacheAgeHours: calculateCacheAgeHours(now, currentReport),
    });
  }

  if (!currentReport) {
    return buildKapCacheEvaluation({
      decision: 'CHECK_KAP_DISCLOSURES',
      reason: 'DB icinde kullanilabilir guncel KAP finansal raporu yok.',
      now,
      nextCheckAt: addHours(now, policy.reportingSeasonCheckHours),
    });
  }

  const cacheAgeHours = calculateCacheAgeHours(now, currentReport);
  if (nextCheck && nextCheck > now && cacheAgeHours !== undefined && cacheAgeHours <= policy.staleAfterHours) {
    return buildKapCacheEvaluation({
      decision: 'USE_DB',
      reason: 'DB raporu taze; KAP kontrol zamani henuz gelmedi.',
      now,
      nextCheckAt: nextCheck,
      cacheAgeHours,
    });
  }

  return buildKapCacheEvaluation({
    decision: 'CHECK_KAP_DISCLOSURES',
    reason: selectKapCheckReason(input, cacheAgeHours),
    now,
    nextCheckAt: new Date(calculateNextKapCheckAt({
      now: checkedAt,
      currentReport,
      expectedReportDate: input.expectedReportDate,
      marketIsInReportingSeason: input.marketIsInReportingSeason,
      consecutiveNoChange: input.syncState?.consecutiveNoChange ?? 0,
      dataType: input.dataType,
      policy,
    })),
    cacheAgeHours,
  });
}

export function calculateNextKapCheckAt(input: {
  now?: string;
  currentReport?: KapFinancialReport;
  expectedReportDate?: string;
  marketIsInReportingSeason?: boolean;
  consecutiveNoChange?: number;
  dataType: KapSyncDataType;
  policy?: Partial<KapCachePolicyConfig>;
}): string {
  const policy = mergeKapCachePolicy(input.policy);
  const now = new Date(input.now ?? new Date().toISOString());
  const consecutiveNoChange = input.consecutiveNoChange ?? 0;

  if (input.dataType === 'DISCLOSURE') return addMinutes(now, consecutiveNoChange > 0 ? 60 : 15).toISOString();
  if (input.dataType === 'COMPANY_PROFILE') return addHours(now, 24 * 7).toISOString();
  if (input.dataType === 'INDEX_MEMBERSHIP') return addHours(now, 24).toISOString();

  const reportPublishedAt = input.currentReport?.publishedAt ? new Date(input.currentReport.publishedAt) : undefined;
  if (reportPublishedAt && now.getTime() - reportPublishedAt.getTime() <= policy.postReportCorrectionWindowHours * 60 * 60 * 1000) {
    return addHours(now, policy.postReportCheckHours).toISOString();
  }

  if (input.expectedReportDate) {
    const expected = new Date(input.expectedReportDate);
    const daysToExpected = (expected.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysToExpected <= 10 && daysToExpected >= -7) {
      return addHours(now, policy.reportingSeasonCheckHours).toISOString();
    }
  }

  if (input.marketIsInReportingSeason) return addHours(now, policy.reportingSeasonCheckHours).toISOString();

  const adaptiveHours = Math.min(
    policy.maxNoChangeCheckHours,
    policy.normalCheckHours * Math.max(1, Math.min(3, consecutiveNoChange + 1)),
  );
  return addHours(now, adaptiveHours).toISOString();
}

export function calculateKapErrorRetryAfter(input: {
  now?: string;
  errorCount: number;
  policy?: Partial<KapCachePolicyConfig>;
}): string {
  const policy = mergeKapCachePolicy(input.policy);
  const now = new Date(input.now ?? new Date().toISOString());
  const index = Math.max(0, Math.min(policy.errorBackoffMinutes.length - 1, input.errorCount));
  return addMinutes(now, policy.errorBackoffMinutes[index]).toISOString();
}

export function createKapSyncState(input: Partial<KapSyncState> & {
  symbol: string;
  dataType: KapSyncDataType;
  now?: string;
}): KapSyncState {
  const now = input.now ?? new Date().toISOString();
  return {
    symbol: input.symbol,
    dataType: input.dataType,
    lastDisclosureId: input.lastDisclosureId,
    lastCheckedAt: input.lastCheckedAt ?? now,
    nextCheckAt: input.nextCheckAt,
    consecutiveNoChange: input.consecutiveNoChange ?? 0,
    syncStatus: input.syncStatus ?? 'idle',
    lastError: input.lastError,
    retryAfter: input.retryAfter,
  };
}

export function planVersionedKapReport(input: {
  report: KapFinancialReport;
  previousCurrentReport?: KapFinancialReport;
  now?: string;
  nextCheckAt?: string;
}): VersionedKapReportPlan {
  const now = input.now ?? new Date().toISOString();
  const previousVersion = input.previousCurrentReport?.version ?? 0;
  const isNewVersion = Boolean(input.previousCurrentReport && input.previousCurrentReport.disclosureId !== input.report.disclosureId);
  const version = isNewVersion ? previousVersion + 1 : Math.max(1, input.report.version ?? (previousVersion || 1));
  const report = {
    ...input.report,
    version,
    isCurrent: true,
    lastCheckedAt: now,
    nextCheckAt: input.nextCheckAt ?? calculateNextKapCheckAt({
      now,
      currentReport: input.report,
      dataType: 'FINANCIAL_REPORT',
      consecutiveNoChange: 0,
    }),
  };

  return {
    report,
    currentPointer: {
      symbol: report.symbol,
      fiscalPeriod: report.fiscalPeriod,
      basis: report.basis,
      currentReportId: report.reportId,
      version,
      currentDisclosureId: report.disclosureId,
      updatedAt: now,
    },
    supersedesReportId: isNewVersion ? input.previousCurrentReport?.reportId : undefined,
  };
}

function summarizeGates(gates: GateResult[]): ValidationResult {
  const blockingReasons = gates.flatMap((gate) => gate.status === 'BLOCK' ? gate.reasons : []);
  const warnings = gates.flatMap((gate) => gate.status === 'WARN' ? gate.reasons : []);
  return {
    passed: blockingReasons.length === 0,
    gates,
    blockingReasons,
    warnings,
  };
}

function mergeKapCachePolicy(policy?: Partial<KapCachePolicyConfig>): KapCachePolicyConfig {
  return {
    ...DEFAULT_KAP_CACHE_POLICY,
    ...policy,
    errorBackoffMinutes: policy?.errorBackoffMinutes ?? DEFAULT_KAP_CACHE_POLICY.errorBackoffMinutes,
  };
}

function buildKapCacheEvaluation(input: {
  decision: KapCacheDecision;
  reason: string;
  now: Date;
  nextCheckAt: Date;
  cacheAgeHours?: number;
}): KapCacheEvaluation {
  return {
    decision: input.decision,
    reason: input.reason,
    shouldUseDb: input.decision === 'USE_DB' || input.decision === 'BACKOFF',
    shouldCheckKap: input.decision === 'CHECK_KAP_DISCLOSURES',
    shouldFetchReport: input.decision === 'FETCH_NEW_REPORT',
    nextCheckAt: input.nextCheckAt.toISOString(),
    checkedAt: input.now.toISOString(),
    cacheAgeHours: input.cacheAgeHours,
  };
}

function selectKapCheckReason(input: KapCacheEvaluationInput, cacheAgeHours?: number): string {
  if (input.marketIsInReportingSeason) return 'Bilanco aciklama doneminde KAP bildirim listesi kontrol edilmeli.';
  if (input.expectedReportDate) return 'Beklenen bilanco tarihi yaklastigi icin KAP bildirim listesi kontrol edilmeli.';
  if (cacheAgeHours !== undefined) return `DB raporu var ama kontrol zamani geldi; cache yasi ${Math.round(cacheAgeHours)} saat.`;
  return 'KAP bildirim listesi kontrol zamani geldi.';
}

function calculateCacheAgeHours(now: Date, report?: KapFinancialReport): number | undefined {
  const anchor = report?.lastCheckedAt ?? report?.retrievedAt;
  if (!anchor) return undefined;
  return Math.max(0, (now.getTime() - new Date(anchor).getTime()) / (60 * 60 * 1000));
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function createFinancialIssue(input: Omit<FinancialValidationIssue, 'issueId'>): FinancialValidationIssue {
  return {
    ...input,
    issueId: `fin-issue-${input.code}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
}

function coerceFinancialNumber(value: number | string | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null) return null;
  const cleaned = value
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/^\((.*)\)$/, '-$1');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function findFinancialMapping(
  item: RawFinancialLineItem,
  mappings: FinancialLineItemMapping[],
  companyProfile?: CompanyStatementProfile,
): FinancialLineItemMapping | undefined {
  const candidates = mappings
    .filter((mapping) => mapping.statement === item.statement)
    .filter((mapping) => !mapping.companyProfile || !companyProfile || mapping.companyProfile === companyProfile)
    .filter((mapping) => {
      if (mapping.taxonomyCode && item.taxonomyCode && mapping.taxonomyCode === item.taxonomyCode) return true;
      if (!mapping.rawLabelPattern) return false;
      return new RegExp(mapping.rawLabelPattern, 'i').test(normalizeText(item.rawLabel));
    })
    .sort((a, b) => b.confidence - a.confidence);

  return candidates[0];
}

function unitMultiplier(unit: string): number {
  const normalized = unit.toUpperCase();
  if (normalized === 'TRY') return 1;
  if (normalized === 'THOUSAND_TRY' || normalized === 'BIN_TL' || normalized === 'THOUSAND') return 1000;
  if (normalized === 'MILLION_TRY' || normalized === 'MILYON_TL' || normalized === 'MILLION') return 1000000;
  return 1;
}

function groupFactsByStandardCode(facts: NormalizedFinancialFact[]): Map<string, NormalizedFinancialFact[]> {
  const grouped = new Map<string, NormalizedFinancialFact[]>();
  for (const fact of facts) {
    const list = grouped.get(fact.standardCode) ?? [];
    list.push(fact);
    grouped.set(fact.standardCode, list);
  }
  return grouped;
}

function firstFact(grouped: Map<string, NormalizedFinancialFact[]>, code: string): NormalizedFinancialFact | undefined {
  return grouped.get(code)?.[0];
}

function financialTolerance(referenceValue: number): number {
  return Math.max(10, Math.abs(referenceValue) * 0.001);
}

function quarterlyFactKey(fact: NormalizedFinancialFact): string {
  return `${fact.symbol}|${fact.basis}|${fact.statement}|${fact.standardCode}|${fact.currency}`;
}

function roundFinancial(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isMandateComplete(mandate?: ResearchMandate): boolean {
  const fieldsPresent = Boolean(
    mandate?.investmentObjective &&
    mandate.horizonMonths &&
    mandate.baseCurrency &&
    mandate.market &&
    mandate.riskTolerance &&
    mandate.maxDrawdownPercent !== undefined,
  );
  if (!fieldsPresent) return false;
  // Kritik alan sistem varsayimiyla dolduysa mandate "tamam" sayilmaz:
  // varsayilan risk/ufuk, kullanicinin gercek profili gibi kaydedilemez ve
  // kisisellestirilmis oneriyi acamaz (sahte kisisellestirme korumasi).
  const assumed = new Set(mandate?.assumedFields ?? []);
  return !MANDATE_CRITICAL_FIELDS.some((field) => assumed.has(field));
}

function inferDecision(input: InvestmentDecisionInput): DecisionLabel {
  if (input.scores.securityQualityScore < 40 || input.scores.riskScore > 80) return 'REDDET';
  if (input.scores.securityQualityScore >= 75 && input.scores.valuationScore >= 65 && input.scores.evidenceConfidence >= 0.8) {
    return 'AL_AMA_KONTROLLU';
  }
  return 'BEKLE';
}

function buildDecisionReasons(input: InvestmentDecisionInput, decision: DecisionLabel): string[] {
  if (decision === 'REDDET') return ['Kalite/risk skoru yatirim tezini tasimiyor.'];
  if (decision === 'BEKLE') return ['Kanıt, degerleme veya portfoy uyumu daha guclu teyit bekliyor.'];
  return [
    `Security quality: ${input.scores.securityQualityScore}`,
    `Valuation score: ${input.scores.valuationScore}`,
    `Evidence confidence: ${input.scores.evidenceConfidence}`,
  ];
}

function calculateDecisionConfidence(input: InvestmentDecisionInput, gates: GateResult[], decision: DecisionLabel): number {
  const blockPenalty = gates.filter((gate) => gate.status === 'BLOCK').length * 0.12;
  const warnPenalty = gates.filter((gate) => gate.status === 'WARN').length * 0.05;
  const buyPenalty = BUY_DECISIONS.has(decision) && input.suitability.personalizedRecommendationAllowed ? 0 : 0.05;
  const raw = input.scores.evidenceConfidence - blockPenalty - warnPenalty - buyPenalty;
  return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
}

function firstValuationRange(models: ValuationModel[]): [number, number] | undefined {
  for (const model of models) {
    if (model.estimatedRange) return model.estimatedRange;
    if (model.estimatedValue !== undefined) return [model.estimatedValue, model.estimatedValue];
  }
  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u');
}

function mergeScreeningConfig(config?: Partial<ScreeningConfig>): ScreeningConfig {
  return {
    ...DEFAULT_SCREENING_CONFIG,
    ...config,
    weights: {
      ...DEFAULT_SCREENING_CONFIG.weights,
      ...config?.weights,
    },
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreLiquidity(avgVolume: number, minimum: number): number {
  if (minimum <= 0) return 50;
  return clampScore((avgVolume / minimum) * 55);
}

function scoreRelativeStrength(ret20d?: number | null, changePercent?: number, tags: string[] = []): number {
  const mediumReturn = ret20d ?? changePercent ?? 0;
  const recentGainerPenalty = tags.includes('recent_gainer') && mediumReturn < 5 ? -15 : 0;
  return clampScore(45 + mediumReturn * 2 + recentGainerPenalty);
}

function scoreVolatilityControl(volatility: number, maximum: number): number {
  if (!Number.isFinite(volatility)) return 0;
  return clampScore(100 - (volatility / Math.max(1, maximum)) * 70);
}

function scoreTrendQuality(trend?: string, rangePosition?: number, volumeRatio?: number): number {
  let score = 45;
  if (trend === 'YUKARI') score += 20;
  if (trend === 'ASAGI') score -= 15;
  if (typeof rangePosition === 'number' && rangePosition >= 45 && rangePosition <= 85) score += 10;
  if (typeof rangePosition === 'number' && rangePosition > 92) score -= 8;
  if (typeof volumeRatio === 'number' && volumeRatio >= 1.1 && volumeRatio <= 2.2) score += 10;
  if (typeof volumeRatio === 'number' && volumeRatio > 3) score -= 10;
  return clampScore(score);
}

function hasDeepKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value as Record<string, unknown>).some((child) => hasDeepKey(child, key));
}
