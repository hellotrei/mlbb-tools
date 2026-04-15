ALTER TABLE tournament_rounds
  ADD COLUMN IF NOT EXISTS stage VARCHAR(32) NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS stage_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS label VARCHAR(80);

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS match_best_of INTEGER;

UPDATE tournament_events
SET format = 'single_elimination'
WHERE event_mode = 'playoffs' AND (format IS NULL OR format = '' OR format = 'playoffs');
