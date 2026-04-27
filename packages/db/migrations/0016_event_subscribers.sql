CREATE TABLE IF NOT EXISTS "event_subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"leagues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"whatsapp" varchar(30),
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_subscribers_email_unique" ON "event_subscribers" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_subscribers_created_at_idx" ON "event_subscribers" ("created_at");
