-- Add game_number column to tournament_match_draft_logs
-- Default 1 for existing single-game (BO1) records
ALTER TABLE tournament_match_draft_logs
  ADD COLUMN game_number integer NOT NULL DEFAULT 1;

-- Drop the old unique constraint on matchId alone
ALTER TABLE tournament_match_draft_logs
  DROP CONSTRAINT IF EXISTS tournament_match_draft_logs_match_unique;

-- Add unique constraint on (match_id, game_number)
CREATE UNIQUE INDEX IF NOT EXISTS tournament_match_draft_logs_match_game_unique
  ON tournament_match_draft_logs (match_id, game_number);

-- Add index for lookup
CREATE INDEX IF NOT EXISTS tournament_match_draft_logs_match_game_idx
  ON tournament_match_draft_logs (match_id, game_number);
