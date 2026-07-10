-- 内部后台任务的可恢复分布式租约。
--
-- WHY: 旧调度器在事务级 advisory lock 所在事务内运行完整任务，
-- 网络 I/O 和批处理期间会长期占用连接，且进程崩溃后没有可观测的租约终态。
-- owner_id + run_id 是 fencing token，保证过期 owner 的晚到心跳或终态
-- 无法覆盖新 owner。时间判定由 PostgreSQL now() 统一完成。

CREATE TABLE IF NOT EXISTS "internal_job_lease" (
  "job_name" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "run_id" text NOT NULL,
  "status" text NOT NULL,
  "lease_expires_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz NOT NULL,
  "last_started_at" timestamptz NOT NULL,
  "last_finished_at" timestamptz,
  "last_success_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "internal_job_lease_status_check"
    CHECK ("status" IN ('running', 'success', 'error'))
);
