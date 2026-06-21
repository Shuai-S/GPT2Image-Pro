ALTER TABLE "image_backend_adobe" ADD COLUMN IF NOT EXISTS "billing_multiplier" numeric DEFAULT '1' NOT NULL;
