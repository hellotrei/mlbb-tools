CREATE TABLE IF NOT EXISTS heroes (
  id SERIAL PRIMARY KEY,
  mlid INTEGER NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  role_primary VARCHAR(40) NOT NULL,
  role_secondary VARCHAR(40),
  lanes JSONB NOT NULL DEFAULT '[]'::jsonb,
  specialities JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_key VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hero_stats_snapshots (
  id SERIAL PRIMARY KEY,
  timeframe VARCHAR(8) NOT NULL,
  rank_scope VARCHAR(40) NOT NULL DEFAULT 'all',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS hero_stats_latest (
  id SERIAL PRIMARY KEY,
  mlid INTEGER NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  win_rate NUMERIC(6, 3) NOT NULL,
  pick_rate NUMERIC(6, 3) NOT NULL,
  ban_rate NUMERIC(6, 3) NOT NULL,
  appearance INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hero_stats_latest_mlid_timeframe_unique UNIQUE (mlid, timeframe)
);

CREATE INDEX IF NOT EXISTS hero_stats_latest_timeframe_win_rate_idx
  ON hero_stats_latest (timeframe, win_rate DESC);

CREATE INDEX IF NOT EXISTS hero_stats_latest_timeframe_pick_rate_idx
  ON hero_stats_latest (timeframe, pick_rate DESC);

CREATE INDEX IF NOT EXISTS hero_stats_latest_timeframe_ban_rate_idx
  ON hero_stats_latest (timeframe, ban_rate DESC);

CREATE TABLE IF NOT EXISTS tier_results (
  id SERIAL PRIMARY KEY,
  timeframe VARCHAR(8) NOT NULL,
  segment VARCHAR(120) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS tier_results_timeframe_segment_idx
  ON tier_results (timeframe, segment);

CREATE TABLE IF NOT EXISTS counter_matrix (
  id SERIAL PRIMARY KEY,
  timeframe VARCHAR(8) NOT NULL,
  enemy_mlid INTEGER NOT NULL,
  counter_mlid INTEGER NOT NULL,
  score NUMERIC(6, 4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT counter_matrix_unique UNIQUE (timeframe, enemy_mlid, counter_mlid)
);

CREATE INDEX IF NOT EXISTS counter_matrix_timeframe_enemy_score_idx
  ON counter_matrix (timeframe, enemy_mlid, score DESC);
