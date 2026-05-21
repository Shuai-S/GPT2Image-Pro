ALTER TABLE "ticket"
  ADD COLUMN IF NOT EXISTS "user_last_seen_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket"
  ADD COLUMN IF NOT EXISTS "last_admin_activity_at" timestamp;
