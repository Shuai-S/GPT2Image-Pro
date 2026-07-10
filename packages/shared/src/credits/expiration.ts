/**
 * 积分过期批处理的有界汇总器。
 *
 * 职责：驱动分页处理函数直到积压清空，并把每页结果压缩为固定上限明细。
 * 使用方：credits/core.ts 的数据库批处理；测试可在不加载数据库的情况下验证
 * 十万级积压不会形成无界结果数组。
 * 关键依赖：无，保持 DB-free，便于覆盖分页、金额累计与截断边界。
 */

/** 单个数据库事务最多处理的过期批次数。 */
export const CREDITS_EXPIRATION_PAGE_SIZE = 500;

/** 单次调用最多向日志和接口返回的批次明细数。 */
export const CREDITS_EXPIRATION_DETAIL_LIMIT = 100;

/** 单条已结算的过期积分批次。 */
export interface ExpiredCreditsBatchDetail {
  batchId: string;
  userId: string;
  expiredAmount: number;
}

/** 单页事务的结算结果。 */
export interface ExpiredCreditsPageResult {
  processedCount: number;
  totalExpired: number;
  balanceUpdates: number;
  details: ExpiredCreditsBatchDetail[];
}

/** 一次过期处理调用的有界汇总结果。 */
export interface ExpiredCreditsProcessingSummary {
  processedCount: number;
  totalExpired: number;
  batchCount: number;
  balanceUpdates: number;
  details: ExpiredCreditsBatchDetail[];
  detailsTruncated: boolean;
}

/** 单个用户在一页事务中应扣减的过期积分总额。 */
export interface ExpiredCreditsUserTotal {
  userId: string;
  amount: number;
}

/**
 * 把积分总额收敛到数据库 numeric(18,2) 的两位小数精度。
 *
 * @param amount 待收敛的积分总额。
 * @returns 两位小数的有限数值。
 * @throws 输入不是有限数值时抛错，避免对账汇总静默产生 NaN。
 * @sideEffects 无。
 */
function normalizeExpiredCreditsTotal(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error("过期积分汇总必须是有效数字");
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * 按用户汇总一页过期批次的剩余积分。
 *
 * @param batches 已锁定或已条件更新成功的批次用户与剩余金额。
 * @returns userId 字典序排列的两位小数汇总，供确定性锁序和集合更新复用。
 * @throws 任一剩余金额不是正的有限数值时抛错，阻止异常账本继续结算。
 * @sideEffects 无。
 */
export function summarizeExpiredCreditsByUser(
  batches: ReadonlyArray<{ userId: string; remaining: number }>
): ExpiredCreditsUserTotal[] {
  const totals = new Map<string, number>();
  for (const batch of batches) {
    if (!Number.isFinite(batch.remaining) || batch.remaining <= 0) {
      throw new Error("过期积分批次包含非法剩余金额");
    }
    totals.set(
      batch.userId,
      normalizeExpiredCreditsTotal(
        (totals.get(batch.userId) ?? 0) + batch.remaining
      )
    );
  }
  return [...totals]
    .sort(([leftUserId], [rightUserId]) =>
      leftUserId < rightUserId ? -1 : leftUserId > rightUserId ? 1 : 0
    )
    .map(([userId, amount]) => ({ userId, amount }));
}

/**
 * 校验锁定的余额快照能精确覆盖本页过期金额。
 *
 * @param totals 每用户待扣减总额。
 * @param balancesByUser 已按确定顺序加行锁的用户余额快照。
 * @returns void。
 * @throws 缺少余额行、余额非法或余额不足时抛错，调用事务必须整页回滚。
 * @sideEffects 无。
 */
export function assertExpiredCreditsBalances(
  totals: readonly ExpiredCreditsUserTotal[],
  balancesByUser: ReadonlyMap<string, number>
): void {
  for (const total of totals) {
    const balance = balancesByUser.get(total.userId);
    if (balance === undefined) {
      throw new Error(`用户 ${total.userId} 缺少积分余额行`);
    }
    if (!Number.isFinite(balance) || balance < total.amount) {
      throw new Error(
        `用户 ${total.userId} 余额 ${balance} 小于待过期积分 ${total.amount}`
      );
    }
  }
}

/**
 * 持续处理过期积分分页，并仅保留固定数量的明细。
 *
 * @param processPage 每次执行一个短事务；返回零条表示当前可领取积压已清空。
 * @returns 全部已提交分页的金额、行数、余额更新次数与有界明细。
 * @throws 分页处理失败或返回非法计数时原样抛错；已提交的前序页保持已提交。
 * @sideEffects 顺序调用 processPage，具体数据库副作用由调用方实现。
 */
export async function drainExpiredCreditsPages(
  processPage: () => Promise<ExpiredCreditsPageResult>
): Promise<ExpiredCreditsProcessingSummary> {
  const summary: ExpiredCreditsProcessingSummary = {
    processedCount: 0,
    totalExpired: 0,
    batchCount: 0,
    balanceUpdates: 0,
    details: [],
    detailsTruncated: false,
  };

  while (true) {
    const page = await processPage();
    if (
      !Number.isInteger(page.processedCount) ||
      page.processedCount < 0 ||
      !Number.isFinite(page.totalExpired) ||
      page.totalExpired < 0 ||
      !Number.isInteger(page.balanceUpdates) ||
      page.balanceUpdates < 0 ||
      page.balanceUpdates > page.processedCount ||
      page.details.length > page.processedCount
    ) {
      throw new Error("过期积分分页返回了非法计数");
    }
    if (page.processedCount === 0) {
      if (
        page.totalExpired !== 0 ||
        page.balanceUpdates !== 0 ||
        page.details.length !== 0
      ) {
        throw new Error("空的过期积分分页包含非零汇总");
      }
      return summary;
    }

    const remainingDetailSlots = Math.max(
      0,
      CREDITS_EXPIRATION_DETAIL_LIMIT - summary.details.length
    );
    summary.details.push(...page.details.slice(0, remainingDetailSlots));
    summary.processedCount += page.processedCount;
    summary.totalExpired = normalizeExpiredCreditsTotal(
      summary.totalExpired + page.totalExpired
    );
    summary.batchCount += 1;
    summary.balanceUpdates += page.balanceUpdates;
    summary.detailsTruncated =
      summary.detailsTruncated ||
      page.details.length > remainingDetailSlots ||
      page.processedCount > page.details.length;
  }
}
