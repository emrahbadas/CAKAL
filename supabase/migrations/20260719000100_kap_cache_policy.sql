-- ============================
-- Cakal Cekirdegi - KAP Cache Policy
-- Migration: 20260719000100_kap_cache_policy
-- Adds timestamp/next-check metadata, version current pointer, and adaptive sync state.
-- ============================

ALTER TABLE kap_financial_reports
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'passed', 'failed', 'partial')),
  ADD COLUMN IF NOT EXISTS validation_errors JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cache_policy JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_kap_financial_reports_next_check
  ON kap_financial_reports(next_check_at)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_kap_financial_reports_version
  ON kap_financial_reports(symbol, fiscal_period, basis, version DESC);

CREATE TABLE IF NOT EXISTS kap_current_financial_reports (
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_period TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('CONSOLIDATED', 'SOLO')),
  current_report_id TEXT NOT NULL REFERENCES kap_financial_reports(report_id) ON DELETE RESTRICT,
  current_disclosure_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY(symbol, fiscal_period, basis)
);

CREATE INDEX IF NOT EXISTS idx_kap_current_financial_reports_report
  ON kap_current_financial_reports(current_report_id);

CREATE TABLE IF NOT EXISTS kap_sync_state (
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  data_type TEXT NOT NULL CHECK (data_type IN ('FINANCIAL_REPORT', 'DISCLOSURE', 'COMPANY_PROFILE', 'INDEX_MEMBERSHIP')),
  last_disclosure_id TEXT,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  consecutive_no_change INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'checking', 'fresh', 'changed', 'error', 'backoff')),
  last_error TEXT,
  retry_after TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(symbol, data_type)
);

CREATE INDEX IF NOT EXISTS idx_kap_sync_state_next_check
  ON kap_sync_state(next_check_at);

CREATE INDEX IF NOT EXISTS idx_kap_sync_state_retry
  ON kap_sync_state(retry_after)
  WHERE retry_after IS NOT NULL;

ALTER TABLE kap_current_financial_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE kap_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON kap_current_financial_reports FROM anon, authenticated;
REVOKE ALL ON kap_sync_state FROM anon, authenticated;
