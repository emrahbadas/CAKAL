-- ============================
-- Cakal Cekirdegi — Investment Research Audit
-- Migration: 20260718000100_investment_research_audit
-- Not: Production'da otomatik calistirilmaz; migration review sonrasi uygulanir.
-- ============================

CREATE TABLE investment_research_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profile(id) ON DELETE SET NULL,
  research_mode TEXT NOT NULL CHECK (research_mode IN (
    'FRESH_MARKET_SCAN',
    'COMPANY_DEEP_DIVE',
    'PORTFOLIO_FIT',
    'WATCHLIST_REFRESH',
    'EVENT_DRIVEN_UPDATE',
    'SECTOR_RESEARCH',
    'RISK_REVIEW',
    'VALUATION_UPDATE'
  )),
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  user_request TEXT NOT NULL,
  mandate JSONB NOT NULL DEFAULT '{}',
  research_charter JSONB NOT NULL DEFAULT '{}',
  universe_snapshot JSONB NOT NULL DEFAULT '{}',
  source_plan JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL_RESEARCH', 'DECISION_READY', 'REPORT_READY', 'CLOSED', 'BLOCKED')),
  model_versions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investment_research_sessions_user ON investment_research_sessions(user_id);
CREATE INDEX idx_investment_research_sessions_mode ON investment_research_sessions(research_mode);
CREATE INDEX idx_investment_research_sessions_created ON investment_research_sessions(created_at DESC);

CREATE TABLE investment_research_audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID NOT NULL REFERENCES investment_research_sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  tool_name TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investment_research_audit_research ON investment_research_audit_events(research_id, created_at);
CREATE INDEX idx_investment_research_audit_state ON investment_research_audit_events(state);

CREATE TABLE investment_research_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID NOT NULL REFERENCES investment_research_sessions(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL,
  source_tier TEXT NOT NULL CHECK (source_tier IN (
    'TIER_A_PRIMARY_OFFICIAL',
    'TIER_B_OFFICIAL_CORPORATE',
    'TIER_C_REPUTABLE_SECONDARY',
    'TIER_D_UNVERIFIED'
  )),
  source_type TEXT NOT NULL,
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  document_id TEXT,
  published_at TIMESTAMPTZ,
  event_date DATE,
  retrieved_at TIMESTAMPTZ NOT NULL,
  reporting_period TEXT,
  currency TEXT,
  unit TEXT,
  excerpt TEXT,
  content_hash TEXT,
  supports_claim_ids TEXT[] NOT NULL DEFAULT '{}',
  contradicts_claim_ids TEXT[] NOT NULL DEFAULT '{}',
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('FRESH', 'STALE', 'UNKNOWN')),
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(research_id, evidence_id)
);

CREATE INDEX idx_investment_research_evidence_research ON investment_research_evidence(research_id);
CREATE INDEX idx_investment_research_evidence_tier ON investment_research_evidence(source_tier);
CREATE INDEX idx_investment_research_evidence_hash ON investment_research_evidence(content_hash);

CREATE TABLE investment_research_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID NOT NULL REFERENCES investment_research_sessions(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'FACT',
    'CALCULATION',
    'INFERENCE',
    'MANAGEMENT_GUIDANCE',
    'ANALYST_OPINION',
    'UNVERIFIED_REPORT'
  )),
  materiality TEXT NOT NULL CHECK (materiality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  contradiction_evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'CONTRADICTED', 'UNRESOLVED')),
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(research_id, claim_id)
);

CREATE INDEX idx_investment_research_claims_research ON investment_research_claims(research_id);
CREATE INDEX idx_investment_research_claims_status ON investment_research_claims(status);
CREATE INDEX idx_investment_research_claims_materiality ON investment_research_claims(materiality);

CREATE TABLE investment_research_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID NOT NULL REFERENCES investment_research_sessions(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('AL', 'AL_AMA_KONTROLLU', 'BEKLE', 'TUT', 'REDDET', 'VERI_YETERSIZ')),
  decision_confidence NUMERIC(4,3) NOT NULL CHECK (decision_confidence BETWEEN 0 AND 1),
  evidence_confidence NUMERIC(4,3) NOT NULL CHECK (evidence_confidence BETWEEN 0 AND 1),
  security_quality_score NUMERIC(5,2) NOT NULL,
  valuation_score NUMERIC(5,2) NOT NULL,
  financial_quality_score NUMERIC(5,2) NOT NULL,
  risk_score NUMERIC(5,2) NOT NULL,
  portfolio_fit_score NUMERIC(5,2),
  valuation_range NUMERIC[],
  main_reasons TEXT[] NOT NULL DEFAULT '{}',
  strongest_supporting_claim_ids TEXT[] NOT NULL DEFAULT '{}',
  strongest_counter_claim_ids TEXT[] NOT NULL DEFAULT '{}',
  invalidation_conditions TEXT[] NOT NULL DEFAULT '{}',
  missing_information TEXT[] NOT NULL DEFAULT '{}',
  gates JSONB NOT NULL DEFAULT '[]',
  policy_version TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(research_id, decision_id)
);

CREATE INDEX idx_investment_research_decisions_research ON investment_research_decisions(research_id);
CREATE INDEX idx_investment_research_decisions_candidate ON investment_research_decisions(candidate_id);
CREATE INDEX idx_investment_research_decisions_decision ON investment_research_decisions(decision);

CREATE TABLE investment_research_red_team_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID NOT NULL REFERENCES investment_research_sessions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  isolation_key TEXT NOT NULL,
  hidden_fields TEXT[] NOT NULL DEFAULT '{}',
  prompt_package JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  isolation_passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investment_research_red_team_research ON investment_research_red_team_runs(research_id);
CREATE INDEX idx_investment_research_red_team_candidate ON investment_research_red_team_runs(candidate_id);

CREATE TABLE investment_thesis_monitor_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  research_id UUID REFERENCES investment_research_sessions(id) ON DELETE SET NULL,
  thesis_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INVALIDATED', 'PAUSED', 'CLOSED')),
  review_frequency TEXT NOT NULL,
  event_triggers TEXT[] NOT NULL DEFAULT '{}',
  invalidation_rules JSONB NOT NULL DEFAULT '[]',
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investment_thesis_monitor_thesis ON investment_thesis_monitor_snapshots(thesis_id, created_at DESC);
CREATE INDEX idx_investment_thesis_monitor_candidate ON investment_thesis_monitor_snapshots(candidate_id);

CREATE TABLE investment_policy_improvement_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id TEXT NOT NULL UNIQUE,
  source_post_mortem_id TEXT NOT NULL,
  observed_pattern TEXT NOT NULL,
  proposed_change TEXT NOT NULL,
  supporting_cases TEXT[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'NEEDS_MANUAL_REVIEW', 'APPROVED', 'REJECTED')),
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only protection for audit-critical records.
CREATE OR REPLACE FUNCTION prevent_investment_research_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'investment research audit tables are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_investment_research_audit_no_update
  BEFORE UPDATE OR DELETE ON investment_research_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_research_evidence_no_update
  BEFORE UPDATE OR DELETE ON investment_research_evidence
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_research_claims_no_update
  BEFORE UPDATE OR DELETE ON investment_research_claims
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_research_decisions_no_update
  BEFORE UPDATE OR DELETE ON investment_research_decisions
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_research_red_team_no_update
  BEFORE UPDATE OR DELETE ON investment_research_red_team_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_thesis_monitor_no_update
  BEFORE UPDATE OR DELETE ON investment_thesis_monitor_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

CREATE TRIGGER trg_investment_policy_proposals_no_update
  BEFORE UPDATE OR DELETE ON investment_policy_improvement_proposals
  FOR EACH ROW EXECUTE FUNCTION prevent_investment_research_mutation();

ALTER TABLE investment_research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_research_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_research_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_research_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_research_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_research_red_team_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_thesis_monitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_policy_improvement_proposals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON investment_research_sessions FROM anon, authenticated;
REVOKE ALL ON investment_research_audit_events FROM anon, authenticated;
REVOKE ALL ON investment_research_evidence FROM anon, authenticated;
REVOKE ALL ON investment_research_claims FROM anon, authenticated;
REVOKE ALL ON investment_research_decisions FROM anon, authenticated;
REVOKE ALL ON investment_research_red_team_runs FROM anon, authenticated;
REVOKE ALL ON investment_thesis_monitor_snapshots FROM anon, authenticated;
REVOKE ALL ON investment_policy_improvement_proposals FROM anon, authenticated;
