ALTER TABLE tournament_events
  ADD COLUMN IF NOT EXISTS advance_to_playoffs INTEGER NOT NULL DEFAULT 4;

UPDATE tournament_events
SET advance_to_playoffs = 4
WHERE advance_to_playoffs IS NULL OR advance_to_playoffs < 1;
