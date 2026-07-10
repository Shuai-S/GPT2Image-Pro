-- 上一正式版本升级测试的最小历史数据夹具。
--
-- WHY: 仅升级空表无法发现数据迁移、唯一索引与非空约束对既有行的破坏。
-- 本夹具只依赖 v0.7.0 已存在的公共表和列，后续正式 tag 仍须保持向后兼容。

CREATE TABLE "migration_ci_marker" (
  "id" integer PRIMARY KEY
);

INSERT INTO "migration_ci_marker" ("id") VALUES (1);

INSERT INTO "user" (
  "id",
  "name",
  "email",
  "email_verified",
  "role"
) VALUES (
  'migration-ci-user',
  'Migration CI',
  'migration-ci@example.invalid',
  true,
  'user'
);

INSERT INTO "subscription" (
  "id",
  "user_id",
  "subscription_id",
  "price_id",
  "status"
) VALUES (
  'migration-ci-subscription',
  'migration-ci-user',
  'migration-ci-provider-subscription',
  'migration-ci-price',
  'active'
);

-- 0059 之前的正式版必须制造重复历史行，验证迁移会保留较新的完整事实。0059 已进入
-- 正式版后，旧 schema 本身已禁止重复；此时就地把单行更新成同一预期赢家，避免门禁
-- 在执行待测增量迁移前被旧版本的正确约束误杀。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_user_id_unique'
      AND conrelid = 'public.subscription'::regclass
  ) THEN
    UPDATE "subscription"
    SET
      "id" = 'migration-ci-subscription-newer',
      "subscription_id" = 'migration-ci-provider-subscription-newer',
      "price_id" = 'migration-ci-price-newer',
      "status" = 'trialing',
      "created_at" = now() + interval '1 minute',
      "updated_at" = now() + interval '1 minute'
    WHERE "id" = 'migration-ci-subscription';
  ELSE
    INSERT INTO "subscription" (
      "id",
      "user_id",
      "subscription_id",
      "price_id",
      "status",
      "created_at",
      "updated_at"
    ) VALUES (
      'migration-ci-subscription-newer',
      'migration-ci-user',
      'migration-ci-provider-subscription-newer',
      'migration-ci-price-newer',
      'trialing',
      now() + interval '1 minute',
      now() + interval '1 minute'
    );
  END IF;
END $$;

INSERT INTO "credits_balance" (
  "id",
  "user_id",
  "balance",
  "total_earned",
  "total_spent"
) VALUES (
  'migration-ci-balance',
  'migration-ci-user',
  25,
  25,
  0
);

INSERT INTO "credits_batch" (
  "id",
  "user_id",
  "amount",
  "remaining",
  "source_type",
  "source_ref"
) VALUES (
  'migration-ci-batch',
  'migration-ci-user',
  25,
  25,
  'bonus',
  'migration-ci-batch-source'
);

INSERT INTO "credits_transaction" (
  "id",
  "user_id",
  "type",
  "amount",
  "debit_account",
  "credit_account",
  "source_ref"
) VALUES (
  'migration-ci-transaction',
  'migration-ci-user',
  'consumption',
  1,
  'WALLET:migration-ci-user',
  'SYSTEM:migration-ci',
  'migration-ci-transaction-source'
);

INSERT INTO "external_api_key" (
  "id",
  "user_id",
  "name",
  "key_prefix",
  "key_hash",
  "last_four"
) VALUES (
  'migration-ci-api-key',
  'migration-ci-user',
  'Migration CI',
  'g2i_ci',
  'migration-ci-api-key-hash',
  '0000'
);

INSERT INTO "generation" (
  "id",
  "user_id",
  "prompt",
  "model",
  "status",
  "storage_key"
) VALUES (
  'migration-ci-generation',
  'migration-ci-user',
  'migration upgrade fixture',
  'gpt-image-1',
  'completed',
  'migration-ci/generation.png'
);
