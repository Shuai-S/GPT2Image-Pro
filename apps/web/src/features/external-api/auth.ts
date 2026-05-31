import { db } from "@repo/database";
import { externalApiKey, user } from "@repo/database/schema";
import {
  isModerationBlockRiskLevel,
  type ModerationBlockRiskLevel,
} from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { logWarn } from "@repo/shared/logger";
import { checkRateLimit } from "@repo/shared/rate-limit";
import { and, eq } from "drizzle-orm";

import { getBearerToken, hashApiKey, safeEqual } from "./auth-token";

/**
 * 单 key 滑窗限流标识前缀。
 *
 * WHY：per-IP 限流（getClientIp）以来源 IP 为桶，无法约束「同一 key 从多 IP /
 * 同 IP 高频」打满上游配额、刷高中转成本的滥用。此处以 apiKey.id 为独立标识，
 * 与 per-IP 限流互不干扰，形成第二道与 IP 解耦的成本闸门。
 * 复用既有 "ai" 桶（成本敏感类型，d2a51f4 已对其内存兜底 fail-closed），
 * 阈值由 RATE_LIMIT_AI_REQUESTS_PER_MINUTE 配置，宽松默认 20 次/分钟，
 * 正常调用无感，仅拦截单 key 的异常高频。
 */
const EXTERNAL_KEY_RATE_LIMIT_PREFIX = "external-key:";

export async function authenticateExternalApiRequest(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const keyHash = hashApiKey(token);
  const keys = await db
    .select({
      id: externalApiKey.id,
      userId: externalApiKey.userId,
      keyHash: externalApiKey.keyHash,
      moderationBlockRiskLevel: externalApiKey.moderationBlockRiskLevel,
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
      relayOnly: externalApiKey.relayOnly,
      userBanned: user.banned,
    })
    .from(externalApiKey)
    .innerJoin(user, eq(user.id, externalApiKey.userId))
    .where(
      and(eq(externalApiKey.keyHash, keyHash), eq(externalApiKey.isActive, true))
    )
    .limit(1);

  const apiKey = keys[0];
  if (!apiKey || apiKey.userBanned || !safeEqual(keyHash, apiKey.keyHash)) {
    return null;
  }

  const plan = await getUserPlan(apiKey.userId);

  // 请求期复核纯中转权限：套餐降级后立即失效（不依赖降级钩子重置 DB 列）。
  // 失去 externalApi.relay 能力的 key 退回普通模式（仍记录/存储），不报错。
  const relayOnly =
    apiKey.relayOnly === true &&
    (await canUsePlanCapability(plan.plan, "externalApi.relay"));

  // per-key 滑窗限流：鉴权通过后、返回上下文前施加，仅拦截已认证 key 的异常高频。
  // WHY：放在鉴权 funnel 末端而非各 handler，可单点覆盖全部 v1 路径
  // （含 relayOnly / 计费路径）；超限直接返回 null，复用各 handler 既有的
  // `if (!auth)` 短路，使请求在任何上游调用 / 扣费前被拒，杜绝单 key 刷上游成本。
  // 残留：受限于只能改本文件，调用方将其映射为 401 而非语义更准的 429；
  // 区分日志（下方 logWarn）保证可观测，后续可由调用方升级为 429 + 阈值配置化。
  const rateLimit = await checkRateLimit(
    `${EXTERNAL_KEY_RATE_LIMIT_PREFIX}${apiKey.id}`,
    "ai"
  );
  if (!rateLimit.success) {
    // 不吞限流事件：以告警级别记录，便于与真实鉴权失败区分并支撑限流监控。
    // 仅记 key/user 标识与限流元数据，绝不记录 token / 明文密钥。
    logWarn("External API key rate limit exceeded", {
      source: "external-api-auth",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      limit: rateLimit.limit,
      reset: rateLimit.reset,
    });
    return null;
  }

  await db
    .update(externalApiKey)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(externalApiKey.id, apiKey.id));

  return {
    apiKeyId: apiKey.id,
    userId: apiKey.userId,
    plan: plan.plan,
    moderationBlockRiskLevel: (
      isModerationBlockRiskLevel(apiKey.moderationBlockRiskLevel)
        ? apiKey.moderationBlockRiskLevel
        : "low"
    ) satisfies ModerationBlockRiskLevel,
    creditLimit: apiKey.creditLimit ?? null,
    creditsUsed: Number(apiKey.creditsUsed || 0),
    relayOnly,
  };
}
