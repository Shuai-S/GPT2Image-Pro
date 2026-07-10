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

-- 0059 必须从重复历史行中保留最近完整事实，并写审计后建立 user_id 唯一约束。
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
