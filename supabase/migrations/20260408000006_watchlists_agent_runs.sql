-- ============================
-- Çakal Çekirdeği — Sprint 9: Watchlists + Agent Runs + Memory Embeddings
-- Migration: 006_watchlists_agent_runs
-- ============================

-- ==================
-- 2. watchlist_matches — Watchlist'e eşleşen fırsatlar
-- ==================
CREATE TABLE watchlist_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  match_score NUMERIC(5,2) DEFAULT 0,            -- 0-100 arası eşleşme skoru
  price_at_match NUMERIC(12,2) DEFAULT NULL,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(watchlist_id, opportunity_id)
);

CREATE INDEX idx_watchlist_matches_watchlist ON watchlist_matches(watchlist_id);
CREATE INDEX idx_watchlist_matches_created ON watchlist_matches(created_at DESC);
