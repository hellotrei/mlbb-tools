ALTER TABLE tournament_teams
  ADD COLUMN IF NOT EXISTS captain_whatsapp VARCHAR(32);
