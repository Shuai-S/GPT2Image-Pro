-- 积分消费幂等性约束：偏唯一索引由 (type, source_ref) 收窄到 (user_id, type, source_ref)
--
-- 背景：0027 建立的偏唯一索引 (type, source_ref) WHERE source_ref IS NOT NULL 为
-- 全局唯一，意味着同一 source_ref 在全表只能存在一行。consumeCredits 的幂等命中会
-- 把命中交易的 amount/metadata（consumedBatches）回放给调用方；若两个不同用户碰巧
-- 共用同一 source_ref，本人合法扣费会误命中他人交易（越权读取金额/批次明细，且本人
-- 实际未扣费），构成 IDOR 风险。
--
-- 本迁移把约束放松为 per-user：(user_id, type, source_ref)。这是放松约束（旧约束更
-- 宽/全局唯一，新约束按用户分桶），历史数据天然兼容——同一行不可能违反更宽松的约束。
-- 配套 core.ts 的两处幂等查询已补 eq(user_id)，二者一致。
--
-- ⚠️ 应用前置排查（上线前手动执行）：
--   source_ref 正常派生自服务端随机 generationId（如 `${generationId}:charge`），
--   按用户分组不应出现重复；新索引为 UNIQUE，若历史数据存在同 (user_id, type,
--   source_ref) 多行将建索引失败。先排查：
--     SELECT user_id, type, source_ref, count(*)
--     FROM credits_transaction WHERE source_ref IS NOT NULL
--     GROUP BY user_id, type, source_ref HAVING count(*) > 1;
--   理论上为空。若非空需先人工核对/清理重复后再应用本迁移。
--
-- 幂等性：DROP ... IF EXISTS 与 CREATE ... IF NOT EXISTS，重复执行安全。

DROP INDEX IF EXISTS "credits_transaction_type_source_ref_unique";

CREATE UNIQUE INDEX IF NOT EXISTS
 "credits_transaction_user_type_source_ref_unique"
 ON "credits_transaction" ("user_id","type","source_ref")
 WHERE "source_ref" IS NOT NULL;
