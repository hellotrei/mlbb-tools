ALTER TABLE tournament_events
  ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS tournament_events_telegram_chat_idx
  ON tournament_events (telegram_chat_id, created_at DESC);
