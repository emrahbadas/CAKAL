ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS learning_score INTEGER NOT NULL DEFAULT 0 CHECK (learning_score BETWEEN 0 AND 100);

UPDATE user_profile
SET learning_score = COALESCE(engagement_score, 0)
WHERE learning_score = 0 AND COALESCE(engagement_score, 0) > 0;