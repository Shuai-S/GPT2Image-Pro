ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "failure_cooldown_enabled" boolean DEFAULT false NOT NULL;
