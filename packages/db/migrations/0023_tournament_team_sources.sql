ALTER TABLE "tournament_teams"
ADD COLUMN "source_event_id" integer,
ADD COLUMN "source_event_name" varchar(255);

DROP INDEX IF EXISTS "tournament_teams_event_name_unique";
