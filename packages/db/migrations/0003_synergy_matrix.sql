CREATE TABLE IF NOT EXISTS synergy_matrix (
  id SERIAL PRIMARY KEY,
  timeframe VARCHAR(8) NOT NULL,
  hero_mlid INTEGER NOT NULL,
  synergy_mlid INTEGER NOT NULL,
  score NUMERIC(6, 4) NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'meta',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS synergy_matrix_unique
  ON synergy_matrix (timeframe, hero_mlid, synergy_mlid);

CREATE INDEX IF NOT EXISTS synergy_matrix_hero_score_idx
  ON synergy_matrix (timeframe, hero_mlid, score);
