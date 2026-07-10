-- 外部 API 异步任务终态保留任务的部分索引。
--
-- WHY: retention 只扫描已完成且 callback 已结束的旧任务；部分索引避免 queued、
-- running 和待投递 callback 污染索引，并支持 completed_at + id 的稳定有界批次。

CREATE INDEX IF NOT EXISTS "external_async_task_terminal_retention_idx"
  ON "external_async_task" ("completed_at", "id")
  WHERE "status" IN ('completed', 'failed')
    AND "callback_status" IN ('none', 'sent', 'permanent_failed')
    AND "completed_at" IS NOT NULL;
