ALTER TABLE tournament_events
  ADD COLUMN IF NOT EXISTS playoff_semifinal_best_of INTEGER,
  ADD COLUMN IF NOT EXISTS playoff_final_best_of INTEGER;
