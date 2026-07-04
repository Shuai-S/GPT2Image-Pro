import { db } from "@repo/database";
import { creditsBatch, subscription, user } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { paymentConfig } from "@repo/shared/config/payment";
import {
  findRuntimePlanByPriceId,
  getSubscriptionMonthlyCredits,
} from "@repo/shared/config/payment-runtime";
import {
  getPlanFromPriceId,
  isSubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import { grantCredits } from "@repo/shared/credits/core";
import {
  getCreditPackagePriceForPlan,
  getRuntimeCreditPackageById,
} from "@repo/shared/credits/packages";
import { logError, logEvent, logger } from "@repo/shared/logger";
import {
  buildCreemReferralCancellationOrderIds,
  buildReferralSubscriptionOrderId,
  buildSubscriptionPeriodKey,
  type CreemCheckoutCompletedData,
  type CreemDisputeCreatedData,
  type CreemRefundCreatedData,
  type CreemSubscription,
  type CreemWebhookEvent,
  computeSubscriptionCreditsToGrant,
  constructRuntimeCreemEvent,
  getCreemPeriodDays,
  isYearlyCreemPeriod,
} from "@repo/shared/payment/creem";
import {
  evaluateCreemAmountMatch,
  shouldGrantAfterAmountCheck,
} from "@repo/shared/payment/creem-amount";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations/referral";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/** 从 CreemSubscription 中安全提取产品 ID */
function getProductId(sub: CreemSubscription): string {
  return typeof sub.product === "string"
    ? sub.product
    : (sub.product?.id ?? "");
}

// ============================================
// 实付金额/币种反欺诈校验
// 纯逻辑已抽离至 @repo/shared/payment/creem-amount，此处仅保留环境读取与日志适配。
// ============================================

/**
 * 是否对金额/币种不符的支付硬拒（不发放积分）。默认硬拒；只有显式配置
 * CREEM_WEBHOOK_ENFORCE_AMOUNT=0/false/no/off 时才退回临时软门闩。
 *
 * WHY：可比金额/币种不匹配代表用户支付额与服务端应收额已经矛盾，继续发放会
 * 让低价产品或跨币种配置套取高价权益；不可比场景仍由纯函数裁决为放行告警。
 */
function isCreemAmountEnforced(): boolean {
  const raw = process.env.CREEM_WEBHOOK_ENFORCE_AMOUNT?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * 对 Creem 金额校验结果落地处置（带日志）：返回 true=继续发放，false=拒绝发放。
 *
 * 封装 @repo/shared/payment/creem-amount 的纯函数 shouldGrantAfterAmountCheck，
 * 在此处追加 Pino 日志输出（纯函数模块不依赖 logger）。
 */
function shouldGrantWithLogging(
  amountMatch: import("@repo/shared/payment/creem-amount").CreemAmountMatchResult,
  context: Record<string, unknown>
): boolean {
  const decision = shouldGrantAfterAmountCheck(
    amountMatch,
    isCreemAmountEnforced()
  );

  if (
    decision.grant &&
    decision.reason === "not-comparable-grant-with-warning"
  ) {
    logger.warn(
      { ...context, source: "creem-webhook", amountMatch, decision },
      "Creem amount check skipped (not comparable); granting credits"
    );
  } else if (
    decision.grant &&
    decision.reason === "mismatch-soft-gate-grant-with-warning"
  ) {
    logger.warn(
      { ...context, source: "creem-webhook", amountMatch, decision },
      "Creem amount mismatch detected (soft gate, not enforced); granting credits"
    );
  } else if (!decision.grant) {
    logError(new Error("Creem paid amount/currency mismatch"), {
      source: "creem-webhook",
      stage: "amount-check",
      amountMatch,
      decision,
      ...context,
    });
  }

  return decision.grant;
}

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

/**
 * Creem Webhook 处理器
 *
 * 处理来自 Creem 的事件通知
 * 文档: https://docs.creem.io/code/webhooks
 */
export const POST = withApiLogging(async (req: Request) => {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("creem-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing creem-signature header" },
      { status: 400 }
    );
  }

  let event: CreemWebhookEvent;

  try {
    // 验证 Webhook 签名并解析事件
    event = await constructRuntimeCreemEvent(body, signature);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logError(err, { source: "creem-webhook", stage: "signature" });
    return NextResponse.json(
      { error: `Webhook Error: ${errorMessage}` },
      { status: 400 }
    );
  }

  try {
    // 处理不同类型的事件
    switch (event.eventType) {
      // ============================================
      // Checkout 完成事件
      // ============================================
      case "checkout.completed": {
        await handleCheckoutCompleted(
          event.object as CreemCheckoutCompletedData
        );
        break;
      }

      // ============================================
      // 订阅相关事件
      // ============================================
      case "subscription.active": {
        await handleSubscriptionActive(event.object as CreemSubscription);
        break;
      }

      case "subscription.renewed":
      case "subscription.paid": {
        await handleSubscriptionRenewed(event.object as CreemSubscription);
        break;
      }

      case "subscription.canceled": {
        await handleSubscriptionCanceled(event.object as CreemSubscription);
        break;
      }

      case "refund.created": {
        await handleRefundCreated(event.object as CreemRefundCreatedData);
        break;
      }

      case "dispute.created": {
        await handleDisputeCreated(event.object as CreemDisputeCreatedData);
        break;
      }

      case "subscription.past_due": {
        await handleSubscriptionPastDue(event.object as CreemSubscription);
        break;
      }

      case "subscription.paused": {
        await handleSubscriptionPaused(event.object as CreemSubscription);
        break;
      }

      default:
        logger.info({ eventType: event.eventType }, "Unhandled event type");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logError(error, { source: "creem-webhook", stage: "handler" });
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
});

// ============================================
// Checkout 完成处理
// ============================================

/**
 * 处理 Checkout 完成事件
 *
 * 当用户完成支付后：
 * - 如果是订阅支付：创建或更新订阅记录
 * - 如果是积分购买：直接发放积分
 */
async function handleCheckoutCompleted(data: CreemCheckoutCompletedData) {
  const userId = data.metadata?.userId;
  const customerId = data.customer.id;
  const productId = data.product?.id || data.order?.product;
  const checkoutType = data.metadata?.type ?? "subscription";

  if (!userId) {
    logger.error(
      { source: "creem-webhook" },
      "Missing userId in checkout metadata"
    );
    return;
  }

  // 更新用户的 customerId
  await db.update(user).set({ customerId }).where(eq(user.id, userId));

  // 根据 checkout 类型分别处理
  if (checkoutType === "credit_purchase") {
    // 积分包一次性购买
    await handleCreditPurchase(userId, data);
  } else if (data.subscription) {
    // 订阅支付
    await createOrUpdateSubscription(userId, data.subscription);
    // 防止 webhook 乱序:若 subscription.active 先于 checkout.completed 到达,
    // handleSubscriptionActive 因找不到订阅记录而跳过积分发放。
    // 此处也调用 grantSubscriptionCredits 确保至少一条路径成功发放。
    // grantCredits 的 sourceRef 幂等机制防止重复发放。
    await grantSubscriptionCredits(
      userId,
      data.subscription,
      "subscription_create"
    );
  }

  logEvent("payment.checkout.completed", {
    userId,
    customerId,
    productId,
    subscriptionId: data.subscription?.id,
    billingType: data.product?.billing_type,
    checkoutType,
  });
}

/**
 * 处理积分包购买
 *
 * 在一次性支付完成后，根据服务端积分包配置发放积分
 * 安全: 不信任 metadata.credits，从服务端积分包配置查找真实积分数量
 */
async function handleCreditPurchase(
  userId: string,
  data: CreemCheckoutCompletedData
) {
  const packageId = data.metadata?.packageId;
  const orderId = data.order?.id ?? data.id;
  const purchasePlan = isSubscriptionPlan(data.metadata?.planId)
    ? data.metadata.planId
    : isSubscriptionPlan(data.metadata?.creditPlan)
      ? data.metadata.creditPlan
      : "free";

  if (!packageId) {
    logger.error(
      { source: "creem-webhook", userId, orderId },
      "Missing packageId in credit_purchase metadata"
    );
    return;
  }

  // 从服务端配置查找积分数量（不信任客户端 metadata.credits）
  const pkg = await getRuntimeCreditPackageById(packageId, {
    includeHidden: true,
    plan: purchasePlan,
  });
  if (!pkg) {
    logger.error(
      { source: "creem-webhook", packageId, userId },
      "Unknown credit package ID"
    );
    return;
  }

  const quantity = 1;
  const creditsAmount = pkg.credits * quantity;
  const unitPrice = getCreditPackagePriceForPlan(pkg, purchasePlan);
  const expectedAmount = unitPrice * quantity;

  // 幂等性检查：同一订单只发放一次积分
  const sourceRef = `credit_purchase:${orderId}`;
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
    await accrueReferralForCreemPayment({
      userId,
      orderId,
      orderKind: "credit_purchase",
      orderAmountCents: getCreemOrderAmountCents(
        data.order?.amount,
        expectedAmount
      ),
      currency: data.order?.currency ?? paymentConfig.currency,
      metadata: {
        checkoutId: data.id,
        packageId,
        planId: purchasePlan,
      },
    });
    logger.info(
      { sourceRef },
      "Credits already granted for purchase, skipping"
    );
    return;
  }

  // 实付金额/币种校验：用服务端套餐重算期望金额（unitPrice * quantity），
  // 与 Creem 实付额（order.amount，单位分）及 order.currency 比对，阻止 checkout
  // 阶段被篡改的价格/数量套取高价积分包。可比但不匹配默认硬拒；不可比仅告警放行。
  const amountMatch = evaluateCreemAmountMatch(
    {
      amount: expectedAmount,
      currency: paymentConfig.currency,
    },
    {
      amount: data.order?.amount ?? Number.NaN,
      currency: data.order?.currency ?? "",
    }
  );
  if (
    !shouldGrantWithLogging(amountMatch, {
      stage: "credit-purchase",
      userId,
      packageId,
      orderId,
      planId: purchasePlan,
    })
  ) {
    return;
  }

  // 积分包购买的积分按系统配置过期
  const expiresAt = await getCreditPackExpiresAt();

  try {
    const result = await grantCredits({
      userId,
      amount: creditsAmount,
      sourceType: "purchase",
      debitAccount: `PAYMENT:${orderId}`,
      transactionType: "purchase",
      expiresAt,
      sourceRef,
      description: `Credit pack purchase: ${creditsAmount} credits (${packageId})`,
      metadata: {
        orderId,
        packageId,
        checkoutId: data.id,
        paymentType: "one-time",
        quantity,
        unitCredits: pkg.credits,
        unitPrice,
        paidMoney: unitPrice * quantity,
        planId: purchasePlan,
      },
    });

    logger.info(
      { userId, creditsAmount, packageId, quantity, batchId: result.batchId },
      "Credits granted for credit pack purchase"
    );
    await accrueReferralForCreemPayment({
      userId,
      orderId,
      orderKind: "credit_purchase",
      orderAmountCents: getCreemOrderAmountCents(
        data.order?.amount,
        expectedAmount
      ),
      currency: data.order?.currency ?? paymentConfig.currency,
      metadata: {
        checkoutId: data.id,
        packageId,
        planId: purchasePlan,
        creditsAmount,
      },
    });
  } catch (error) {
    logError(error, {
      source: "creem-webhook",
      stage: "grant-credit-purchase",
      userId,
      packageId,
    });
    // S-L2：不再吞异常。grantCredits 对幂等命中（重复 sourceRef）走
    // onConflictDoNothing 并正常返回，不抛错；故能到此 catch 的都是真正的 DB/未知
    // 异常。前置 existingBatch 短路 + credits_batch (source_type, source_ref) 唯一索引
    // 保证 Creem 重投不会双发，因此上抛让外层返回 5xx 触发重投，避免静默漏发积分。
    throw error;
  }
}

// ============================================
// 订阅事件处理
// ============================================

/**
 * 处理订阅激活事件
 *
 * 首次订阅激活时触发，发放积分
 */
async function handleSubscriptionActive(sub: CreemSubscription) {
  const userId = sub.metadata?.userId;

  if (!userId) {
    // 尝试从数据库查找
    const [existingSub] = await db
      .select({ userId: subscription.userId })
      .from(subscription)
      .where(eq(subscription.subscriptionId, sub.id))
      .limit(1);

    if (!existingSub) {
      logger.error(
        { subscriptionId: sub.id },
        "Cannot find userId for subscription"
      );
      return;
    }

    await updateSubscriptionStatus(sub);
    await grantSubscriptionCredits(
      existingSub.userId,
      sub,
      "subscription_create"
    );
    logEvent("payment.subscription.created", {
      userId: existingSub.userId,
      subscriptionId: sub.id,
      priceId: getProductId(sub),
      status: sub.status,
    });
    return;
  }

  await createOrUpdateSubscription(userId, sub);
  await grantSubscriptionCredits(userId, sub, "subscription_create");
  logEvent("payment.subscription.created", {
    userId,
    subscriptionId: sub.id,
    priceId: getProductId(sub),
    status: sub.status,
  });
}

/**
 * 处理订阅续期事件
 *
 * 订阅周期结束续费时触发，发放积分
 */
async function handleSubscriptionRenewed(sub: CreemSubscription) {
  await updateSubscriptionStatus(sub);

  // 从数据库获取 userId
  const [existingSub] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.subscriptionId, sub.id))
    .limit(1);

  if (!existingSub) {
    logger.error(
      { subscriptionId: sub.id },
      "Subscription not found for renewal"
    );
    return;
  }

  await grantSubscriptionCredits(existingSub.userId, sub, "subscription_cycle");
}

/**
 * 处理订阅取消事件
 */
async function handleSubscriptionCanceled(sub: CreemSubscription) {
  // 判断当前周期是否未结束
  const periodEnd = new Date(sub.current_period_end_date);
  const isStillInPeriod = periodEnd > new Date();

  if (isStillInPeriod) {
    // 周期未结束：保持 active，标记 cancelAtPeriodEnd
    // 不管 Creem 传来的 cancel_at_period_end 是什么值
    await db
      .update(subscription)
      .set({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscription.subscriptionId, sub.id));
  } else {
    // 已过期：标记为 canceled
    await db
      .update(subscription)
      .set({
        status: "canceled",
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscription.subscriptionId, sub.id));
  }

  const [existingSub] = await db
    .select({ userId: subscription.userId })
    .from(subscription)
    .where(eq(subscription.subscriptionId, sub.id))
    .limit(1);

  logEvent("payment.subscription.canceled", {
    userId: existingSub?.userId,
    subscriptionId: sub.id,
    cancelAtPeriodEnd: isStillInPeriod,
    periodEnd: sub.current_period_end_date,
  });
}

function buildCreemReferralOrderIds(params: {
  orderId?: string;
  subscription?: CreemSubscription;
  transaction?: { period_start?: number; period_end?: number };
}) {
  return buildCreemReferralCancellationOrderIds({
    orderId: params.orderId,
    subscriptionId: params.subscription?.id,
    periodStartMs: params.transaction?.period_start,
  });
}

async function cancelReferralForCreemOrders(params: {
  orderIds: string[];
  reason: "refund" | "chargeback";
  metadata: Record<string, unknown>;
}) {
  for (const orderId of params.orderIds) {
    const result = await invokeOperation<{
      canceledCount: number;
      reversedCount: number;
      skippedCount: number;
      alreadyCanceledCount: number;
      errors: Array<{ commissionId: string; message: string }>;
    }>(
      "referral.cancelCommissionForOrder",
      {
        provider: "creem",
        orderId,
        reason: params.reason,
        metadata: params.metadata,
      },
      { type: "system", reason: "creem-webhook-referral-cancel" }
    );

    // WHY: 冲正失败（如邀请人余额不足、瞬时 DB 错误）不能静默返回 200，
    // 否则 Creem 不会重投，退款订单的返佣积分永远留在邀请人账上。
    // 取消路径整体幂等（canceled 终态短路、冲正扣费带 sourceRef 幂等键），
    // 上抛让外层返回 5xx 触发重投是安全的。
    if (result.errors.length > 0) {
      throw new Error(
        `Referral commission cancellation failed for Creem order ${orderId}: ${result.errors
          .map((item) => `${item.commissionId}: ${item.message}`)
          .join("; ")}`
      );
    }

    logger.info(
      {
        orderId,
        reason: params.reason,
        ...result,
      },
      "Referral commission canceled for Creem order"
    );
  }
}

async function handleRefundCreated(data: CreemRefundCreatedData) {
  const orderIds = buildCreemReferralOrderIds({
    orderId: data.order?.id ?? data.transaction?.order,
    subscription: data.subscription,
    transaction: data.transaction,
  });

  if (orderIds.length === 0) {
    logger.warn(
      { refundId: data.id },
      "Missing order reference in Creem refund webhook"
    );
    return;
  }

  await cancelReferralForCreemOrders({
    orderIds,
    reason: "refund",
    metadata: {
      refundId: data.id,
      refundStatus: data.status,
      refundAmount: data.refund_amount,
      refundCurrency: data.refund_currency,
      refundReason: data.reason,
      transactionId: data.transaction?.id,
      subscriptionId: data.subscription?.id ?? data.transaction?.subscription,
    },
  });
}

async function handleDisputeCreated(data: CreemDisputeCreatedData) {
  const orderIds = buildCreemReferralOrderIds({
    orderId: data.order?.id ?? data.transaction?.order,
    subscription: data.subscription,
    transaction: data.transaction,
  });

  if (orderIds.length === 0) {
    logger.warn(
      { disputeId: data.id },
      "Missing order reference in Creem dispute webhook"
    );
    return;
  }

  await cancelReferralForCreemOrders({
    orderIds,
    reason: "chargeback",
    metadata: {
      disputeId: data.id,
      disputeAmount: data.amount,
      disputeCurrency: data.currency,
      transactionId: data.transaction?.id,
      transactionStatus: data.transaction?.status,
      subscriptionId: data.subscription?.id ?? data.transaction?.subscription,
    },
  });
}

/**
 * 处理订阅逾期事件
 */
async function handleSubscriptionPastDue(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: "past_due",
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));

  logger.info({ subscriptionId: sub.id }, "Subscription past due");
}

/**
 * 处理订阅暂停事件
 */
async function handleSubscriptionPaused(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: "paused",
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));

  logger.info({ subscriptionId: sub.id }, "Subscription paused");
}

// ============================================
// 辅助函数
// ============================================

/**
 * 创建或更新订阅记录
 */
async function createOrUpdateSubscription(
  userId: string,
  sub: CreemSubscription
) {
  const [existingSub] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  const subscriptionData = {
    subscriptionId: sub.id,
    priceId: getProductId(sub),
    status: sub.status,
    currentPeriodStart: new Date(sub.current_period_start_date),
    currentPeriodEnd: new Date(sub.current_period_end_date),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: new Date(),
  };

  if (existingSub) {
    await db
      .update(subscription)
      .set(subscriptionData)
      .where(eq(subscription.userId, userId));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      userId,
      ...subscriptionData,
    });
  }

  logger.info({ userId }, "Subscription created/updated");
}

/**
 * 更新订阅状态
 */
async function updateSubscriptionStatus(sub: CreemSubscription) {
  await db
    .update(subscription)
    .set({
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start_date),
      currentPeriodEnd: new Date(sub.current_period_end_date),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(subscription.subscriptionId, sub.id));
}

/**
 * 发放订阅积分
 *
 * @param userId - 用户 ID
 * @param sub - 订阅信息
 * @param billingReason - 计费原因 (subscription_create | subscription_cycle)
 */
async function grantSubscriptionCredits(
  userId: string,
  sub: CreemSubscription,
  billingReason: "subscription_create" | "subscription_cycle"
) {
  const priceId = getProductId(sub);
  const planType = getPlanFromPriceId(priceId);

  if (!planType) {
    logger.error({ priceId }, "Unknown priceId");
    return;
  }

  const { price: runtimePrice } = await findRuntimePlanByPriceId(priceId);
  const productPriceMinorUnits =
    typeof sub.product === "object" &&
    typeof sub.product.price === "number" &&
    Number.isFinite(sub.product.price)
      ? sub.product.price
      : undefined;
  const productCurrency =
    typeof sub.product === "object" ? sub.product.currency : undefined;

  // 幂等性检查：同一订阅 + 同一周期只发放一次积分
  const periodKey = buildSubscriptionPeriodKey(
    sub.id,
    sub.current_period_start_date
  );
  // referral 账本的订单键须与退款/拒付侧（periodStartMs → ISO）格式一致，
  // 用归一化构造器而非 credits 的 periodKey；日期非法时跳过返佣但不影响积分。
  const referralOrderId = buildReferralSubscriptionOrderId(
    sub.id,
    sub.current_period_start_date
  );
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, periodKey),
        eq(creditsBatch.sourceType, "subscription")
      )
    )
    .limit(1);

  if (existingBatch) {
    if (referralOrderId) {
      await accrueReferralForCreemPayment({
        userId,
        orderId: referralOrderId,
        orderKind: "subscription",
        orderAmountCents: getCreemOrderAmountCents(
          productPriceMinorUnits,
          runtimePrice?.amount ?? 0
        ),
        currency: productCurrency ?? paymentConfig.currency,
        metadata: {
          subscriptionId: sub.id,
          priceId,
          planType,
          billingReason,
          periodStart: sub.current_period_start_date,
          periodEnd: sub.current_period_end_date,
        },
      });
    } else {
      logger.warn(
        { subscriptionId: sub.id, periodStart: sub.current_period_start_date },
        "Skipping referral accrual: invalid subscription period start"
      );
    }
    logger.info(
      { periodKey },
      "Credits already granted for subscription period, skipping"
    );
    return;
  }

  // 获取该计划的月度积分配额
  const monthlyCreditsByPlan = await getSubscriptionMonthlyCredits();
  const monthlyCredits =
    planType in monthlyCreditsByPlan
      ? monthlyCreditsByPlan[planType as keyof typeof monthlyCreditsByPlan]
      : 0;
  if (!monthlyCredits) {
    logger.error({ planType }, "No monthly credits configured for plan");
    return;
  }

  // 判断是否为年付（通过周期长度判断），并计算应发放积分
  const periodEnd = new Date(sub.current_period_end_date);
  const periodDays = getCreemPeriodDays(
    sub.current_period_start_date,
    sub.current_period_end_date
  );
  const isYearly = isYearlyCreemPeriod(periodDays);
  const creditsToGrant = computeSubscriptionCreditsToGrant(
    monthlyCredits,
    isYearly
  );

  // 实付金额/币种校验：用 priceId 反查服务端期望金额，与订阅 product 上的
  // price/currency 比对，阻止被篡改的订阅价套取高额积分。CreemSubscription 不带 order，
  // 仅当 product 为对象且带 price 时才有可比信息；缺失则裁决为不可比 → 放行 + 告警。
  const subscriptionAmountMatch = evaluateCreemAmountMatch(
    {
      // 年付期望额用 runtimePrice（按 priceId 反查到对应 interval 的金额），
      // 缺失则不可比 → 放行 + 告警。
      amount: runtimePrice?.amount ?? Number.NaN,
      currency: paymentConfig.currency,
    },
    {
      amount: productPriceMinorUnits ?? Number.NaN,
      currency: productCurrency ?? "",
    }
  );
  if (
    !shouldGrantWithLogging(subscriptionAmountMatch, {
      stage: "subscription-credits",
      userId,
      subscriptionId: sub.id,
      priceId,
      planType,
    })
  ) {
    return;
  }

  const fallbackExpiresAt = await getCreditPackExpiresAt();
  const expiresAt = Number.isNaN(periodEnd.getTime())
    ? fallbackExpiresAt
    : periodEnd;

  // 发放积分
  try {
    const result = await grantCredits({
      userId,
      amount: creditsToGrant,
      sourceType: "subscription",
      debitAccount: `SUBSCRIPTION:${sub.id}`,
      transactionType: "monthly_grant",
      expiresAt,
      sourceRef: periodKey,
      description: isYearly
        ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} 年度订阅积分 (${monthlyCredits} × 12)`
        : `${planType.charAt(0).toUpperCase() + planType.slice(1)} 月度订阅积分`,
      metadata: {
        subscriptionId: sub.id,
        priceId,
        planType,
        monthlyCredits,
        billingReason,
        interval: isYearly ? "year" : "month",
        periodStart: sub.current_period_start_date,
        periodEnd: sub.current_period_end_date,
      },
    });

    logger.info(
      {
        userId,
        creditsToGrant,
        planType,
        interval: isYearly ? "yearly" : "monthly",
        batchId: result.batchId,
      },
      "Subscription credits granted"
    );
    if (referralOrderId) {
      await accrueReferralForCreemPayment({
        userId,
        orderId: referralOrderId,
        orderKind: "subscription",
        orderAmountCents: getCreemOrderAmountCents(
          productPriceMinorUnits,
          runtimePrice?.amount ?? 0
        ),
        currency: productCurrency ?? paymentConfig.currency,
        metadata: {
          subscriptionId: sub.id,
          priceId,
          planType,
          billingReason,
          interval: isYearly ? "year" : "month",
          periodStart: sub.current_period_start_date,
          periodEnd: sub.current_period_end_date,
          creditsToGrant,
        },
      });
    } else {
      logger.warn(
        { subscriptionId: sub.id, periodStart: sub.current_period_start_date },
        "Skipping referral accrual: invalid subscription period start"
      );
    }
  } catch (error) {
    logError(error, {
      source: "creem-webhook",
      stage: "grant-subscription-credits",
      userId,
    });
    // S-L2：不再吞异常。grantCredits 对幂等命中走 onConflictDoNothing 正常返回不抛错，
    // 故能到此 catch 的都是真正的 DB/未知异常。前置 existingBatch 短路 +
    // credits_batch (source_type, source_ref) 唯一索引保证 Creem 重投不会双发周期积分，
    // 因此上抛让外层返回 5xx 触发重投，避免静默漏发订阅积分。
    throw error;
  }
}

function getCreemOrderAmountCents(
  actualMinorUnits: number | undefined,
  expectedMajorUnits: number
) {
  if (
    typeof actualMinorUnits === "number" &&
    Number.isFinite(actualMinorUnits) &&
    actualMinorUnits > 0
  ) {
    return Math.trunc(actualMinorUnits);
  }
  return Math.max(0, Math.round(expectedMajorUnits * 100));
}

async function accrueReferralForCreemPayment(params: {
  userId: string;
  orderId: string;
  orderKind: "credit_purchase" | "subscription";
  orderAmountCents: number;
  currency: string;
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
      provider: "creem",
      orderId: params.orderId,
      orderKind: params.orderKind,
      orderAmountCents: params.orderAmountCents,
      currency: params.currency,
      metadata: params.metadata,
    },
    { type: "system", reason: "creem-webhook-referral" }
  );
  if (result.applied) {
    logger.info(
      {
        userId: params.userId,
        orderId: params.orderId,
        commissionId: result.commissionId,
        inviterUserId: result.inviterUserId,
        commissionCredits: result.commissionCredits,
      },
      "Referral commission accrued for Creem payment"
    );
  }
}
