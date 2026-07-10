-- External API Key 配额幂等账本。
--
-- WHY: credits_used 过去只有聚合计数，同一任务并发重试时无法识别已经执行的
-- 预占或退款。账本以 (api_key_id, source_ref) 唯一约束保存单向状态，配合
-- external_api_key 行锁，使聚合计数与幂等状态在同一事务内更新。

CREATE TABLE IF NOT EXISTS "external_api_key_usage" (
  "api_key_id" text NOT NULL,
  "source_ref" text NOT NULL,
  "user_id" text NOT NULL,
  "amount" numeric(18, 2) NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "refunded_at" timestamptz,
  CONSTRAINT "external_api_key_usage_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "external_api_key_usage_status_check"
    CHECK ("status" IN ('reserved', 'refunded'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_api_key_usage"
    ADD CONSTRAINT "external_api_key_usage_api_key_id_external_api_key_id_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "public"."external_api_key"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_api_key_usage"
    ADD CONSTRAINT "external_api_key_usage_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_api_key_usage_source_unique"
  ON "external_api_key_usage" ("api_key_id", "source_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_api_key_usage_user_created_idx"
  ON "external_api_key_usage" ("user_id", "created_at");
