CREATE TABLE IF NOT EXISTS "image_backend_group" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_user_selectable" boolean DEFAULT true NOT NULL,
  "content_safety_enabled" boolean,
  "priority" integer DEFAULT 50 NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_backend_account" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text,
  "name" text NOT NULL,
  "email" text,
  "credential_hash" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "interface_mode" text DEFAULT 'web' NOT NULL,
  "model" text,
  "content_safety_enabled" boolean DEFAULT true NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 50 NOT NULL,
  "concurrency" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_used_at" timestamp,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "image_backend_account_credential_hash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_backend_api" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key" text NOT NULL,
  "model" text,
  "interface_mode" text DEFAULT 'images' NOT NULL,
  "use_stream" boolean DEFAULT false NOT NULL,
  "content_safety_enabled" boolean DEFAULT true NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 50 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_used_at" timestamp,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_image_backend_preference" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "group_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_image_backend_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_account" ADD CONSTRAINT "image_backend_account_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_api" ADD CONSTRAINT "image_backend_api_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_image_backend_preference" ADD CONSTRAINT "user_image_backend_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_image_backend_preference" ADD CONSTRAINT "user_image_backend_preference_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "external_api_key"
 ADD COLUMN IF NOT EXISTS "generation_group_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_api_key" ADD CONSTRAINT "external_api_key_generation_group_id_image_backend_group_id_fk" FOREIGN KEY ("generation_group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_group_enabled_priority_idx" ON "image_backend_group" ("is_enabled", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_account_group_enabled_priority_idx" ON "image_backend_account" ("group_id", "is_enabled", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_api_group_enabled_priority_idx" ON "image_backend_api" ("group_id", "is_enabled", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_api_key_generation_group_id_idx" ON "external_api_key" ("generation_group_id");
