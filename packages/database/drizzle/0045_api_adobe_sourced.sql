ALTER TABLE "image_backend_api" ADD COLUMN IF NOT EXISTS "adobe_sourced" boolean DEFAULT false NOT NULL;
ALTER TABLE "image_backend_api" ADD COLUMN IF NOT EXISTS "billing_multiplier" numeric DEFAULT '1' NOT NULL;
