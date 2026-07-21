-- Ensure default user profile exists for agent/tool FK relations
INSERT INTO user_profile (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
