-- 积分过期批处理的全局与单用户 partial 索引。
--
-- WHY: processExpiredBatches 以固定 500 行按 expires_at,id 领取到期批次；全局
-- cron 使用 SKIP LOCKED，余额和消费热路径按 user_id 等待同用户结算。旧表只有
-- source_ref 唯一索引，积压时每页都要扫描 active/永久/已终结的无关行。
-- partial 条件与运行时查询逐项一致，使查询成本随待处理页数增长而非随全表增长。
-- drizzle migrate 在事务内执行，不能使用 CONCURRENTLY；生产大表可在维护窗口
-- 预先以 CONCURRENTLY 建立同名索引，本迁移随后因 IF NOT EXISTS 成为 no-op。

CREATE INDEX IF NOT EXISTS "credits_batch_expiration_active_idx"
  ON "credits_batch" ("expires_at", "id")
  WHERE "status" = 'active'
    AND "remaining" > 0
    AND "expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credits_batch_user_expiration_active_idx"
  ON "credits_batch" ("user_id", "expires_at", "id")
  WHERE "status" = 'active'
    AND "remaining" > 0
    AND "expires_at" IS NOT NULL;
