-- 当前数据库迁移后的关键结构冒烟断言。
--
-- 使用方：CI 空库全迁移和上一正式 tag 增量升级。任何断言失败均抛异常并让
-- `psql -v ON_ERROR_STOP=1` 非零退出。检查聚焦财务幂等、调度租约、持久队列
-- 和图库索引，防止 journal 已登记但实际对象缺失的假绿。

SELECT set_config(
  'gpt2image.expected_migration_at',
  :'expected_migration_at',
  false
);

DO $$
DECLARE
  latest_journal_at bigint;
  latest_applied_at bigint;
  required_table text;
  required_index text;
BEGIN
  latest_journal_at := current_setting(
    'gpt2image.expected_migration_at'
  )::bigint;

  SELECT max(created_at)
  INTO latest_applied_at
  FROM drizzle.__drizzle_migrations;

  IF latest_applied_at IS DISTINCT FROM latest_journal_at THEN
    RAISE EXCEPTION
      'migration journal mismatch: expected %, applied %',
      latest_journal_at,
      latest_applied_at;
  END IF;

  FOREACH required_table IN ARRAY ARRAY[
    'user',
    'subscription',
    'credits_batch',
    'credits_transaction',
    'generation',
    'internal_job_lease',
    'external_api_key_usage',
    'image_generation_concurrency_slot',
    'external_async_task'
  ] LOOP
    IF to_regclass(format('public.%I', required_table)) IS NULL THEN
      RAISE EXCEPTION 'missing required table: %', required_table;
    END IF;
  END LOOP;

  FOREACH required_index IN ARRAY ARRAY[
    'credits_batch_source_ref_unique',
    'credits_batch_expiration_active_idx',
    'credits_batch_user_expiration_active_idx',
    'credits_transaction_user_type_source_ref_unique',
    'generation_gallery_final_idx',
    'generation_gallery_status_cursor_idx',
    'external_api_key_usage_source_unique',
    'external_async_task_editable_client_unique',
    'external_async_task_generation_client_unique',
    'external_async_task_terminal_retention_idx'
  ] LOOP
    IF to_regclass(format('public.%I', required_index)) IS NULL THEN
      RAISE EXCEPTION 'missing required index: %', required_index;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'internal_job_lease_status_check'
      AND conrelid = 'public.internal_job_lease'::regclass
  ) THEN
    RAISE EXCEPTION 'missing internal job lease status constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_user_id_unique'
      AND conrelid = 'public.subscription'::regclass
  ) THEN
    RAISE EXCEPTION 'missing subscription user unique constraint';
  END IF;

  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'migration CI must run on PostgreSQL 16 or newer';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.migration_ci_marker') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "user" WHERE "id" = 'migration-ci-user'
  ) THEN
    RAISE EXCEPTION 'upgrade fixture user was lost';
  END IF;

  IF to_regclass('public.migration_ci_marker') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "subscription"
    WHERE "id" = 'migration-ci-subscription-newer'
      AND "user_id" = 'migration-ci-user'
      AND "price_id" = 'migration-ci-price-newer'
  ) THEN
    RAISE EXCEPTION 'upgrade fixture subscription winner was not retained';
  END IF;

  IF to_regclass('public.migration_ci_marker') IS NOT NULL AND (
    SELECT count(*) FROM "subscription" WHERE "user_id" = 'migration-ci-user'
  ) <> 1 THEN
    RAISE EXCEPTION 'upgrade fixture subscriptions were not deduplicated';
  END IF;

  IF to_regclass('public.migration_ci_marker') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "credits_balance"
    WHERE "user_id" = 'migration-ci-user'
      AND "balance" = 25
  ) THEN
    RAISE EXCEPTION 'upgrade fixture credits balance changed unexpectedly';
  END IF;
END $$;
