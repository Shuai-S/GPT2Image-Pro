import { db } from "@repo/database";
import { externalApiKey } from "@repo/database/schema";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

import {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  roundQuotaCredits,
} from "./quota-math";

// 纯逻辑已抽到 quota-math.ts（DB-free 可单测），此处 re-export 保持调用方导入路径不变。
export {
  ExternalApiKeyQuotaExceededError,
  getExternalApiKeyQuotaRemaining,
  isExternalApiKeyQuotaExceededError,
  normalizeExternalApiKeyCreditLimit,
} from "./quota-math";

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
    creditsRemaining: getExternalApiKeyQuotaRemaining(
      creditLimit,
      creditsUsed
    ),
  };
}

export async function reserveExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
}) {
  if (!params.apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;

  const [updated] = await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`${externalApiKey.creditsUsed} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
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
    apiKeyId: params.apiKeyId,
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

export async function refundExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
}) {
  if (!params.apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;

  await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`GREATEST(0, ${externalApiKey.creditsUsed} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
        eq(externalApiKey.userId, params.userId)
      )
    );
}
