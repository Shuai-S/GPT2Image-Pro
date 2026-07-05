/**
 * Epay client helpers.
 *
 * Compatible with common 易支付 submit.php integrations. The signing rules
 * mirror new-api's go-epay usage: filter empty values plus sign/sign_type,
 * sort keys, join as query string, append merchant key, then MD5.
 */

import crypto from "node:crypto";
import { db } from "@repo/database";
import { epayOrder } from "@repo/database/schema";
import { and, eq, lt, or } from "drizzle-orm";
import { getBaseUrl } from "../config/payment";
import {
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "../system-settings";

export const EPAY_TRADE_SUCCESS = "TRADE_SUCCESS";

export type PaymentProvider = "creem" | "epay" | "alipay";
export type EpayBusinessType = "subscription" | "credit_purchase";

export interface EpayMetadata {
  type: EpayBusinessType;
  userId: string;
  outTradeNo: string;
  provider?: "epay" | "alipay";
  priceId?: string;
  planId?: string;
  packageId?: string;
  quantity?: number;
  creditPlan?: string;
  checkoutMode?: "new_subscription" | "upgrade";
  expectedAmount?: number;
  originalAmount?: number;
  prorationCredit?: number;
  remainingDays?: number;
  periodDays?: number;
  upgradeFromPriceId?: string;
}

export interface EpayPurchaseInput {
  outTradeNo: string;
  name: string;
  money: number | string;
  type?: string;
  notifyUrl?: string;
  returnUrl?: string;
  param?: string;
}

export interface EpayPurchaseResult {
  url: string;
  params?: Record<string, string>;
  method?: "GET" | "POST" | "QR";
  qrCode?: string;
}

export interface EpayVerifyResult {
  verifyStatus: boolean;
  type: string;
  tradeNo: string;
  outTradeNo: string;
  name: string;
  money: string;
  tradeStatus: string;
  param?: string;
  raw: Record<string, string>;
}

export type EpayOrderStatus = "pending" | "processing" | "success" | "failed";

const EPAY_PROCESSING_LOCK_TTL_MS = 5 * 60 * 1000;

export function getPaymentProvider(): PaymentProvider {
  const providerValues = [
    process.env.PAYMENT_PROVIDER,
    process.env.NEXT_PUBLIC_PAYMENT_PROVIDER,
  ];
  const normalizedProvider = providerValues
    .map((provider) => provider?.trim().toLowerCase())
    .find((provider) => provider === "epay" || provider === "alipay");

  return normalizedProvider ?? "creem";
}

export function isEpayPaymentProvider(): boolean {
  return getPaymentProvider() === "epay";
}

export function isLocalPaymentSubscriptionId(subscriptionId: string): boolean {
  return (
    subscriptionId.startsWith("epay_") || subscriptionId.startsWith("alipay_")
  );
}

export async function getRuntimePaymentProvider(): Promise<PaymentProvider> {
  return getRuntimeSettingSelect(
    "PAYMENT_PROVIDER",
    ["creem", "epay", "alipay"] as const,
    getPaymentProvider()
  );
}

export async function isRuntimeEpayPaymentProvider(): Promise<boolean> {
  return (await getRuntimePaymentProvider()) === "epay";
}

export function getEpayDefaultPaymentType(): string {
  return (
    process.env.EPAY_DEFAULT_PAYMENT_TYPE ??
    process.env.NEXT_PUBLIC_EPAY_DEFAULT_PAYMENT_TYPE ??
    "alipay"
  ).trim();
}

function getEpayNotifyUrl(): string | undefined {
  const notifyUrl = process.env.EPAY_NOTIFY_URL?.trim();
  return notifyUrl || undefined;
}

function getEpayReturnUrl(baseUrl: string): string {
  return `${baseUrl}/api/payments/epay/return`;
}

function getEpayConfig() {
  const pid = process.env.EPAY_PID?.trim() ?? "";
  const key = process.env.EPAY_KEY?.trim() ?? "";
  const apiUrl = process.env.EPAY_API_URL?.trim() ?? "";

  if (!pid || !key || !apiUrl) {
    throw new Error("EPAY_PID, EPAY_KEY and EPAY_API_URL must be configured");
  }

  return { pid, key, apiUrl };
}

function getEpaySubmitUrl(apiUrl: string): URL {
  const submitUrl = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  submitUrl.pathname = `${submitUrl.pathname.replace(/\/+$/, "")}/submit.php`;
  return submitUrl;
}

async function getRuntimeEpayConfig() {
  const pid = (await getRuntimeSettingString("EPAY_PID")) ?? "";
  const key = (await getRuntimeSettingString("EPAY_KEY")) ?? "";
  const apiUrl = (await getRuntimeSettingString("EPAY_API_URL")) ?? "";

  if (!pid || !key || !apiUrl) {
    throw new Error("EPAY_PID, EPAY_KEY and EPAY_API_URL must be configured");
  }

  return { pid, key, apiUrl };
}

export function isEpayConfigured(): boolean {
  return Boolean(
    process.env.EPAY_PID?.trim() &&
      process.env.EPAY_KEY?.trim() &&
      process.env.EPAY_API_URL?.trim()
  );
}

export async function isRuntimeEpayConfigured(): Promise<boolean> {
  return Boolean(
    (await getRuntimeSettingString("EPAY_PID")) &&
      (await getRuntimeSettingString("EPAY_KEY")) &&
      (await getRuntimeSettingString("EPAY_API_URL"))
  );
}

export function formatEpayMoney(money: number | string): string {
  if (typeof money === "number") {
    return money.toFixed(2);
  }
  return money;
}

function filterParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => key !== "sign" && key !== "sign_type" && value !== ""
    )
  );
}

function buildSignPayload(params: Record<string, string>): string {
  const filtered = filterParams(params);
  return Object.keys(filtered)
    .sort()
    .map((key) => `${key}=${filtered[key]}`)
    .join("&");
}

export function signEpayParams(
  params: Record<string, string>,
  key?: string
): string {
  const merchantKey = key ?? getEpayConfig().key;
  return crypto
    .createHash("md5")
    .update(buildSignPayload(params) + merchantKey)
    .digest("hex");
}

export async function signRuntimeEpayParams(
  params: Record<string, string>
): Promise<string> {
  const { key } = await getRuntimeEpayConfig();
  return crypto
    .createHash("md5")
    .update(buildSignPayload(params) + key)
    .digest("hex");
}

export function withEpaySignature(
  params: Record<string, string>
): Record<string, string> {
  return {
    ...params,
    sign: signEpayParams(params),
    sign_type: "MD5",
  };
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createEpayPurchase(
  input: EpayPurchaseInput
): EpayPurchaseResult {
  const { pid, apiUrl } = getEpayConfig();
  const baseUrl = getBaseUrl();
  const notifyUrl = input.notifyUrl ?? getEpayNotifyUrl();
  const params: Record<string, string> = {
    pid,
    type: input.type || getEpayDefaultPaymentType(),
    out_trade_no: input.outTradeNo,
    notify_url: notifyUrl ?? `${baseUrl}/api/webhooks/epay`,
    return_url: input.returnUrl ?? getEpayReturnUrl(baseUrl),
    name: input.name,
    money: formatEpayMoney(input.money),
    device: "pc",
    sign_type: "MD5",
  };

  const signedParams = withEpaySignature(params);
  const submitUrl = getEpaySubmitUrl(apiUrl);

  return {
    url: submitUrl.toString(),
    params: signedParams,
  };
}

export async function createRuntimeEpayPurchase(
  input: EpayPurchaseInput
): Promise<EpayPurchaseResult> {
  const { pid, apiUrl } = await getRuntimeEpayConfig();
  const baseUrl = getBaseUrl();
  const notifyUrl =
    input.notifyUrl ??
    (await getRuntimeSettingString("EPAY_NOTIFY_URL")) ??
    `${baseUrl}/api/webhooks/epay`;
  const paymentType =
    input.type ??
    (await getRuntimeSettingString("EPAY_DEFAULT_PAYMENT_TYPE")) ??
    "alipay";
  const params: Record<string, string> = {
    pid,
    type: paymentType,
    out_trade_no: input.outTradeNo,
    notify_url: notifyUrl,
    return_url: input.returnUrl ?? getEpayReturnUrl(baseUrl),
    name: input.name,
    money: formatEpayMoney(input.money),
    device: "pc",
    sign_type: "MD5",
  };

  const signedParams = {
    ...params,
    sign: await signRuntimeEpayParams(params),
    sign_type: "MD5",
  };
  const submitUrl = getEpaySubmitUrl(apiUrl);

  return {
    url: submitUrl.toString(),
    params: signedParams,
  };
}

export async function saveEpayOrder(
  metadata: EpayMetadata,
  amount: number | string
): Promise<void> {
  const inserted = await db
    .insert(epayOrder)
    .values({
      outTradeNo: metadata.outTradeNo,
      userId: metadata.userId,
      businessType: metadata.type,
      amount: Number(formatEpayMoney(amount)),
      status: "pending",
      metadata: metadata as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ outTradeNo: epayOrder.outTradeNo });

  // outTradeNo 理论上由服务端随机生成，不应冲突。若冲突，绝不能覆盖旧订单
  // 或把已完成订单重置为 pending，否则会制造重复履约窗口。
  if (inserted.length === 0) {
    throw new Error("Payment order already exists");
  }
}

export async function getEpayOrderMetadata(
  outTradeNo: string
): Promise<EpayMetadata | null> {
  if (!outTradeNo) return null;

  const [order] = await db
    .select({
      metadata: epayOrder.metadata,
    })
    .from(epayOrder)
    .where(eq(epayOrder.outTradeNo, outTradeNo))
    .limit(1);

  if (!order?.metadata) return null;
  return normalizeEpayMetadata(order.metadata);
}

export async function updateEpayOrderStatus(
  outTradeNo: string,
  status: EpayOrderStatus
): Promise<void> {
  if (!outTradeNo) return;

  await db
    .update(epayOrder)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(epayOrder.outTradeNo, outTradeNo));
}

export async function getEpayOrderStatus(
  outTradeNo: string
): Promise<EpayOrderStatus | null> {
  if (!outTradeNo) return null;

  const [order] = await db
    .select({ status: epayOrder.status })
    .from(epayOrder)
    .where(eq(epayOrder.outTradeNo, outTradeNo))
    .limit(1);

  return (order?.status as EpayOrderStatus | undefined) ?? null;
}

/**
 * 原子领取订单进行发放：pending 或超时 processing 才能置为 processing。
 * 返回 true 表示本次成功领取（可继续发放），false 表示订单不存在、已完成
 * 或仍在其他请求处理中。履约完成后调用方必须再显式置为 success。
 *
 * WHY：不能在领取时直接置 success，否则进程在“置 success 后、发放前”崩溃会让
 * 网关重投被误判为已履约，造成永久漏发。processing + 超时重领能在崩溃后恢复，
 * 而 credits_batch/sourceRef 唯一约束继续兜底重复发放。
 */
export async function claimEpayOrderForFulfillment(
  outTradeNo: string
): Promise<boolean> {
  if (!outTradeNo) return false;

  const staleProcessingBefore = new Date(
    Date.now() - EPAY_PROCESSING_LOCK_TTL_MS
  );
  const claimed = await db
    .update(epayOrder)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(epayOrder.outTradeNo, outTradeNo),
        or(
          eq(epayOrder.status, "pending"),
          and(
            eq(epayOrder.status, "processing"),
            lt(epayOrder.updatedAt, staleProcessingBefore)
          )
        )
      )
    )
    .returning({ outTradeNo: epayOrder.outTradeNo });

  return claimed.length > 0;
}

export function verifyEpayParams(
  params: Record<string, string>
): EpayVerifyResult {
  const receivedSign = params.sign ?? "";
  const expectedSign = signEpayParams(params);
  const verifyStatus = timingSafeEqualString(
    receivedSign.toLowerCase(),
    expectedSign.toLowerCase()
  );

  const result: EpayVerifyResult = {
    verifyStatus,
    type: params.type ?? "",
    tradeNo: params.trade_no ?? "",
    outTradeNo: params.out_trade_no ?? "",
    name: params.name ?? "",
    money: params.money ?? "",
    tradeStatus: params.trade_status ?? "",
    raw: params,
  };

  if (params.param !== undefined) {
    result.param = params.param;
  }

  return result;
}

export async function verifyRuntimeEpayParams(
  params: Record<string, string>
): Promise<EpayVerifyResult> {
  const receivedSign = params.sign ?? "";
  const expectedSign = await signRuntimeEpayParams(params);
  const verifyStatus = timingSafeEqualString(
    receivedSign.toLowerCase(),
    expectedSign.toLowerCase()
  );

  const result: EpayVerifyResult = {
    verifyStatus,
    type: params.type ?? "",
    tradeNo: params.trade_no ?? "",
    outTradeNo: params.out_trade_no ?? "",
    name: params.name ?? "",
    money: params.money ?? "",
    tradeStatus: params.trade_status ?? "",
    raw: params,
  };

  if (params.param !== undefined) {
    result.param = params.param;
  }

  return result;
}

export async function parseEpayRequestParams(
  req: Request
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};

  if (req.method === "GET") {
    const url = new URL(req.url);
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        params[key] = value;
      } else if (value !== null && value !== undefined) {
        params[key] = String(value);
      }
    }
    return params;
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await req.formData();
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        params[key] = value;
      }
    });
    return params;
  }

  const body = await req.text();
  new URLSearchParams(body).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

export function encodeEpayMetadata(metadata: EpayMetadata): string {
  const compact: Record<string, unknown> = {
    t: metadata.type === "subscription" ? "s" : "c",
    u: metadata.userId,
    o: metadata.outTradeNo,
  };

  if (metadata.provider === "alipay") compact.v = "a";
  if (metadata.priceId) compact.p = metadata.priceId;
  if (metadata.planId) compact.l = metadata.planId;
  if (metadata.packageId) compact.g = metadata.packageId;
  if (metadata.quantity && metadata.quantity > 1) compact.q = metadata.quantity;
  if (metadata.creditPlan) compact.x = metadata.creditPlan;
  if (typeof metadata.expectedAmount === "number") {
    compact.e = metadata.expectedAmount;
  }

  if (metadata.checkoutMode === "upgrade") {
    compact.m = "u";
    if (typeof metadata.originalAmount === "number") {
      compact.a = metadata.originalAmount;
    }
    if (metadata.prorationCredit) {
      compact.c = metadata.prorationCredit;
    }
    if (metadata.remainingDays) {
      compact.r = metadata.remainingDays;
    }
    if (metadata.periodDays) {
      compact.d = metadata.periodDays;
    }
    if (metadata.upgradeFromPriceId) {
      compact.f = metadata.upgradeFromPriceId;
    }
  }

  return Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
}

export function decodeEpayMetadata(param?: string): EpayMetadata | null {
  if (!param) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(param, "base64url").toString("utf8")
    ) as Partial<EpayMetadata> & Record<string, unknown>;
    return normalizeEpayMetadata(parsed);
  } catch {
    return null;
  }
}

function normalizeEpayMetadata(
  metadata: Partial<EpayMetadata> & Record<string, unknown>
): EpayMetadata | null {
  const type =
    metadata.type ??
    (metadata.t === "s"
      ? "subscription"
      : metadata.t === "c"
        ? "credit_purchase"
        : undefined);
  const userId = metadata.userId ?? metadata.u;
  const outTradeNo = metadata.outTradeNo ?? metadata.o;
  const provider =
    metadata.provider ??
    (metadata.v === "a" ? "alipay" : metadata.v === "e" ? "epay" : undefined);
  const priceId = metadata.priceId ?? metadata.p;
  const planId = metadata.planId ?? metadata.l;
  const packageId = metadata.packageId ?? metadata.g;
  const creditPlan = metadata.creditPlan ?? metadata.x;
  const numberValue = (value: unknown) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : undefined;
  const quantity = numberValue(metadata.quantity ?? metadata.q);
  const checkoutMode =
    metadata.checkoutMode ??
    (metadata.m === "u"
      ? "upgrade"
      : metadata.m === "n"
        ? "new_subscription"
        : undefined);
  const expectedAmount = numberValue(metadata.expectedAmount ?? metadata.e);
  const originalAmount = numberValue(metadata.originalAmount ?? metadata.a);
  const prorationCredit = numberValue(metadata.prorationCredit ?? metadata.c);
  const remainingDays = numberValue(metadata.remainingDays ?? metadata.r);
  const periodDays = numberValue(metadata.periodDays ?? metadata.d);
  const upgradeFromPriceId = metadata.upgradeFromPriceId ?? metadata.f;

  if (
    (type !== "subscription" && type !== "credit_purchase") ||
    typeof userId !== "string" ||
    typeof outTradeNo !== "string"
  ) {
    return null;
  }

  return {
    type,
    userId,
    outTradeNo,
    ...((provider === "epay" || provider === "alipay") && { provider }),
    ...(typeof priceId === "string" && { priceId }),
    ...(typeof planId === "string" && { planId }),
    ...(typeof packageId === "string" && { packageId }),
    ...(typeof creditPlan === "string" && { creditPlan }),
    ...(typeof quantity === "number" &&
      Number.isFinite(quantity) &&
      quantity > 0 && {
        quantity: Math.floor(quantity),
      }),
    ...((checkoutMode === "new_subscription" || checkoutMode === "upgrade") && {
      checkoutMode,
    }),
    ...(typeof expectedAmount === "number" &&
      Number.isFinite(expectedAmount) && {
        expectedAmount,
      }),
    ...(typeof originalAmount === "number" &&
      Number.isFinite(originalAmount) && {
        originalAmount,
      }),
    ...(typeof prorationCredit === "number" &&
      Number.isFinite(prorationCredit) && {
        prorationCredit,
      }),
    ...(typeof remainingDays === "number" &&
      Number.isFinite(remainingDays) && {
        remainingDays,
      }),
    ...(typeof periodDays === "number" &&
      Number.isFinite(periodDays) && {
        periodDays,
      }),
    ...(typeof upgradeFromPriceId === "string" && {
      upgradeFromPriceId,
    }),
  };
}

export function moneyToCents(value: number | string): number {
  const str = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return Number.NaN;
  }

  const [yuan = "0", cents = ""] = str.split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}
