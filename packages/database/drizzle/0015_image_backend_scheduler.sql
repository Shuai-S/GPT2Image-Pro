ALTER TABLE "image_backend_account"
  ADD COLUMN IF NOT EXISTS "success_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "fail_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_acquired_at" timestamp,
  ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;
--> statement-breakpoint
ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "success_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "fail_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_acquired_at" timestamp,
  ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "last_error_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_account_scheduler_idx"
  ON "image_backend_account" ("group_id", "is_enabled", "status", "priority", "last_used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_api_scheduler_idx"
  ON "image_backend_api" ("group_id", "is_enabled", "status", "priority", "last_used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_account_cooldown_idx"
  ON "image_backend_account" ("cooldown_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_api_cooldown_idx"
  ON "image_backend_api" ("cooldown_until");
