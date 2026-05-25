"use server";

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@repo/database";
import {
  adminAuditLog,
  creditsBalance,
  creditsBatch,
  creditsTransaction,
  externalApiKey,
  generation,
  subscription,
  user,
} from "@repo/database/schema";
import {
  ADMIN_MANAGEMENT_ROLES,
  APP_USER_ROLES,
  getUserRoleLabel,
} from "../../auth/roles";
import {
  getPlanFromPriceId,
  type SubscriptionPlan,
} from "../../config/subscription-plan";
import { PRICE_IDS } from "../../config/payment";
import { CREDIT_CONFIG_DEFAULTS } from "../../credits/config";
import {
  freezeCreditsAccount,
  grantCredits,
  unfreezeCreditsAccount,
} from "../../credits/core";
import { expireStalePendingGenerations } from "../../generation-maintenance";
import { adminAction, superAdminAction } from "../../safe-action";
import { getUserPlan } from "../../subscription/services/user-plan";
import { getRuntimeSettingNumber } from "../../system-settings";

const withAdminUsersAction = (name: string) =>
  adminAction.metadata({ action: `support.adminUsers.${name}` });
const withSuperAdminUsersAction = (name: string) =>
  superAdminAction.metadata({ action: `support.adminUsers.${name}` });

const userStatusSchema = z.enum(["all", "active", "banned", "unverified"]);
const subscriptionStatusSchema = z.enum([
  "all",
  "none",
  "active",
  "canceled",
  "past_due",
  "incomplete",
]);
const creditsStatusSchema = z.enum(["all", "active", "frozen"]);
const planFilterSchema = z.enum([
  "all",
  "free",
  "starter",
  "pro",
  "ultra",
  "enterprise",
]);

const listUsersSchema = z
  .object({
    query: z.string().trim().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(10).max(100).default(20),
    status: userStatusSchema.default("all"),
    subscriptionStatus: subscriptionStatusSchema.default("all"),
    creditsStatus: creditsStatusSchema.default("all"),
    plan: planFilterSchema.default("all"),
  })
  .optional();

const userIdSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
});

const reasonSchema = z
  .string()
  .trim()
  .min(1, "请填写操作原因")
  .max(300, "原因最多300字符");

const updateUserRoleSchema = userIdSchema.extend({
  role: z.enum(APP_USER_ROLES),
  reason: z.string().trim().max(300).optional(),
});

const banUserSchema = userIdSchema.extend({
  banned: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

const grantCreditsSchema = userIdSchema.extend({
  amount: z
    .number()
    .positive("积分数量必须大于0")
    .max(100000, "单次最多充值10万积分"),
  reason: reasonSchema,
});

const setCreditsStatusSchema = userIdSchema.extend({
  status: z.enum(["active", "frozen"]),
  reason: reasonSchema,
});

const setExternalApiKeyStatusSchema = z.object({
  keyId: z.string().min(1, "API Key ID 不能为空"),
  isActive: z.boolean(),
  reason: reasonSchema,
});

type ListUsersInput = z.infer<typeof listUsersSchema>;
type PlanFilter = z.infer<typeof planFilterSchema>;

function normalizeListInput(input: ListUsersInput) {
  return {
    query: input?.query?.trim() || "",
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 20,
    status: input?.status ?? "all",
    subscriptionStatus: input?.subscriptionStatus ?? "all",
    creditsStatus: input?.creditsStatus ?? "all",
    plan: input?.plan ?? "all",
  };
}

function getPlanFromSubscriptionPriceId(priceId: string | null | undefined) {
  if (!priceId) {
    return "free" satisfies SubscriptionPlan;
  }
  return getPlanFromPriceId(priceId) ?? ("free" satisfies SubscriptionPlan);
}

function isSubscriptionWithinPeriod(sub: {
  currentPeriodEnd: Date | null;
  status: string | null;
}) {
  if (!sub.status) {
    return false;
  }
  if (sub.status === "lifetime") {
    return true;
  }
  const withinPeriod = !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date();
  return (
    (["active", "trialing"].includes(sub.status) && withinPeriod) ||
    (sub.status === "canceled" && withinPeriod)
  );
}

function effectiveSubscriptionCondition() {
  return sql<boolean>`(
    ${subscription.status} = 'lifetime'
    OR (
      ${subscription.status} IN ('active', 'trialing')
      AND (
        ${subscription.currentPeriodEnd} IS NULL
        OR ${subscription.currentPeriodEnd} > now()
      )
    )
    OR (
      ${subscription.status} = 'canceled'
      AND ${subscription.currentPeriodEnd} IS NOT NULL
      AND ${subscription.currentPeriodEnd} > now()
    )
  )`;
}

function getPlanPriceIds(plan: Exclude<PlanFilter, "all" | "free">) {
  return Object.values(PRICE_IDS)
    .filter((value): value is string => {
      if (!value) {
        return false;
      }
      return getPlanFromPriceId(value) === plan;
    });
}

function buildUserFilters(input: ReturnType<typeof normalizeListInput>) {
  const filters = [];

  if (input.query) {
    const query = `%${input.query}%`;
    filters.push(
      or(
        ilike(user.id, query),
        ilike(user.name, query),
        ilike(user.email, query)
      )
    );
  }

  if (input.status === "active") {
    filters.push(eq(user.banned, false));
  } else if (input.status === "banned") {
    filters.push(eq(user.banned, true));
  } else if (input.status === "unverified") {
    filters.push(eq(user.emailVerified, false));
  }

  if (input.creditsStatus !== "all") {
    filters.push(eq(creditsBalance.status, input.creditsStatus));
  }

  if (input.subscriptionStatus === "none") {
    filters.push(sql`${subscription.id} IS NULL`);
  } else if (input.subscriptionStatus !== "all") {
    filters.push(eq(subscription.status, input.subscriptionStatus));
  }

  if (input.plan === "free") {
    filters.push(
      or(
        sql`${subscription.id} IS NULL`,
        sql`NOT ${effectiveSubscriptionCondition()}`
      )
    );
  } else if (input.plan !== "all") {
    const priceIds = getPlanPriceIds(input.plan);
    if (priceIds.length > 0) {
      filters.push(inArray(subscription.priceId, priceIds));
      filters.push(effectiveSubscriptionCondition());
    } else {
      filters.push(sql`false`);
    }
  }

  return filters.length > 0 ? and(...filters) : undefined;
}

function sanitizeSnapshot(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function writeAdminAuditLog(params: {
  adminUserId: string;
  targetUserId?: string | null;
  action: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminUserId: params.adminUserId,
    targetUserId: params.targetUserId ?? null,
    action: params.action,
    reason: params.reason?.trim() || null,
    before: sanitizeSnapshot(params.before),
    after: sanitizeSnapshot(params.after),
    metadata: params.metadata,
  });
}

async function getUserBasicOrThrow(userId: string) {
  const [targetUser] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      bannedReason: user.bannedReason,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!targetUser) {
    throw new Error("用户不存在");
  }

  return targetUser;
}

export const getAllUsersAction = withAdminUsersAction("getAllUsers")
  .schema(listUsersSchema)
  .action(async ({ parsedInput }) => {
    const input = normalizeListInput(parsedInput);
    const where = buildUserFilters(input);
    const offset = (input.page - 1) * input.pageSize;

    const baseQuery = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        banned: user.banned,
        bannedReason: user.bannedReason,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        creditsBalance: sql<number>`coalesce(${creditsBalance.balance}, 0)`.mapWith(Number),
        creditsTotalEarned:
          sql<number>`coalesce(${creditsBalance.totalEarned}, 0)`.mapWith(
            Number
          ),
        creditsTotalSpent:
          sql<number>`coalesce(${creditsBalance.totalSpent}, 0)`.mapWith(
            Number
          ),
        creditsStatus: creditsBalance.status,
        subscriptionStatus: subscription.status,
        subscriptionPriceId: subscription.priceId,
        subscriptionCurrentPeriodEnd: subscription.currentPeriodEnd,
      })
      .from(user)
      .leftJoin(creditsBalance, eq(creditsBalance.userId, user.id))
      .leftJoin(subscription, eq(subscription.userId, user.id));

    const countQuery = db
      .select({ count: count() })
      .from(user)
      .leftJoin(creditsBalance, eq(creditsBalance.userId, user.id))
      .leftJoin(subscription, eq(subscription.userId, user.id));

    const [rows, totalResult, statsResults] = await Promise.all([
      (where ? baseQuery.where(where) : baseQuery)
        .orderBy(desc(user.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      (where ? countQuery.where(where) : countQuery),
      Promise.all([
        db.select({ count: count() }).from(user),
        db
          .select({ count: count() })
          .from(user)
          .where(inArray(user.role, [
            "observer_admin",
            ...ADMIN_MANAGEMENT_ROLES,
          ])),
        db.select({ count: count() }).from(user).where(eq(user.banned, true)),
        db
          .select({ count: count() })
          .from(subscription)
          .where(effectiveSubscriptionCondition()),
      ]),
    ]);

    const userIds = rows.map((row) => row.id);
    const [generationCounts, apiKeyCounts] =
      userIds.length > 0
        ? await Promise.all([
            db
              .select({
                userId: generation.userId,
                total: sql<number>`count(*)`.mapWith(Number),
                failed: sql<number>`sum(case when ${generation.status} = 'failed' then 1 else 0 end)`.mapWith(
                  Number
                ),
              })
              .from(generation)
              .where(inArray(generation.userId, userIds))
              .groupBy(generation.userId),
            db
              .select({
                userId: externalApiKey.userId,
                total: sql<number>`count(*)`.mapWith(Number),
                active: sql<number>`sum(case when ${externalApiKey.isActive} then 1 else 0 end)`.mapWith(
                  Number
                ),
              })
              .from(externalApiKey)
              .where(inArray(externalApiKey.userId, userIds))
              .groupBy(externalApiKey.userId),
          ])
        : [[], []];

    const generationCountMap = new Map(
      generationCounts.map((item) => [item.userId, item])
    );
    const apiKeyCountMap = new Map(
      apiKeyCounts.map((item) => [item.userId, item])
    );

    return {
      users: rows.map((row) => {
        const generationStats = generationCountMap.get(row.id);
        const apiKeyStats = apiKeyCountMap.get(row.id);
        return {
          ...row,
          plan: isSubscriptionWithinPeriod({
            status: row.subscriptionStatus,
            currentPeriodEnd: row.subscriptionCurrentPeriodEnd,
          })
            ? getPlanFromSubscriptionPriceId(row.subscriptionPriceId)
            : ("free" satisfies SubscriptionPlan),
          creditsStatus: row.creditsStatus ?? "active",
          generationCount: generationStats?.total ?? 0,
          failedGenerationCount: generationStats?.failed ?? 0,
          apiKeyCount: apiKeyStats?.total ?? 0,
          activeApiKeyCount: apiKeyStats?.active ?? 0,
        };
      }),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total: totalResult[0]?.count ?? 0,
      },
      stats: {
        totalUsers: statsResults[0][0]?.count ?? 0,
        admins: statsResults[1][0]?.count ?? 0,
        banned: statsResults[2][0]?.count ?? 0,
        activeSubscriptions: statsResults[3][0]?.count ?? 0,
      },
    };
  });

export const getUserDetailAction = withAdminUsersAction("getUserDetail")
  .schema(userIdSchema)
  .action(async ({ parsedInput }) => {
    const userId = parsedInput.userId;
    await expireStalePendingGenerations({ userId, limit: 100 });

    const [
      userRows,
      balanceRows,
      subscriptionRows,
      activeBatches,
      transactions,
      generations,
      apiKeys,
      auditLogs,
      generationSummary,
    ] = await Promise.all([
      db
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      db
        .select()
        .from(creditsBalance)
        .where(eq(creditsBalance.userId, userId))
        .limit(1),
      db
        .select()
        .from(subscription)
        .where(eq(subscription.userId, userId))
        .limit(1),
      db
        .select()
        .from(creditsBatch)
        .where(
          and(
            eq(creditsBatch.userId, userId),
            eq(creditsBatch.status, "active"),
            sql`${creditsBatch.remaining} > 0`
          )
        )
        .orderBy(desc(creditsBatch.issuedAt))
        .limit(10),
      db
        .select()
        .from(creditsTransaction)
        .where(eq(creditsTransaction.userId, userId))
        .orderBy(desc(creditsTransaction.createdAt))
        .limit(20),
      db
        .select({
          id: generation.id,
          prompt: generation.prompt,
          revisedPrompt: generation.revisedPrompt,
          model: generation.model,
          size: generation.size,
          status: generation.status,
          storageKey: generation.storageKey,
          storageBucket: generation.storageBucket,
          fileSize: generation.fileSize,
          creditsConsumed: generation.creditsConsumed,
          error: generation.error,
          metadata: generation.metadata,
          createdAt: generation.createdAt,
          completedAt: generation.completedAt,
        })
        .from(generation)
        .where(eq(generation.userId, userId))
        .orderBy(desc(generation.createdAt))
        .limit(12),
      db
        .select({
          id: externalApiKey.id,
          name: externalApiKey.name,
          keyPrefix: externalApiKey.keyPrefix,
          lastFour: externalApiKey.lastFour,
          lastUsedAt: externalApiKey.lastUsedAt,
          isActive: externalApiKey.isActive,
          createdAt: externalApiKey.createdAt,
          updatedAt: externalApiKey.updatedAt,
        })
        .from(externalApiKey)
        .where(eq(externalApiKey.userId, userId))
        .orderBy(desc(externalApiKey.createdAt)),
      db
        .select({
          id: adminAuditLog.id,
          adminUserId: adminAuditLog.adminUserId,
          action: adminAuditLog.action,
          reason: adminAuditLog.reason,
          metadata: adminAuditLog.metadata,
          createdAt: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .where(eq(adminAuditLog.targetUserId, userId))
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(20),
      db
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          completed:
            sql<number>`sum(case when ${generation.status} = 'completed' then 1 else 0 end)`.mapWith(
              Number
            ),
          failed:
            sql<number>`sum(case when ${generation.status} = 'failed' then 1 else 0 end)`.mapWith(
              Number
            ),
          creditsConsumed:
            sql<number>`coalesce(sum(${generation.creditsConsumed}), 0)`.mapWith(
              Number
            ),
        })
        .from(generation)
        .where(eq(generation.userId, userId)),
    ]);

    const userData = userRows[0];
    if (!userData) {
      throw new Error("用户不存在");
    }

    const sub = subscriptionRows[0] ?? null;
    const planInfo = await getUserPlan(userId);
    return {
      user: userData,
      creditsBalance: balanceRows[0] ?? null,
      subscription: sub,
      plan: planInfo.plan,
      activeBatches,
      transactions,
      generations: generations.map((item) => ({
        ...item,
        imageUrl: item.storageKey
          ? `/api/storage/${item.storageBucket ?? "generations"}/${item.storageKey}`
          : null,
      })),
      apiKeys,
      auditLogs,
      generationSummary: generationSummary[0] ?? {
        total: 0,
        completed: 0,
        failed: 0,
        creditsConsumed: 0,
      },
    };
  });

export const updateUserRoleAction = withSuperAdminUsersAction("updateUserRole")
  .schema(updateUserRoleSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const targetUser = await getUserBasicOrThrow(data.userId);

    await db
      .update(user)
      .set({
        role: data.role,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));

    await writeAdminAuditLog({
      adminUserId: ctx.userId,
      targetUserId: data.userId,
      action: "user.role.update",
      reason: data.reason || "管理员修改用户角色",
      before: { role: targetUser.role },
      after: { role: data.role },
    });

    revalidatePath("/dashboard/users");
    return { message: `用户角色已更新为 ${getUserRoleLabel(data.role)}` };
  });

export const banUserAction = withAdminUsersAction("banUser")
  .schema(banUserSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const targetUser = await getUserBasicOrThrow(data.userId);
    const reason = data.reason || (data.banned ? "管理员操作" : "解除封禁");

    await db
      .update(user)
      .set({
        banned: data.banned,
        bannedReason: data.banned ? reason : null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));

    await writeAdminAuditLog({
      adminUserId: ctx.userId,
      targetUserId: data.userId,
      action: data.banned ? "user.ban" : "user.unban",
      reason,
      before: {
        banned: targetUser.banned,
        bannedReason: targetUser.bannedReason,
      },
      after: {
        banned: data.banned,
        bannedReason: data.banned ? reason : null,
      },
    });

    revalidatePath("/dashboard/users");
    return {
      message: data.banned ? "用户已被封禁" : "用户已被解封",
    };
  });

export const adminGrantCreditsAction = withAdminUsersAction("grantCredits")
  .schema(grantCreditsSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    await getUserBasicOrThrow(data.userId);

    const expiryDays = await getRuntimeSettingNumber(
      "FREE_CREDITS_EXPIRY_DAYS",
      CREDIT_CONFIG_DEFAULTS.freeCreditsExpiryDays,
      { positive: true }
    );
    const expiresAt = expiryDays
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await grantCredits({
      userId: data.userId,
      amount: data.amount,
      sourceType: "bonus",
      debitAccount: `ADMIN:${ctx.userId}`,
      transactionType: "admin_grant",
      expiresAt,
      description: `管理员手动充值: ${data.reason}`,
      metadata: {
        adminUserId: ctx.userId,
        reason: data.reason,
      },
    });

    await writeAdminAuditLog({
      adminUserId: ctx.userId,
      targetUserId: data.userId,
      action: "credits.grant",
      reason: data.reason,
      after: {
        amount: data.amount,
        batchId: result.batchId,
        transactionId: result.transactionId,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });

    revalidatePath("/dashboard/users");
    return {
      message: `已为用户充值 ${data.amount} 积分`,
      ...result,
    };
  });

export const setUserCreditsStatusAction = withAdminUsersAction(
  "setCreditsStatus"
)
  .schema(setCreditsStatusSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    await getUserBasicOrThrow(data.userId);

    const [before] = await db
      .select()
      .from(creditsBalance)
      .where(eq(creditsBalance.userId, data.userId))
      .limit(1);

    if (data.status === "frozen") {
      await freezeCreditsAccount(data.userId);
    } else {
      await unfreezeCreditsAccount(data.userId);
    }

    const [after] = await db
      .select()
      .from(creditsBalance)
      .where(eq(creditsBalance.userId, data.userId))
      .limit(1);

    await writeAdminAuditLog({
      adminUserId: ctx.userId,
      targetUserId: data.userId,
      action:
        data.status === "frozen" ? "credits.freeze" : "credits.unfreeze",
      reason: data.reason,
      before: before
        ? {
            status: before.status,
            balance: before.balance,
          }
        : undefined,
      after: after
        ? {
            status: after.status,
            balance: after.balance,
          }
        : undefined,
    });

    revalidatePath("/dashboard/users");
    return {
      message:
        data.status === "frozen" ? "积分账户已冻结" : "积分账户已解冻",
    };
  });

export const setExternalApiKeyStatusAction = withAdminUsersAction(
  "setExternalApiKeyStatus"
)
  .schema(setExternalApiKeyStatusSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const [apiKey] = await db
      .select({
        id: externalApiKey.id,
        userId: externalApiKey.userId,
        name: externalApiKey.name,
        keyPrefix: externalApiKey.keyPrefix,
        lastFour: externalApiKey.lastFour,
        isActive: externalApiKey.isActive,
      })
      .from(externalApiKey)
      .where(eq(externalApiKey.id, data.keyId))
      .limit(1);

    if (!apiKey) {
      throw new Error("API Key 不存在");
    }

    await db
      .update(externalApiKey)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(eq(externalApiKey.id, data.keyId));

    await writeAdminAuditLog({
      adminUserId: ctx.userId,
      targetUserId: apiKey.userId,
      action: data.isActive ? "external_api_key.enable" : "external_api_key.disable",
      reason: data.reason,
      before: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        lastFour: apiKey.lastFour,
        isActive: apiKey.isActive,
      },
      after: {
        id: apiKey.id,
        isActive: data.isActive,
      },
    });

    revalidatePath("/dashboard/users");
    return {
      message: data.isActive ? "API Key 已启用" : "API Key 已禁用",
    };
  });
