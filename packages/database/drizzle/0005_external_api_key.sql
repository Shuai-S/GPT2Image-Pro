CREATE TABLE IF NOT EXISTS "external_api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text DEFAULT 'Default API key' NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_four" text NOT NULL,
  "last_used_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "external_api_key_key_hash_unique" UNIQUE("key_hash"),
  CONSTRAINT "external_api_key_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

