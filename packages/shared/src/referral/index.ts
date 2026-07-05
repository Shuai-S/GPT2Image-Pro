/**
 * 邀请返佣核心服务
 *
 * 使用方：注册归因、支付 webhook、UOL operation、后续用户/管理端页面。
 * 关键依赖：@repo/database referral 表、system-settings、credits/core。
 *
 * 该模块只实现一级邀请返佣，MVP 返佣奖励只能手动转为站内积分；不处理现金提现。
 */

import { randomInt } from "node:crypto";
import { db } from "@repo/database";
import {
  adminAuditLog,
  type ReferralCommissionStatus,
  type ReferralTransfer,
  referralBinding,
  referralCommissionLedger,
  referralProfile,
  referralTransfer,
  user,
} from "@repo/database/schema";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { consumeCredits, grantCredits } from "../credits/core";
import { logEvent, logger } from "../logger";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
} from "../system-settings";
import {
  calculateReferralCommissionCents,
  centsToCredits,
  isValidReferralCode,
  normalizeOrderAmountToCnyCents,
  normalizeReferralCode,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from "./rules";

/**
 * 构造 PostgreSQL enum 状态字面量。
 *
 * @param status - 内部受控的返佣账本状态。
 * @returns 可安全拼入 SQL 的 enum 字面量片段。
 * @sideEffects 无。
 */
function referralCommissionStatusLiteral(status: ReferralCommissionStatus) {
  switch (status) {
    case "available":
      return sql`'available'::referral_commission_status`;
    case "canceled":
      return sql`'canceled'::referral_commission_status`;
    case "converted":
      return sql`'converted'::referral_commission_status`;
    case "converting":
      return sql`'converting'::referral_commission_status`;
    case "frozen":
      return sql`'frozen'::referral_commission_status`;
  }
}

/**
 * 按返佣状态聚合积分数量。
 *
 * @param status - 要聚合的返佣账本状态。
 * @returns Drizzle SQL 片段，结果映射为 number。
 * @sideEffects 无；WHY: 明确 cast enum 字面量，避免 pg 参数化后按 text 比较。
 */
function sumCommissionCreditsByStatus(status: ReferralCommissionStatus) {
  const statusLiteral = referralCommissionStatusLiteral(status);

  return sql<number>`
    coalesce(
      sum(
        case
          when ${referralCommissionLedger.status} = ${statusLiteral}
          then ${referralCommissionLedger.commissionCredits}
          else 0
        end
      ),
      0
    )
  `.mapWith(Number);
}

export interface ReferralPaymentInput {
  inviteeUserId: string;
  provider: "creem" | "epay" | "alipay";
  orderId: string;
  orderKind: "credit_purchase" | "subscription";
  orderAmountCents: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface ReferralCommissionResult {
  applied: boolean;
  reason?:
    | "disabled"
    | "invalid_order"
    | "unsupported_currency"
    | "no_binding"
    | "expired"
    | "cap_reached"
    | "zero_commission"
    | "already_accrued";
  commissionId?: string;
  inviterUserId?: string;
  commissionAmountCents?: number;
  commissionCredits?: number;
  status?: ReferralCommissionStatus;
}

export interface ReferralCommissionCancelResult {
  canceledCount: number;
  reversedCount: number;
  skippedCount: number;
  alreadyCanceledCount: number;
  errors: Array<{
    commissionId: string;
    message: string;
  }>;
}

export interface ReferralOverview {
  userId: string;
  referralCode: string;
  invitedCount: number;
  effectiveCommissionRateBps: number;
  availableCredits: number;
  frozenCredits: number;
  convertedCredits: number;
  invitees: Array<{
    userId: string;
    email: string;
    name: string;
    joinedAt: Date;
    totalOrderAmountCents: number;
    totalCommissionCredits: number;
  }>;
}

export async function isReferralEnabled() {
  return getRuntimeSettingBoolean("REFERRAL_ENABLED", false);
}

async function getReferralRewardMode() {
  return getRuntimeSettingSelect(
    "REFERRAL_REWARD_MODE",
    ["credits"],
    "credits"
  );
}

async function getGlobalCommissionRateBps() {
  return Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_COMMISSION_RATE_BPS", 1000, {
      nonNegative: true,
    })
  );
}

async function getReferralFreezeHours() {
  return Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_FREEZE_HOURS", 168, {
      nonNegative: true,
    })
  );
}

async function getReferralBindingWindowHours() {
  return Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_BINDING_WINDOW_HOURS", 72, {
      nonNegative: true,
    })
  );
}

async function getReferralDurationDays() {
  return Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_DURATION_DAYS", 0, {
      nonNegative: true,
    })
  );
}

async function getPerInviteeCapCents() {
  return Math.trunc(
    await getRuntimeSettingNumber("REFERRAL_PER_INVITEE_CAP_CENTS", 0, {
      nonNegative: true,
    })
  );
}

async function getReferralCnyPerUsd() {
  return getRuntimeSettingNumber("REFERRAL_CNY_PER_USD", 7.2, {
    positive: true,
  });
}

function generateReferralCode() {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "***";
  const visibleLocal =
    local.length <= 2 ? `${local[0] ?? ""}***` : `${local.slice(0, 2)}***`;
  const domainParts = domain.split(".");
  const domainName = domainParts[0] ?? "";
  const suffix = domainParts.slice(1).join(".");
  const visibleDomain =
    domainName.length <= 1
      ? `${domainName}***`
      : `${domainName.slice(0, 1)}***`;
  return suffix
    ? `${visibleLocal}@${visibleDomain}.${suffix}`
    : `${visibleLocal}@***`;
}

async function createUniqueReferralCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateReferralCode();
    const [existing] = await db
      .select({ userId: referralProfile.userId })
      .from(referralProfile)
      .where(eq(referralProfile.referralCode, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new Error("生成邀请码失败");
}

function normalizeAdminPage(input?: ReferralAdminPaginationInput) {
  const requestedPage = input?.page;
  const requestedPageSize = input?.pageSize;
  const page =
    Number.isInteger(requestedPage) && requestedPage && requestedPage > 0
      ? requestedPage
      : 1;
  const pageSize =
    Number.isInteger(requestedPageSize) &&
    requestedPageSize &&
    requestedPageSize > 0
      ? Math.min(requestedPageSize, MAX_ADMIN_PAGE_SIZE)
      : 20;
  const query = input?.query?.trim() ?? "";

  return { page, pageSize, query, offset: (page - 1) * pageSize };
}

async function writeReferralAdminAuditLog(params: {
  adminUserId: string;
  targetUserId: string;
  action: string;
  reason?: string | null | undefined;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminUserId: params.adminUserId,
    targetUserId: params.targetUserId,
    action: params.action,
    reason: params.reason?.trim() || null,
    before: sanitizeReferralAdminSnapshot(params.before),
    after: sanitizeReferralAdminSnapshot(params.after),
  });
}

function sanitizeReferralAdminSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export async function ensureReferralProfile(userId: string) {
  const [existing] = await db
    .select()
    .from(referralProfile)
    .where(eq(referralProfile.userId, userId))
    .limit(1);
  if (existing) return existing;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = await createUniqueReferralCode();
    const inserted = await db
      .insert(referralProfile)
      .values({
        userId,
        referralCode: code,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];

    const [raced] = await db
      .select()
      .from(referralProfile)
      .where(eq(referralProfile.userId, userId))
      .limit(1);
    if (raced) return raced;
  }

  throw new Error("创建邀请档案失败");
}

/**
 * 按邀请码查找邀请档案。
 *
 * @param rawCode - URL、Cookie 或用户输入中的邀请码。
 * @returns 存在且格式合法时返回邀请档案概要，否则返回 null。
 * @sideEffects 无写入；用于邀请链接落地页在写 Cookie 前确认邀请码真实存在。
 */
export async function getReferralProfileByCode(rawCode: string) {
  const code = normalizeReferralCode(rawCode);
  if (!isValidReferralCode(code)) return null;

  const [profile] = await db
    .select({
      userId: referralProfile.userId,
      referralCode: referralProfile.referralCode,
    })
    .from(referralProfile)
    .where(eq(referralProfile.referralCode, code))
    .limit(1);

  return profile ?? null;
}

export async function bindInviterByCode(params: {
  inviteeUserId: string;
  code: string;
  metadata?: Record<string, unknown>;
}) {
  const code = normalizeReferralCode(params.code);
  if (!code) return { bound: false, reason: "empty_code" as const };
  if (!(await isReferralEnabled())) {
    return { bound: false, reason: "disabled" as const };
  }
  if (!isValidReferralCode(code)) {
    return { bound: false, reason: "invalid_code" as const };
  }

  // WHY: 绑定一旦建立不可解除，且被邀请人后续所有订单都会持续产生返佣。
  // 若不限制绑定时机，存量付费老用户可被事后拉去绑码套取续费返佣，
  // 或被恶意链接非自愿绑定。默认只允许注册后短窗口内绑定，0 表示不限制。
  const bindingWindowHours = await getReferralBindingWindowHours();
  if (bindingWindowHours > 0) {
    const [invitee] = await db
      .select({ createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, params.inviteeUserId))
      .limit(1);
    if (!invitee) {
      return { bound: false, reason: "invalid_invitee" as const };
    }
    const windowEndsAt =
      invitee.createdAt.getTime() + bindingWindowHours * 60 * 60 * 1000;
    if (Date.now() > windowEndsAt) {
      return { bound: false, reason: "binding_window_expired" as const };
    }
  }

  await ensureReferralProfile(params.inviteeUserId);

  const [existingBinding] = await db
    .select({ id: referralBinding.id })
    .from(referralBinding)
    .where(eq(referralBinding.inviteeUserId, params.inviteeUserId))
    .limit(1);
  if (existingBinding) {
    return { bound: false, reason: "already_bound" as const };
  }

  const [inviter] = await db
    .select({
      userId: referralProfile.userId,
      referralCode: referralProfile.referralCode,
    })
    .from(referralProfile)
    .where(eq(referralProfile.referralCode, code))
    .limit(1);
  if (!inviter || inviter.userId === params.inviteeUserId) {
    return { bound: false, reason: "invalid_code" as const };
  }

  // WHY: 绑定插入与 invitedCount 自增必须同事务提交，否则插入成功后进程
  // 崩溃会导致计数永久偏小。invitee 唯一索引仍是防重复绑定的兜底。
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(referralBinding)
      .values({
        id: crypto.randomUUID(),
        inviterUserId: inviter.userId,
        inviteeUserId: params.inviteeUserId,
        referralCode: inviter.referralCode,
        metadata: params.metadata,
      })
      .onConflictDoNothing({
        target: referralBinding.inviteeUserId,
      })
      .returning({ id: referralBinding.id });

    if (rows.length > 0) {
      await tx
        .update(referralProfile)
        .set({
          invitedCount: sql`${referralProfile.invitedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(referralProfile.userId, inviter.userId));
    }

    return rows;
  });

  if (inserted.length === 0) {
    return { bound: false, reason: "already_bound" as const };
  }

  logEvent("referral.binding.created", {
    inviterUserId: inviter.userId,
    inviteeUserId: params.inviteeUserId,
  });

  return { bound: true, inviterUserId: inviter.userId };
}

async function getEffectiveCommissionRateBps(inviterUserId: string) {
  const [profile] = await db
    .select({
      commissionRateBps: referralProfile.commissionRateBps,
    })
    .from(referralProfile)
    .where(eq(referralProfile.userId, inviterUserId))
    .limit(1);
  const rate =
    profile?.commissionRateBps ?? (await getGlobalCommissionRateBps());
  if (!Number.isFinite(rate)) return 0;
  return Math.min(10000, Math.max(0, Math.trunc(rate)));
}

export async function accrueReferralCommissionForPayment(
  input: ReferralPaymentInput
): Promise<ReferralCommissionResult> {
  if (!(await isReferralEnabled()))
    return { applied: false, reason: "disabled" };
  if (
    !input.orderId.trim() ||
    input.orderAmountCents <= 0 ||
    !Number.isFinite(input.orderAmountCents)
  ) {
    return { applied: false, reason: "invalid_order" };
  }

  // WHY: 业务口径按人民币返利（10 元订单、10% 返利即 1 元），
  // 且 1 人民币分对应 1 积分。Creem 美元订单先折成人民币分，易支付/
  // 支付宝订单直接使用人民币分；未知币种拒绝入账并告警，避免跨通道
  // 金额口径不一致。
  const normalizedAmountCents = normalizeOrderAmountToCnyCents(
    input.orderAmountCents,
    input.currency,
    await getReferralCnyPerUsd()
  );
  if (normalizedAmountCents === null) {
    logger.error(
      {
        inviteeUserId: input.inviteeUserId,
        provider: input.provider,
        orderId: input.orderId,
        currency: input.currency,
      },
      "Referral commission skipped: unsupported order currency"
    );
    return { applied: false, reason: "unsupported_currency" };
  }
  if (normalizedAmountCents <= 0) {
    return { applied: false, reason: "zero_commission" };
  }

  await ensureReferralProfile(input.inviteeUserId);

  const [binding] = await db
    .select()
    .from(referralBinding)
    .where(eq(referralBinding.inviteeUserId, input.inviteeUserId))
    .limit(1);
  if (!binding) return { applied: false, reason: "no_binding" };

  const durationDays = await getReferralDurationDays();
  if (durationDays > 0) {
    const expiresAt = new Date(binding.createdAt);
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    if (Date.now() > expiresAt.getTime()) {
      return { applied: false, reason: "expired" };
    }
  }

  const rateBps = await getEffectiveCommissionRateBps(binding.inviterUserId);
  const capCents = await getPerInviteeCapCents();
  const freezeHours = await getReferralFreezeHours();

  return db.transaction(async (tx) => {
    // WHY: 单 invitee 返佣上限依赖“已累计返佣 + 当前订单返佣”的读后写。
    // 并发 webhook 若同时读取旧累计值，会绕过上限。这里用 inviter+invitee 维度的
    // 事务级 advisory lock 串行化该范围的入账，同时仍由唯一索引兜底单订单重放。
    await tx.execute(
      sql`select pg_advisory_xact_lock(20260704, hashtext(${`${binding.inviterUserId}:${input.inviteeUserId}`}))`
    );

    const existingOrder = await tx
      .select({
        id: referralCommissionLedger.id,
        status: referralCommissionLedger.status,
        commissionAmountCents: referralCommissionLedger.commissionAmountCents,
        commissionCredits: referralCommissionLedger.commissionCredits,
      })
      .from(referralCommissionLedger)
      .where(
        and(
          eq(referralCommissionLedger.provider, input.provider),
          eq(referralCommissionLedger.orderId, input.orderId),
          eq(referralCommissionLedger.inviterUserId, binding.inviterUserId)
        )
      )
      .limit(1);
    if (existingOrder[0]) {
      return {
        applied: false,
        reason: "already_accrued",
        commissionId: existingOrder[0].id,
        inviterUserId: binding.inviterUserId,
        commissionAmountCents: existingOrder[0].commissionAmountCents,
        commissionCredits: existingOrder[0].commissionCredits,
        status: existingOrder[0].status,
      };
    }

    let existingCents = 0;
    if (capCents > 0) {
      const [row] = await tx
        .select({
          total:
            sql<number>`coalesce(sum(${referralCommissionLedger.commissionAmountCents}), 0)`.mapWith(
              Number
            ),
        })
        .from(referralCommissionLedger)
        .where(
          and(
            eq(referralCommissionLedger.inviterUserId, binding.inviterUserId),
            eq(referralCommissionLedger.inviteeUserId, input.inviteeUserId),
            sql`${referralCommissionLedger.status} <> 'canceled'`
          )
        );
      existingCents = row?.total ?? 0;
      if (existingCents >= capCents) {
        return { applied: false, reason: "cap_reached" };
      }
    }

    const commissionAmountCents = calculateReferralCommissionCents(
      normalizedAmountCents,
      rateBps,
      existingCents,
      capCents
    );
    const commissionCredits = centsToCredits(commissionAmountCents);
    if (commissionAmountCents <= 0 || commissionCredits <= 0) {
      return { applied: false, reason: "zero_commission" };
    }

    const frozenUntil =
      freezeHours > 0
        ? new Date(Date.now() + freezeHours * 60 * 60 * 1000)
        : null;
    const status: ReferralCommissionStatus = frozenUntil
      ? "frozen"
      : "available";
    const commissionId = crypto.randomUUID();

    // 账本金额统一以归一后的人民币分记账，保证单 invitee 上限与返佣计算
    // 均按“人民币返利、人民币分转积分”的业务口径执行；原始金额与币种
    // 保留在 metadata 供审计。
    const inserted = await tx
      .insert(referralCommissionLedger)
      .values({
        id: commissionId,
        inviterUserId: binding.inviterUserId,
        inviteeUserId: input.inviteeUserId,
        provider: input.provider,
        orderId: input.orderId,
        orderKind: input.orderKind,
        orderAmountCents: normalizedAmountCents,
        currency: "CNY",
        commissionRateBps: rateBps,
        commissionAmountCents,
        commissionCredits,
        status,
        frozenUntil,
        metadata: {
          ...input.metadata,
          originalOrderAmountCents: Math.trunc(input.orderAmountCents),
          originalCurrency: input.currency.toUpperCase(),
        },
      })
      .onConflictDoNothing({
        target: [
          referralCommissionLedger.provider,
          referralCommissionLedger.orderId,
          referralCommissionLedger.inviterUserId,
        ],
      })
      .returning({ id: referralCommissionLedger.id });

    if (inserted.length === 0) {
      return {
        applied: false,
        reason: "already_accrued",
        inviterUserId: binding.inviterUserId,
      };
    }

    logEvent("referral.commission.accrued", {
      commissionId,
      inviterUserId: binding.inviterUserId,
      inviteeUserId: input.inviteeUserId,
      provider: input.provider,
      orderId: input.orderId,
      commissionCredits,
      status,
    });

    return {
      applied: true,
      commissionId,
      inviterUserId: binding.inviterUserId,
      commissionAmountCents,
      commissionCredits,
      status,
    };
  });
}

export async function thawReferralCommissions(userId?: string) {
  const now = new Date();
  const filters = [
    eq(referralCommissionLedger.status, "frozen" as const),
    sql`${referralCommissionLedger.frozenUntil} is not null`,
    sql`${referralCommissionLedger.frozenUntil} <= ${now}`,
  ];
  if (userId) {
    filters.push(eq(referralCommissionLedger.inviterUserId, userId));
  }

  const updated = await db
    .update(referralCommissionLedger)
    .set({ status: "available", updatedAt: now })
    .where(and(...filters))
    .returning({ id: referralCommissionLedger.id });

  return { thawedCount: updated.length };
}

export async function getReferralOverview(
  userId: string
): Promise<ReferralOverview> {
  await thawReferralCommissions(userId);
  const profile = await ensureReferralProfile(userId);
  const rate =
    profile.commissionRateBps ?? (await getGlobalCommissionRateBps());

  const [totals] = await db
    .select({
      available: sumCommissionCreditsByStatus("available"),
      frozen: sumCommissionCreditsByStatus("frozen"),
      converted: sumCommissionCreditsByStatus("converted"),
    })
    .from(referralCommissionLedger)
    .where(eq(referralCommissionLedger.inviterUserId, userId));

  const invitees = await db
    .select({
      userId: referralBinding.inviteeUserId,
      email: user.email,
      name: user.name,
      joinedAt: referralBinding.createdAt,
      totalOrderAmountCents:
        sql<number>`coalesce(sum(${referralCommissionLedger.orderAmountCents}), 0)`.mapWith(
          Number
        ),
      totalCommissionCredits:
        sql<number>`coalesce(sum(${referralCommissionLedger.commissionCredits}), 0)`.mapWith(
          Number
        ),
    })
    .from(referralBinding)
    .innerJoin(user, eq(user.id, referralBinding.inviteeUserId))
    .leftJoin(
      referralCommissionLedger,
      and(
        eq(
          referralCommissionLedger.inviterUserId,
          referralBinding.inviterUserId
        ),
        eq(
          referralCommissionLedger.inviteeUserId,
          referralBinding.inviteeUserId
        ),
        sql`${referralCommissionLedger.status} <> 'canceled'`
      )
    )
    .where(eq(referralBinding.inviterUserId, userId))
    .groupBy(
      referralBinding.inviteeUserId,
      user.email,
      user.name,
      referralBinding.createdAt
    )
    .orderBy(sql`${referralBinding.createdAt} desc`)
    .limit(100);

  return {
    userId,
    referralCode: profile.referralCode,
    invitedCount: profile.invitedCount,
    effectiveCommissionRateBps: rate,
    availableCredits: totals?.available ?? 0,
    frozenCredits: totals?.frozen ?? 0,
    convertedCredits: totals?.converted ?? 0,
    invitees: invitees.map((item) => ({
      ...item,
      email: maskEmail(item.email),
    })),
  };
}

export async function convertAvailableReferralCommissionToCredits(params: {
  userId: string;
  requestId: string;
}) {
  if ((await getReferralRewardMode()) !== "credits") {
    throw new Error("当前返佣奖励模式不支持转积分");
  }

  await thawReferralCommissions(params.userId);

  const sourceRef = `referral_transfer:${params.userId}:${params.requestId}`;
  const transfer = await db.transaction(async (tx) => {
    // WHY: 同一用户的转积分请求需要先串行化，再读取 existing/pending
    // transfer。否则相同 requestId 并发进入时，一个请求已 claim 账本但尚未
    // 插入完成前，另一个请求可能按过期视图误报“没有可转积分”。
    await tx.execute(
      sql`select pg_advisory_xact_lock(20260704, hashtext(${`referral-transfer:${params.userId}`}))`
    );

    const [existingTransfer] = await tx
      .select()
      .from(referralTransfer)
      .where(eq(referralTransfer.sourceRef, sourceRef))
      .limit(1);
    if (existingTransfer) {
      return existingTransfer;
    }

    const [recoverableTransfer] = await tx
      .select()
      .from(referralTransfer)
      .where(
        and(
          eq(referralTransfer.userId, params.userId),
          eq(referralTransfer.status, "pending" as const)
        )
      )
      .orderBy(desc(referralTransfer.createdAt))
      .limit(1);
    if (recoverableTransfer) {
      return recoverableTransfer;
    }

    const claimed = await tx
      .update(referralCommissionLedger)
      .set({ status: "converting", updatedAt: new Date() })
      .where(
        and(
          eq(referralCommissionLedger.inviterUserId, params.userId),
          eq(referralCommissionLedger.status, "available" as const)
        )
      )
      .returning({
        id: referralCommissionLedger.id,
        commissionAmountCents: referralCommissionLedger.commissionAmountCents,
        commissionCredits: referralCommissionLedger.commissionCredits,
      });

    if (claimed.length === 0) {
      throw new Error("没有可转积分的返佣");
    }

    const transferId = crypto.randomUUID();
    const commissionIds = claimed.map((item) => item.id);
    const amountCents = claimed.reduce(
      (sum, item) => sum + item.commissionAmountCents,
      0
    );
    const creditsAmount =
      Math.round(
        claimed.reduce((sum, item) => sum + item.commissionCredits, 0) * 100
      ) / 100;

    const [insertedTransfer] = await tx
      .insert(referralTransfer)
      .values({
        id: transferId,
        userId: params.userId,
        status: "pending",
        amountCents,
        creditsAmount,
        commissionIds,
        sourceRef,
      })
      .returning();

    if (!insertedTransfer) {
      throw new Error("创建返佣转积分记录失败");
    }

    return insertedTransfer;
  });

  return completeReferralTransfer(transfer);
}

/**
 * 取消订单产生的返佣，并对已转积分的返佣做积分冲正。
 *
 * @param params - 支付提供商、订单号和取消原因。
 * @returns 取消、冲正和跳过数量。
 * @sideEffects 更新返佣账本；必要时调用 consumeCredits 扣回 referral_bonus 积分。
 */
export async function cancelReferralCommissionForOrder(params: {
  provider: ReferralPaymentInput["provider"];
  orderId: string;
  reason: "refund" | "chargeback" | "admin" | "payment_canceled";
  metadata?: Record<string, unknown>;
}): Promise<ReferralCommissionCancelResult> {
  if (!params.orderId.trim()) {
    return {
      canceledCount: 0,
      reversedCount: 0,
      skippedCount: 0,
      alreadyCanceledCount: 0,
      errors: [],
    };
  }

  const commissions = await db
    .select({ id: referralCommissionLedger.id })
    .from(referralCommissionLedger)
    .where(
      and(
        eq(referralCommissionLedger.provider, params.provider),
        eq(referralCommissionLedger.orderId, params.orderId)
      )
    );

  const result: ReferralCommissionCancelResult = {
    canceledCount: 0,
    reversedCount: 0,
    skippedCount: 0,
    alreadyCanceledCount: 0,
    errors: [],
  };

  for (const commission of commissions) {
    await cancelSingleReferralCommission(commission.id, params, result);
  }

  if (
    result.canceledCount > 0 ||
    result.reversedCount > 0 ||
    result.errors.length > 0
  ) {
    logEvent("referral.commission.canceled", {
      provider: params.provider,
      orderId: params.orderId,
      reason: params.reason,
      ...result,
    });
  }

  if (result.errors.length > 0) {
    // WHY: 冲正失败（如邀请人余额不足）意味着退款订单的返佣积分仍留在
    // 邀请人账上，属于资金泄漏，必须以 error 级别暴露给告警渠道，
    // 由调用方决定重试（webhook 5xx 重投）或人工介入。
    logger.error(
      {
        provider: params.provider,
        orderId: params.orderId,
        reason: params.reason,
        errors: result.errors,
      },
      "Referral commission cancellation has unresolved errors"
    );
  }

  return result;
}

async function getReferralCommissionById(commissionId: string) {
  const [commission] = await db
    .select()
    .from(referralCommissionLedger)
    .where(eq(referralCommissionLedger.id, commissionId))
    .limit(1);

  return commission ?? null;
}

async function findPendingReferralTransferForCommission(commissionId: string) {
  const [transfer] = await db
    .select()
    .from(referralTransfer)
    .where(
      and(
        eq(referralTransfer.status, "pending" as const),
        sql`${referralTransfer.commissionIds}::jsonb @> ${JSON.stringify([
          commissionId,
        ])}::jsonb`
      )
    )
    .orderBy(desc(referralTransfer.createdAt))
    .limit(1);

  return transfer ?? null;
}

const CANCEL_COMMISSION_MAX_ATTEMPTS = 5;

/**
 * 取消单条返佣，按当前状态选择直接取消或先冲正积分。
 *
 * WHY: 取消与用户转积分可能并发。若按取消前的快照状态分支、且取消 update 只
 * 排除 canceled，会把并发中刚 converted 的返佣直接置为 canceled 而跳过积分
 * 冲正（已发积分无人扣回）。这里每轮循环重读状态，且取消 update 严格守卫
 * "仅 frozen/available 可直接取消、converted 必须先冲正"；守卫未命中说明状态
 * 被并发修改，重读后按新状态重新分支。grantCredits/consumeCredits 自带
 * db.transaction，不可嵌套外层事务，故用守卫 + 重试而非大事务串行化。
 *
 * @param commissionId - 返佣账本 ID。
 * @param params - 取消原因与元数据。
 * @param result - 聚合结果，就地累加计数与错误。
 * @sideEffects 更新返佣账本；converting 时幂等完成 pending transfer；
 *   converted 时调用 consumeCredits 扣回积分。
 */
async function cancelSingleReferralCommission(
  commissionId: string,
  params: {
    provider: ReferralPaymentInput["provider"];
    orderId: string;
    reason: "refund" | "chargeback" | "admin" | "payment_canceled";
    metadata?: Record<string, unknown>;
  },
  result: ReferralCommissionCancelResult
) {
  for (let attempt = 0; attempt < CANCEL_COMMISSION_MAX_ATTEMPTS; attempt++) {
    const commission = await getReferralCommissionById(commissionId);
    if (!commission) {
      result.skippedCount += 1;
      return;
    }

    if (commission.status === "canceled") {
      result.alreadyCanceledCount += 1;
      return;
    }

    if (commission.status === "converting") {
      const pendingTransfer =
        await findPendingReferralTransferForCommission(commissionId);
      if (!pendingTransfer) {
        // converting 但查不到 pending transfer：转积分 claim 事务与 transfer
        // 插入同事务提交，正常不会出现；短暂窗口下重试一轮再判失败。
        continue;
      }
      try {
        // WHY: converting 表示转积分已经 claim 返佣账本，grantCredits 可能正在
        // 执行或已经成功但尚未把账本置为 converted。退款/拒付不能直接把这类
        // 账本改成 canceled，否则会和转积分收尾竞态，出现已发积分但未冲正的
        // 状态。先用同一 sourceRef 幂等完成 pending transfer，再按 converted
        // 路径扣回。
        await completeReferralTransfer(pendingTransfer);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        result.errors.push({ commissionId, message });
        return;
      }
      continue;
    }

    if (commission.status === "converted") {
      const sourceRef = `referral_reversal:${commissionId}:${params.reason}`;
      let alreadyConsumed = false;
      try {
        const reversal = await consumeCredits({
          userId: commission.inviterUserId,
          amount: commission.commissionCredits,
          serviceName: "referral_reversal",
          sourceRef,
          description: "邀请返佣退款冲正",
          metadata: {
            commissionId,
            provider: params.provider,
            orderId: params.orderId,
            reason: params.reason,
            ...params.metadata,
          },
        });
        alreadyConsumed = reversal.alreadyConsumed === true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        result.errors.push({ commissionId, message });
        return;
      }

      const canceled = await db
        .update(referralCommissionLedger)
        .set({
          status: "canceled",
          canceledAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            ...commission.metadata,
            cancellation: {
              reason: params.reason,
              canceledAt: new Date().toISOString(),
              reversalSourceRef: sourceRef,
              ...params.metadata,
            },
          },
        })
        .where(
          and(
            eq(referralCommissionLedger.id, commissionId),
            eq(referralCommissionLedger.status, "converted" as const)
          )
        )
        .returning({ id: referralCommissionLedger.id });

      if (canceled.length > 0) {
        result.canceledCount += 1;
        if (!alreadyConsumed) {
          result.reversedCount += 1;
        }
        return;
      }
      // 状态被并发修改（如管理员同时取消），重读后重新分支；冲正扣费有
      // sourceRef 幂等保护，重复进入该分支不会双扣。
      continue;
    }

    // frozen / available：直接取消。守卫限定这两种状态，避免覆盖并发中
    // 已进入 converting/converted 的账本。
    const canceled = await db
      .update(referralCommissionLedger)
      .set({
        status: "canceled",
        canceledAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ...commission.metadata,
          cancellation: {
            reason: params.reason,
            canceledAt: new Date().toISOString(),
            ...params.metadata,
          },
        },
      })
      .where(
        and(
          eq(referralCommissionLedger.id, commissionId),
          inArray(referralCommissionLedger.status, ["frozen", "available"])
        )
      )
      .returning({ id: referralCommissionLedger.id });

    if (canceled.length > 0) {
      result.canceledCount += 1;
      return;
    }
  }

  result.errors.push({
    commissionId,
    message: "返佣状态持续变化，取消未完成，请重试",
  });
}

/**
 * 完成一笔已创建的返佣转积分记录。
 *
 * @param transfer - 待完成或待恢复的转积分记录。
 * @returns 转积分结果；重复调用同一 sourceRef 时保持幂等。
 * @sideEffects 可能调用 grantCredits，并将返佣账本标记为 converted。
 */
async function completeReferralTransfer(transfer: ReferralTransfer) {
  if (transfer.status === "completed") {
    return {
      transferId: transfer.id,
      creditsAmount: transfer.creditsAmount,
      commissionCount: transfer.commissionIds.length,
      alreadyConverted: true,
    };
  }

  if (transfer.commissionIds.length === 0) {
    throw new Error("返佣转积分记录缺少可转换账本");
  }

  const commissionIds = transfer.commissionIds;
  const claimed = await db
    .update(referralCommissionLedger)
    .set({ status: "converting", updatedAt: new Date() })
    .where(
      and(
        eq(referralCommissionLedger.inviterUserId, transfer.userId),
        inArray(referralCommissionLedger.id, commissionIds),
        inArray(referralCommissionLedger.status, ["available", "converting"])
      )
    )
    .returning({ id: referralCommissionLedger.id });

  if (claimed.length !== commissionIds.length) {
    const [converted] = await db
      .select({
        count:
          sql<number>`count(*) filter (where ${referralCommissionLedger.status} = 'converted')`.mapWith(
            Number
          ),
      })
      .from(referralCommissionLedger)
      .where(
        and(
          eq(referralCommissionLedger.inviterUserId, transfer.userId),
          inArray(referralCommissionLedger.id, commissionIds)
        )
      );

    if ((converted?.count ?? 0) === commissionIds.length) {
      await db
        .update(referralTransfer)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(referralTransfer.id, transfer.id));

      return {
        transferId: transfer.id,
        creditsAmount: transfer.creditsAmount,
        commissionCount: commissionIds.length,
        alreadyConverted: true,
      };
    }

    // WHY: 本次 claim 已把部分账本从 available 改成 converting。若直接标记
    // transfer failed 并抛错，这些行既不会被新转积分 claim（只 claim
    // available），也不会被恢复路径捞起（pending transfer 已变 failed），
    // 将永久卡死。必须先把刚 claim 的行回置 available 再判失败。
    if (claimed.length > 0) {
      await db
        .update(referralCommissionLedger)
        .set({ status: "available", updatedAt: new Date() })
        .where(
          and(
            eq(referralCommissionLedger.inviterUserId, transfer.userId),
            inArray(
              referralCommissionLedger.id,
              claimed.map((item) => item.id)
            ),
            eq(referralCommissionLedger.status, "converting" as const)
          )
        );
    }

    await db
      .update(referralTransfer)
      .set({
        status: "failed",
        failureReason: "返佣状态已变化，无法完成本次转积分",
        updatedAt: new Date(),
      })
      .where(eq(referralTransfer.id, transfer.id));
    throw new Error("返佣状态已变化，无法完成本次转积分");
  }

  let grantSucceeded = false;

  try {
    const result = await grantCredits({
      userId: transfer.userId,
      amount: transfer.creditsAmount,
      sourceType: "referral",
      debitAccount: "REFERRAL:commission",
      transactionType: "referral_bonus",
      sourceRef: transfer.sourceRef,
      description: "邀请返佣转积分",
      metadata: {
        transferId: transfer.id,
        commissionIds,
        amountCents: transfer.amountCents,
      },
    });
    grantSucceeded = true;

    await db
      .update(referralCommissionLedger)
      .set({
        status: "converted",
        convertedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(referralCommissionLedger.inviterUserId, transfer.userId),
          inArray(referralCommissionLedger.id, commissionIds)
        )
      );

    await db
      .update(referralTransfer)
      .set({
        status: "completed",
        creditsBatchId: result.batchId,
        creditsTransactionId: result.transactionId,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(referralTransfer.id, transfer.id));

    logEvent("referral.transfer.completed", {
      userId: transfer.userId,
      transferId: transfer.id,
      creditsAmount: transfer.creditsAmount,
      commissionCount: commissionIds.length,
    });

    return {
      transferId: transfer.id,
      creditsAmount: transfer.creditsAmount,
      commissionCount: commissionIds.length,
      alreadyConverted: result.alreadyGranted === true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (!grantSucceeded) {
      await db
        .update(referralCommissionLedger)
        .set({ status: "available", updatedAt: new Date() })
        .where(
          and(
            eq(referralCommissionLedger.inviterUserId, transfer.userId),
            inArray(referralCommissionLedger.id, commissionIds),
            eq(referralCommissionLedger.status, "converting" as const)
          )
        );
      await db
        .update(referralTransfer)
        .set({
          status: "failed",
          failureReason: message,
          updatedAt: new Date(),
        })
        .where(eq(referralTransfer.id, transfer.id));
    } else {
      // grantCredits 成功后不能把账本退回 available，否则新 requestId 会再次发放。
      // 保持 pending 允许下一次点击用同一 transfer.sourceRef 幂等恢复收尾。
      await db
        .update(referralTransfer)
        .set({
          status: "pending",
          failureReason: message,
          updatedAt: new Date(),
        })
        .where(eq(referralTransfer.id, transfer.id));
    }

    logger.error(
      { error, userId: transfer.userId },
      "Referral transfer failed"
    );
    throw error;
  }
}

export interface ReferralAdminPaginationInput {
  page?: number | undefined;
  pageSize?: number | undefined;
  query?: string | undefined;
}

export interface ReferralAdminLedgerInput extends ReferralAdminPaginationInput {
  status?: ReferralCommissionStatus | "all" | undefined;
}

export interface ReferralAdminTransferInput
  extends ReferralAdminPaginationInput {
  status?: ReferralTransfer["status"] | "all" | undefined;
}

export interface ReferralAdminProfileRow {
  userId: string;
  email: string;
  name: string;
  referralCode: string;
  referralCodeCustom: boolean;
  commissionRateBps: number | null;
  invitedCount: number;
  availableCredits: number;
  frozenCredits: number;
  convertedCredits: number;
  createdAt: Date;
}

export interface ReferralAdminBindingRow {
  id: string;
  inviterUserId: string;
  inviterEmail: string;
  inviteeUserId: string;
  inviteeEmail: string;
  referralCode: string;
  createdAt: Date;
}

export interface ReferralAdminCommissionRow {
  id: string;
  inviterUserId: string;
  inviterEmail: string;
  inviteeUserId: string;
  inviteeEmail: string;
  provider: string;
  orderId: string;
  orderKind: string;
  orderAmountCents: number;
  currency: string;
  commissionRateBps: number;
  commissionAmountCents: number;
  commissionCredits: number;
  status: ReferralCommissionStatus;
  frozenUntil: Date | null;
  convertedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

export interface ReferralAdminTransferRow {
  id: string;
  userId: string;
  email: string;
  status: ReferralTransfer["status"];
  amountCents: number;
  creditsAmount: number;
  commissionCount: number;
  sourceRef: string;
  creditsBatchId: string | null;
  creditsTransactionId: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReferralAdminCancelCommissionResult
  extends ReferralCommissionCancelResult {
  provider: ReferralPaymentInput["provider"];
  orderId: string;
}

export interface ReferralAdminListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_ADMIN_PAGE_SIZE = 100;

/**
 * 管理端分页查询邀请档案。
 *
 * @param input - 搜索词与分页参数。
 * @returns 用户邀请码、专属比例与返佣汇总。
 * @sideEffects 只读；用于管理端审计页和 agent 查询。
 */
export async function listReferralProfiles(
  input?: ReferralAdminPaginationInput
): Promise<ReferralAdminListResult<ReferralAdminProfileRow>> {
  const page = normalizeAdminPage(input);
  const where = page.query
    ? or(
        ilike(user.email, `%${page.query}%`),
        ilike(user.name, `%${page.query}%`),
        ilike(referralProfile.userId, `%${page.query}%`),
        ilike(referralProfile.referralCode, `%${page.query}%`)
      )
    : undefined;

  const totals = db
    .select({
      inviterUserId: referralCommissionLedger.inviterUserId,
      availableCredits:
        sumCommissionCreditsByStatus("available").as("available_credits"),
      frozenCredits: sumCommissionCreditsByStatus("frozen").as(
        "frozen_credits"
      ),
      convertedCredits:
        sumCommissionCreditsByStatus("converted").as("converted_credits"),
    })
    .from(referralCommissionLedger)
    .groupBy(referralCommissionLedger.inviterUserId)
    .as("referral_profile_totals");

  const baseQuery = db
    .select({
      userId: referralProfile.userId,
      email: user.email,
      name: user.name,
      referralCode: referralProfile.referralCode,
      referralCodeCustom: referralProfile.referralCodeCustom,
      commissionRateBps: referralProfile.commissionRateBps,
      invitedCount: referralProfile.invitedCount,
      availableCredits:
        sql<number>`coalesce(${totals.availableCredits}, 0)`.mapWith(Number),
      frozenCredits: sql<number>`coalesce(${totals.frozenCredits}, 0)`.mapWith(
        Number
      ),
      convertedCredits:
        sql<number>`coalesce(${totals.convertedCredits}, 0)`.mapWith(Number),
      createdAt: referralProfile.createdAt,
    })
    .from(referralProfile)
    .innerJoin(user, eq(user.id, referralProfile.userId))
    .leftJoin(totals, eq(totals.inviterUserId, referralProfile.userId));

  const countQuery = db
    .select({ count: count() })
    .from(referralProfile)
    .innerJoin(user, eq(user.id, referralProfile.userId));

  const [items, totalRows] = await Promise.all([
    (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(referralProfile.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  return {
    items,
    total: totalRows[0]?.count ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/**
 * 管理员设置用户专属邀请码。
 *
 * @param params - 目标用户、邀请码、管理员和原因。
 * @returns 更新后的邀请档案。
 * @sideEffects 可能创建用户邀请档案，更新邀请码并写管理员审计日志。
 */
export async function updateReferralCode(params: {
  targetUserId: string;
  code: string;
  adminUserId: string;
  reason?: string | null | undefined;
}) {
  const code = normalizeReferralCode(params.code);
  if (!isValidReferralCode(code)) {
    throw new Error("邀请码格式不正确");
  }

  const before = await ensureReferralProfile(params.targetUserId);
  const [codeOwner] = await db
    .select({ userId: referralProfile.userId })
    .from(referralProfile)
    .where(eq(referralProfile.referralCode, code))
    .limit(1);
  if (codeOwner && codeOwner.userId !== params.targetUserId) {
    throw new Error("邀请码已被其他用户使用");
  }

  const [after] = await db
    .update(referralProfile)
    .set({
      referralCode: code,
      referralCodeCustom: true,
      updatedAt: new Date(),
    })
    .where(eq(referralProfile.userId, params.targetUserId))
    .returning();
  if (!after) throw new Error("更新邀请码失败");

  await writeReferralAdminAuditLog({
    adminUserId: params.adminUserId,
    targetUserId: params.targetUserId,
    action: "referral.profile.update_code",
    reason: params.reason,
    before: {
      referralCode: before.referralCode,
      referralCodeCustom: before.referralCodeCustom,
    },
    after: {
      referralCode: after.referralCode,
      referralCodeCustom: after.referralCodeCustom,
    },
  });

  return after;
}

/**
 * 管理员设置用户作为邀请人时的专属返佣比例。
 *
 * @param params - 目标用户、bps 比例、管理员和原因；null 表示恢复全局比例。
 * @returns 更新后的邀请档案。
 * @sideEffects 可能创建用户邀请档案，更新专属比例并写管理员审计日志。
 */
export async function setReferralCommissionRate(params: {
  targetUserId: string;
  commissionRateBps: number | null;
  adminUserId: string;
  reason?: string | null | undefined;
}) {
  if (
    params.commissionRateBps !== null &&
    (!Number.isInteger(params.commissionRateBps) ||
      params.commissionRateBps < 0 ||
      params.commissionRateBps > 10000)
  ) {
    throw new Error("返佣比例必须在 0 到 10000 bps 之间");
  }

  const before = await ensureReferralProfile(params.targetUserId);
  const [after] = await db
    .update(referralProfile)
    .set({
      commissionRateBps: params.commissionRateBps,
      updatedAt: new Date(),
    })
    .where(eq(referralProfile.userId, params.targetUserId))
    .returning();
  if (!after) throw new Error("更新专属返佣比例失败");

  await writeReferralAdminAuditLog({
    adminUserId: params.adminUserId,
    targetUserId: params.targetUserId,
    action: "referral.profile.set_commission_rate",
    reason: params.reason,
    before: { commissionRateBps: before.commissionRateBps },
    after: { commissionRateBps: after.commissionRateBps },
  });

  return after;
}

/**
 * 管理员按订单取消返佣。
 *
 * @param params - 订单归属、管理员和审计原因。
 * @returns 取消与冲正结果。
 * @sideEffects 更新返佣账本；必要时扣回已转积分，并写管理员审计日志。
 */
export async function adminCancelReferralCommissionForOrder(params: {
  provider: ReferralPaymentInput["provider"];
  orderId: string;
  adminUserId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<ReferralAdminCancelCommissionResult> {
  const orderId = params.orderId.trim();
  const reason = params.reason.trim();
  if (!orderId) {
    throw new Error("订单号不能为空");
  }
  if (!reason) {
    throw new Error("请填写操作原因");
  }

  const beforeRows = await db
    .select({
      id: referralCommissionLedger.id,
      inviterUserId: referralCommissionLedger.inviterUserId,
      inviteeUserId: referralCommissionLedger.inviteeUserId,
      status: referralCommissionLedger.status,
      commissionCredits: referralCommissionLedger.commissionCredits,
    })
    .from(referralCommissionLedger)
    .where(
      and(
        eq(referralCommissionLedger.provider, params.provider),
        eq(referralCommissionLedger.orderId, orderId)
      )
    );

  const firstCommission = beforeRows[0];
  if (!firstCommission) {
    throw new Error("未找到该订单的返佣记录");
  }

  const result = await cancelReferralCommissionForOrder({
    provider: params.provider,
    orderId,
    reason: "admin",
    metadata: {
      adminUserId: params.adminUserId,
      adminReason: reason,
      ...params.metadata,
    },
  });

  await writeReferralAdminAuditLog({
    adminUserId: params.adminUserId,
    targetUserId: firstCommission.inviterUserId,
    action: "referral.commission.cancel_order",
    reason,
    before: {
      provider: params.provider,
      orderId,
      commissions: beforeRows,
    },
    after: {
      provider: params.provider,
      orderId,
      ...result,
    },
  });

  return {
    provider: params.provider,
    orderId,
    ...result,
  };
}

/**
 * 管理端分页查询邀请绑定。
 *
 * @param input - 搜索词与分页参数。
 * @returns 邀请人、被邀请人和绑定时间。
 * @sideEffects 无。
 */
export async function listReferralBindings(
  input?: ReferralAdminPaginationInput
): Promise<ReferralAdminListResult<ReferralAdminBindingRow>> {
  const page = normalizeAdminPage(input);
  const inviter = alias(user, "referral_binding_inviter");
  const invitee = alias(user, "referral_binding_invitee");
  const where = page.query
    ? or(
        ilike(inviter.email, `%${page.query}%`),
        ilike(invitee.email, `%${page.query}%`),
        ilike(referralBinding.inviterUserId, `%${page.query}%`),
        ilike(referralBinding.inviteeUserId, `%${page.query}%`),
        ilike(referralBinding.referralCode, `%${page.query}%`)
      )
    : undefined;

  const baseQuery = db
    .select({
      id: referralBinding.id,
      inviterUserId: referralBinding.inviterUserId,
      inviterEmail: inviter.email,
      inviteeUserId: referralBinding.inviteeUserId,
      inviteeEmail: invitee.email,
      referralCode: referralBinding.referralCode,
      createdAt: referralBinding.createdAt,
    })
    .from(referralBinding)
    .innerJoin(inviter, eq(inviter.id, referralBinding.inviterUserId))
    .innerJoin(invitee, eq(invitee.id, referralBinding.inviteeUserId));

  const countQuery = db
    .select({ count: count() })
    .from(referralBinding)
    .innerJoin(inviter, eq(inviter.id, referralBinding.inviterUserId))
    .innerJoin(invitee, eq(invitee.id, referralBinding.inviteeUserId));

  const [items, totalRows] = await Promise.all([
    (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(referralBinding.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  return {
    items,
    total: totalRows[0]?.count ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/**
 * 管理端分页查询返佣账本。
 *
 * @param input - 搜索、状态与分页参数。
 * @returns 返佣订单、状态和金额快照。
 * @sideEffects 无。
 */
export async function listReferralCommissionLedger(
  input?: ReferralAdminLedgerInput
): Promise<ReferralAdminListResult<ReferralAdminCommissionRow>> {
  const page = normalizeAdminPage(input);
  const inviter = alias(user, "referral_commission_inviter");
  const invitee = alias(user, "referral_commission_invitee");
  const filters = [];
  if (input?.status && input.status !== "all") {
    filters.push(eq(referralCommissionLedger.status, input.status));
  }
  if (page.query) {
    filters.push(
      or(
        ilike(inviter.email, `%${page.query}%`),
        ilike(invitee.email, `%${page.query}%`),
        ilike(referralCommissionLedger.inviterUserId, `%${page.query}%`),
        ilike(referralCommissionLedger.inviteeUserId, `%${page.query}%`),
        ilike(referralCommissionLedger.provider, `%${page.query}%`),
        ilike(referralCommissionLedger.orderId, `%${page.query}%`)
      )
    );
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const baseQuery = db
    .select({
      id: referralCommissionLedger.id,
      inviterUserId: referralCommissionLedger.inviterUserId,
      inviterEmail: inviter.email,
      inviteeUserId: referralCommissionLedger.inviteeUserId,
      inviteeEmail: invitee.email,
      provider: referralCommissionLedger.provider,
      orderId: referralCommissionLedger.orderId,
      orderKind: referralCommissionLedger.orderKind,
      orderAmountCents: referralCommissionLedger.orderAmountCents,
      currency: referralCommissionLedger.currency,
      commissionRateBps: referralCommissionLedger.commissionRateBps,
      commissionAmountCents: referralCommissionLedger.commissionAmountCents,
      commissionCredits: referralCommissionLedger.commissionCredits,
      status: referralCommissionLedger.status,
      frozenUntil: referralCommissionLedger.frozenUntil,
      convertedAt: referralCommissionLedger.convertedAt,
      canceledAt: referralCommissionLedger.canceledAt,
      createdAt: referralCommissionLedger.createdAt,
    })
    .from(referralCommissionLedger)
    .innerJoin(inviter, eq(inviter.id, referralCommissionLedger.inviterUserId))
    .innerJoin(invitee, eq(invitee.id, referralCommissionLedger.inviteeUserId));

  const countQuery = db
    .select({ count: count() })
    .from(referralCommissionLedger)
    .innerJoin(inviter, eq(inviter.id, referralCommissionLedger.inviterUserId))
    .innerJoin(invitee, eq(invitee.id, referralCommissionLedger.inviteeUserId));

  const [items, totalRows] = await Promise.all([
    (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(referralCommissionLedger.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  return {
    items,
    total: totalRows[0]?.count ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/**
 * 管理端分页查询返佣转积分记录。
 *
 * @param input - 搜索、状态与分页参数。
 * @returns 转积分流水和关联积分批次。
 * @sideEffects 无。
 */
export async function listReferralTransfers(
  input?: ReferralAdminTransferInput
): Promise<ReferralAdminListResult<ReferralAdminTransferRow>> {
  const page = normalizeAdminPage(input);
  const filters = [];
  if (input?.status && input.status !== "all") {
    filters.push(eq(referralTransfer.status, input.status));
  }
  if (page.query) {
    filters.push(
      or(
        ilike(user.email, `%${page.query}%`),
        ilike(referralTransfer.userId, `%${page.query}%`),
        ilike(referralTransfer.sourceRef, `%${page.query}%`),
        ilike(referralTransfer.creditsBatchId, `%${page.query}%`),
        ilike(referralTransfer.creditsTransactionId, `%${page.query}%`)
      )
    );
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const baseQuery = db
    .select({
      id: referralTransfer.id,
      userId: referralTransfer.userId,
      email: user.email,
      status: referralTransfer.status,
      amountCents: referralTransfer.amountCents,
      creditsAmount: referralTransfer.creditsAmount,
      commissionCount:
        sql<number>`json_array_length(${referralTransfer.commissionIds})`.mapWith(
          Number
        ),
      sourceRef: referralTransfer.sourceRef,
      creditsBatchId: referralTransfer.creditsBatchId,
      creditsTransactionId: referralTransfer.creditsTransactionId,
      failureReason: referralTransfer.failureReason,
      createdAt: referralTransfer.createdAt,
      updatedAt: referralTransfer.updatedAt,
    })
    .from(referralTransfer)
    .innerJoin(user, eq(user.id, referralTransfer.userId));

  const countQuery = db
    .select({ count: count() })
    .from(referralTransfer)
    .innerJoin(user, eq(user.id, referralTransfer.userId));

  const [items, totalRows] = await Promise.all([
    (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(referralTransfer.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  return {
    items,
    total: totalRows[0]?.count ?? 0,
    page: page.page,
    pageSize: page.pageSize,
  };
}
