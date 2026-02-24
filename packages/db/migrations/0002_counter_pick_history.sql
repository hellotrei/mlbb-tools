CREATE TABLE IF NOT EXISTS counter_pick_history (
  id SERIAL PRIMARY KEY,
  timeframe VARCHAR(8) NOT NULL,
  rank_scope VARCHAR(40) NOT NULL DEFAULT 'mythic_glory',
  enemy_mlids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_mlids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS counter_pick_history_timeframe_rank_idx
  ON counter_pick_history (timeframe, rank_scope, created_at DESC);
