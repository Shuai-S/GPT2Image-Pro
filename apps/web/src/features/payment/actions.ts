"use server";

import { db } from "@repo/database";
import { subscription } from "@repo/database/schema";

import { getBaseUrl, paymentConfig } from "@repo/shared/config/payment";
import { findRuntimePlanByPriceId } from "@repo/shared/config/payment-runtime";
import { logEvent } from "@repo/shared/logger";
import {
  createRuntimeAlipayPurchase,
  queryRuntimeAlipayTrade,
} from "@repo/shared/payment/alipay";
import { creem } from "@repo/shared/payment/creem";
import {
  createRuntimeEpayPurchase,
  type EpayVerifyResult,
  getEpayOrderMetadata,
  getEpayOrderStatus,
  getRuntimePaymentProvider,
  isLocalPaymentSubscriptionId,
  saveEpayOrder,
} from "@repo/shared/payment/epay";
import { protectedAction } from "@repo/shared/safe-action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PaymentType } from "@/features/payment/types";

import { fulfillSuccessfulEpayPayment } from "./epay-fulfillment";
import { createSubscriptionCheckoutQuote } from "./subscription-upgrade";

function createPaymentOrderNo(prefix: "SUB" | "CR"): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * 创建 Creem Checkout Session
 *
 * 支持订阅支付和一次性支付两种模式
 */
export const createCheckoutSession = protectedAction
  .metadata({ action: "payment.createCheckoutSession" })
  .schema(
    z.object({
      priceId: z.string().min(1, "价格 ID 不能为空"),
      type: z.nativeEnum(PaymentType).optional(),
      successUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { priceId, successUrl } = parsedInput;
    const { userId } = ctx;

    // 检查是否已有活跃订阅
    const [existingSub] = await db
      .select({
        userId: subscription.userId,
        priceId: subscription.priceId,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
      })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    // 查找计划和价格信息
    const { plan, price } = await findRuntimePlanByPriceId(priceId);
    if (!plan || !price) {
      throw new Error("无效的价格 ID");
    }

    const baseUrl = getBaseUrl();
    const hasActiveSub =
      existingSub && isSubscriptionCurrentlyActive(existingSub);
    const upgradeQuote = hasActiveSub
      ? await createSubscriptionCheckoutQuote(existingSub, priceId)
      : null;
    const paymentProvider = await getRuntimePaymentProvider();
    const useLocalOrderProvider =
      paymentProvider === "epay" || paymentProvider === "alipay";

    logEvent("payment.checkout.started", {
      userId,
      priceId,
      planId: plan.id,
      provider: paymentProvider,
      checkoutMode: upgradeQuote ? "upgrade" : "new_subscription",
      amountDue: upgradeQuote?.amountDue ?? price.amount,
      prorationCredit: upgradeQuote?.prorationCredit,
    });

    if (useLocalOrderProvider) {
      const outTradeNo = createPaymentOrderNo("SUB");
      const amountDue = upgradeQuote?.amountDue ?? price.amount;
      const metadata = {
        type: "subscription" as const,
        userId,
        outTradeNo,
        provider: paymentProvider,
        priceId,
        planId: plan.id,
        checkoutMode: upgradeQuote
          ? ("upgrade" as const)
          : ("new_subscription" as const),
        expectedAmount: amountDue,
        originalAmount: upgradeQuote?.originalAmount ?? price.amount,
        prorationCredit: upgradeQuote?.prorationCredit ?? 0,
        remainingDays: upgradeQuote?.remainingDays ?? 0,
        periodDays: upgradeQuote?.periodDays ?? 0,
        upgradeFromPriceId: upgradeQuote?.upgradeFromPriceId,
      };
      await saveEpayOrder(metadata, amountDue);
      const purchaseInput = {
        outTradeNo,
        name: upgradeQuote
          ? `GPT2IMAGE upgrade to ${plan.name} ${price.interval ?? "subscription"}`
          : `GPT2IMAGE ${plan.name} ${price.interval ?? "subscription"}`,
        money: amountDue,
      };
      const checkout =
        paymentProvider === "alipay"
          ? await createRuntimeAlipayPurchase(purchaseInput)
          : await createRuntimeEpayPurchase(purchaseInput);
      if (checkout.method === "QR" && checkout.qrCode) {
        return {
          url: checkout.url,
          qrCode: checkout.qrCode,
          outTradeNo: checkout.outTradeNo ?? outTradeNo,
          method: "QR" as const,
        };
      }

      return {
        url: checkout.url,
        params: checkout.params ?? {},
        outTradeNo: checkout.outTradeNo ?? outTradeNo,
        method: "POST" as const,
      };
    }

    if (hasActiveSub) {
      throw new Error("当前支付通道暂不支持自动补差升级，请联系管理员处理");
    }

    // 创建 Creem Checkout
    const checkout = await creem.createCheckout({
      product_id: priceId,
      success_url:
        successUrl ??
        `${baseUrl}${paymentConfig.redirectAfterCheckout}?success=true`,
      request_id: `subscription_${userId}_${crypto.randomUUID()}`,
      metadata: {
        userId,
        planId: plan?.id ?? "unknown",
      },
    });

    return { url: checkout.checkout_url };
  });

/**
 * 同步支付宝本地订单状态。
 *
 * @param parsedInput.outTradeNo 商户订单号，只允许当前登录用户自己的订单。
 * @returns 本地订单状态；支付宝已支付但异步通知未到时会主动触发履约。
 * @sideEffects 可能调用支付宝查单、发放积分或订阅权益，并更新本地订单状态。
 */
export const syncAlipayOrderStatus = protectedAction
  .metadata({ action: "payment.syncAlipayOrderStatus" })
  .schema(
    z.object({
      outTradeNo: z
        .string()
        .min(8, "订单号不能为空")
        .max(80, "订单号过长")
        .regex(/^[A-Za-z0-9_-]+$/, "订单号格式不正确"),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { outTradeNo } = parsedInput;
    const metadata = await getEpayOrderMetadata(outTradeNo);
    if (
      !metadata ||
      metadata.userId !== ctx.userId ||
      metadata.provider !== "alipay"
    ) {
      return { status: "not_found" as const };
    }

    const currentStatus = await getEpayOrderStatus(outTradeNo);
    if (currentStatus === "success") {
      return {
        status: "success" as const,
        businessType: metadata.type,
      };
    }
    if (currentStatus === "failed") {
      return {
        status: "failed" as const,
        businessType: metadata.type,
      };
    }

    const queryResult = await queryRuntimeAlipayTrade(outTradeNo);
    if (!queryResult.paid) {
      return {
        status:
          currentStatus === "processing"
            ? ("processing" as const)
            : ("pending" as const),
        businessType: metadata.type,
        tradeStatus: queryResult.tradeStatus,
      };
    }

    const verifyInfo: EpayVerifyResult = {
      verifyStatus: true,
      type: "alipay",
      tradeNo: queryResult.tradeNo,
      outTradeNo: queryResult.outTradeNo,
      name: "",
      money: queryResult.totalAmount,
      tradeStatus: queryResult.tradeStatus,
      raw: queryResult.raw,
    };

    await fulfillSuccessfulEpayPayment(verifyInfo, "alipay-query");
    const syncedStatus = await getEpayOrderStatus(outTradeNo);

    return {
      status: syncedStatus === "success" ? ("success" as const) : "processing",
      businessType: metadata.type,
      tradeStatus: queryResult.tradeStatus,
    };
  });

/**
 * 创建订阅管理链接
 *
 * Creem 不提供类似 Stripe Customer Portal 的功能
 * 用户需要通过 Creem 的订阅管理页面或联系支持来管理订阅
 * 这里返回 null，前端可以显示取消订阅按钮或联系支持链接
 */
export const createCustomerPortal = protectedAction
  .metadata({ action: "payment.createCustomerPortal" })
  .schema(
    z
      .object({
        returnUrl: z.string().optional(),
      })
      .optional()
  )
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅
    const [userSubscription] = await db
      .select({ subscriptionId: subscription.subscriptionId })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription?.subscriptionId) {
      throw new Error("您还没有订阅任何计划");
    }

    // Creem 没有 Customer Portal，返回 null
    // 前端可以显示取消订阅按钮或联系支持链接
    return { url: null, subscriptionId: userSubscription.subscriptionId };
  });

/**
 * 取消订阅
 *
 * 调用 Creem API 取消用户的订阅
 */
export const cancelSubscription = protectedAction
  .metadata({ action: "payment.cancelSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅
    const [userSubscription] = await db
      .select({ subscriptionId: subscription.subscriptionId })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription?.subscriptionId) {
      throw new Error("您还没有订阅任何计划");
    }

    if (isLocalPaymentSubscriptionId(userSubscription.subscriptionId)) {
      throw new Error("本地支付订阅不支持自动取消，请等待当前周期结束");
    }

    // 调用 Creem API 取消订阅
    await creem.cancelSubscription(userSubscription.subscriptionId);

    // 更新数据库状态
    await db
      .update(subscription)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(subscription.userId, userId));

    logEvent("payment.subscription.canceled", {
      userId,
      subscriptionId: userSubscription.subscriptionId,
    });

    return { success: true };
  });

/**
 * 获取用户当前订阅状态
 *
 * 用于在前端显示用户的订阅信息
 */
export const getUserSubscription = protectedAction
  .metadata({ action: "payment.getUserSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅信息
    const [userSubscription] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription) {
      return { subscription: null };
    }

    // 检查订阅是否有效
    const isActive = isSubscriptionCurrentlyActive(userSubscription);
    const isTrialing = userSubscription.status === "trialing";

    return {
      subscription: {
        id: userSubscription.id,
        status: userSubscription.status,
        priceId: userSubscription.priceId,
        currentPeriodStart: userSubscription.currentPeriodStart,
        currentPeriodEnd: userSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: userSubscription.cancelAtPeriodEnd,
        isActive,
        isTrialing,
      },
    };
  });

/**
 * 检查用户是否有有效订阅
 */
export const hasActiveSubscription = protectedAction
  .metadata({ action: "payment.hasActiveSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    const [userSubscription] = await db
      .select({
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
      })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription) {
      return { hasSubscription: false, status: null };
    }

    const isActive = isSubscriptionCurrentlyActive(userSubscription);

    return {
      hasSubscription: isActive,
      status: userSubscription.status,
    };
  });

function isSubscriptionCurrentlyActive(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  if (sub.status === "lifetime") {
    return true;
  }

  return (
    (["active", "trialing"].includes(sub.status) &&
      isSubscriptionWithinPeriod(sub)) ||
    isCanceledSubscriptionWithinPeriod(sub)
  );
}

function isSubscriptionWithinPeriod(sub: { currentPeriodEnd: Date | null }) {
  return !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date();
}

function isCanceledSubscriptionWithinPeriod(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  return (
    sub.status === "canceled" &&
    Boolean(sub.currentPeriodEnd) &&
    isSubscriptionWithinPeriod(sub)
  );
}
