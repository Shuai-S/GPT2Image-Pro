-- 将尚未转积分的旧邀请返佣账本从 USD 归一口径迁移为人民币口径。
-- WHY: 返佣业务口径调整为“人民币金额 * 返佣比例 = 人民币返利金额”，
-- 且 1 人民币分对应 1 积分。frozen/available 账本尚未发放积分，可安全重算；
-- converted/converting 已经进入积分发放链路，不在迁移中改写，避免账实不一致。

DO $$
DECLARE
  cny_per_usd numeric := 7.2;
  cap_cents integer := 0;
BEGIN
  SELECT
    CASE
      WHEN (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (value #>> '{}')::numeric
      ELSE 7.2
    END
  INTO cny_per_usd
  FROM system_setting
  WHERE key = 'REFERRAL_CNY_PER_USD'
  LIMIT 1;

  cny_per_usd := coalesce(cny_per_usd, 7.2);
  IF cny_per_usd <= 0 THEN
    cny_per_usd := 7.2;
  END IF;

  SELECT
    CASE
      WHEN (value #>> '{}') ~ '^[0-9]+$'
        THEN (value #>> '{}')::integer
      ELSE 0
    END
  INTO cap_cents
  FROM system_setting
  WHERE key = 'REFERRAL_PER_INVITEE_CAP_CENTS'
  LIMIT 1;

  cap_cents := coalesce(cap_cents, 0);

  IF cap_cents = 0 THEN
    WITH normalized AS (
      SELECT
        id,
        CASE
          WHEN upper(metadata ->> 'originalCurrency') = 'CNY'
            THEN floor((metadata ->> 'originalOrderAmountCents')::numeric)::integer
          WHEN upper(metadata ->> 'originalCurrency') = 'USD'
            THEN floor(
              (metadata ->> 'originalOrderAmountCents')::numeric * cny_per_usd
            )::integer
          ELSE NULL
        END AS normalized_order_amount_cents
      FROM referral_commission_ledger
      WHERE currency = 'USD'
        AND status IN ('frozen', 'available')
        AND metadata ->> 'originalOrderAmountCents' ~ '^[0-9]+(\.[0-9]+)?$'
        AND upper(metadata ->> 'originalCurrency') IN ('CNY', 'USD')
    ),
    recalculated AS (
      SELECT
        ledger.id,
        normalized.normalized_order_amount_cents,
        floor(
          normalized.normalized_order_amount_cents
          * ledger.commission_rate_bps
          / 10000
        )::integer AS commission_amount_cents
      FROM normalized
      INNER JOIN referral_commission_ledger AS ledger
        ON ledger.id = normalized.id
      WHERE normalized.normalized_order_amount_cents > 0
    )
    UPDATE referral_commission_ledger AS ledger
    SET
      order_amount_cents = recalculated.normalized_order_amount_cents,
      currency = 'CNY',
      commission_amount_cents = recalculated.commission_amount_cents,
      commission_credits = recalculated.commission_amount_cents::numeric,
      metadata = (
        coalesce(ledger.metadata, '{}'::json)::jsonb
        || jsonb_build_object(
          'referralCnyRebasedAt', now(),
          'previousNormalizedCurrency', ledger.currency,
          'previousNormalizedOrderAmountCents', ledger.order_amount_cents,
          'previousCommissionAmountCents', ledger.commission_amount_cents,
          'previousCommissionCredits', ledger.commission_credits
        )
      )::json,
      updated_at = now()
    FROM recalculated
    WHERE ledger.id = recalculated.id
      AND recalculated.commission_amount_cents > 0;
  END IF;
END $$;
