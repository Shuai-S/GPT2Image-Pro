-- 画廊/历史/计数 + 每次读触发的 pending 过期维护扫描:在 686MB 的 generation 表上
-- 此前只有主键索引,这些查询全是顺序扫(累计 seq_scan 6.3 万次、读 23 亿行),
-- 表现为前端"切换选项卡/拉数据库"卡顿。下列索引把顺序扫转为索引扫。
--
-- 说明:线上库已用 CREATE INDEX CONCURRENTLY 非阻塞建好;此处用普通 CREATE INDEX
-- IF NOT EXISTS —— drizzle-kit migrate 在单事务内执行迁移,CONCURRENTLY 在事务块内非法;
-- 对已存在索引的线上库为 no-op,对新建/重置库表为空、加锁瞬时无影响。
CREATE INDEX IF NOT EXISTS "generation_user_id_created_at_idx" ON "generation" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_status_created_at_idx" ON "generation" ("status","created_at");
--> statement-breakpoint
-- metadata 的 jsonb_path_ops GIN 表达式索引:加速画廊 draft/upload 的 @? jsonpath 过滤。
-- 原 EXISTS(jsonb_array_elements(metadata...)) 需对该用户全部行逐行解析 metadata(单查 ~2.3s);
-- 改写为 (metadata::jsonb) @? '<jsonpath>' 后可走该 GIN(降至 ~11ms)。
CREATE INDEX IF NOT EXISTS "generation_metadata_gin_idx" ON "generation" USING gin (("metadata"::jsonb) jsonb_path_ops);
