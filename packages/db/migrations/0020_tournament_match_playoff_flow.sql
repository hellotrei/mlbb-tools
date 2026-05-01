ALTER TABLE "tournament_matches"
  ADD COLUMN IF NOT EXISTS "playoff_flow" jsonb;
