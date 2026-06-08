ALTER TABLE "image_backend_account"
  ADD COLUMN IF NOT EXISTS "always_active" boolean DEFAULT false NOT NULL;
