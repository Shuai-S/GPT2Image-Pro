-- 账单页(余额/计数/交易列表)与管理员用户详情:credits_transaction(14.6 万行、141MB)
-- 仅有主键与偏唯一索引 (user_id, type, source_ref) WHERE source_ref IS NOT NULL,
-- 无法服务 'WHERE user_id=? ORDER BY created_at DESC' —— 此前全表顺序扫。
-- 补 (user_id, created_at) 索引后转为 Index Scan Backward(~0.1ms)。
--
-- 同 0035:线上已 CONCURRENTLY 建好;此处普通 IF NOT EXISTS(事务内迁移不可用 CONCURRENTLY)。
CREATE INDEX IF NOT EXISTS "credits_transaction_user_id_created_at_idx" ON "credits_transaction" ("user_id","created_at");
