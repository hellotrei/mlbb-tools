CREATE TABLE IF NOT EXISTS "tournament_match_draft_logs" (
  "id" serial PRIMARY KEY,
  "event_id" integer NOT NULL REFERENCES "tournament_events"("id") ON DELETE cascade,
  "match_id" integer NOT NULL REFERENCES "tournament_matches"("id") ON DELETE cascade,
  "team_a_picks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "team_b_picks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "team_a_bans" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "team_b_bans" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source" varchar(24) NOT NULL DEFAULT 'manual',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tournament_match_draft_logs_match_unique"
  ON "tournament_match_draft_logs" ("match_id");

CREATE INDEX IF NOT EXISTS "tournament_match_draft_logs_event_idx"
  ON "tournament_match_draft_logs" ("event_id", "match_id");
