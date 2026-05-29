-- 积分发放幂等性约束
--
-- 背景：grantCredits 的所有幂等检查此前为应用层 SELECT-then-INSERT，
-- credits_batch.source_ref 无唯一约束，并发/重放支付 webhook、注册奖励重复领取
-- 等场景可导致同一来源积分被多次发放（薅羊毛 / 经济损失）。
--
-- 本迁移建立 (source_type, source_ref) 偏唯一索引，使重复发放在数据库层被拒绝；
-- 配合 grantCredits 的 onConflictDoNothing，重复发放将被安全跳过。
-- source_ref 为空的批次（如管理员手动调整）不受约束。
--
-- ⚠️ 应用前置检查：若历史数据已存在重复 (source_type, source_ref)，
-- 本索引创建会失败（fail-loud）。请先排查并人工处置（核对是否多发、是否需追回），
-- 切勿在迁移中自动删除财务批次。排查 SQL：
--   SELECT source_type, source_ref, count(*)
--   FROM credits_batch WHERE source_ref IS NOT NULL
--   GROUP BY source_type, source_ref HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "credits_batch_source_ref_unique"
 ON "credits_batch" ("source_type","source_ref")
 WHERE "source_ref" IS NOT NULL;
