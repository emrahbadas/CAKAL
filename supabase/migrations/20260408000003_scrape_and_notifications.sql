-- ============================
-- Migration: 003_scrape_and_notifications
-- Tarama kaynakları + bildirim log tabloları
-- ============================

-- ==================
-- 1. Scrape Sources — Kaynak tarama konfigürasyonu
-- ==================
CREATE TABLE scrape_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id TEXT NOT NULL UNIQUE,              -- 'sahibinden', 'trendyol', 'letgo'
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'scrape' CHECK (source_type IN ('scrape', 'api')),
  base_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 10,
  min_delay_ms INTEGER NOT NULL DEFAULT 3000,  -- minimum bekleme süresi (ms)
  max_delay_ms INTEGER NOT NULL DEFAULT 8000,  -- maximum bekleme süresi (ms)
  last_scraped_at TIMESTAMPTZ,
  last_error TEXT,
  ban_until TIMESTAMPTZ,                       -- ban varsa bu tarihe kadar bekle
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_errors INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC(5,2) DEFAULT 100.00,
  config JSONB DEFAULT '{}',                   -- ek ayarlar (proxy, UA listesi vs.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scrape_sources_active ON scrape_sources(is_active);
CREATE INDEX idx_scrape_sources_ban ON scrape_sources(ban_until);

-- Varsayılan kaynak kayıtları
INSERT INTO scrape_sources (source_id, source_name, source_type, base_url, rate_limit_per_min, min_delay_ms, max_delay_ms, config) VALUES
  ('sahibinden', 'Sahibinden.com', 'scrape', 'https://www.sahibinden.com', 8, 4000, 10000, '{"cautious": true, "cloudflare": true}'),
  ('trendyol', 'Trendyol', 'scrape', 'https://www.trendyol.com', 12, 2000, 6000, '{"cautious": false}'),
  ('letgo', 'Letgo/Dolap', 'scrape', 'https://www.dolap.com', 10, 3000, 7000, '{"cautious": false}'),
  ('perplexity', 'Perplexity API', 'api', 'https://api.perplexity.ai', 30, 500, 1000, '{"type": "api"}');

-- ==================
-- 2. Notification Log — Gönderilen bildirimler
-- ==================
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'email', 'push', 'in-app')),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('opportunity', 'weekly-summary', 'watchlist-alert', 'profile-update')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_notification_user ON notification_log(user_id);
CREATE INDEX idx_notification_type ON notification_log(notification_type);
CREATE INDEX idx_notification_sent ON notification_log(sent_at DESC);
CREATE INDEX idx_notification_opportunity ON notification_log(opportunity_id);
