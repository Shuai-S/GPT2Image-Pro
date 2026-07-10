/**
 * 积分幂等相关纯工具（不依赖数据库，便于单测）。
 */

/**
 * 从已存在交易的 metadata 中安全解析 consumedBatches。
 * 幂等命中时用于回放首次扣费的批次明细。
 */
export function readConsumedBatchesFromMetadata(
  metadata: unknown
): Array<{ batchId: string; consumedFromBatch: number }> {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { consumedBatches?: unknown }).consumedBatches;
  if (!Array.isArray(raw)) return [];
  const result: Array<{ batchId: string; consumedFromBatch: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const batchId = (item as { batchId?: unknown }).batchId;
    const consumedFromBatch = (item as { consumedFromBatch?: unknown })
      .consumedFromBatch;
    if (typeof batchId === "string" && typeof consumedFromBatch === "number") {
      result.push({ batchId, consumedFromBatch });
    }
  }
  return result;
}

/** Postgres unique_violation (SQLSTATE 23505) 判定（pg / postgres.js 通用）。 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
  );
}

/**
 * 校验同一财务幂等键的金额没有漂移。
 *
 * @param existingAmount 首次落账金额。
 * @param requestedAmount 本次重放请求金额。
 * @throws 两者按积分两位小数规范化后不一致时 fail-closed。
 * @sideEffects 无。
 */
export function assertIdempotentCreditAmount(
  existingAmount: number,
  requestedAmount: number
): void {
  const normalizedExisting = Math.round(existingAmount * 100) / 100;
  const normalizedRequested = Math.round(requestedAmount * 100) / 100;
  if (
    !Number.isFinite(normalizedExisting) ||
    !Number.isFinite(normalizedRequested) ||
    normalizedExisting !== normalizedRequested
  ) {
    throw new Error("同一积分幂等键的金额不一致");
  }
}
