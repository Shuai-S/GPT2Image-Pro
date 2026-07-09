import "server-only";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { logWarn } from "@repo/shared/logger";
import { desc, inArray } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";

export {
  classifyGenerationError,
  type GenerationErrorCategory,
} from "./sla-classification";

import { classifyGenerationError } from "./sla-classification";

export type GenerationSlaStats = {
  sampleSize: number;
  completed: number;
  failed: number;
  successRate: number;
  platformErrors: number;
  moderationErrors: number;
  userRequestErrors: number;
};

/** unstable_cache 的 tag,用于生成完成后 revalidateTag 失效首页 SLA 缓存。 */
export const SLA_STATS_CACHE_TAG = "sla-stats";

/**
 * 构造无可用样本时的 SLA 快照。
 *
 * @returns 样本与错误计数均为零的独立对象。
 * @sideEffects 无。
 */
function createEmptyGenerationSlaStats(): GenerationSlaStats {
  return {
    sampleSize: 0,
    completed: 0,
    failed: 0,
    successRate: 1,
    platformErrors: 0,
    moderationErrors: 0,
    userRequestErrors: 0,
  };
}

/**
 * 实际扫描最近生成记录并聚合 SLA 指标的查询(无缓存)。
 *
 * @param limit 抽取的最近已完成记录数上限。
 * @returns 成败计数与错误分类统计。
 * @sideEffects 全表扫描 generation(按 createdAt desc 取最近 limit 条 completed/failed),
 *             扫描成本随 limit 线性增长;调用方应避免高频触发,统一走缓存包装器。
 */
async function queryRecentGenerationSlaStats(
  limit: number
): Promise<GenerationSlaStats> {
  // 样本只取已完结记录(completed/failed):pending 在途任务既不属于成功也
  // 不属于失败,混进样本会让"样本数"与各分类卡片的合计对不上(差额即在途数)。
  const rows = await db
    .select({
      status: generation.status,
      error: generation.error,
    })
    .from(generation)
    .where(inArray(generation.status, ["completed", "failed"]))
    .orderBy(desc(generation.createdAt))
    .limit(limit);

  let completed = 0;
  let failed = 0;
  let platformErrors = 0;
  let moderationErrors = 0;
  let userRequestErrors = 0;

  for (const row of rows) {
    if (row.status === "completed") {
      completed += 1;
      continue;
    }
    if (row.status !== "failed") continue;

    failed += 1;
    const category = classifyGenerationError(row.error);
    if (category === "moderation") {
      moderationErrors += 1;
    } else if (category === "user_request") {
      userRequestErrors += 1;
    } else {
      platformErrors += 1;
    }
  }

  const denominator = completed + platformErrors;
  const successRate = denominator > 0 ? completed / denominator : 1;

  return {
    sampleSize: rows.length,
    completed,
    failed,
    successRate,
    platformErrors,
    moderationErrors,
    userRequestErrors,
  };
}

/**
 * 读取最近生成记录的 SLA 聚合指标(带缓存)。
 *
 * WHY: 首页每次访问都全表扫描最近 1000 条 generation 行,无缓存时既慢又压 DB。
 * 用 unstable_cache 包一层(60s TTL + tag 失效),首页重复访问秒开;生成完成
 * 后通过 revalidateTag(SLA_STATS_CACHE_TAG) 即可让首页在下次请求前刷新。
 *
 * 包装在 unstable_cache 外层,内部仍调用 queryRecentGenerationSlaStats。
 * 参数兼容:透传 limit(number 可序列化),不同 limit 值会命中不同的缓存条目
 * (key 含 limit)。回调内不返回函数,只返回纯数据对象。
 *
 * @param limit 抽取的最近已完成记录数上限,默认 1000。
 * @returns 缓存命中或新算的 SLA 指标对象。
 * @sideEffects 命中缓存时不查 DB;未命中时执行全表扫描聚合查询。
 */
export const getRecentGenerationSlaStats = unstable_cache(
  async (limit = 1000): Promise<GenerationSlaStats> => {
    if (process.env.GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB === "1") {
      return createEmptyGenerationSlaStats();
    }

    try {
      return await queryRecentGenerationSlaStats(limit);
    } catch (error) {
      logWarn("SLA stats query unavailable; using an empty snapshot", {
        source: "sla-stats",
        error: error instanceof Error ? error.message : String(error),
      });
      return createEmptyGenerationSlaStats();
    }
  },
  ["sla-recent-stats"],
  { revalidate: 60, tags: [SLA_STATS_CACHE_TAG] }
);

/**
 * 失效首页 SLA 聚合缓存。
 *
 * WHY: 图像生成成功/失败后会写入 generation 行,首页 SLA 卡片依赖这些数据。
 * 在生成完成后主动 revalidateTag 让首页在下次请求前刷新,避免最长 60s TTL
 * 造成的滞后;散落在异常路径上的零散 generation 写入不接入,靠 60s TTL 兜底。
 *
 * 调用方包括 route handler 与 server action。revalidateTag 在两者上下文均可调,
 * 但若在不允许的边缘上下文(如构建期)触发会抛错,故包一层 try/catch 降级,
 * 仅记日志,绝不中断生成主流程——缓存新旧的代价远小于生成失败。
 *
 * @sideEffects 通过 revalidateTag 标记 SLA_STATS_CACHE_TAG 为待失效。
 */
export function invalidateSlaStatsCache() {
  try {
    // Next 16 要求显式 profile:"max" 表示立即彻底失效(等价旧单参语义)。
    revalidateTag(SLA_STATS_CACHE_TAG, "max");
  } catch (error) {
    // 缓存失效失败不阻断主路径;60s TTL 仍会自然刷新。
    console.warn("[sla] invalidateSlaStatsCache failed", error);
  }
}
