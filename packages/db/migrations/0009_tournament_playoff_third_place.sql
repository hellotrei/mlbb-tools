ALTER TABLE tournament_events
  ADD COLUMN IF NOT EXISTS playoff_third_place_best_of INTEGER;
