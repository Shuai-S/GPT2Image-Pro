/**
 * 积分系统核心服务。
 *
 * 职责：实现积分发放、FIFO 消费、过期、退款相关的双重记账和预计算余额维护。
 * 使用方：UOL 积分操作、支付履约、生图结算、管理员动作与余额查询热路径。
 * 关键依赖：Drizzle/PostgreSQL 事务、credits_batch/credits_transaction 账本表、
 * 系统设置与结构化日志；财务写入失败时显式回滚或上抛。
 */

import { db } from "@repo/database";
import {
  type CreditsBatchSource,
  type CreditsTransactionType,
  creditsBalance,
  creditsBatch,
  creditsTransaction,
} from "@repo/database/schema";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { logEvent } from "../logger/index";
import { getRuntimeSettingNumber } from "../system-settings";
import { CREDIT_CONFIG_DEFAULTS } from "./config";
import {
  assertExpiredCreditsBalances,
  CREDITS_EXPIRATION_PAGE_SIZE,
  drainExpiredCreditsPages,
  type ExpiredCreditsPageResult,
  summarizeExpiredCreditsByUser,
} from "./expiration";
import {
  isUniqueConstraintViolation,
  readConsumedBatchesFromMetadata,
} from "./idempotency";

const CREDIT_DECIMAL_PLACES = 2;
const CREDIT_DECIMAL_FACTOR = 10 ** CREDIT_DECIMAL_PLACES;

function creditBatchSourcePriorityOrder() {
  return sql`CASE ${creditsBatch.sourceType}
    WHEN 'bonus' THEN 1
    WHEN 'subscription' THEN 2
    WHEN 'purchase' THEN 3
    ELSE 4
  END`;
}

function creditBatchExpiryOrder() {
  return sql`${creditsBatch.expiresAt} IS NULL`;
}

async function getDefaultCreditsExpiryDate(issuedAt: Date) {
  const expiryDays = await getRuntimeSettingNumber(
    "CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
    { nonNegative: true }
  );
  if (expiryDays <= 0) return null;
  return new Date(issuedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

async function getFreeCreditsExpiryDays() {
  return getRuntimeSettingNumber(
    "FREE_CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.freeCreditsExpiryDays,
    { positive: true }
  );
}

async function getFreeCreditsExpiryDate(issuedAt: Date) {
  const expiryDays = await getFreeCreditsExpiryDays();
  return new Date(issuedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

function normalizeCreditAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    throw new Error("积分数量必须是有效数字");
  }
  return (
    Math.round((amount + Number.EPSILON) * CREDIT_DECIMAL_FACTOR) /
    CREDIT_DECIMAL_FACTOR
  );
}

// ============================================
// 类型定义
// ============================================

/**
 * 发放积分参数
 */
export interface GrantCreditsParams {
  /** 用户 ID */
  userId: string;
  /** 积分数量 */
  amount: number;
  /** 来源类型 */
  sourceType: CreditsBatchSource;
  /** 借方账户（资金来源） */
  debitAccount: string;
  /** 交易类型 */
  transactionType: CreditsTransactionType;
  /** 过期时间，默认按系统积分有效期计算 */
  expiresAt?: Date | null;
  /** 来源引用（如订单 ID） */
  sourceRef?: string;
  /** 描述 */
  description?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 消费积分参数
 */
export interface ConsumeCreditsParams {
  /** 用户 ID */
  userId: string;
  /** 消费数量 */
  amount: number;
  /** 服务名称 */
  serviceName: string;
  /** 描述 */
  description?: string;
  /**
   * 来源引用（幂等键）。传入后，同一 (consumption, sourceRef) 只扣费一次：
   * 重试/并发的重复扣费会被偏唯一索引拒绝并安全跳过，返回首次扣费结果。
   * 不传则行为与历史一致（不幂等）。
   */
  sourceRef?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 积分消费结果
 */
export interface ConsumeCreditsResult {
  /** 是否成功 */
  success: boolean;
  /** 实际消费数量 */
  consumedAmount: number;
  /** 剩余余额 */
  remainingBalance: number;
  /** 交易 ID */
  transactionId: string;
  /** 消费的批次详情 */
  consumedBatches: Array<{
    batchId: string;
    consumedFromBatch: number;
  }>;
  /** 是否为幂等命中（重复 sourceRef，未实际再次扣费） */
  alreadyConsumed?: boolean;
}

/**
 * 套餐升级作废旧订阅积分参数
 */
export interface VoidSubscriptionCreditsForUpgradeParams {
  /** 用户 ID */
  userId: string;
  /** 新套餐积分批次 sourceRef，避免刚发放的新积分被作废 */
  newBatchSourceRef?: string;
  /** 订阅 ID */
  subscriptionId?: string;
  /** 旧套餐价格 ID */
  upgradeFromPriceId?: string;
  /** 新套餐价格 ID */
  upgradeToPriceId?: string;
  /** 只作废此时间之前发放的订阅积分，避免重复回调误扣后续周期积分 */
  issuedBefore?: Date;
  /** 描述 */
  description?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 积分余额错误
 */
export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number
  ) {
    super(`积分不足: 需要 ${required}，可用 ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * 账户冻结错误
 */
export class AccountFrozenError extends Error {
  constructor(userId: string) {
    super(`用户 ${userId} 的积分账户已被冻结`);
    this.name = "AccountFrozenError";
  }
}

// ============================================
// 核心函数
// ============================================

/**
 * 确保用户有积分账户
 *
 * 如果账户不存在则创建
 */
export async function ensureCreditsBalance(userId: string) {
  const [existing] = await db
    .select()
    .from(creditsBalance)
    .where(eq(creditsBalance.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [newBalance] = await db
    .insert(creditsBalance)
    .values({
      id: crypto.randomUUID(),
      userId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      status: "active",
    })
    .onConflictDoNothing({
      target: creditsBalance.userId,
    })
    .returning();

  if (newBalance) {
    return newBalance;
  }

  // 并发首次访问同一用户时，唯一索引可能让另一个请求赢得插入。
  // 冲突不代表失败，重新读取即可得到已创建的账户。
  const [concurrentBalance] = await db
    .select()
    .from(creditsBalance)
    .where(eq(creditsBalance.userId, userId))
    .limit(1);

  if (!concurrentBalance) {
    throw new Error("创建积分账户失败");
  }

  return concurrentBalance;
}

/**
 * 获取用户积分余额
 */
export async function getCreditsBalance(userId: string) {
  await processExpiredBatches({ userId });
  return await ensureCreditsBalance(userId);
}

/**
 * 确保用户获得注册奖励
 *
 * 懒加载机制：
 * 1. 检查用户是否已经领过注册奖励
 * 2. 如果没有注册奖励交易，补发注册奖励
 * 3. 这种方式比在注册时发放更安全，避免 Auth Hook 失败导致的问题
 *
 * @param userId 用户 ID
 * @param bonusAmount 注册奖励积分数量
 */
export async function ensureRegistrationBonus(
  userId: string,
  bonusAmount: number
) {
  const [existingTransaction] = await db
    .select({ id: creditsTransaction.id })
    .from(creditsTransaction)
    .where(
      and(
        eq(creditsTransaction.userId, userId),
        eq(creditsTransaction.type, "registration_bonus")
      )
    )
    .limit(1);

  if (existingTransaction) {
    await ensureRegistrationBonusExpiry(userId);
    return { granted: false, reason: "Registration bonus already granted" };
  }

  const issuedAt = new Date();
  const result = await grantCredits({
    userId,
    amount: bonusAmount,
    sourceType: "bonus",
    debitAccount: "SYSTEM:registration_bonus",
    transactionType: "registration_bonus",
    expiresAt: await getFreeCreditsExpiryDate(issuedAt),
    sourceRef: `registration_bonus:${userId}`,
    description: "新用户注册奖励",
    metadata: {
      bonusType: "registration",
      grantedAt: issuedAt.toISOString(),
    },
  });

  return {
    granted: true,
    ...result,
  };
}

/**
 * 注册奖励积分默认 7 天过期。保留这个修正逻辑可以让之前被设为
 * 永不过期的活跃注册奖励批次，在用户下次读取余额时自动改回 7 天有效期。
 */
export async function ensureRegistrationBonusExpiry(userId: string) {
  const sourceRef = `registration_bonus:${userId}`;
  const expiryDays = await getFreeCreditsExpiryDays();

  const updatedBatches = await db
    .update(creditsBatch)
    .set({
      expiresAt: sql`${creditsBatch.issuedAt} + (${expiryDays} * interval '1 day')`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditsBatch.userId, userId),
        eq(creditsBatch.sourceType, "bonus"),
        eq(creditsBatch.status, "active"),
        or(
          eq(creditsBatch.sourceRef, sourceRef),
          isNull(creditsBatch.sourceRef)
        ),
        or(
          isNull(creditsBatch.expiresAt),
          gt(
            creditsBatch.expiresAt,
            sql`${creditsBatch.issuedAt} + (${expiryDays} * interval '1 day')`
          )
        )
      )
    )
    .returning({ id: creditsBatch.id });

  if (updatedBatches.length > 0) {
    await processExpiredBatches({ userId });
  }
}

/**
 * 发放积分
 *
 * 在事务中执行：
 * 1. 创建积分批次
 * 2. 记录交易（双重记账）
 * 3. 更新余额
 */
export async function grantCredits(params: GrantCreditsParams) {
  const {
    userId,
    sourceType,
    debitAccount,
    transactionType,
    expiresAt,
    sourceRef,
    description,
    metadata,
  } = params;
  const amount = normalizeCreditAmount(params.amount);

  if (amount <= 0) {
    throw new Error("积分数量必须大于 0");
  }

  return await db.transaction(async (tx) => {
    const [balanceRecord] = await tx
      .select()
      .from(creditsBalance)
      .where(eq(creditsBalance.userId, userId))
      .limit(1);

    let currentBalance = balanceRecord;

    if (!currentBalance) {
      const [newBalance] = await tx
        .insert(creditsBalance)
        .values({
          id: crypto.randomUUID(),
          userId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          status: "active",
        })
        .onConflictDoNothing({
          target: creditsBalance.userId,
        })
        .returning();

      if (newBalance) {
        currentBalance = newBalance;
      } else {
        // 同一用户的首次发放可能并发进入事务，依赖 user_id 唯一索引兜底。
        // 插入冲突后重新读取账户，避免把可恢复的并发竞争暴露为发放失败。
        const [concurrentBalance] = await tx
          .select()
          .from(creditsBalance)
          .where(eq(creditsBalance.userId, userId))
          .limit(1);

        if (!concurrentBalance) {
          throw new Error("创建积分账户失败");
        }

        currentBalance = concurrentBalance;
      }
    }

    if (currentBalance.status === "frozen") {
      throw new AccountFrozenError(userId);
    }

    const issuedAt = new Date();
    const effectiveExpiresAt =
      expiresAt === undefined
        ? sourceType === "bonus"
          ? await getFreeCreditsExpiryDate(issuedAt)
          : await getDefaultCreditsExpiryDate(issuedAt)
        : expiresAt;
    const batchId = crypto.randomUUID();
    const insertedBatch = await tx
      .insert(creditsBatch)
      .values({
        id: batchId,
        userId,
        amount,
        remaining: amount,
        issuedAt,
        expiresAt: effectiveExpiresAt,
        status: "active",
        sourceType,
        sourceRef,
      })
      .onConflictDoNothing({
        target: [creditsBatch.sourceType, creditsBatch.sourceRef],
        where: sql`${creditsBatch.sourceRef} is not null`,
      })
      .returning({ id: creditsBatch.id });

    // 幂等性保障：(sourceType, sourceRef) 唯一索引使重复发放的插入为空。
    // 此时跳过记账与余额累加，避免支付 webhook 重放 / 并发回调 / 注册奖励
    // 重复领取导致的积分双重发放（薅羊毛）。
    if (insertedBatch.length === 0) {
      const [existingBatch] = sourceRef
        ? await tx
            .select({ id: creditsBatch.id })
            .from(creditsBatch)
            .where(
              and(
                eq(creditsBatch.sourceType, sourceType),
                eq(creditsBatch.sourceRef, sourceRef)
              )
            )
            .limit(1)
        : [];
      const [existingTransaction] = sourceRef
        ? await tx
            .select({ id: creditsTransaction.id })
            .from(creditsTransaction)
            .where(
              and(
                eq(creditsTransaction.userId, userId),
                eq(creditsTransaction.type, transactionType),
                eq(creditsTransaction.sourceRef, sourceRef)
              )
            )
            .limit(1)
        : [];

      return {
        batchId: existingBatch?.id ?? null,
        transactionId: existingTransaction?.id ?? null,
        amount: 0,
        newBalance: currentBalance.balance,
        alreadyGranted: true,
      };
    }

    const transactionId = crypto.randomUUID();
    const creditAccount = `WALLET:${userId}`;

    await tx.insert(creditsTransaction).values({
      id: transactionId,
      userId,
      type: transactionType,
      amount,
      debitAccount,
      creditAccount,
      description,
      sourceRef,
      metadata: {
        ...metadata,
        batchId,
        sourceRef,
      },
    });

    await tx
      .update(creditsBalance)
      .set({
        balance: sql`${creditsBalance.balance} + ${amount}`,
        totalEarned: sql`${creditsBalance.totalEarned} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditsBalance.userId, userId));

    // 注意: newBalance 是基于事务开始时快照的预估值，在并发事务下可能不精确。
    // 需要精确余额的调用方应在事务完成后调用 getCreditsBalance()。
    return {
      batchId,
      transactionId,
      amount,
      newBalance: currentBalance.balance + amount,
      alreadyGranted: false,
    };
  });
}

/**
 * 消费积分 (FIFO)
 *
 * 核心 FIFO 逻辑：
 * 1. 获取所有活跃批次，按过期时间升序排列（最早过期的优先消费）
 * 2. 循环扣除直到满足需求
 * 3. 更新批次状态和余额
 * 4. 记录交易
 */
export async function consumeCredits(
  params: ConsumeCreditsParams
): Promise<ConsumeCreditsResult> {
  const { userId, serviceName, description, metadata, sourceRef } = params;
  const amount = normalizeCreditAmount(params.amount);

  if (amount <= 0) {
    throw new Error("消费数量必须大于 0");
  }

  await processExpiredBatches({ userId });

  try {
    return await db.transaction(async (tx) => {
      // 幂等快路：已存在相同 (userId, consumption, sourceRef) 的交易 → 不重复扣费。
      // 覆盖串行重试场景；并发场景由下方偏唯一索引兜底。
      // WHY 必须按 userId 归属：sourceRef 派生自服务端随机 generationId，理论上全局
      // 唯一；但幂等命中会把命中交易的 amount/metadata（consumedBatches）回放给调用方。
      // 若跨用户碰撞（旧的全局 (type, source_ref) 约束允许同一 sourceRef 仅存在一行，
      // 一旦被他人占用，本人的合法扣费会误命中他人交易并返回其金额/批次明细，造成
      // 越权信息泄露且本人实际未扣费）。加 eq(userId) 后只在本人交易内幂等，配合 0029
      // 收窄到 per-user 偏唯一索引，跨用户相同 sourceRef 互不干扰。
      if (sourceRef) {
        const [existing] = await tx
          .select({
            id: creditsTransaction.id,
            amount: creditsTransaction.amount,
            metadata: creditsTransaction.metadata,
          })
          .from(creditsTransaction)
          .where(
            and(
              eq(creditsTransaction.userId, userId),
              eq(creditsTransaction.type, "consumption"),
              eq(creditsTransaction.sourceRef, sourceRef)
            )
          )
          .limit(1);
        if (existing) {
          const [balance] = await tx
            .select({ balance: creditsBalance.balance })
            .from(creditsBalance)
            .where(eq(creditsBalance.userId, userId))
            .limit(1);
          return {
            success: true,
            consumedAmount: existing.amount,
            remainingBalance: balance?.balance ?? 0,
            transactionId: existing.id,
            consumedBatches: readConsumedBatchesFromMetadata(existing.metadata),
            alreadyConsumed: true,
          };
        }
      }

      const [balanceRecord] = await tx
        .select()
        .from(creditsBalance)
        .where(eq(creditsBalance.userId, userId))
        .limit(1);

      if (!balanceRecord) {
        throw new InsufficientCreditsError(amount, 0);
      }

      if (balanceRecord.status === "frozen") {
        throw new AccountFrozenError(userId);
      }

      if (balanceRecord.balance < amount) {
        throw new InsufficientCreditsError(amount, balanceRecord.balance);
      }

      let remainingToConsume = amount;
      const consumedBatches: Array<{
        batchId: string;
        consumedFromBatch: number;
      }> = [];

      while (remainingToConsume > 0) {
        const now = new Date();
        const [batch] = await tx
          .select()
          .from(creditsBatch)
          .where(
            and(
              eq(creditsBatch.userId, userId),
              eq(creditsBatch.status, "active"),
              gt(creditsBatch.remaining, 0),
              or(
                isNull(creditsBatch.expiresAt),
                gt(creditsBatch.expiresAt, now)
              )
            )
          )
          // 扣减顺序:最快到期的批次先扣(在过期作废前尽量用掉),无到期(永久)批次最后扣;
          // 同到期时间再按来源优先级(bonus→subscription→purchase),最后按发放时间。
          .orderBy(
            creditBatchExpiryOrder(),
            asc(creditsBatch.expiresAt),
            creditBatchSourcePriorityOrder(),
            asc(creditsBatch.issuedAt)
          )
          .limit(1);

        if (!batch) {
          break;
        }

        const consumeFromThisBatch = Math.min(
          batch.remaining,
          remainingToConsume
        );
        const newRemainingSql = sql`${creditsBatch.remaining} - ${consumeFromThisBatch}`;
        const nextStatusSql = sql`(CASE WHEN ${newRemainingSql} <= 0 THEN 'consumed' ELSE 'active' END)::credits_batch_status`;

        const [updatedBatch] = await tx
          .update(creditsBatch)
          .set({
            remaining: newRemainingSql,
            status: nextStatusSql,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(creditsBatch.id, batch.id),
              eq(creditsBatch.status, "active"),
              gte(creditsBatch.remaining, consumeFromThisBatch),
              or(
                isNull(creditsBatch.expiresAt),
                gt(creditsBatch.expiresAt, now)
              )
            )
          )
          .returning({ id: creditsBatch.id });

        if (!updatedBatch) {
          continue;
        }

        consumedBatches.push({
          batchId: batch.id,
          consumedFromBatch: consumeFromThisBatch,
        });

        remainingToConsume -= consumeFromThisBatch;
      }

      if (remainingToConsume > 0) {
        throw new InsufficientCreditsError(amount, amount - remainingToConsume);
      }

      const transactionId = crypto.randomUUID();
      const debitAccount = `WALLET:${userId}`;
      const creditAccount = `SERVICE:${serviceName}`;

      // 带 sourceRef 写入：偏唯一索引 (type, source_ref) 使并发重复扣费的第二次
      // INSERT 触发唯一冲突，整个事务回滚（批次扣减一并撤销），由外层 catch 重查兜底。
      await tx.insert(creditsTransaction).values({
        id: transactionId,
        userId,
        type: "consumption",
        amount,
        debitAccount,
        creditAccount,
        description: description ?? `消费于 ${serviceName}`,
        sourceRef,
        metadata: {
          ...metadata,
          serviceName,
          consumedBatches,
        },
      });

      const [updatedBalance] = await tx
        .update(creditsBalance)
        .set({
          balance: sql`${creditsBalance.balance} - ${amount}`,
          totalSpent: sql`${creditsBalance.totalSpent} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditsBalance.userId, userId),
            gte(creditsBalance.balance, amount)
          )
        )
        .returning({ newBalance: creditsBalance.balance });

      if (!updatedBalance) {
        throw new InsufficientCreditsError(amount, balanceRecord.balance);
      }

      return {
        success: true,
        consumedAmount: amount,
        remainingBalance: updatedBalance.newBalance,
        transactionId,
        consumedBatches,
      };
    });
  } catch (error) {
    // 并发兜底：唯一索引冲突表示已被另一并发请求以相同 sourceRef 扣过 →
    // 重查该交易返回幂等结果，避免双重扣费。
    // WHY 同样按 userId 归属：0029 后偏唯一索引为 (user_id, type, source_ref)，冲突
    // 必来自同一用户的并发重复请求，重查须限定本人交易，否则在跨用户碰撞时会回放他人
    // 金额/批次明细（越权）。与上方快路保持一致。
    if (sourceRef && isUniqueConstraintViolation(error)) {
      const [existing] = await db
        .select({
          id: creditsTransaction.id,
          amount: creditsTransaction.amount,
          metadata: creditsTransaction.metadata,
        })
        .from(creditsTransaction)
        .where(
          and(
            eq(creditsTransaction.userId, userId),
            eq(creditsTransaction.type, "consumption"),
            eq(creditsTransaction.sourceRef, sourceRef)
          )
        )
        .limit(1);
      if (existing) {
        const [balance] = await db
          .select({ balance: creditsBalance.balance })
          .from(creditsBalance)
          .where(eq(creditsBalance.userId, userId))
          .limit(1);
        return {
          success: true,
          consumedAmount: existing.amount,
          remainingBalance: balance?.balance ?? 0,
          transactionId: existing.id,
          consumedBatches: readConsumedBatchesFromMetadata(existing.metadata),
          alreadyConsumed: true,
        };
      }
    }
    throw error;
  }
}

/**
 * 套餐升级后作废旧套餐剩余积分。
 *
 * 只处理 sourceType=subscription 的活跃批次，不影响免费积分和按量购买积分。
 * 重复支付回调不会重复扣减，因为已作废批次不再是 active。
 */
export async function voidActiveSubscriptionCreditsForUpgrade(
  params: VoidSubscriptionCreditsForUpgradeParams
) {
  const {
    userId,
    newBatchSourceRef,
    subscriptionId,
    upgradeFromPriceId,
    upgradeToPriceId,
    issuedBefore,
    description,
    metadata,
  } = params;

  return await db.transaction(async (tx) => {
    const batches = await tx
      .select({
        id: creditsBatch.id,
        amount: creditsBatch.amount,
        remaining: creditsBatch.remaining,
        sourceRef: creditsBatch.sourceRef,
        issuedAt: creditsBatch.issuedAt,
        expiresAt: creditsBatch.expiresAt,
      })
      .from(creditsBatch)
      .where(
        and(
          eq(creditsBatch.userId, userId),
          eq(creditsBatch.sourceType, "subscription"),
          eq(creditsBatch.status, "active"),
          gt(creditsBatch.remaining, 0),
          issuedBefore ? lt(creditsBatch.issuedAt, issuedBefore) : sql`true`,
          newBatchSourceRef
            ? sql`${creditsBatch.sourceRef} IS DISTINCT FROM ${newBatchSourceRef}`
            : sql`true`
        )
      )
      .orderBy(
        creditBatchExpiryOrder(),
        asc(creditsBatch.expiresAt),
        asc(creditsBatch.issuedAt)
      );

    const voidedBatches: Array<{
      batchId: string;
      voidedAmount: number;
      sourceRef: string | null;
    }> = [];

    for (const batch of batches) {
      const [voidedBatch] = await tx
        .update(creditsBatch)
        .set({
          status: "expired",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditsBatch.id, batch.id),
            eq(creditsBatch.status, "active"),
            gt(creditsBatch.remaining, 0)
          )
        )
        .returning({
          id: creditsBatch.id,
          amount: creditsBatch.amount,
          remaining: creditsBatch.remaining,
          sourceRef: creditsBatch.sourceRef,
          issuedAt: creditsBatch.issuedAt,
          expiresAt: creditsBatch.expiresAt,
        });

      if (!voidedBatch) continue;

      await tx.insert(creditsTransaction).values({
        id: crypto.randomUUID(),
        userId,
        type: "expiration",
        amount: voidedBatch.remaining,
        debitAccount: `WALLET:${userId}`,
        creditAccount: "SYSTEM:subscription_upgrade",
        description:
          description ?? `套餐升级作废旧订阅积分批次 ${voidedBatch.id}`,
        metadata: {
          ...metadata,
          reason: "subscription_upgrade",
          batchId: voidedBatch.id,
          sourceRef: voidedBatch.sourceRef,
          originalAmount: voidedBatch.amount,
          voidedAmount: voidedBatch.remaining,
          issuedAt: voidedBatch.issuedAt,
          expiresAt: voidedBatch.expiresAt,
          subscriptionId,
          upgradeFromPriceId,
          upgradeToPriceId,
          newBatchSourceRef,
          issuedBefore,
        },
      });

      voidedBatches.push({
        batchId: voidedBatch.id,
        voidedAmount: voidedBatch.remaining,
        sourceRef: voidedBatch.sourceRef,
      });
    }

    if (voidedBatches.length > 0) {
      const totalVoided = normalizeCreditAmount(
        voidedBatches.reduce((sum, batch) => sum + batch.voidedAmount, 0)
      );

      await tx
        .update(creditsBalance)
        .set({
          balance: sql`GREATEST(0, ${creditsBalance.balance} - ${totalVoided})`,
          updatedAt: new Date(),
        })
        .where(eq(creditsBalance.userId, userId));

      return {
        voidedAmount: totalVoided,
        voidedBatches,
      };
    }

    return {
      voidedAmount: 0,
      voidedBatches,
    };
  });
}

/** 过期批处理的可选用户范围。 */
export interface ProcessExpiredBatchesOptions {
  /** 仅结算指定用户；省略时由全局 worker 并发领取。 */
  userId?: string;
}

/**
 * 从 node-postgres 或 Neon execute 结果中读取行数组。
 *
 * @param result Drizzle execute 返回的未知驱动结果。
 * @returns 仅包含普通对象的结果行；无法识别时返回空数组。
 * @sideEffects 无。
 */
function readExecutedRows(result: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null && "rows" in result
      ? (result as { rows?: unknown }).rows
      : undefined;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null
      )
    : [];
}

/**
 * 在单个短事务中领取并结算一页过期批次。
 *
 * @param cutoff 本次调用固定的到期截止时间，避免处理过程中不断追逐新数据。
 * @param options 可选用户范围；用户热路径不跳锁，全局 worker 使用 SKIP LOCKED。
 * @returns 本页已提交的批次、金额、余额更新数和至多 500 条明细。
 * @throws 余额缺失、余额不足或条件更新数量不一致时回滚整页，禁止账实不平。
 * @sideEffects 更新 credits_batch、批量写 credits_transaction、集合更新余额。
 */
async function processExpiredBatchesPage(
  cutoff: Date,
  options: ProcessExpiredBatchesOptions
): Promise<ExpiredCreditsPageResult> {
  return await db.transaction(async (tx) => {
    const userId = options.userId;
    const query = tx
      .select({
        id: creditsBatch.id,
        userId: creditsBatch.userId,
        amount: creditsBatch.amount,
        remaining: creditsBatch.remaining,
        expiresAt: creditsBatch.expiresAt,
      })
      .from(creditsBatch)
      .where(
        and(
          eq(creditsBatch.status, "active"),
          userId === undefined ? sql`true` : eq(creditsBatch.userId, userId),
          isNotNull(creditsBatch.expiresAt),
          lte(creditsBatch.expiresAt, cutoff),
          gt(creditsBatch.remaining, 0)
        )
      )
      .orderBy(asc(creditsBatch.expiresAt), asc(creditsBatch.id))
      .limit(CREDITS_EXPIRATION_PAGE_SIZE);
    const claimedBatches =
      userId === undefined
        ? await query.for("update", { skipLocked: true })
        : await query.for("update");

    if (claimedBatches.length === 0) {
      return {
        processedCount: 0,
        totalExpired: 0,
        balanceUpdates: 0,
        details: [],
      };
    }

    const claimedTotals = summarizeExpiredCreditsByUser(claimedBatches);
    const lockedBalances = await tx
      .select({
        userId: creditsBalance.userId,
        balance: creditsBalance.balance,
      })
      .from(creditsBalance)
      .where(
        inArray(
          creditsBalance.userId,
          claimedTotals.map((total) => total.userId)
        )
      )
      .orderBy(asc(creditsBalance.userId))
      .for("update");
    const balancesByUser = new Map(
      lockedBalances.map((balance) => [balance.userId, balance.balance])
    );

    assertExpiredCreditsBalances(claimedTotals, balancesByUser);

    const processedAt = new Date();
    const expiredBatches = await tx
      .update(creditsBatch)
      .set({
        status: "expired",
        updatedAt: processedAt,
      })
      .where(
        and(
          inArray(
            creditsBatch.id,
            claimedBatches.map((batch) => batch.id)
          ),
          eq(creditsBatch.status, "active"),
          isNotNull(creditsBatch.expiresAt),
          lte(creditsBatch.expiresAt, cutoff),
          gt(creditsBatch.remaining, 0)
        )
      )
      .returning({
        id: creditsBatch.id,
        userId: creditsBatch.userId,
        amount: creditsBatch.amount,
        remaining: creditsBatch.remaining,
        expiresAt: creditsBatch.expiresAt,
      });

    if (expiredBatches.length !== claimedBatches.length) {
      throw new Error("过期积分批次条件更新数量不一致");
    }

    const expiredTotals = summarizeExpiredCreditsByUser(expiredBatches);
    await tx.insert(creditsTransaction).values(
      expiredBatches.map((batch) => ({
        id: crypto.randomUUID(),
        userId: batch.userId,
        type: "expiration" as const,
        amount: batch.remaining,
        debitAccount: `WALLET:${batch.userId}`,
        creditAccount: "SYSTEM:expired",
        description: `批次 ${batch.id} 过期`,
        sourceRef: `credits_batch_expiration:${batch.id}`,
        metadata: {
          batchId: batch.id,
          originalAmount: batch.amount,
          expiredAmount: batch.remaining,
          expiresAt: batch.expiresAt,
        },
      }))
    );

    const expiredValues = sql.join(
      expiredTotals.map(
        (total) => sql`(${total.userId}, ${total.amount}::numeric)`
      ),
      sql`, `
    );
    const balanceUpdateResult = await tx.execute(sql`
      WITH "expired_totals" ("user_id", "amount") AS (
        VALUES ${expiredValues}
      )
      UPDATE "credits_balance" AS "balance"
      SET
        "balance" = "balance"."balance" - "expired_totals"."amount",
        "updated_at" = ${processedAt}
      FROM "expired_totals"
      WHERE "balance"."user_id" = "expired_totals"."user_id"
        AND "balance"."balance" >= "expired_totals"."amount"
      RETURNING "balance"."user_id"
    `);
    const updatedBalanceUserIds = new Set(
      readExecutedRows(balanceUpdateResult).flatMap((row) =>
        typeof row.user_id === "string" ? [row.user_id] : []
      )
    );
    if (updatedBalanceUserIds.size !== expiredTotals.length) {
      throw new Error("过期积分余额集合更新数量不一致");
    }

    const totalExpired = normalizeCreditAmount(
      expiredTotals.reduce((sum, total) => sum + total.amount, 0)
    );
    return {
      processedCount: expiredBatches.length,
      totalExpired,
      balanceUpdates: expiredTotals.length,
      details: expiredBatches.map((batch) => ({
        batchId: batch.id,
        userId: batch.userId,
        expiredAmount: batch.remaining,
      })),
    };
  });
}

/**
 * 分页处理已到期的活跃积分批次。
 *
 * @param options 可选用户范围；指定用户时等待并发结算，确保随后余额读取不陈旧。
 * @returns 有界汇总：处理行数、金额、事务页数、余额更新次数和最多 100 条明细。
 * @throws 任一页账实校验失败时停止并上抛；已提交的前序页保持幂等终态。
 * @sideEffects 每页使用一个短事务修改批次、账本和预计算余额，并记录汇总日志。
 */
export async function processExpiredBatches(
  options: ProcessExpiredBatchesOptions = {}
) {
  const cutoff = new Date();
  const summary = await drainExpiredCreditsPages(() =>
    processExpiredBatchesPage(cutoff, options)
  );

  if (summary.processedCount > 0) {
    logEvent("credits.expired", {
      count: summary.processedCount,
      totalExpired: summary.totalExpired,
      batchCount: summary.batchCount,
      balanceUpdates: summary.balanceUpdates,
      detailsTruncated: summary.detailsTruncated,
    });
  }

  return summary;
}

/**
 * 获取用户的活跃批次列表
 */
export async function getUserActiveBatches(userId: string) {
  const now = new Date();

  return await db
    .select()
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.userId, userId),
        eq(creditsBatch.status, "active"),
        gt(creditsBatch.remaining, 0),
        or(isNull(creditsBatch.expiresAt), gt(creditsBatch.expiresAt, now))
      )
    )
    .orderBy(
      creditBatchSourcePriorityOrder(),
      creditBatchExpiryOrder(),
      asc(creditsBatch.expiresAt),
      asc(creditsBatch.issuedAt)
    );
}

/**
 * 获取用户的交易历史
 */
export async function getUserTransactions(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
) {
  const { limit = 20, offset = 0 } = options ?? {};

  return await db
    .select()
    .from(creditsTransaction)
    .where(eq(creditsTransaction.userId, userId))
    .orderBy(sql`${creditsTransaction.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}

/**
 * 获取用户交易总数
 */
export async function getUserTransactionsCount(
  userId: string
): Promise<number> {
  const [result] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(creditsTransaction)
    .where(eq(creditsTransaction.userId, userId));

  return result?.count ?? 0;
}

/**
 * 冻结用户积分账户
 */
export async function freezeCreditsAccount(userId: string) {
  await db
    .update(creditsBalance)
    .set({
      status: "frozen",
      updatedAt: new Date(),
    })
    .where(eq(creditsBalance.userId, userId));
}

/**
 * 解冻用户积分账户
 */
export async function unfreezeCreditsAccount(userId: string) {
  await db
    .update(creditsBalance)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(creditsBalance.userId, userId));
}
