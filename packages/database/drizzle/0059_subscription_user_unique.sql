-- 清理同用户重复订阅并建立 subscription.user_id 数据库唯一约束。
--
-- WHY: 历史写路径以先查后写实现，同一用户的并发 webhook 或管理操作可能插入
-- 多行。业务查询随后 limit(1) 会读到任意套餐，造成旧权益被重新激活或错误授权。
-- winner 必须是同一条完整记录，不能把不同历史行的最高套餐、状态和到期日拼接；
-- 统一按 updated_at、created_at、id 倒序选择最近一次完整事实。
--
-- 本迁移不修改任何积分账本或余额表。loser 删除前写入 admin_audit_log，
-- 保留完整 loser/winner 快照并标记可能需要到上游取消的订阅。

LOCK TABLE "subscription" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH "ranked_subscriptions" AS (
  SELECT
    "id",
    "user_id",
    row_number() OVER (
      PARTITION BY "user_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "row_number",
    first_value("id") OVER (
      PARTITION BY "user_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "winner_id"
  FROM "subscription"
),
"duplicate_subscriptions" AS (
  SELECT
    "loser".*,
    "ranked"."winner_id",
    to_json("loser") AS "loser_snapshot",
    to_json("winner") AS "winner_snapshot"
  FROM "ranked_subscriptions" AS "ranked"
  JOIN "subscription" AS "loser" ON "loser"."id" = "ranked"."id"
  JOIN "subscription" AS "winner" ON "winner"."id" = "ranked"."winner_id"
  WHERE "ranked"."row_number" > 1
)
INSERT INTO "admin_audit_log" (
  "id",
  "admin_user_id",
  "target_user_id",
  "action",
  "reason",
  "before",
  "after",
  "metadata",
  "created_at"
)
SELECT
  'subscription-deduplicate:' || md5(
    "duplicate"."id" || ':' || "duplicate"."winner_id"
  ),
  NULL,
  "duplicate"."user_id",
  'subscription.history.deduplicate',
  '0059 migration retained the most recently updated complete subscription row',
  "duplicate"."loser_snapshot",
  "duplicate"."winner_snapshot",
  json_build_object(
    'migration', '0059_subscription_user_unique',
    'loserSubscriptionId', "duplicate"."subscription_id",
    'winnerId', "duplicate"."winner_id",
    'winnerSelection', 'updated_at_desc_created_at_desc_id_desc',
    'mayRequireUpstreamCancellation',
      "duplicate"."subscription_id" NOT LIKE 'manual:%'
      AND (
        "duplicate"."status" IN ('active', 'trialing', 'past_due', 'paused')
        OR COALESCE("duplicate"."current_period_end" > now(), false)
      ),
    'creditsModified', false
  ),
  now()
FROM "duplicate_subscriptions" AS "duplicate"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
WITH "ranked_subscriptions" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "row_number"
  FROM "subscription"
)
DELETE FROM "subscription" AS "duplicate"
USING "ranked_subscriptions" AS "ranked"
WHERE "duplicate"."id" = "ranked"."id"
  AND "ranked"."row_number" > 1;
--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_user_id_updated_at_idx";
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_user_id_unique'
      AND conrelid = 'subscription'::regclass
  ) THEN
    ALTER TABLE "subscription"
      ADD CONSTRAINT "subscription_user_id_unique" UNIQUE ("user_id");
  END IF;
END $$;
