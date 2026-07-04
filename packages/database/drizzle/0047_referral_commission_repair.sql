-- 兜底修复邀请返佣迁移。
-- 历史部署若误用了根目录 legacy drizzle/，
-- 或手工标记 0046 已执行，可能出现 referral 表缺失的状态。
-- 本迁移全部使用 IF NOT EXISTS。
-- 正常执行过 0046 的数据库不会产生结构变化。
DO $$ BEGIN
  ALTER TYPE "credits_batch_source" ADD VALUE IF NOT EXISTS 'referral';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "credits_transaction_type"
    ADD VALUE IF NOT EXISTS 'referral_bonus';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "referral_commission_status" AS ENUM (
    'frozen',
    'available',
    'converting',
    'converted',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "referral_transfer_status" AS ENUM (
    'pending',
    'completed',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "referral_profile" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "referral_code" text NOT NULL UNIQUE,
  "referral_code_custom" boolean DEFAULT false NOT NULL,
  "commission_rate_bps" integer,
  "invited_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "referral_profile_referral_code_idx"
  ON "referral_profile" ("referral_code");

CREATE TABLE IF NOT EXISTS "referral_binding" (
  "id" text PRIMARY KEY NOT NULL,
  "inviter_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "invitee_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "referral_code" text NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_binding_invitee_unique"
  ON "referral_binding" ("invitee_user_id");

CREATE INDEX IF NOT EXISTS "referral_binding_inviter_created_at_idx"
  ON "referral_binding" ("inviter_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "referral_commission_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "inviter_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "invitee_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "order_id" text NOT NULL,
  "order_kind" text NOT NULL,
  "order_amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "commission_rate_bps" integer NOT NULL,
  "commission_amount_cents" integer NOT NULL,
  "commission_credits" numeric(18,2) NOT NULL,
  "status" "referral_commission_status" NOT NULL,
  "frozen_until" timestamp,
  "converted_at" timestamp,
  "canceled_at" timestamp,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_commission_order_inviter_unique"
  ON "referral_commission_ledger" ("provider", "order_id", "inviter_user_id");

CREATE INDEX IF NOT EXISTS "referral_commission_inviter_status_idx"
  ON "referral_commission_ledger" ("inviter_user_id", "status");

CREATE INDEX IF NOT EXISTS "referral_commission_invitee_idx"
  ON "referral_commission_ledger" ("invitee_user_id");

CREATE TABLE IF NOT EXISTS "referral_transfer" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "status" "referral_transfer_status" DEFAULT 'pending' NOT NULL,
  "amount_cents" integer NOT NULL,
  "credits_amount" numeric(18,2) NOT NULL,
  "commission_ids" json NOT NULL,
  "source_ref" text NOT NULL UNIQUE,
  "credits_batch_id" text,
  "credits_transaction_id" text,
  "failure_reason" text,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "referral_transfer_user_created_at_idx"
  ON "referral_transfer" ("user_id", "created_at");
