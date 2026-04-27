ALTER TABLE "tournament_events" ADD COLUMN IF NOT EXISTS "admin_whatsapp" varchar(32);
ALTER TABLE "tournament_events" ADD COLUMN IF NOT EXISTS "registration_deadline" timestamp with time zone;
