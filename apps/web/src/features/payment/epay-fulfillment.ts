import { db } from "@repo/database";
import { creditsBatch, subscription } from "@repo/database/schema";
import {
  findRuntimePlanByPriceId,
  getSubscriptionMonthlyCredits,
  type PaidPlanId,
} from "@repo/shared/config/payment-runtime";
import {
  getPlanFromPriceId,
  isPlanAtLeast,
  isSubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import {
  CREDIT_CONFIG_DEFAULTS,
  ENTERPRISE_RESOURCE_PACKAGE_ID,
} from "@repo/shared/credits/config";
import {
  grantCredits,
  voidActiveSubscriptionCreditsForUpgrade,
} from "@repo/shared/credits/core";
import {
  getCreditPackagePriceForPlan,
  getRuntimeCreditPackageById,
} from "@repo/shared/credits/packages";
import { logEvent, logger } from "@repo/shared/logger";
import {
  claimEpayOrderForFulfillment,
  decodeEpayMetadata,
  type EpayMetadata,
  type EpayVerifyResult,
  getEpayOrderMetadata,
  moneyToCents,
  updateEpayOrderStatus,
} from "@repo/shared/payment/epay";
import { getUserPlanType } from "@repo/shared/subscription/services/user-plan";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations/referral";
import { and, eq } from "drizzle-orm";

interface FulfillEpayPaymentResult {
  metadata: EpayMetadata;
}

type EpayFulfillmentSource = "epay-webhook" | "epay-return" | "alipay-webhook";
type LocalPaymentProvider = "epay" | "alipay";

// 进程内去重表：仅为单实例下的最佳努力优化，合并同一订单的并发履约，
// 避免重复的订阅写入等副作用。跨实例的正确性不依赖此表，而由
// claimEpayOrderForFulfillment 的原子 UPDATE（pending → success）与
// credits_batch 唯一约束兜底，多实例部署下此表自然失效但不影响幂等。
const inFlightFulfillments = new Map<
  string,
  Promise<FulfillEpayPaymentResult>
>();

async function getCreditPackExpiresAt() {
  const expiryDays = await getRuntimeSettingNumber(
    "CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
    { nonNegative: true }
  );
  return expiryDays > 0
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    : null;
}

// 网关回传金额与期望金额（均换算为分）做反欺诈比对，阻止低价/篡改金额套取
// 高价套餐。允许实付不低于期望，且不超出期望 EPAY_AMOUNT_TOLERANCE_CENTS 分，
// 容忍上游四舍五入/手续费导致的轻微多付；任一侧解析为 NaN 视为不匹配。
// 导出以便 DB-free 单测锁定该金额门闩。
const EPAY_AMOUNT_TOLERANCE_CENTS = 10;

export function isExpectedEpayAmount(
  verifyInfo: EpayVerifyResult,
  expectedAmount: number
) {
  const expectedCents = moneyToCents(expectedAmount);
  const paidCents = moneyToCents(verifyInfo.money);
  if (!Number.isFinite(expectedCents) || !Number.isFinite(paidCents)) {
    return false;
  }

  return (
    paidCents >= expectedCents &&
    paidCents <= expectedCents + EPAY_AMOUNT_TOLERANCE_CENTS
  );
}

function getFulfillmentSourceProvider(
  source: EpayFulfillmentSource
): LocalPaymentProvider {
  return source === "alipay-webhook" ? "alipay" : "epay";
}

export function isMatchingPaymentProvider(params: {
  source: EpayFulfillmentSource;
  metadata: EpayMetadata;
}): boolean {
  const expectedProvider = getFulfillmentSourceProvider(params.source);
  return getPaymentProviderFromMetadata(params.metadata) === expectedProvider;
}

export function resolveExpectedLocalPaymentAmount(params: {
  metadata: EpayMetadata;
  fallbackAmount: number;
}): number {
  return typeof params.metadata.expectedAmount === "number" &&
    Number.isFinite(params.metadata.expectedAmount)
    ? params.metadata.expectedAmount
    : params.fallbackAmount;
}

export async function fulfillSuccessfulEpayPayment(
  verifyInfo: EpayVerifyResult,
  source: EpayFulfillmentSource
): Promise<FulfillEpayPaymentResult> {
  const runningFulfillment = inFlightFulfillments.get(verifyInfo.outTradeNo);
  if (runningFulfillment) {
    return runningFulfillment;
  }

  const fulfillment = fulfillSuccessfulEpayPaymentInner(verifyInfo, source);
  inFlightFulfillments.set(verifyInfo.outTradeNo, fulfillment);

  try {
    return await fulfillment;
  } finally {
    if (inFlightFulfillments.get(verifyInfo.outTradeNo) === fulfillment) {
      inFlightFulfillments.delete(verifyInfo.outTradeNo);
    }
  }
}

async function fulfillSuccessfulEpayPaymentInner(
  verifyInfo: EpayVerifyResult,
  source: EpayFulfillmentSource
): Promise<FulfillEpayPaymentResult> {
  const metadata =
    decodeEpayMetadata(verifyInfo.param) ??
    (await getEpayOrderMetadata(verifyInfo.outTradeNo));
  if (!metadata || metadata.outTradeNo !== verifyInfo.outTradeNo) {
    await updateEpayOrderStatus(verifyInfo.outTradeNo, "failed");
    throw new Error("Invalid or mismatched Epay metadata");
  }
  if (!isMatchingPaymentProvider({ source, metadata })) {
    throw new Error("Payment provider mismatch");
  }

  // 原子领取订单（pending / stale processing → processing）。重复异步通知 /
  // 并发回调将领取失败，在此安全跳过，避免重复履约。领取态不能直接写 success，
  // 否则进程在“领取后、发放前”崩溃会让网关重投被误判为已完成。
  const claimed = await claimEpayOrderForFulfillment(verifyInfo.outTradeNo);
  if (!claimed) {
    logger.info(
      { source, outTradeNo: verifyInfo.outTradeNo },
      "Epay order already fulfilled or currently processing; skipping"
    );
    return { metadata };
  }

  try {
    if (metadata.type === "credit_purchase") {
      await handleCreditPurchase(
        metadata.userId,
        metadata.packageId,
        metadata.quantity ?? 1,
        metadata,
        verifyInfo,
        source
      );
    } else {
      await handleSubscription(
        metadata.userId,
        metadata.priceId,
        metadata,
        verifyInfo,
        source
      );
    }
  } catch (error) {
    // 履约失败：释放领取（processing → pending），以便后续异步通知重试。
    await updateEpayOrderStatus(verifyInfo.outTradeNo, "pending");
    throw error;
  }

  await updateEpayOrderStatus(verifyInfo.outTradeNo, "success");

  return { metadata };
}

async function handleCreditPurchase(
  userId: string,
  packageId: string | undefined,
  quantity: number,
  metadata: EpayMetadata,
  verifyInfo: EpayVerifyResult,
  source: EpayFulfillmentSource
) {
  const provider = getPaymentProviderFromMetadata(metadata);
  if (!packageId) {
    throw new Error("Missing credit package ID");
  }

  const currentPlan = await getUserPlanType(userId);
  const purchasePlan = isSubscriptionPlan(metadata?.creditPlan)
    ? metadata.creditPlan
    : currentPlan;
  const pkg = await getRuntimeCreditPackageById(packageId, {
    includeHidden: true,
    plan: purchasePlan,
  });
  if (!pkg) {
    throw new Error(`Unknown credit package: ${packageId}`);
  }
  const normalizedQuantity =
    Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const isEnterpriseResourcePack = packageId === ENTERPRISE_RESOURCE_PACKAGE_ID;
  if (isEnterpriseResourcePack && !isPlanAtLeast(currentPlan, "enterprise")) {
    throw new Error(
      "Enterprise resource pack purchase requires Enterprise plan"
    );
  }
  if (pkg.requiresPlan && !isPlanAtLeast(currentPlan, pkg.requiresPlan)) {
    throw new Error("Credit package purchase requires a higher plan");
  }
  const creditsAmount = pkg.credits * normalizedQuantity;
  const expectedAmount = resolveExpectedLocalPaymentAmount({
    metadata,
    fallbackAmount:
      getCreditPackagePriceForPlan(pkg, purchasePlan) * normalizedQuantity,
  });

  if (!isExpectedEpayAmount(verifyInfo, expectedAmount)) {
    throw new Error("Epay amount does not match credit package price");
  }

  const sourceRef = `${provider}:${verifyInfo.outTradeNo}`;
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, sourceRef),
        eq(creditsBatch.sourceType, "purchase")
      )
    )
    .limit(1);

  if (existingBatch) {
    await accrueReferralForLocalPayment({
      userId,
      provider,
      orderId: sourceRef,
      orderKind: "credit_purchase",
      orderAmountCents: moneyToCents(verifyInfo.money),
      metadata: {
        outTradeNo: verifyInfo.outTradeNo,
        tradeNo: verifyInfo.tradeNo,
        packageId,
        quantity: normalizedQuantity,
        creditPlan: purchasePlan,
      },
    });
    logger.info({ source, sourceRef }, "Credit purchase already fulfilled");
    return;
  }

  const expiresAt = await getCreditPackExpiresAt();

  const result = await grantCredits({
    userId,
    amount: creditsAmount,
    sourceType: "purchase",
    debitAccount: `PAYMENT:${verifyInfo.outTradeNo}`,
    transactionType: "purchase",
    expiresAt,
    sourceRef,
    description: `${provider} credit pack purchase: ${creditsAmount} credits (${pkg.id})`,
    metadata: {
      provider,
      outTradeNo: verifyInfo.outTradeNo,
      tradeNo: verifyInfo.tradeNo,
      paymentMethod: verifyInfo.type,
      packageId: pkg.id,
      quantity: normalizedQuantity,
      unitCredits: pkg.credits,
      unitPrice: pkg.price,
      paidMoney: verifyInfo.money,
    },
  });

  logEvent("credits.purchased", {
    userId,
    amount: creditsAmount,
    paymentId: verifyInfo.outTradeNo,
    source: provider,
    packageId: pkg.id,
    quantity: normalizedQuantity,
  });
  logger.info(
    { source, batchId: result.batchId, userId },
    "Epay credit purchase fulfilled"
  );
  await accrueReferralForLocalPayment({
    userId,
    provider,
    orderId: sourceRef,
    orderKind: "credit_purchase",
    orderAmountCents: moneyToCents(verifyInfo.money),
    metadata: {
      outTradeNo: verifyInfo.outTradeNo,
      tradeNo: verifyInfo.tradeNo,
      packageId: pkg.id,
      quantity: normalizedQuantity,
      creditPlan: purchasePlan,
      creditsAmount,
    },
  });
}

async function handleSubscription(
  userId: string,
  priceId: string | undefined,
  metadata: EpayMetadata,
  verifyInfo: EpayVerifyResult,
  source: EpayFulfillmentSource
) {
  const provider = getPaymentProviderFromMetadata(metadata);
  if (!priceId) {
    throw new Error("Missing subscription price ID");
  }

  const { plan, price } = await findRuntimePlanByPriceId(priceId);
  const planType = getPlanFromPriceId(priceId);
  if (!plan || !price || !planType || planType === "free") {
    throw new Error(`Unknown subscription price ID: ${priceId}`);
  }

  const expectedAmount = metadata.expectedAmount ?? price.amount;
  if (!isExpectedEpayAmount(verifyInfo, expectedAmount)) {
    throw new Error("Epay amount does not match subscription price");
  }

  const now = new Date();
  const periodEnd = new Date(now);
  const isYearly = price.interval === "yearly";
  if (isYearly) {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const subscriptionId = `${provider}_${verifyInfo.outTradeNo}`;
  const [existingBySubscriptionId] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.subscriptionId, subscriptionId))
    .limit(1);

  if (!existingBySubscriptionId) {
    const [existingByUser] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    const values = {
      subscriptionId,
      priceId,
      status: "canceled",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    };

    if (existingByUser) {
      await db
        .update(subscription)
        .set(values)
        .where(eq(subscription.userId, userId));
    } else {
      await db.insert(subscription).values({
        id: crypto.randomUUID(),
        userId,
        ...values,
      });
    }
  }

  await grantSubscriptionCredits({
    userId,
    subscriptionId,
    priceId,
    planType,
    isYearly,
    periodStart: now,
    periodEnd,
    outTradeNo: verifyInfo.outTradeNo,
    paymentMethod: verifyInfo.type,
    paidMoney: verifyInfo.money,
    checkoutMode: metadata.checkoutMode ?? "new_subscription",
    originalAmount: metadata.originalAmount ?? price.amount,
    prorationCredit: metadata.prorationCredit ?? 0,
    remainingDays: metadata.remainingDays ?? 0,
    periodDays: metadata.periodDays ?? 0,
    upgradeFromPriceId: metadata.upgradeFromPriceId,
    source,
    provider,
  });

  logEvent("payment.checkout.completed", {
    userId,
    provider,
    priceId,
    planId: plan.id,
    subscriptionId,
    checkoutType: "subscription",
    checkoutMode: metadata.checkoutMode ?? "new_subscription",
    paidMoney: verifyInfo.money,
    prorationCredit: metadata.prorationCredit,
  });
}

async function grantSubscriptionCredits(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  planType: PaidPlanId;
  isYearly: boolean;
  periodStart: Date;
  periodEnd: Date;
  outTradeNo: string;
  paymentMethod: string;
  paidMoney: string;
  checkoutMode: "new_subscription" | "upgrade";
  originalAmount: number;
  prorationCredit: number;
  remainingDays: number;
  periodDays: number;
  upgradeFromPriceId?: string;
  source: EpayFulfillmentSource;
  provider: LocalPaymentProvider;
}) {
  const sourceRef = `${params.provider}_subscription:${params.outTradeNo}`;

  const [existingBatch] = await db
    .select({
      id: creditsBatch.id,
      issuedAt: creditsBatch.issuedAt,
    })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, sourceRef),
        eq(creditsBatch.sourceType, "subscription")
      )
    )
    .limit(1);

  if (existingBatch) {
    await accrueReferralForLocalPayment({
      userId: params.userId,
      provider: params.provider,
      orderId: sourceRef,
      orderKind: "subscription",
      orderAmountCents: moneyToCents(params.paidMoney),
      metadata: {
        subscriptionId: params.subscriptionId,
        priceId: params.priceId,
        planType: params.planType,
        outTradeNo: params.outTradeNo,
        checkoutMode: params.checkoutMode,
      },
    });
    if (params.checkoutMode === "upgrade") {
      const voidResult = await voidActiveSubscriptionCreditsForUpgrade({
        userId: params.userId,
        newBatchSourceRef: sourceRef,
        subscriptionId: params.subscriptionId,
        upgradeFromPriceId: params.upgradeFromPriceId,
        upgradeToPriceId: params.priceId,
        issuedBefore: existingBatch.issuedAt,
        description: `${params.planType} ${params.provider} upgrade voided previous subscription credits`,
        metadata: {
          provider: params.provider,
          outTradeNo: params.outTradeNo,
          checkoutMode: params.checkoutMode,
        },
      });
      logger.info(
        {
          source: params.source,
          sourceRef,
          userId: params.userId,
          voidedAmount: voidResult.voidedAmount,
        },
        "Previous subscription credits voided for existing upgrade fulfillment"
      );
    }

    logger.info(
      { source: params.source, sourceRef },
      "Subscription credits already fulfilled"
    );
    return;
  }

  const monthlyCreditsByPlan = await getSubscriptionMonthlyCredits();
  const monthlyCredits = monthlyCreditsByPlan[params.planType];
  const creditsToGrant = params.isYearly ? monthlyCredits * 12 : monthlyCredits;
  const fallbackExpiresAt = await getCreditPackExpiresAt();
  const expiresAt = Number.isNaN(params.periodEnd.getTime())
    ? fallbackExpiresAt
    : params.periodEnd;
  const upgradeCutoff = new Date();

  const result = await grantCredits({
    userId: params.userId,
    amount: creditsToGrant,
    sourceType: "subscription",
    debitAccount: `SUBSCRIPTION:${params.subscriptionId}`,
    transactionType: "monthly_grant",
    expiresAt,
    sourceRef,
    description: params.isYearly
      ? `${params.planType} ${params.provider} yearly subscription credits (${monthlyCredits} x 12)`
      : `${params.planType} ${params.provider} monthly subscription credits`,
    metadata: {
      provider: params.provider,
      subscriptionId: params.subscriptionId,
      priceId: params.priceId,
      planType: params.planType,
      monthlyCredits,
      interval: params.isYearly ? "year" : "month",
      periodStart: params.periodStart.toISOString(),
      periodEnd: params.periodEnd.toISOString(),
      outTradeNo: params.outTradeNo,
      paymentMethod: params.paymentMethod,
      paidMoney: params.paidMoney,
      checkoutMode: params.checkoutMode,
      originalAmount: params.originalAmount,
      prorationCredit: params.prorationCredit,
      remainingDays: params.remainingDays,
      periodDays: params.periodDays,
      ...(params.upgradeFromPriceId && {
        upgradeFromPriceId: params.upgradeFromPriceId,
      }),
    },
  });

  if (params.checkoutMode === "upgrade") {
    const voidResult = await voidActiveSubscriptionCreditsForUpgrade({
      userId: params.userId,
      newBatchSourceRef: sourceRef,
      subscriptionId: params.subscriptionId,
      upgradeFromPriceId: params.upgradeFromPriceId,
      upgradeToPriceId: params.priceId,
      issuedBefore: upgradeCutoff,
      description: `${params.planType} ${params.provider} upgrade voided previous subscription credits`,
      metadata: {
        provider: params.provider,
        outTradeNo: params.outTradeNo,
        checkoutMode: params.checkoutMode,
        newBatchId: result.batchId,
      },
    });

    logger.info(
      {
        source: params.source,
        sourceRef,
        userId: params.userId,
        batchId: result.batchId,
        voidedAmount: voidResult.voidedAmount,
      },
      "Previous subscription credits voided for upgrade"
    );
  }
  await accrueReferralForLocalPayment({
    userId: params.userId,
    provider: params.provider,
    orderId: sourceRef,
    orderKind: "subscription",
    orderAmountCents: moneyToCents(params.paidMoney),
    metadata: {
      subscriptionId: params.subscriptionId,
      priceId: params.priceId,
      planType: params.planType,
      outTradeNo: params.outTradeNo,
      checkoutMode: params.checkoutMode,
      creditsToGrant,
    },
  });
}

async function accrueReferralForLocalPayment(params: {
  userId: string;
  provider: LocalPaymentProvider;
  orderId: string;
  orderKind: "credit_purchase" | "subscription";
  orderAmountCents: number;
  metadata?: Record<string, unknown>;
}) {
  const result = await invokeOperation<{
    applied: boolean;
    commissionId?: string;
    inviterUserId?: string;
    commissionCredits?: number;
  }>(
    "referral.accrueCommissionForOrder",
    {
      inviteeUserId: params.userId,
      provider: params.provider,
      orderId: params.orderId,
      orderKind: params.orderKind,
      orderAmountCents: params.orderAmountCents,
      currency: "CNY",
      metadata: params.metadata,
    },
    { type: "system", reason: "local-payment-referral" }
  );
  if (result.applied) {
    logger.info(
      {
        userId: params.userId,
        orderId: params.orderId,
        provider: params.provider,
        commissionId: result.commissionId,
        inviterUserId: result.inviterUserId,
        commissionCredits: result.commissionCredits,
      },
      "Referral commission accrued for local payment"
    );
  }
}

function getPaymentProviderFromMetadata(metadata: EpayMetadata | null) {
  return metadata?.provider === "alipay" ? "alipay" : "epay";
}
