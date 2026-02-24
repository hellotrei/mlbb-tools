CREATE TABLE IF NOT EXISTS hero_role_pool (
  id SERIAL PRIMARY KEY,
  mlid INTEGER NOT NULL,
  lane VARCHAR(16) NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL,
  source VARCHAR(24) NOT NULL DEFAULT 'derived',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hero_role_pool_unique UNIQUE (mlid, lane)
);

CREATE INDEX IF NOT EXISTS hero_role_pool_lane_confidence_idx
  ON hero_role_pool (lane, confidence DESC);
