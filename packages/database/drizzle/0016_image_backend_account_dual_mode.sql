ALTER TABLE "image_backend_account"
  DROP CONSTRAINT IF EXISTS "image_backend_account_credential_hash_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "image_backend_account_credential_hash_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_account_interface_credential_hash_unique"
  ON "image_backend_account" ("interface_mode", "credential_hash");
