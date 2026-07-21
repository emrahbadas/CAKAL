-- ============================
-- Çakal Çekirdeği — Self-Awareness Tabloları
-- Migration: 004_self_awareness
-- Sprint 7: System Conscience
-- ============================

-- ==================
-- 1. capability_gaps — Tespit edilen eksik yetenek talepleri
-- ==================
CREATE TABLE capability_gaps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  capability_name TEXT NOT NULL,
  trigger_count INTEGER NOT NULL DEFAULT 1,
  first_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context TEXT, -- Son tetiklenme bağlamı (kullanıcı mesajı veya tool adı)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'proposed', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aynı yetenek adı için tekil index (upsert kolaylığı)
CREATE UNIQUE INDEX idx_capability_gaps_name ON capability_gaps(capability_name);

-- ==================
-- 2. expansion_proposals — Kullanıcıya sunulan gelişim önerileri
-- ==================
CREATE TABLE expansion_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  capability_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT, -- Teknik entegrasyon önerisi
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  user_response TEXT, -- Kullanıcının isteğe bağlı açıklaması
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Haftalık max 1 öneri kuralı için index
CREATE INDEX idx_expansion_proposals_proposed_at ON expansion_proposals(proposed_at DESC);

-- Status bazlı sorgular için index
CREATE INDEX idx_expansion_proposals_status ON expansion_proposals(status);
