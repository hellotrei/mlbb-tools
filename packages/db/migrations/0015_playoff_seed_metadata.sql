ALTER TABLE tournament_events ADD COLUMN playoff_seed_policy varchar(32);
ALTER TABLE tournament_events ADD COLUMN playoff_seed_metadata jsonb;
