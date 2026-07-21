-- Conversation logs tablosu (chat geçmişi DB'de tutmak için)
CREATE TABLE conversation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  agent_name TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_user ON conversation_logs(user_id);
CREATE INDEX idx_conversation_created ON conversation_logs(created_at DESC);

-- System capabilities tablosu (self-awareness için)
CREATE TABLE system_capabilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  capability_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing', 'planned', 'disabled')),
  required_config JSONB DEFAULT '{}', -- hangi API key / tool gerekli
  category TEXT NOT NULL, -- 'source', 'notification', 'ai', 'finance', 'travel'
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_capabilities_status ON system_capabilities(status);
CREATE INDEX idx_capabilities_category ON system_capabilities(category);

-- Varsayılan capability kayıtları
INSERT INTO system_capabilities (capability_name, description, status, required_config, category) VALUES
  ('openai_chat', 'OpenAI GPT-4o ile sohbet ve analiz', 'active', '{"key": "OPENAI_API_KEY"}', 'ai'),
  ('perplexity_search', 'Perplexity API ile web araması ve trend analizi', 'active', '{"key": "PERPLEXITY_API_KEY"}', 'ai'),
  ('telegram_notify', 'Telegram ile anlık bildirim gönderme', 'active', '{"key": "TELEGRAM_BOT_TOKEN", "extra": "TELEGRAM_CHAT_ID"}', 'notification'),
  ('sahibinden_scan', 'Sahibinden.com tarama (Playwright)', 'missing', '{"tool": "playwright"}', 'source'),
  ('trendyol_scan', 'Trendyol kampanya ve indirim tarama', 'missing', '{"tool": "playwright"}', 'source'),
  ('letgo_scan', 'Letgo/Dolap ikinci el tarama', 'missing', '{"tool": "playwright"}', 'source'),
  ('finance_watch', 'Döviz, altın, kripto fiyat takibi', 'planned', '{"key": "ALPHA_VANTAGE_KEY"}', 'finance'),
  ('flight_search', 'Ucuz uçak bileti arama', 'missing', '{"key": "SKYSCANNER_API_KEY"}', 'travel'),
  ('hotel_search', 'Ucuz otel arama', 'missing', '{"key": "BOOKING_API_KEY"}', 'travel'),
  ('aliexpress_arbitrage', 'AliExpress fiyat karşılaştırma', 'planned', '{"tool": "playwright"}', 'source'),
  ('price_history', 'Akakçe/Cimri fiyat geçmişi', 'missing', '{"tool": "playwright"}', 'source');
