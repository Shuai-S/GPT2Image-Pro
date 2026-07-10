/**
 * Creem API 客户端
 *
 * 提供与 Creem 支付平台的 API 交互
 * 文档: https://docs.creem.io/api-reference
 */

import crypto from "node:crypto";
import { z } from "zod";
import {
  fetchWithDeadline,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from "../http/fetch";
import { getRuntimeSettingString } from "../system-settings";

async function getRuntimeCreemApiKey() {
  return (await getRuntimeSettingString("CREEM_API_KEY")) ?? "";
}

async function getRuntimeCreemApiBase(): Promise<string> {
  return (await getRuntimeCreemApiKey()).startsWith("creem_test_")
    ? "https://test-api.creem.io/v1"
    : "https://api.creem.io/v1";
}

// ============================================
// 类型定义
// ============================================

export interface CreemCheckoutParams {
  /** Creem 产品 ID */
  product_id: string;
  /** 支付成功后的重定向 URL */
  success_url: string;
  /** 请求 ID（用于幂等性） */
  request_id?: string;
  /** 自定义元数据 */
  metadata?: Record<string, string>;
}

export interface CreemCheckoutResponse {
  /** Checkout ID */
  id: string;
  /** Checkout URL（重定向用户到此 URL 完成支付） */
  checkout_url: string;
  /** 状态 */
  status: string;
}

export interface CreemSubscription {
  /** 订阅 ID */
  id: string;
  /** 订阅状态 */
  status: "active" | "canceled" | "past_due" | "trialing" | "paused";
  /** 产品（可能是 ID 字符串或完整对象） */
  product:
    | string
    | {
        id: string;
        name?: string | undefined;
        price?: number | undefined;
        currency?: string | undefined;
        billing_type?: string | undefined;
        billing_period?: string | undefined;
      };
  /** 客户（可能是 ID 字符串或完整对象） */
  customer:
    | string
    | {
        id: string;
        email?: string | undefined;
        name?: string | undefined;
      };
  /** 当前周期开始时间 (ISO 8601) */
  current_period_start_date: string;
  /** 当前周期结束时间 (ISO 8601) */
  current_period_end_date: string;
  /** 是否在周期结束时取消 */
  cancel_at_period_end: boolean;
  /** 元数据 */
  metadata?: Record<string, string> | undefined;
}

export interface CreemCustomer {
  /** 客户 ID */
  id: string;
  /** 邮箱 */
  email: string;
  /** 名称 */
  name?: string | undefined;
  /** 元数据 */
  metadata?: Record<string, string> | undefined;
}

const creemMetadataSchema = z.record(z.string(), z.string());
const creemCustomerSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().optional(),
  metadata: creemMetadataSchema.optional(),
});
const creemSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "canceled", "past_due", "trialing", "paused"]),
  product: z.union([
    z.string().min(1),
    z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      price: z.number().optional(),
      currency: z.string().optional(),
      billing_type: z.string().optional(),
      billing_period: z.string().optional(),
    }),
  ]),
  customer: z.union([
    z.string().min(1),
    z.object({
      id: z.string().min(1),
      email: z.string().optional(),
      name: z.string().optional(),
    }),
  ]),
  current_period_start_date: z.string().min(1),
  current_period_end_date: z.string().min(1),
  cancel_at_period_end: z.boolean(),
  metadata: creemMetadataSchema.optional(),
});
const creemCheckoutResponseSchema = z.object({
  id: z.string().min(1),
  checkout_url: z.url(),
  status: z.string().min(1),
});

export interface CreemWebhookEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 (Creem 使用 eventType 驼峰命名) */
  eventType:
    | "checkout.completed"
    | "subscription.active"
    | "subscription.canceled"
    | "subscription.scheduled_cancel"
    | "subscription.renewed"
    | "subscription.paused"
    | "subscription.past_due"
    | "subscription.paid"
    | "subscription.expired"
    | "subscription.update"
    | "subscription.trialing"
    | "refund.created"
    | "dispute.created";
  /** 事件数据 (Creem 直接在顶层使用 object，不嵌套在 data 里) */
  object:
    | CreemCheckoutCompletedData
    | CreemSubscription
    | CreemRefundCreatedData
    | CreemDisputeCreatedData;
  /** 创建时间 (Unix 毫秒时间戳) */
  created_at: number;
}

export interface CreemCheckoutCompletedData {
  /** Checkout ID */
  id: string;
  /** Checkout 对象类型 */
  object: "checkout";
  /** 请求 ID（幂等性） */
  request_id?: string;
  /** 订单信息 */
  order?: {
    object: "order";
    id: string;
    customer: string;
    product: string;
    amount: number;
    currency: string;
    status: string;
    type: "onetime" | "subscription";
    transaction?: string;
  };
  /** 产品信息 */
  product?: {
    id: string;
    name: string;
    price: number;
    currency: string;
    billing_type: "onetime" | "recurring";
    billing_period: string;
  };
  /** 订阅信息（如果是订阅支付） */
  subscription?: CreemSubscription;
  /** 客户信息 */
  customer: CreemCustomer;
  /** Checkout 状态 */
  status: string;
  /** 元数据 */
  metadata?: Record<string, string>;
  /** 模式 */
  mode?: "test" | "live";
}

export interface CreemTransactionReference {
  id?: string;
  order?: string;
  subscription?: string;
  period_start?: number;
  period_end?: number;
  status?: string;
}

export interface CreemOrderReference {
  id?: string;
  object?: "order";
  amount?: number;
  currency?: string;
  status?: string;
  type?: "onetime" | "recurring";
  transaction?: string;
}

export interface CreemRefundCreatedData {
  id: string;
  object: "refund";
  status?: string;
  refund_amount?: number;
  refund_currency?: string;
  reason?: string;
  transaction?: CreemTransactionReference;
  subscription?: CreemSubscription;
  checkout?: {
    id?: string;
    object?: "checkout";
    request_id?: string;
    metadata?: Record<string, string>;
  };
  order?: CreemOrderReference;
  customer?: CreemCustomer;
  created_at?: number;
}

export interface CreemDisputeCreatedData {
  id: string;
  object: "dispute";
  amount?: number;
  currency?: string;
  transaction?: CreemTransactionReference;
  subscription?: CreemSubscription;
  checkout?: {
    id?: string;
    object?: "checkout";
    request_id?: string;
    metadata?: Record<string, string>;
  };
  order?: CreemOrderReference;
  customer?: CreemCustomer;
  created_at?: number;
}

/**
 * 从 Creem 退款/拒付事件中推导本系统 referral 账本使用的订单键。
 *
 * @param params - Creem 事件中的订单、订阅与交易周期引用。
 * @returns 去重后的 referral orderId 候选，包含一次性订单 ID 与订阅周期键。
 * @sideEffects 无；纯函数，供 webhook handler 和单测共用。
 */
export function buildCreemReferralCancellationOrderIds(params: {
  orderId?: string;
  subscriptionId?: string;
  periodStartMs?: number;
}) {
  const ids = new Set<string>();
  const orderId = params.orderId?.trim();
  if (orderId) {
    ids.add(orderId);
  }

  if (
    params.subscriptionId &&
    typeof params.periodStartMs === "number" &&
    Number.isFinite(params.periodStartMs)
  ) {
    const subscriptionOrderId = buildReferralSubscriptionOrderId(
      params.subscriptionId,
      params.periodStartMs
    );
    if (subscriptionOrderId) {
      ids.add(subscriptionOrderId);
    }
  }

  return Array.from(ids);
}

// ============================================
// Webhook 事件运行时校验（Zod）
// ============================================

/**
 * Creem 已知的 Webhook 事件类型。
 *
 * 与 CreemWebhookEvent.eventType 保持一致；Creem 新增类型时需同步此处，
 * 未知类型会在 parseCreemWebhookEvent 处被拒绝并记录，避免静默走错分支。
 */
const CREEM_WEBHOOK_EVENT_TYPES = [
  "checkout.completed",
  "subscription.active",
  "subscription.canceled",
  "subscription.scheduled_cancel",
  "subscription.renewed",
  "subscription.paused",
  "subscription.past_due",
  "subscription.paid",
  "subscription.expired",
  "subscription.update",
  "subscription.trialing",
  "refund.created",
  "dispute.created",
] as const;

/**
 * Webhook 事件体的运行时 schema。
 *
 * WHY：Creem 直接在顶层使用 eventType + object，过去仅以 `as CreemWebhookEvent`
 * 盲转，Creem 改字段或发未预期事件时类型系统无保护（运行时 undefined 解引用
 * 或静默走错分支）。此处用 Zod 在验签后做结构校验，违反 CLAUDE.md
 * “校验一切外部输入优先 Zod”。object 用 passthrough 保留未知字段，仅保证它是对象，
 * 具体变体字段由各 handler 自行判空读取，避免对 Creem 字段演进过度脆弱。
 */
const creemWebhookEventSchema = z
  .object({
    id: z.string(),
    eventType: z.enum(CREEM_WEBHOOK_EVENT_TYPES),
    object: z.object({}).passthrough(),
    created_at: z.number(),
  })
  .passthrough();

/**
 * 解析并运行时校验 Webhook 事件体。
 *
 * @param payload - 已验签的原始请求体（JSON 字符串）
 * @returns 结构校验通过的事件对象
 * @throws 当 JSON 非法或结构不符（含未知 eventType）时抛错，由调用方记日志并返回 4xx
 */
export function parseCreemWebhookEvent(payload: string): CreemWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Invalid webhook payload: not valid JSON");
  }

  const result = creemWebhookEventSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid webhook event shape: ${result.error.issues
        .map((issue) => issue.path.join(".") || "<root>")
        .join(", ")}`
    );
  }

  // schema 已校验 eventType/object/created_at 的运行时形状；object 仅保证是对象，
  // 其 CreemSubscription / CreemCheckoutCompletedData 变体字段由各 handler 判空读取，
  // 故经 unknown 收窄回声明类型（运行时已验签 + 结构校验，非裸 as 盲转）。
  return result.data as unknown as CreemWebhookEvent;
}

// ============================================
// Webhook 纯逻辑助手（DB-free，可单测）
// ============================================

/** 一天的毫秒数 */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 订阅周期长度判为年付的阈值（天）。
 *
 * WHY：Creem 不直接给出计费间隔，只能用周期长度推断。月付约 30 天、年付约 365 天，
 * 取 60 天作为分界既能容纳 28/31 天月份，又远低于年付下限，避免边界误判导致少发/多发积分。
 */
export const CREEM_YEARLY_PERIOD_DAY_THRESHOLD = 60;

/**
 * 构造订阅周期幂等键。
 *
 * 同一订阅 + 同一周期开始时间只发放一次积分，作为 credits_batch (source_type, source_ref)
 * 幂等去重的 sourceRef。
 */
export function buildSubscriptionPeriodKey(
  subscriptionId: string,
  periodStartDate: string
): string {
  return `${subscriptionId}:${periodStartDate}`;
}

/**
 * 构造 referral 账本使用的订阅周期订单键。
 *
 * WHY: 入账来自订阅事件（period_start 为日期字符串），退款/拒付来自 refund/
 * dispute 事件（period_start 为毫秒时间戳）。两侧必须先归一为同一 ISO 格式再
 * 拼键，否则字符串格式差异（毫秒位、时区表示）会让退款侧查不到入账账本，
 * 返佣取消静默失败。日期非法时返回 null，由调用方跳过并告警。
 *
 * @param subscriptionId - Creem 订阅 ID。
 * @param periodStart - 周期开始时间，接受日期字符串或毫秒时间戳。
 * @returns 归一化订单键；periodStart 无法解析时返回 null。
 * @sideEffects 无；纯函数，供入账与退款取消两侧共用。
 */
export function buildReferralSubscriptionOrderId(
  subscriptionId: string,
  periodStart: string | number
): string | null {
  const time = new Date(periodStart).getTime();
  if (!subscriptionId || Number.isNaN(time)) {
    return null;
  }
  return `${subscriptionId}:${new Date(time).toISOString()}`;
}

/**
 * 计算订阅周期天数。
 *
 * @returns 周期天数（四舍五入）；当日期非法时返回 NaN，交由调用方决定回退。
 */
export function getCreemPeriodDays(
  periodStartDate: string,
  periodEndDate: string
): number {
  const start = new Date(periodStartDate).getTime();
  const end = new Date(periodEndDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return Number.NaN;
  }
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * 依据周期天数判断是否为年付订阅。
 *
 * 周期天数非法（NaN）时按月付处理，避免误发 12 倍积分。
 */
export function isYearlyCreemPeriod(periodDays: number): boolean {
  return (
    Number.isFinite(periodDays) &&
    periodDays > CREEM_YEARLY_PERIOD_DAY_THRESHOLD
  );
}

/**
 * 计算订阅周期应发放的积分。
 *
 * 月付发放月度积分，年付发放 12 个月积分。monthlyCredits 由服务端套餐配置提供，
 * 此处仅做纯算术，便于 DB-free 单测覆盖年付/月付与边界判定。
 */
export function computeSubscriptionCreditsToGrant(
  monthlyCredits: number,
  isYearly: boolean
): number {
  return isYearly ? monthlyCredits * 12 : monthlyCredits;
}

// ============================================
// API 客户端
// ============================================

/**
 * 请求 Creem 并有界读取未信任的 JSON 响应。
 *
 * @param path - Creem v1 API 相对路径。
 * @param init - HTTP 方法、请求头和请求体。
 * @returns 未信任 JSON，由各公开方法用对应 Zod schema 校验。
 * @throws 网络、截止时间、正文超限、非 2xx 或非法 JSON 时抛错；支付路径 fail-closed。
 * @sideEffects 发起带 Creem 服务端 API key 的第三方请求。
 */
async function requestCreemJson(
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", await getRuntimeCreemApiKey());
  const response = await fetchWithDeadline(
    `${await getRuntimeCreemApiBase()}${path}`,
    { ...init, headers }
  );

  if (!response.ok) {
    const error = await readResponseTextWithLimit(response);
    throw new Error(`Creem API error: ${response.status} - ${error}`);
  }

  return readResponseJsonWithLimit(response);
}

/**
 * Creem API 客户端
 */
export const creem = {
  /**
   * 创建 Checkout Session
   *
   * @param params - Checkout 参数
   * @returns Checkout 响应（包含重定向 URL）
   */
  async createCheckout(
    params: CreemCheckoutParams
  ): Promise<CreemCheckoutResponse> {
    const payload = await requestCreemJson("/checkouts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    return creemCheckoutResponseSchema.parse(payload);
  },

  /**
   * 获取订阅详情
   *
   * @param subscriptionId - 订阅 ID
   * @returns 订阅信息
   */
  async getSubscription(subscriptionId: string): Promise<CreemSubscription> {
    const payload = await requestCreemJson(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`
    );
    return creemSubscriptionSchema.parse(payload);
  },

  /**
   * 取消订阅
   *
   * @param subscriptionId - 订阅 ID
   * @returns 更新后的订阅信息
   */
  async cancelSubscription(subscriptionId: string): Promise<CreemSubscription> {
    const payload = await requestCreemJson(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
      }
    );
    return creemSubscriptionSchema.parse(payload);
  },

  /**
   * 获取客户信息
   *
   * @param customerId - 客户 ID
   * @returns 客户信息
   */
  async getCustomer(customerId: string): Promise<CreemCustomer> {
    const payload = await requestCreemJson(
      `/customers/${encodeURIComponent(customerId)}`
    );
    return creemCustomerSchema.parse(payload);
  },
};

// ============================================
// Webhook 签名验证
// ============================================

/**
 * 验证 Creem Webhook 签名
 *
 * @param payload - 原始请求体
 * @param signature - creem-signature 头
 * @param secret - Webhook 密钥
 * @returns 是否验证通过
 */
export function verifyCreemWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const computedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(signature);
  if (computedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(computedBuf, receivedBuf);
}

/**
 * 解析并验证 Creem Webhook 事件
 *
 * @param payload - 原始请求体
 * @param signature - creem-signature 头
 * @returns 解析后的事件对象
 * @throws 如果签名验证失败
 */
export function constructCreemEvent(
  payload: string,
  signature: string
): CreemWebhookEvent {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) throw new Error("CREEM_WEBHOOK_SECRET is not configured");

  if (!verifyCreemWebhookSignature(payload, signature, secret)) {
    throw new Error("Invalid webhook signature");
  }

  return parseCreemWebhookEvent(payload);
}

export async function constructRuntimeCreemEvent(
  payload: string,
  signature: string
): Promise<CreemWebhookEvent> {
  const secret = await getRuntimeSettingString("CREEM_WEBHOOK_SECRET");
  if (!secret) throw new Error("CREEM_WEBHOOK_SECRET is not configured");

  if (!verifyCreemWebhookSignature(payload, signature, secret)) {
    throw new Error("Invalid webhook signature");
  }

  return parseCreemWebhookEvent(payload);
}
