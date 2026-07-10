-- 外部 API 持久异步任务、可恢复 PPT/PSD worker 与 callback outbox。
--
-- WHY: 模块级 Map 在重启后丢失 task_*，多副本轮询随机 404；PPT/PSD 无 generation
-- 行，进程崩溃后无法恢复。请求中的 base64 图片不会写入本表，只保存对象存储引用。

CREATE TABLE IF NOT EXISTS "external_async_task" (
  "id" text PRIMARY KEY NOT NULL,
  "task_type" text NOT NULL,
  "object_type" text NOT NULL,
  "user_id" text NOT NULL,
  "api_key_id" text,
  "kind" text,
  "model" text,
  "client_request_id" text,
  "request_hash" text,
  "status" text NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "user_concurrency" integer DEFAULT 1 NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "lease_owner" text,
  "lease_token" text,
  "lease_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "initial_payload" json NOT NULL,
  "request_payload" json,
  "result_payload" json,
  "error_payload" json,
  "callback_url" text,
  "callback_status" text DEFAULT 'none' NOT NULL,
  "callback_attempts" integer DEFAULT 0 NOT NULL,
  "callback_next_at" timestamptz,
  "callback_lease_owner" text,
  "callback_lease_token" text,
  "callback_lease_expires_at" timestamptz,
  "callback_delivered_at" timestamptz,
  "callback_error" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "external_async_task_type_check"
    CHECK ("task_type" IN ('image', 'video', 'editable_file')),
  CONSTRAINT "external_async_task_status_check"
    CHECK ("status" IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT "external_async_task_callback_status_check"
    CHECK ("callback_status" IN ('none', 'waiting', 'sending', 'retry', 'sent', 'permanent_failed')),
  CONSTRAINT "external_async_task_attempts_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" > 0),
  CONSTRAINT "external_async_task_concurrency_check"
    CHECK ("user_concurrency" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_async_task"
    ADD CONSTRAINT "external_async_task_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_async_task_editable_client_unique"
  ON "external_async_task" ("user_id", "kind", "client_request_id")
  WHERE "task_type" = 'editable_file' AND "client_request_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_async_task_editable_claim_idx"
  ON "external_async_task" (
    "task_type", "status", "priority" DESC, "available_at", "created_at"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_async_task_lease_expiry_idx"
  ON "external_async_task" ("lease_expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_async_task_callback_claim_idx"
  ON "external_async_task" (
    "callback_status", "callback_next_at", "callback_lease_expires_at"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_async_task_owner_idx"
  ON "external_async_task" ("user_id", "api_key_id", "created_at" DESC);
