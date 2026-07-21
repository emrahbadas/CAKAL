-- ============================
-- Çakal Çekirdeği — Veritabanı Şeması
-- Migration: 001_initial_schema
-- ============================

-- Enable pgvector extension for semantic memory
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================
-- 1. User Profile
-- ==================
CREATE TABLE user_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  risk_tolerance TEXT NOT NULL DEFAULT 'medium' CHECK (risk_tolerance IN ('low', 'medium', 'high')),
  preferred_domains TEXT[] DEFAULT '{}',
  decision_speed TEXT NOT NULL DEFAULT 'fast' CHECK (decision_speed IN ('fast', 'slow')),
  total_profit NUMERIC(12,2) DEFAULT 0,
  total_loss NUMERIC(12,2) DEFAULT 0,
  avg_margin NUMERIC(5,2) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  active_watchlists TEXT[] DEFAULT '{}',
  successful_patterns TEXT[] DEFAULT '{}',
  blocked_patterns TEXT[] DEFAULT '{}',
  engagement_score INTEGER DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================
-- 2. User Index Entries (Profile Keeper writes here)
-- ==================
CREATE TABLE user_index_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL, -- 'interest', 'risk_change', 'pattern_detected', etc.
  entry_key TEXT NOT NULL,
  entry_value JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC(3,2) DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  source TEXT NOT NULL, -- 'feedback', 'conversation', 'pattern', 'auto'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_index_user ON user_index_entries(user_id);
CREATE INDEX idx_user_index_type ON user_index_entries(entry_type);

-- ==================
-- 3. Opportunities
-- ==================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  score INTEGER DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  expected_profit NUMERIC(12,2),
  expected_profit_percent NUMERIC(5,2),
  timeframe TEXT,
  urgency TEXT DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  source TEXT NOT NULL,
  source_url TEXT,
  reasoning TEXT, -- why this was suggested
  scoring_factors JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'taken', 'rejected')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opportunities_score ON opportunities(score DESC);
CREATE INDEX idx_opportunities_category ON opportunities(category);
CREATE INDEX idx_opportunities_status ON opportunities(status);

-- ==================
-- 4. Opportunity Signals (raw data from sources)
-- ==================
CREATE TABLE opportunity_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_source ON opportunity_signals(source_id);
CREATE INDEX idx_signals_processed ON opportunity_signals(processed);

-- ==================
-- 5. Recommendations
-- ==================
CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  presented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted BOOLEAN,
  accepted_at TIMESTAMPTZ,
  reasoning TEXT
);

CREATE INDEX idx_recommendations_user ON recommendations(user_id);

-- ==================
-- 6. Recommendation Feedback
-- ==================
CREATE TABLE recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('profit', 'loss', 'neutral', 'skipped', 'pending')),
  actual_profit NUMERIC(12,2),
  notes TEXT,
  want_similar BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_user ON recommendation_feedback(user_id);
CREATE INDEX idx_feedback_outcome ON recommendation_feedback(outcome);

-- ==================
-- 7. Strategy Patterns
-- ==================
CREATE TABLE strategy_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  avg_profit NUMERIC(12,2) DEFAULT 0,
  confidence NUMERIC(3,2) DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  status TEXT DEFAULT 'on-hold' CHECK (status IN ('active', 'weakened', 'on-hold')),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================
-- 8. Strategy Weights
-- ==================
CREATE TABLE strategy_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_id UUID NOT NULL REFERENCES strategy_patterns(id) ON DELETE CASCADE,
  weight NUMERIC(4,2) DEFAULT 0 CHECK (weight BETWEEN -1 AND 1),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weights_pattern ON strategy_weights(pattern_id);

-- ==================
-- 9. Agent Runs (log)
-- ==================
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_name ON agent_runs(agent_name);
CREATE INDEX idx_agent_runs_created ON agent_runs(created_at DESC);

-- ==================
-- 10. Memory Embeddings (pgvector)
-- ==================
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  metadata JSONB DEFAULT '{}',
  category TEXT, -- 'opportunity', 'feedback', 'conversation', 'pattern'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_category ON memory_embeddings(category);

-- ==================
-- 11. Watchlists
-- ==================
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  query TEXT NOT NULL, -- search query or product identifier
  category TEXT,
  target_price NUMERIC(12,2),
  current_price NUMERIC(12,2),
  source TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);
CREATE INDEX idx_watchlists_active ON watchlists(is_active);

-- ==================
-- 12. Profile Events (Profile Keeper log)
-- ==================
CREATE TABLE profile_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'feedback', 'conversation', 'preference_change', 'weekly_report'
  event_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_events_user ON profile_events(user_id);
CREATE INDEX idx_profile_events_type ON profile_events(event_type);

-- ==================
-- Updated_at trigger function
-- ==================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_profile_updated
  BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_strategy_patterns_updated
  BEFORE UPDATE ON strategy_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
