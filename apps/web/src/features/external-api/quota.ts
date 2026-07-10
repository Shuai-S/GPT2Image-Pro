/**
 * 外部 API Key 配额读写服务。
 *
 * 无 sourceRef 的站内调用保留聚合计数原子更新；外部 API 计费传入 sourceRef 后，
 * 通过配额账本与 API Key 行锁保证预占/退款在并发重试下只生效一次。
 */
import { db } from "@repo/database";
import { externalApiKey, externalApiKeyUsage } from "@repo/database/schema";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

import {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  normalizeExternalApiKeyUsageSourceRef,
  resolveExternalApiKeyUsageMutation,
  roundQuotaCredits,
} from "./quota-math";

// 纯逻辑已抽到 quota-math.ts（DB-free 可单测），此处 re-export 保持调用方导入路径不变。
export {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  isExternalApiKeyQuotaExceededError,
  normalizeExternalApiKeyCreditLimit,
} from "./quota-math";

/**
 * 读取归属于用户的 API Key 配额快照；Key 不存在或归属不匹配时抛错。
 */
export async function getExternalApiKeyQuota(params: {
  apiKeyId: string;
  userId: string;
}) {
  const [key] = await db
    .select({
      id: externalApiKey.id,
      name: externalApiKey.name,
      keyPrefix: externalApiKey.keyPrefix,
      lastFour: externalApiKey.lastFour,
      isActive: externalApiKey.isActive,
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
      lastUsedAt: externalApiKey.lastUsedAt,
      createdAt: externalApiKey.createdAt,
    })
    .from(externalApiKey)
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
        eq(externalApiKey.userId, params.userId)
      )
    )
    .limit(1);

  if (!key) {
    throw new Error("API key not found");
  }

  const creditLimit = key.creditLimit ?? null;
  const creditsUsed = roundQuotaCredits(Number(key.creditsUsed || 0));
  return {
    ...key,
    creditLimit,
    creditsUsed,
    creditsRemaining: getExternalApiKeyQuotaRemaining(creditLimit, creditsUsed),
  };
}

/**
 * 预占 API Key 配额。
 *
 * sourceRef 缺失时沿用旧的原子累加；提供时在事务内锁定 Key，并以账本唯一键
 * 去重。额度不足、Key 停用、归属错误或同一幂等键金额漂移时抛错。
 */
export async function reserveExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
  sourceRef?: string;
}) {
  const apiKeyId = params.apiKeyId;
  if (!apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;
  const sourceRef = normalizeExternalApiKeyUsageSourceRef(params.sourceRef);

  if (sourceRef) {
    return await db.transaction(async (tx) => {
      const [key] = await tx
        .select({
          creditLimit: externalApiKey.creditLimit,
          creditsUsed: externalApiKey.creditsUsed,
          isActive: externalApiKey.isActive,
        })
        .from(externalApiKey)
        .where(
          and(
            eq(externalApiKey.id, apiKeyId),
            eq(externalApiKey.userId, params.userId)
          )
        )
        .for("update");

      if (!key) {
        throw new Error("API key not found");
      }

      const [existing] = await tx
        .select({
          amount: externalApiKeyUsage.amount,
          status: externalApiKeyUsage.status,
        })
        .from(externalApiKeyUsage)
        .where(
          and(
            eq(externalApiKeyUsage.apiKeyId, apiKeyId),
            eq(externalApiKeyUsage.sourceRef, sourceRef)
          )
        )
        .limit(1);
      const mutation = resolveExternalApiKeyUsageMutation({
        existing: existing ?? null,
        requestedStatus: "reserved",
        amount,
      });
      if (mutation === "noop") {
        return {
          creditLimit: key.creditLimit,
          creditsUsed: key.creditsUsed,
        };
      }
      if (mutation !== "insert") {
        throw new Error("API Key 配额预占状态迁移非法");
      }

      const remaining = getExternalApiKeyQuotaRemaining(
        key.creditLimit,
        key.creditsUsed
      );
      if (!key.isActive || (remaining !== null && remaining < amount)) {
        throw new ExternalApiKeyQuotaExceededError(
          amount,
          remaining ?? amount,
          key.creditLimit,
          key.creditsUsed
        );
      }

      const now = new Date();
      await tx.insert(externalApiKeyUsage).values({
        apiKeyId,
        sourceRef,
        userId: params.userId,
        amount,
        status: "reserved",
        createdAt: now,
        updatedAt: now,
      });
      const [updated] = await tx
        .update(externalApiKey)
        .set({
          creditsUsed: sql`${externalApiKey.creditsUsed} + ${amount}`,
          updatedAt: now,
        })
        .where(eq(externalApiKey.id, apiKeyId))
        .returning({
          creditLimit: externalApiKey.creditLimit,
          creditsUsed: externalApiKey.creditsUsed,
        });
      if (!updated) {
        throw new Error("API Key 配额预占失败");
      }
      return updated;
    });
  }

  const [updated] = await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`${externalApiKey.creditsUsed} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, apiKeyId),
        eq(externalApiKey.userId, params.userId),
        eq(externalApiKey.isActive, true),
        or(
          isNull(externalApiKey.creditLimit),
          gte(
            sql`${externalApiKey.creditLimit} - ${externalApiKey.creditsUsed}`,
            amount
          )
        )
      )
    )
    .returning({
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
    });

  if (updated) return updated;

  const quota = await getExternalApiKeyQuota({
    apiKeyId,
    userId: params.userId,
  });
  const remaining = quota.creditsRemaining ?? Number.POSITIVE_INFINITY;
  throw new ExternalApiKeyQuotaExceededError(
    amount,
    Number.isFinite(remaining) ? remaining : amount,
    quota.creditLimit,
    quota.creditsUsed
  );
}

/**
 * 退回 API Key 配额。
 *
 * sourceRef 缺失时沿用旧的原子扣减；提供时将对应账本状态单向转为 refunded。
 * 独立退款键首次出现时也会落账，以保证失败补偿重放不会重复减少 creditsUsed。
 */
export async function refundExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
  sourceRef?: string;
}) {
  const apiKeyId = params.apiKeyId;
  if (!apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;
  const sourceRef = normalizeExternalApiKeyUsageSourceRef(params.sourceRef);

  if (sourceRef) {
    await db.transaction(async (tx) => {
      const [key] = await tx
        .select({ id: externalApiKey.id })
        .from(externalApiKey)
        .where(
          and(
            eq(externalApiKey.id, apiKeyId),
            eq(externalApiKey.userId, params.userId)
          )
        )
        .for("update");
      if (!key) return;

      const [existing] = await tx
        .select({
          amount: externalApiKeyUsage.amount,
          status: externalApiKeyUsage.status,
        })
        .from(externalApiKeyUsage)
        .where(
          and(
            eq(externalApiKeyUsage.apiKeyId, apiKeyId),
            eq(externalApiKeyUsage.sourceRef, sourceRef)
          )
        )
        .limit(1);
      const mutation = resolveExternalApiKeyUsageMutation({
        existing: existing ?? null,
        requestedStatus: "refunded",
        amount,
      });
      if (mutation === "noop") return;

      const now = new Date();
      if (mutation === "insert") {
        await tx.insert(externalApiKeyUsage).values({
          apiKeyId,
          sourceRef,
          userId: params.userId,
          amount,
          status: "refunded",
          createdAt: now,
          updatedAt: now,
          refundedAt: now,
        });
      } else {
        const [transitioned] = await tx
          .update(externalApiKeyUsage)
          .set({
            status: "refunded",
            refundedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(externalApiKeyUsage.apiKeyId, apiKeyId),
              eq(externalApiKeyUsage.sourceRef, sourceRef),
              eq(externalApiKeyUsage.status, "reserved")
            )
          )
          .returning({ sourceRef: externalApiKeyUsage.sourceRef });
        if (!transitioned) {
          throw new Error("API Key 配额退款状态迁移失败");
        }
      }

      const [updated] = await tx
        .update(externalApiKey)
        .set({
          creditsUsed: sql`GREATEST(0, ${externalApiKey.creditsUsed} - ${amount})`,
          updatedAt: now,
        })
        .where(eq(externalApiKey.id, apiKeyId))
        .returning({ id: externalApiKey.id });
      if (!updated) {
        throw new Error("API Key 配额退款失败");
      }
    });
    return;
  }

  await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`GREATEST(0, ${externalApiKey.creditsUsed} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, apiKeyId),
        eq(externalApiKey.userId, params.userId)
      )
    );
  return;
}
