-- ============================
-- Cakal Cekirdegi - Financial Ingestion Pipeline
-- Migration: 20260718000200_financial_ingestion_pipeline
-- Flow: KAP companies/disclosures -> reports -> raw archive -> mapping/normalization
--       -> validation/cross-check -> Cakal financial DB -> ratios/company analysis
-- ============================

CREATE TABLE kap_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol TEXT NOT NULL UNIQUE,
  kap_member_id TEXT,
  title TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'BIST' CHECK (market = 'BIST'),
  sector TEXT,
  statement_profile TEXT NOT NULL CHECK (statement_profile IN ('INDUSTRIAL', 'BANK', 'INSURANCE', 'HOLDING', 'REIT', 'OTHER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kap_companies_sector ON kap_companies(sector);
CREATE INDEX idx_kap_companies_active ON kap_companies(is_active);

CREATE TABLE kap_disclosures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disclosure_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  disclosure_type TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  kap_url TEXT NOT NULL,
  has_financial_report BOOLEAN NOT NULL DEFAULT FALSE,
  raw_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kap_disclosures_symbol_published ON kap_disclosures(symbol, published_at DESC);
CREATE INDEX idx_kap_disclosures_type ON kap_disclosures(disclosure_type);

CREATE TABLE kap_financial_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id TEXT NOT NULL UNIQUE,
  disclosure_id TEXT NOT NULL REFERENCES kap_disclosures(disclosure_id) ON DELETE RESTRICT,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_year INTEGER NOT NULL,
  fiscal_period TEXT NOT NULL,
  fiscal_quarter INTEGER CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_type TEXT NOT NULL CHECK (period_type IN ('QUARTERLY', 'CUMULATIVE', 'ANNUAL', 'POINT_IN_TIME')),
  basis TEXT NOT NULL CHECK (basis IN ('CONSOLIDATED', 'SOLO')),
  audit_status TEXT NOT NULL CHECK (audit_status IN ('AUDITED', 'REVIEWED', 'UNAUDITED', 'UNKNOWN')),
  currency TEXT NOT NULL DEFAULT 'TRY',
  unit TEXT NOT NULL CHECK (unit IN ('TRY', 'THOUSAND_TRY', 'MILLION_TRY', 'OTHER')),
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  is_restatement BOOLEAN NOT NULL DEFAULT FALSE,
  replaces_report_id TEXT REFERENCES kap_financial_reports(report_id) ON DELETE SET NULL,
  raw_document_hash TEXT,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, fiscal_period, basis, is_restatement, report_id)
);

CREATE INDEX idx_kap_financial_reports_symbol_period ON kap_financial_reports(symbol, fiscal_period DESC);
CREATE INDEX idx_kap_financial_reports_basis ON kap_financial_reports(basis);
CREATE INDEX idx_kap_financial_reports_hash ON kap_financial_reports(raw_document_hash);

CREATE TABLE kap_raw_financial_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_item_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES kap_financial_reports(report_id) ON DELETE RESTRICT,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  statement TEXT NOT NULL CHECK (statement IN ('BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW', 'EQUITY_CHANGE', 'NOTES')),
  raw_label TEXT NOT NULL,
  raw_value TEXT,
  taxonomy_code TEXT,
  currency TEXT,
  unit TEXT,
  source_url TEXT,
  source_timestamp TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, raw_item_id)
);

CREATE INDEX idx_kap_raw_financial_items_report ON kap_raw_financial_items(report_id);
CREATE INDEX idx_kap_raw_financial_items_statement ON kap_raw_financial_items(statement);
CREATE INDEX idx_kap_raw_financial_items_taxonomy ON kap_raw_financial_items(taxonomy_code);

CREATE TABLE financial_line_item_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapping_id TEXT NOT NULL UNIQUE,
  statement TEXT NOT NULL CHECK (statement IN ('BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW', 'EQUITY_CHANGE', 'NOTES')),
  standard_code TEXT NOT NULL,
  standard_label TEXT NOT NULL,
  taxonomy_code TEXT,
  raw_label_pattern TEXT,
  company_profile TEXT CHECK (company_profile IN ('INDUSTRIAL', 'BANK', 'INSURANCE', 'HOLDING', 'REIT', 'OTHER')),
  multiplier NUMERIC,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  version TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_line_item_mappings_standard ON financial_line_item_mappings(standard_code);
CREATE INDEX idx_financial_line_item_mappings_profile ON financial_line_item_mappings(company_profile);
CREATE INDEX idx_financial_line_item_mappings_active ON financial_line_item_mappings(is_active);

CREATE TABLE normalized_financial_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fact_id TEXT NOT NULL UNIQUE,
  report_id TEXT NOT NULL REFERENCES kap_financial_reports(report_id) ON DELETE RESTRICT,
  raw_item_id TEXT NOT NULL,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_year INTEGER NOT NULL,
  fiscal_period TEXT NOT NULL,
  fiscal_quarter INTEGER CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_type TEXT NOT NULL CHECK (period_type IN ('QUARTERLY', 'CUMULATIVE', 'ANNUAL', 'POINT_IN_TIME')),
  basis TEXT NOT NULL CHECK (basis IN ('CONSOLIDATED', 'SOLO')),
  statement TEXT NOT NULL CHECK (statement IN ('BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW', 'EQUITY_CHANGE', 'NOTES')),
  standard_code TEXT NOT NULL,
  standard_label TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  raw_value NUMERIC NOT NULL,
  normalized_value NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  unit TEXT NOT NULL,
  audit_status TEXT NOT NULL CHECK (audit_status IN ('AUDITED', 'REVIEWED', 'UNAUDITED', 'UNKNOWN')),
  source_url TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  mapping_version TEXT NOT NULL,
  restated BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_normalized_financial_facts_symbol_period ON normalized_financial_facts(symbol, fiscal_period DESC);
CREATE INDEX idx_normalized_financial_facts_standard ON normalized_financial_facts(standard_code);
CREATE INDEX idx_normalized_financial_facts_report ON normalized_financial_facts(report_id);
CREATE INDEX idx_normalized_financial_facts_basis ON normalized_financial_facts(basis);

CREATE TABLE financial_validation_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id TEXT NOT NULL REFERENCES kap_financial_reports(report_id) ON DELETE RESTRICT,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  passed BOOLEAN NOT NULL,
  blocking_issues JSONB NOT NULL DEFAULT '[]',
  issues JSONB NOT NULL DEFAULT '[]',
  validated_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_validation_results_report ON financial_validation_results(report_id, created_at DESC);
CREATE INDEX idx_financial_validation_results_symbol ON financial_validation_results(symbol, created_at DESC);
CREATE INDEX idx_financial_validation_results_passed ON financial_validation_results(passed);

CREATE TABLE financial_cross_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id TEXT REFERENCES kap_financial_reports(report_id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_period TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('FINTABLES', 'IS_YATIRIM', 'KAP_REVISED', 'BORSA_ISTANBUL', 'OTHER')),
  passed BOOLEAN NOT NULL,
  issues JSONB NOT NULL DEFAULT '[]',
  checked_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_cross_checks_symbol_period ON financial_cross_checks(symbol, fiscal_period DESC);
CREATE INDEX idx_financial_cross_checks_provider ON financial_cross_checks(provider);

CREATE TABLE company_financial_ratios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_period TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('CONSOLIDATED', 'SOLO')),
  currency TEXT NOT NULL DEFAULT 'TRY',
  ratios JSONB NOT NULL DEFAULT '{}',
  quality_flags TEXT[] NOT NULL DEFAULT '{}',
  calculated_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, fiscal_period, basis, calculated_at)
);

CREATE INDEX idx_company_financial_ratios_symbol_period ON company_financial_ratios(symbol, fiscal_period DESC);

CREATE TABLE company_analysis_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol TEXT NOT NULL REFERENCES kap_companies(symbol) ON DELETE RESTRICT,
  fiscal_period TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('CONSOLIDATED', 'SOLO')),
  readiness TEXT NOT NULL CHECK (readiness IN ('READY_FOR_ANALYSIS', 'PARTIAL_DATA', 'BLOCKED')),
  blocking_reasons TEXT[] NOT NULL DEFAULT '{}',
  ratios JSONB NOT NULL DEFAULT '{}',
  validation JSONB NOT NULL DEFAULT '{}',
  raw JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_company_analysis_snapshots_symbol_period ON company_analysis_snapshots(symbol, fiscal_period DESC);
CREATE INDEX idx_company_analysis_snapshots_readiness ON company_analysis_snapshots(readiness);

CREATE OR REPLACE FUNCTION prevent_financial_ingestion_archive_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'financial ingestion archive tables are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kap_disclosures_no_update
  BEFORE UPDATE OR DELETE ON kap_disclosures
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_kap_financial_reports_no_update
  BEFORE UPDATE OR DELETE ON kap_financial_reports
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_kap_raw_financial_items_no_update
  BEFORE UPDATE OR DELETE ON kap_raw_financial_items
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_normalized_financial_facts_no_update
  BEFORE UPDATE OR DELETE ON normalized_financial_facts
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_financial_validation_results_no_update
  BEFORE UPDATE OR DELETE ON financial_validation_results
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_financial_cross_checks_no_update
  BEFORE UPDATE OR DELETE ON financial_cross_checks
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_company_financial_ratios_no_update
  BEFORE UPDATE OR DELETE ON company_financial_ratios
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

CREATE TRIGGER trg_company_analysis_snapshots_no_update
  BEFORE UPDATE OR DELETE ON company_analysis_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ingestion_archive_mutation();

ALTER TABLE kap_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kap_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE kap_financial_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE kap_raw_financial_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_line_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_financial_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_cross_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_financial_ratios ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_analysis_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON kap_companies FROM anon, authenticated;
REVOKE ALL ON kap_disclosures FROM anon, authenticated;
REVOKE ALL ON kap_financial_reports FROM anon, authenticated;
REVOKE ALL ON kap_raw_financial_items FROM anon, authenticated;
REVOKE ALL ON financial_line_item_mappings FROM anon, authenticated;
REVOKE ALL ON normalized_financial_facts FROM anon, authenticated;
REVOKE ALL ON financial_validation_results FROM anon, authenticated;
REVOKE ALL ON financial_cross_checks FROM anon, authenticated;
REVOKE ALL ON company_financial_ratios FROM anon, authenticated;
REVOKE ALL ON company_analysis_snapshots FROM anon, authenticated;
