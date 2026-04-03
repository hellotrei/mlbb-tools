ALTER TABLE tournament_events
  ADD COLUMN IF NOT EXISTS event_mode VARCHAR(24) NOT NULL DEFAULT 'regular_season',
  ADD COLUMN IF NOT EXISTS match_best_of INTEGER NOT NULL DEFAULT 2;

UPDATE tournament_events
SET event_mode = 'playoffs'
WHERE format = 'playoffs'
  AND event_mode <> 'playoffs';

UPDATE tournament_events
SET event_mode = 'regular_season'
WHERE event_mode IS NULL OR event_mode = '';
