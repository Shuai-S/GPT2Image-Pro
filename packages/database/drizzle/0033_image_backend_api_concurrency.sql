ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "concurrency" integer DEFAULT 10 NOT NULL;
