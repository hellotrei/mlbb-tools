CREATE TABLE IF NOT EXISTS tournament_events (
  id SERIAL PRIMARY KEY,
  code VARCHAR(24) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  format VARCHAR(24) NOT NULL DEFAULT 'swiss',
  total_teams INTEGER NOT NULL,
  total_rounds INTEGER NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ongoing',
  created_by_telegram_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournament_events_telegram_user_idx
  ON tournament_events (created_by_telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tournament_events_status_idx
  ON tournament_events (status, created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_teams (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  seed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_teams_event_seed_unique UNIQUE (event_id, seed),
  CONSTRAINT tournament_teams_event_name_unique UNIQUE (event_id, name)
);

CREATE INDEX IF NOT EXISTS tournament_teams_event_idx
  ON tournament_teams (event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_rounds (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_rounds_event_round_unique UNIQUE (event_id, round_number)
);

CREATE INDEX IF NOT EXISTS tournament_rounds_event_idx
  ON tournament_rounds (event_id, round_number);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  team_a_id INTEGER NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  team_b_id INTEGER REFERENCES tournament_teams(id) ON DELETE CASCADE,
  score_a INTEGER,
  score_b INTEGER,
  result VARCHAR(24) NOT NULL DEFAULT 'pending',
  pairing_order INTEGER NOT NULL,
  winner_team_id INTEGER REFERENCES tournament_teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_matches_round_order_unique UNIQUE (round_id, pairing_order)
);

CREATE INDEX IF NOT EXISTS tournament_matches_event_round_idx
  ON tournament_matches (event_id, round_id, pairing_order);

CREATE INDEX IF NOT EXISTS tournament_matches_event_result_idx
  ON tournament_matches (event_id, result);

CREATE TABLE IF NOT EXISTS telegram_sessions (
  id SERIAL PRIMARY KEY,
  telegram_user_id VARCHAR(64) NOT NULL,
  current_command VARCHAR(64) NOT NULL,
  step VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expired_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_sessions_user_command_idx
  ON telegram_sessions (telegram_user_id, current_command, updated_at DESC);

CREATE INDEX IF NOT EXISTS telegram_sessions_expiry_idx
  ON telegram_sessions (expired_at);
