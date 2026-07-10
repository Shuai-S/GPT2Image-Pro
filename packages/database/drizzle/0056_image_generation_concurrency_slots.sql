-- 图像生成的集群级用户/全局 semaphore 槽位。
--
-- WHY: 生图管线当前传入不可序列化的请求闭包，同步与流式请求也
-- 依赖当前 HTTP 连接，因此不能伪装成数据库 worker。本表只持久运行许可：
-- 每个任务以同一 lease_id 原子领取一个 user 槽与一个 global 槽，业务在
-- 事务外运行。心跳停止后过期槽位可被其他副本接管。

CREATE TABLE IF NOT EXISTS "image_generation_concurrency_slot" (
  "scope" text NOT NULL,
  "scope_key" text NOT NULL,
  "slot_no" integer NOT NULL,
  "lease_id" text,
  "owner_id" text,
  "task_id" text,
  "lease_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "image_generation_concurrency_slot_scope_check"
    CHECK ("scope" IN ('user', 'global')),
  CONSTRAINT "image_generation_concurrency_slot_slot_no_check"
    CHECK ("slot_no" > 0),
  CONSTRAINT "image_generation_concurrency_slot_pkey"
    PRIMARY KEY ("scope", "scope_key", "slot_no")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_generation_concurrency_slot_lease_idx"
  ON "image_generation_concurrency_slot" ("lease_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_generation_concurrency_slot_expiry_idx"
  ON "image_generation_concurrency_slot" ("lease_expires_at");
