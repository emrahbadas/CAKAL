-- ============================
-- Çakal Çekirdeği — Seed Data
-- İlk kullanıcı profili ve varsayılan ayarlar
-- ============================

-- Default user profile
INSERT INTO user_profile (
  id,
  risk_tolerance,
  preferred_domains,
  decision_speed,
  engagement_score
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'medium',
  ARRAY['elektronik', 'araba'],
  'fast',
  0
);
