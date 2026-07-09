-- 图库分页与计数查询索引。
--
-- WHY: /dashboard/gallery 首屏和切 tab 会按 user/status/storage_key/created_at
-- 查询当前列表，并按 created_at,id 做游标翻页。既有 generation_user_id_created_at_idx
-- 缺少 id 与 partial 条件，在大表上仍可能扫描大量无关行；视频表同理缺少 id 游标列。
-- 下列索引用 IF NOT EXISTS 保持手写迁移幂等。drizzle migrate 在事务内执行，
-- 不能使用 CONCURRENTLY；生产大表如需非阻塞建索引，应先在维护窗口手动
-- CREATE INDEX CONCURRENTLY 同名索引，本迁移随后为 no-op。

CREATE INDEX IF NOT EXISTS "generation_gallery_final_idx"
  ON "generation" ("user_id", "created_at" DESC, "id" DESC)
  WHERE "status" = 'completed' AND "storage_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_gallery_status_cursor_idx"
  ON "generation" ("user_id", "status", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_generation_gallery_idx"
  ON "video_generation" ("user_id", "status", "created_at" DESC, "id" DESC)
  WHERE "storage_key" IS NOT NULL;
