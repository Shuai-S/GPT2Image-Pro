CREATE TABLE IF NOT EXISTS "image_backend_api_group" (
  "id" text PRIMARY KEY NOT NULL,
  "api_id" text NOT NULL,
  "group_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_api_group" ADD CONSTRAINT "image_backend_api_group_api_id_image_backend_api_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."image_backend_api"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_api_group" ADD CONSTRAINT "image_backend_api_group_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_api_group_api_group_unique"
  ON "image_backend_api_group" ("api_id", "group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_api_group_group_idx"
  ON "image_backend_api_group" ("group_id");
--> statement-breakpoint
INSERT INTO "image_backend_api_group" ("id", "api_id", "group_id", "created_at")
SELECT
  "image_backend_api"."id" || ':' || "image_backend_api"."group_id",
  "image_backend_api"."id",
  "image_backend_api"."group_id",
  COALESCE("image_backend_api"."created_at", now())
FROM "image_backend_api"
WHERE "image_backend_api"."group_id" IS NOT NULL
ON CONFLICT DO NOTHING;
