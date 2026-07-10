/**
 * 用户订阅写入服务。
 *
 * 供支付回调、本地支付履约和后台套餐管理共用，依赖 subscription.userId
 * 唯一约束把同一用户的并发创建收敛为单行更新。
 */

import { randomUUID } from "node:crypto";
import { db } from "@repo/database";
import { type Subscription, subscription } from "@repo/database/schema";
import { sql } from "drizzle-orm";

/** 冲突更新时计费周期的处理策略。 */
export type SubscriptionPeriodConflictPolicy =
  | "replace"
  | "preserve_same_subscription";

/** 单次订阅写入所需的、已由调用方规范化的数据。 */
export interface UpsertUserSubscriptionInput {
  /** 订阅归属用户 ID。 */
  userId: string;
  /** 支付渠道或人工管理生成的订阅 ID。 */
  subscriptionId: string;
  /** 用于映射站内套餐的价格 ID。 */
  priceId: string;
  /** 当前订阅状态。 */
  status: string;
  /** 当前计费周期开始时间；永久订阅等无周期场景可为空。 */
  currentPeriodStart: Date | null;
  /** 当前计费周期结束时间；永久订阅等无期限场景可为空。 */
  currentPeriodEnd: Date | null;
  /** 是否在当前周期结束时取消。 */
  cancelAtPeriodEnd: boolean;
  /**
   * 同一用户冲突时的计费周期策略。默认 replace，适合会刷新周期的订阅事件；
   * 本地单次支付可选 preserve_same_subscription，防止并发重放延长首次周期。
   */
  periodConflictPolicy?: SubscriptionPeriodConflictPolicy;
}

/**
 * 按用户创建或更新唯一订阅记录。
 *
 * @param input - 已完成渠道校验和日期转换的订阅数据。
 * @returns 数据库实际插入或更新后的完整订阅记录。
 * @throws 数据库写入失败，或数据库未返回写入记录时抛出异常。
 * @sideeffect 写入 subscription 表；冲突更新刻意不包含 id 与 createdAt，
 * 从而保留既有记录身份和创建时间。该函数要求数据库已存在 userId 唯一约束。
 */
export async function upsertUserSubscription(
  input: UpsertUserSubscriptionInput
): Promise<Subscription> {
  const now = new Date();
  const { periodConflictPolicy = "replace", ...subscriptionValues } = input;
  const preserveSameSubscriptionPeriod =
    periodConflictPolicy === "preserve_same_subscription";
  const [savedSubscription] = await db
    .insert(subscription)
    .values({
      id: randomUUID(),
      ...subscriptionValues,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscription.userId,
      set: {
        subscriptionId: input.subscriptionId,
        priceId: input.priceId,
        status: input.status,
        currentPeriodStart: preserveSameSubscriptionPeriod
          ? sql`CASE WHEN ${subscription.subscriptionId} = excluded.subscription_id THEN ${subscription.currentPeriodStart} ELSE excluded.current_period_start END`
          : input.currentPeriodStart,
        currentPeriodEnd: preserveSameSubscriptionPeriod
          ? sql`CASE WHEN ${subscription.subscriptionId} = excluded.subscription_id THEN ${subscription.currentPeriodEnd} ELSE excluded.current_period_end END`
          : input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        updatedAt: now,
      },
    })
    .returning();

  if (!savedSubscription) {
    throw new Error("Subscription upsert did not return a record");
  }

  return savedSubscription;
}
