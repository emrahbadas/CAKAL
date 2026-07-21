import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuditEvent,
  CounterThesis,
  EvidenceItem,
  InvestmentDecisionRecord,
  InvestmentResearchPolicy,
  CompanyAnalysisSnapshot,
  FinancialCrossCheckReport,
  FinancialLineItemMapping,
  FinancialRatioSet,
  FinancialValidationReport,
  KapSyncState,
  PolicyImprovementProposal,
  KapCompany,
  KapDisclosure,
  KapFinancialReport,
  VersionedKapReportPlan,
  NormalizedFinancialFact,
  RawFinancialLineItem,
  RedTeamAssignment,
  ResearchCharter,
  ResearchClaim,
  ResearchMandate,
  ResearchMode,
  ThesisMonitor,
  UniverseSnapshot,
} from '@cakal/core/investment-research';

let supabase: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  supabase = createClient(url, anonKey);
  return supabase;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase not initialized. Call initSupabase() first.');
  }
  return supabase;
}

// ==============================
// User Profile
// ==============================

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export async function getOrCreateUserProfile(userId?: string) {
  const db = getSupabase();
  const id = userId || DEFAULT_USER_ID;

  const { data, error } = await db
    .from('user_profile')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    const { data: newProfile } = await db
      .from('user_profile')
      .insert({ id })
      .select()
      .single();
    return newProfile;
  }

  return data;
}

export async function updateUserProfile(
  userId: string,
  updates: Record<string, unknown>
) {
  const db = getSupabase();
  return db
    .from('user_profile')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
}

// ==============================
// Agent Runs
// ==============================

export async function logAgentRun(
  agentName: string,
  success: boolean,
  durationMs: number,
  inputSummary?: string,
  outputSummary?: string,
  errorMessage?: string
) {
  const db = getSupabase();
  return db.from('agent_runs').insert({
    agent_name: agentName,
    success,
    duration_ms: durationMs,
    input_summary: inputSummary,
    output_summary: outputSummary,
    error_message: errorMessage,
  });
}

// ==============================
// Investment Research Audit
// ==============================

export async function createInvestmentResearchSession(input: {
  user_id?: string;
  research_mode: ResearchMode;
  policy: InvestmentResearchPolicy;
  user_request: string;
  mandate?: ResearchMandate;
  research_charter?: ResearchCharter;
  universe_snapshot?: UniverseSnapshot;
  source_plan?: Record<string, unknown>;
  status?: 'OPEN' | 'PARTIAL_RESEARCH' | 'DECISION_READY' | 'REPORT_READY' | 'CLOSED' | 'BLOCKED';
  model_versions?: Record<string, unknown>;
}) {
  const db = getSupabase();
  return db.from('investment_research_sessions').insert({
    user_id: input.user_id,
    research_mode: input.research_mode,
    policy_id: input.policy.id,
    policy_version: input.policy.version,
    user_request: input.user_request,
    mandate: input.mandate ?? {},
    research_charter: input.research_charter ?? {},
    universe_snapshot: input.universe_snapshot ?? {},
    source_plan: input.source_plan ?? {},
    status: input.status ?? 'OPEN',
    model_versions: input.model_versions ?? {},
  }).select().single();
}

export async function appendInvestmentResearchAuditEvent(researchId: string, event: AuditEvent & { eventType?: string; toolName?: string }) {
  const db = getSupabase();
  return db.from('investment_research_audit_events').insert({
    research_id: researchId,
    state: event.state,
    event_type: event.eventType ?? 'STATE_TRANSITION',
    policy_version: event.policyVersion,
    tool_name: event.toolName,
    details: event.details,
  }).select().single();
}

export async function appendInvestmentResearchEvidence(researchId: string, evidence: EvidenceItem[]) {
  const db = getSupabase();
  return db.from('investment_research_evidence').insert(evidence.map((item) => ({
    research_id: researchId,
    evidence_id: item.evidenceId,
    source_tier: item.sourceTier,
    source_type: item.sourceType,
    publisher: item.publisher,
    title: item.title,
    url: item.url,
    document_id: item.documentId,
    published_at: item.publishedAt,
    event_date: item.eventDate,
    retrieved_at: item.retrievedAt,
    reporting_period: item.reportingPeriod,
    currency: item.currency,
    unit: item.unit,
    excerpt: item.excerpt,
    content_hash: item.contentHash,
    supports_claim_ids: item.supportsClaimIds,
    contradicts_claim_ids: item.contradictsClaimIds,
    freshness_status: item.freshnessStatus,
    raw: item,
  }))).select();
}

export async function appendInvestmentResearchClaims(researchId: string, claims: ResearchClaim[]) {
  const db = getSupabase();
  return db.from('investment_research_claims').insert(claims.map((claim) => ({
    research_id: researchId,
    claim_id: claim.claimId,
    claim_text: claim.text,
    claim_type: claim.type,
    materiality: claim.materiality,
    evidence_ids: claim.evidenceIds,
    contradiction_evidence_ids: claim.contradictionEvidenceIds,
    confidence: claim.confidence,
    status: claim.status,
    raw: claim,
  }))).select();
}

export async function appendInvestmentResearchDecision(researchId: string, decision: InvestmentDecisionRecord) {
  const db = getSupabase();
  return db.from('investment_research_decisions').insert({
    research_id: researchId,
    decision_id: decision.decisionId,
    candidate_id: decision.candidateId,
    decision: decision.decision,
    decision_confidence: decision.decisionConfidence,
    evidence_confidence: decision.evidenceConfidence,
    security_quality_score: decision.securityQualityScore,
    valuation_score: decision.valuationScore,
    financial_quality_score: decision.financialQualityScore,
    risk_score: decision.riskScore,
    portfolio_fit_score: decision.portfolioFitScore,
    valuation_range: decision.valuationRange,
    main_reasons: decision.mainReasons,
    strongest_supporting_claim_ids: decision.strongestSupportingClaimIds,
    strongest_counter_claim_ids: decision.strongestCounterClaimIds,
    invalidation_conditions: decision.invalidationConditions,
    missing_information: decision.missingInformation,
    gates: decision.gates,
    policy_version: decision.policyVersion,
    raw: decision,
  }).select().single();
}

export async function appendInvestmentResearchRedTeamRun(input: {
  researchId: string;
  assignment: RedTeamAssignment;
  counterThesis?: CounterThesis;
  isolationPassed: boolean;
}) {
  const db = getSupabase();
  return db.from('investment_research_red_team_runs').insert({
    research_id: input.researchId,
    candidate_id: input.assignment.candidateId,
    isolation_key: input.assignment.isolationKey,
    hidden_fields: input.assignment.hiddenFields,
    prompt_package: input.assignment.promptPackage,
    output: input.counterThesis ?? {},
    isolation_passed: input.isolationPassed,
  }).select().single();
}

export async function appendThesisMonitorSnapshot(researchId: string | undefined, monitor: ThesisMonitor) {
  const db = getSupabase();
  return db.from('investment_thesis_monitor_snapshots').insert({
    research_id: researchId,
    thesis_id: monitor.thesisId,
    candidate_id: monitor.candidateId,
    status: monitor.status,
    review_frequency: monitor.reviewFrequency,
    event_triggers: monitor.eventTriggers,
    invalidation_rules: monitor.invalidationRules,
    last_reviewed_at: monitor.lastReviewedAt,
    next_review_at: monitor.nextReviewAt,
    raw: monitor,
  }).select().single();
}

export async function appendPolicyImprovementProposal(proposal: PolicyImprovementProposal) {
  const db = getSupabase();
  return db.from('investment_policy_improvement_proposals').insert({
    proposal_id: proposal.proposalId,
    source_post_mortem_id: proposal.sourcePostMortemId,
    observed_pattern: proposal.observedPattern,
    proposed_change: proposal.proposedChange,
    supporting_cases: proposal.supportingCases,
    confidence: proposal.confidence,
    status: proposal.status,
    raw: proposal,
  }).select().single();
}

// ==============================
// Financial Ingestion Pipeline
// ==============================

export async function upsertKapCompany(company: KapCompany) {
  const db = getSupabase();
  return db.from('kap_companies').upsert({
    symbol: company.symbol,
    kap_member_id: company.kapMemberId,
    title: company.title,
    market: company.market,
    sector: company.sector,
    statement_profile: company.statementProfile,
    is_active: company.isActive,
    source_url: company.sourceUrl,
    retrieved_at: company.retrievedAt,
    raw: company,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'symbol' }).select().single();
}

export async function appendKapDisclosure(disclosure: KapDisclosure) {
  const db = getSupabase();
  return db.from('kap_disclosures').insert({
    disclosure_id: disclosure.disclosureId,
    symbol: disclosure.symbol,
    title: disclosure.title,
    disclosure_type: disclosure.disclosureType,
    published_at: disclosure.publishedAt,
    kap_url: disclosure.kapUrl,
    has_financial_report: disclosure.hasFinancialReport,
    raw_metadata: disclosure.rawMetadata ?? {},
  }).select().single();
}

export async function appendKapFinancialReport(report: KapFinancialReport) {
  const db = getSupabase();
  return db.from('kap_financial_reports').insert({
    report_id: report.reportId,
    disclosure_id: report.disclosureId,
    symbol: report.symbol,
    fiscal_year: report.fiscalYear,
    fiscal_period: report.fiscalPeriod,
    period_end: report.periodEnd,
    fiscal_quarter: report.fiscalQuarter,
    period_type: report.periodType,
    basis: report.basis,
    audit_status: report.auditStatus,
    currency: report.currency,
    unit: report.unit,
    source_url: report.sourceUrl,
    published_at: report.publishedAt,
    retrieved_at: report.retrievedAt,
    is_restatement: report.isRestatement ?? false,
    replaces_report_id: report.replacesReportId,
    raw_document_hash: report.rawDocumentHash,
    version: report.version ?? 1,
    is_current: report.isCurrent ?? true,
    fetched_at: report.retrievedAt,
    last_checked_at: report.lastCheckedAt,
    next_check_at: report.nextCheckAt,
    validation_status: report.validationStatus ?? 'pending',
    validation_errors: report.validationErrors ?? [],
    raw: report,
  }).select().single();
}

export async function upsertKapCurrentFinancialReport(plan: VersionedKapReportPlan) {
  const db = getSupabase();
  return db.from('kap_current_financial_reports').upsert({
    symbol: plan.currentPointer.symbol,
    fiscal_period: plan.currentPointer.fiscalPeriod,
    basis: plan.currentPointer.basis,
    current_report_id: plan.currentPointer.currentReportId,
    current_disclosure_id: plan.currentPointer.currentDisclosureId,
    version: plan.currentPointer.version,
    updated_at: plan.currentPointer.updatedAt,
    raw: plan,
  }, { onConflict: 'symbol,fiscal_period,basis' }).select().single();
}

export async function appendVersionedKapFinancialReport(plan: VersionedKapReportPlan) {
  const reportResult = await appendKapFinancialReport(plan.report);
  if (reportResult.error) return reportResult;
  const pointerResult = await upsertKapCurrentFinancialReport(plan);
  return pointerResult.error ? pointerResult : reportResult;
}

export async function getCurrentKapFinancialReport(input: {
  symbol: string;
  fiscalPeriod?: string;
  basis?: 'CONSOLIDATED' | 'SOLO';
}) {
  const db = getSupabase();
  let query = db
    .from('kap_current_financial_reports')
    .select('*, kap_financial_reports(*)')
    .eq('symbol', input.symbol)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (input.fiscalPeriod) query = query.eq('fiscal_period', input.fiscalPeriod);
  if (input.basis) query = query.eq('basis', input.basis);

  return query.maybeSingle();
}

export async function getKapSyncState(symbol: string, dataType: KapSyncState['dataType']) {
  const db = getSupabase();
  return db
    .from('kap_sync_state')
    .select('*')
    .eq('symbol', symbol)
    .eq('data_type', dataType)
    .maybeSingle();
}

export async function upsertKapSyncState(state: KapSyncState) {
  const db = getSupabase();
  return db.from('kap_sync_state').upsert({
    symbol: state.symbol,
    data_type: state.dataType,
    last_disclosure_id: state.lastDisclosureId,
    last_checked_at: state.lastCheckedAt,
    next_check_at: state.nextCheckAt,
    consecutive_no_change: state.consecutiveNoChange,
    sync_status: state.syncStatus,
    last_error: state.lastError,
    retry_after: state.retryAfter,
    raw: state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'symbol,data_type' }).select().single();
}

export async function markKapSyncNoChange(input: {
  symbol: string;
  dataType: KapSyncState['dataType'];
  lastDisclosureId?: string;
  checkedAt: string;
  nextCheckAt: string;
  previousNoChangeCount?: number;
}) {
  return upsertKapSyncState({
    symbol: input.symbol,
    dataType: input.dataType,
    lastDisclosureId: input.lastDisclosureId,
    lastCheckedAt: input.checkedAt,
    nextCheckAt: input.nextCheckAt,
    consecutiveNoChange: (input.previousNoChangeCount ?? 0) + 1,
    syncStatus: 'fresh',
  });
}

export async function markKapSyncError(input: {
  symbol: string;
  dataType: KapSyncState['dataType'];
  checkedAt: string;
  retryAfter: string;
  errorMessage: string;
}) {
  return upsertKapSyncState({
    symbol: input.symbol,
    dataType: input.dataType,
    lastCheckedAt: input.checkedAt,
    retryAfter: input.retryAfter,
    consecutiveNoChange: 0,
    syncStatus: 'backoff',
    lastError: input.errorMessage,
  });
}

export async function appendKapRawFinancialItems(items: RawFinancialLineItem[]) {
  const db = getSupabase();
  return db.from('kap_raw_financial_items').insert(items.map((item) => ({
    raw_item_id: item.rawItemId,
    report_id: item.reportId,
    symbol: item.symbol,
    statement: item.statement,
    raw_label: item.rawLabel,
    raw_value: item.rawValue === null || item.rawValue === undefined ? null : String(item.rawValue),
    taxonomy_code: item.taxonomyCode,
    currency: item.currency,
    unit: item.unit,
    source_url: item.sourceUrl,
    source_timestamp: item.sourceTimestamp,
    raw_payload: item.rawPayload ?? {},
  }))).select();
}

export async function upsertFinancialLineItemMappings(mappings: FinancialLineItemMapping[]) {
  const db = getSupabase();
  return db.from('financial_line_item_mappings').upsert(mappings.map((mapping) => ({
    mapping_id: mapping.mappingId,
    statement: mapping.statement,
    standard_code: mapping.standardCode,
    standard_label: mapping.standardLabel,
    taxonomy_code: mapping.taxonomyCode,
    raw_label_pattern: mapping.rawLabelPattern,
    company_profile: mapping.companyProfile,
    multiplier: mapping.multiplier,
    confidence: mapping.confidence,
    version: mapping.version,
    is_active: true,
    updated_at: new Date().toISOString(),
  })), { onConflict: 'mapping_id' }).select();
}

export async function appendNormalizedFinancialFacts(facts: NormalizedFinancialFact[]) {
  const db = getSupabase();
  return db.from('normalized_financial_facts').insert(facts.map((fact) => ({
    fact_id: fact.factId,
    report_id: fact.reportId,
    raw_item_id: fact.rawItemId,
    symbol: fact.symbol,
    fiscal_year: fact.fiscalYear,
    fiscal_period: fact.fiscalPeriod,
    fiscal_quarter: fact.fiscalQuarter,
    period_type: fact.periodType,
    basis: fact.basis,
    statement: fact.statement,
    standard_code: fact.standardCode,
    standard_label: fact.standardLabel,
    raw_label: fact.rawLabel,
    raw_value: fact.rawValue,
    normalized_value: fact.normalizedValue,
    currency: fact.currency,
    unit: fact.unit,
    audit_status: fact.auditStatus,
    source_url: fact.sourceUrl,
    source_timestamp: fact.sourceTimestamp,
    confidence: fact.confidence,
    mapping_version: fact.mappingVersion,
    restated: fact.restated,
    raw: fact,
  }))).select();
}

export async function appendFinancialValidationResult(validation: FinancialValidationReport) {
  const db = getSupabase();
  return db.from('financial_validation_results').insert({
    report_id: validation.reportId,
    symbol: validation.symbol,
    passed: validation.passed,
    blocking_issues: validation.blockingIssues,
    issues: validation.issues,
    validated_at: validation.validatedAt,
    raw: validation,
  }).select().single();
}

export async function appendFinancialCrossCheck(reportId: string | undefined, check: FinancialCrossCheckReport) {
  const db = getSupabase();
  return db.from('financial_cross_checks').insert({
    report_id: reportId,
    symbol: check.symbol,
    fiscal_period: check.fiscalPeriod,
    provider: check.provider,
    passed: check.passed,
    issues: check.issues,
    checked_at: check.checkedAt,
    raw: check,
  }).select().single();
}

export async function appendCompanyFinancialRatios(ratios: FinancialRatioSet) {
  const db = getSupabase();
  return db.from('company_financial_ratios').insert({
    symbol: ratios.symbol,
    fiscal_period: ratios.fiscalPeriod,
    basis: ratios.basis,
    currency: ratios.currency,
    ratios: ratios.ratios,
    quality_flags: ratios.qualityFlags,
    calculated_at: ratios.calculatedAt,
    raw: ratios,
  }).select().single();
}

export async function appendCompanyAnalysisSnapshot(snapshot: CompanyAnalysisSnapshot) {
  const db = getSupabase();
  return db.from('company_analysis_snapshots').insert({
    symbol: snapshot.symbol,
    fiscal_period: snapshot.fiscalPeriod,
    basis: snapshot.basis,
    readiness: snapshot.readiness,
    blocking_reasons: snapshot.blockingReasons,
    ratios: snapshot.ratios,
    validation: snapshot.validation,
    raw: snapshot,
  }).select().single();
}

// ==============================
// Opportunities
// ==============================

export async function saveOpportunity(opportunity: {
  title: string;
  description?: string;
  category: string;
  score: number;
  expected_profit?: number;
  expected_profit_percent?: number;
  timeframe?: string;
  source: string;
  source_url?: string;
  reasoning?: string;
  urgency?: string;
}) {
  const db = getSupabase();
  return db.from('opportunities').insert(opportunity).select().single();
}

export async function getOpportunities(options?: {
  status?: string;
  category?: string;
  limit?: number;
  minScore?: number;
}) {
  const db = getSupabase();
  let query = db
    .from('opportunities')
    .select('*')
    .order('created_at', { ascending: false });

  if (options?.status) query = query.eq('status', options.status);
  if (options?.category) query = query.eq('category', options.category);
  if (options?.minScore) query = query.gte('score', options.minScore);
  query = query.limit(options?.limit || 50);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getOpportunityById(id: string) {
  const db = getSupabase();
  const { data, error } = await db
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// ==============================
// Recommendations
// ==============================

export async function createRecommendation(
  userId: string,
  opportunityId: string,
  reasoning?: string
) {
  const db = getSupabase();
  return db
    .from('recommendations')
    .insert({ user_id: userId, opportunity_id: opportunityId, reasoning })
    .select()
    .single();
}

export async function getRecommendations(userId: string, options?: { limit?: number }) {
  const db = getSupabase();
  const { data, error } = await db
    .from('recommendations')
    .select('*, opportunities(*), recommendation_feedback(*)')
    .eq('user_id', userId)
    .order('presented_at', { ascending: false })
    .limit(options?.limit || 20);
  if (error) throw error;
  return data || [];
}

export async function acceptRecommendation(id: string) {
  const db = getSupabase();
  return db
    .from('recommendations')
    .update({ accepted: true, accepted_at: new Date().toISOString() })
    .eq('id', id);
}

// ==============================
// Feedback
// ==============================

export async function saveFeedback(feedback: {
  recommendation_id: string;
  user_id: string;
  outcome: string;
  actual_profit?: number;
  notes?: string;
  want_similar: boolean;
}) {
  const db = getSupabase();
  return db.from('recommendation_feedback').insert(feedback).select().single();
}

export async function getFeedbacks(userId: string, options?: { limit?: number; outcome?: string }) {
  const db = getSupabase();
  let query = db
    .from('recommendation_feedback')
    .select('*, recommendations(*, opportunities(*))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.outcome) query = query.eq('outcome', options.outcome);
  query = query.limit(options?.limit || 20);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getPendingFeedbacks(userId: string) {
  const db = getSupabase();
  const { data, error } = await db
    .from('recommendations')
    .select('*, opportunities(*)')
    .eq('user_id', userId)
    .eq('accepted', true)
    .is('recommendation_feedback', null)
    .order('presented_at', { ascending: false })
    .limit(10);
  // Fallback: get accepted recommendations without feedback
  if (error) {
    const { data: fallback } = await db
      .from('recommendations')
      .select('*, opportunities(*)')
      .eq('user_id', userId)
      .eq('accepted', true)
      .order('presented_at', { ascending: false })
      .limit(10);
    return fallback || [];
  }
  return data || [];
}

// ==============================
// Profile Events
// ==============================

export async function logProfileEvent(
  userId: string,
  eventType: string,
  eventData: Record<string, unknown>
) {
  const db = getSupabase();
  return db.from('profile_events').insert({
    user_id: userId,
    event_type: eventType,
    event_data: eventData,
  });
}

// ==============================
// Strategy Patterns
// ==============================

export async function getStrategyPatterns(options?: { status?: string }) {
  const db = getSupabase();
  let query = db
    .from('strategy_patterns')
    .select('*, strategy_weights(*)')
    .order('confidence', { ascending: false });

  if (options?.status) query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function saveStrategyPattern(pattern: {
  name: string;
  description?: string;
  tags?: string[];
}) {
  const db = getSupabase();
  return db.from('strategy_patterns').insert(pattern).select().single();
}

// ==============================
// Watchlists
// ==============================

export async function getWatchlists(userId: string) {
  const db = getSupabase();
  const { data, error } = await db
    .from('watchlists')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToWatchlist(item: {
  user_id: string;
  title: string;
  query: string;
  category?: string;
  target_price?: number;
  source: string;
}) {
  const db = getSupabase();
  return db.from('watchlists').insert(item).select().single();
}

// ==============================
// Conversation Logs
// ==============================

export async function saveConversationMessage(msg: {
  user_id: string;
  role: string;
  content: string;
  agent_name?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getSupabase();
  return db.from('conversation_logs').insert(msg);
}

export async function getConversationHistory(userId: string, limit = 50) {
  const db = getSupabase();
  const { data, error } = await db
    .from('conversation_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse(); // chronological order
}

// ==============================
// System Capabilities (Self-Awareness)
// ==============================

export async function getCapabilities(options?: { status?: string; category?: string }) {
  const db = getSupabase();
  let query = db.from('system_capabilities').select('*').order('category');

  if (options?.status) query = query.eq('status', options.status);
  if (options?.category) query = query.eq('category', options.category);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateCapabilityStatus(name: string, status: string) {
  const db = getSupabase();
  return db
    .from('system_capabilities')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('capability_name', name);
}

// ==============================
// Dashboard Stats
// ==============================

export async function getDashboardStats(userId: string) {
  const db = getSupabase();

  const [opps, feedbacks, profile, patterns] = await Promise.all([
    db.from('opportunities').select('id, score, category, created_at', { count: 'exact' }).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    db.from('recommendation_feedback').select('outcome, actual_profit').eq('user_id', userId),
    db.from('user_profile').select('*').eq('id', userId).single(),
    db.from('strategy_patterns').select('name, confidence, status').eq('status', 'active').order('confidence', { ascending: false }).limit(5),
  ]);

  const feedbackData = feedbacks.data || [];
  const totalProfit = feedbackData.filter(f => f.outcome === 'profit').reduce((sum, f) => sum + (f.actual_profit || 0), 0);
  const totalLoss = feedbackData.filter(f => f.outcome === 'loss').reduce((sum, f) => sum + Math.abs(f.actual_profit || 0), 0);

  return {
    opportunitiesThisWeek: opps.count || 0,
    totalProfit,
    totalLoss,
    activeWatchlists: profile.data?.active_watchlists?.length || 0,
    topPatterns: patterns.data || [],
    feedbackCount: feedbackData.length,
    profitCount: feedbackData.filter(f => f.outcome === 'profit').length,
    lossCount: feedbackData.filter(f => f.outcome === 'loss').length,
  };
}
