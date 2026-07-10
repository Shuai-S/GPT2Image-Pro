-- 把持久异步任务租约的 fencing token 下沉到图像与视频业务行。
--
-- WHY: external_async_task 的 token 只能阻止旧 worker 覆盖任务外壳，不能阻止晚到
-- 执行覆盖 generation/video_generation 终态、退款赢家或发布孤立对象。业务管线的
-- running/failed/completed 条件写必须同时匹配本次 token；同步路径继续使用 NULL。

ALTER TABLE "generation"
  ADD COLUMN IF NOT EXISTS "execution_token" text;
--> statement-breakpoint
ALTER TABLE "video_generation"
  ADD COLUMN IF NOT EXISTS "execution_token" text;
