-- ============================
-- Çakal Çekirdeği — Güvenlik Sıkılaştırma
-- Migration: 20260705000100_security_hardening
-- 1) exec_sql: yalnızca cakal_evolution şemasına tek DDL ifadesi
-- 2) public şema tablolarında RLS aktif + anon/authenticated yetkileri kaldırıldı
-- Not: Uygulama main process'i service_role ile bağlanır; RLS onu etkilemez.
-- ============================

-- ==================
-- 1. exec_sql sıkılaştırma
-- Eski sürüm her SQL'i çalıştırıyordu ve search_path=public olduğu için
-- şema öneki olmayan DDL public şemasına iniyordu. Yeni sürüm:
--   • Yalnızca tek ifade (noktalı virgül zinciri yok)
--   • Yalnızca CREATE / ALTER / DROP
--   • public. referansı yasak
--   • Hedef nesne açıkça cakal_evolution. önekli olmalı
--   • search_path = cakal_evolution (önek unutulsa bile public'e inemez)
-- ==================
CREATE OR REPLACE FUNCTION exec_sql(sql_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cakal_evolution
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF sql_text IS NULL OR TRIM(sql_text) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SQL cannot be empty');
  END IF;

  -- Yorumları söküp normalize et (yorum içine gizlenmiş bypass'ları önler)
  cleaned := regexp_replace(sql_text, '/\*.*?\*/', ' ', 'g');
  cleaned := regexp_replace(cleaned, '--[^\r\n]*', ' ', 'g');
  cleaned := lower(TRIM(regexp_replace(cleaned, '\s+', ' ', 'g')));

  -- Tek ifade zorunlu: noktalı virgül yalnızca sonda olabilir
  IF position(';' IN rtrim(cleaned, '; ')) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a single statement is allowed');
  END IF;

  -- Yalnızca DDL
  IF cleaned !~ '^(create|alter|drop) ' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only CREATE / ALTER / DROP DDL is allowed');
  END IF;

  -- public şeması kesin yasak
  IF cleaned ~ '\mpublic\s*\.' THEN
    RETURN jsonb_build_object('success', false, 'error', 'public schema is off-limits');
  END IF;

  -- Hedef açıkça cakal_evolution şeması olmalı
  IF position('cakal_evolution.' IN cleaned) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'DDL must explicitly target the cakal_evolution schema (use cakal_evolution.<table>)');
  END IF;

  EXECUTE sql_text;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$$;

-- Yalnızca service_role çağırabilsin (eski GRANT authenticated kaldırıldı)
REVOKE ALL ON FUNCTION exec_sql(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION exec_sql(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION exec_sql(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;

-- ==================
-- 2. RLS: public şemadaki tüm tablolarda etkinleştir
-- Politika tanımlanmadığı için anon/authenticated erişimi tamamen kapalı;
-- service_role RLS'i bypass eder (uygulama main process'i bunu kullanır).
-- ==================
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Tablo/sequence yetkilerini de kaldır (derinlemesine savunma)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- cakal_evolution şeması da yalnızca service_role'e açık kalsın
REVOKE ALL ON ALL TABLES IN SCHEMA cakal_evolution FROM anon, authenticated;
