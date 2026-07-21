-- ============================
-- Çakal Çekirdeği — Sprint 8: Self-Evolution + DB Authority
-- Migration: 005_evolution_engine
-- ============================

-- ==================
-- 1. cakal_evolution schema — Çakal'ın özgür alanı
-- DDL dahil her şeyi yapabilir, public şemasına dokunmaz
-- ==================
CREATE SCHEMA IF NOT EXISTS cakal_evolution;

-- ==================
-- 2. evolution_ddl_log — Her DDL işleminin kaydı (audit trail)
-- ==================
CREATE TABLE evolution_ddl_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ddl_sql TEXT NOT NULL,
  ddl_type TEXT NOT NULL CHECK (ddl_type IN ('CREATE_TABLE', 'ALTER_TABLE', 'DROP_TABLE', 'CREATE_INDEX', 'OTHER')),
  target_table TEXT, -- Etkilenen tablo adı
  reason TEXT NOT NULL, -- Neden bu DDL çalıştırıldı
  rollback_sql TEXT, -- Geri alma SQL'i
  status TEXT NOT NULL DEFAULT 'executed' CHECK (status IN ('pending', 'executed', 'rolled_back', 'failed')),
  approved_by TEXT DEFAULT 'auto' CHECK (approved_by IN ('user', 'auto')),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evolution_ddl_log_type ON evolution_ddl_log(ddl_type);
CREATE INDEX idx_evolution_ddl_log_status ON evolution_ddl_log(status);
CREATE INDEX idx_evolution_ddl_log_executed_at ON evolution_ddl_log(executed_at DESC);

-- ==================
-- 3. evolution_log — Kod evrimi kayıtları (8A)
-- ==================
CREATE TABLE evolution_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evolution_type TEXT NOT NULL CHECK (evolution_type IN ('new_module', 'modify_module', 'new_tool', 'prompt_update', 'config_change')),
  target_path TEXT, -- Hedef dosya yolu
  title TEXT NOT NULL,
  description TEXT,
  diff_content TEXT, -- Değişiklik diff'i
  generated_code TEXT, -- Üretilen kod
  test_result TEXT CHECK (test_result IN ('passed', 'failed', 'skipped')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'applied', 'rejected', 'rolled_back')),
  model_used TEXT, -- Hangi model kullandı (gpt-4o, codex, etc.)
  git_branch TEXT, -- Oluşturulan git branch
  git_commit TEXT, -- Commit hash
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evolution_log_status ON evolution_log(status);
CREATE INDEX idx_evolution_log_type ON evolution_log(evolution_type);
CREATE INDEX idx_evolution_log_proposed_at ON evolution_log(proposed_at DESC);

-- ==================
-- 4. DDL günlük limit kontrolü için view
-- ==================
CREATE OR REPLACE VIEW evolution_daily_ddl_count AS
SELECT 
  DATE(executed_at) AS ddl_date,
  COUNT(*) AS ddl_count
FROM evolution_ddl_log
WHERE status = 'executed'
GROUP BY DATE(executed_at);

-- ==================
-- 5. cakal_evolution şemasında örnek meta tablo
-- Çakal'ın kendi oluşturduğu tabloları takip etmek için
-- ==================
CREATE TABLE cakal_evolution.schema_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  columns_json JSONB NOT NULL DEFAULT '{}',
  row_count INTEGER DEFAULT 0,
  created_by TEXT DEFAULT 'cakal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================
-- 6. exec_sql RPC fonksiyonu — Çakal'ın DDL çalıştırma kapısı
-- SECURITY DEFINER: supabase anon key ile bile DDL çalıştırabilir
-- SADECE cakal_evolution şemasına izin verir (uygulama katmanında kontrol)
-- ==================
CREATE OR REPLACE FUNCTION exec_sql(sql_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Güvenlik: boş SQL engelle
  IF sql_text IS NULL OR TRIM(sql_text) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SQL cannot be empty');
  END IF;

  -- SQL çalıştır
  EXECUTE sql_text;

  result := jsonb_build_object('success', true);
  RETURN result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$$;

-- Sadece authenticated ve service_role erişebilsin
REVOKE ALL ON FUNCTION exec_sql(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;
