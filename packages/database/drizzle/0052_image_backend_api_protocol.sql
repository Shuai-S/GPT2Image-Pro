ALTER TABLE "image_backend_api" ADD COLUMN IF NOT EXISTS "api_protocol" text DEFAULT 'openai' NOT NULL;
