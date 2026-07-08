/**
 * Adobe Firefly 视频计费（纯函数，DB-free，可单测）。
 *
 * 口径：统一基价 = 每秒 N 积分（默认 30），按模型族倍率缩放：
 *   credits = ceil2(basePerSecond × durationSeconds × modelMultiplier)
 * basePerSecond 与 per-model 倍率由系统设置提供（VIDEO_BASE_CREDITS_PER_SECOND /
 * VIDEO_MODEL_MULTIPLIERS）；本模块只做纯计算与倍率解析，不读 DB。
 * 使用方：视频生成扣费（operations 侧），扣费须带幂等 sourceRef。
 */

import {
  type PricingSnapshot,
  resolveModelPricing,
} from "../model-pricing";

export const DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND = 30;

// 向上取到 2 位小数，避免计费下溢（与积分 decimal(2) 一致）。先把 value×100 四舍五入
// 到整数分以消除浮点噪声（如 199.95000000000002），再向上取整，避免噪声把恰好 2 位的
// 金额误抬一分。
function ceil2(value: number): number {
  const cents = Math.round(value * 1_000_000) / 10_000; // = value×100，去噪
  const result = Math.ceil(cents - 1e-9) / 100;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * 解析某模型族的倍率：从配置 map 取，缺省/非法/非正数回退 1。
 */
export function resolveVideoModelMultiplier(
  family: string | null | undefined,
  multipliers: Record<string, number> | null | undefined
): number {
  if (!family || !multipliers) return 1;
  const value = multipliers[family];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

/**
 * 计算一次视频生成的积分成本。
 * @param durationSeconds 视频时长（秒）。
 * @param basePerSecond 每秒基价（缺省 30）。
 * @param modelMultiplier 模型族倍率（缺省 1）。
 */
export function getVideoCreditCost(params: {
  durationSeconds: number;
  basePerSecond?: number | null;
  modelMultiplier?: number | null;
}): number {
  const base =
    typeof params.basePerSecond === "number" &&
    Number.isFinite(params.basePerSecond) &&
    params.basePerSecond > 0
      ? params.basePerSecond
      : DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND;
  const multiplier =
    typeof params.modelMultiplier === "number" &&
    Number.isFinite(params.modelMultiplier) &&
    params.modelMultiplier > 0
      ? params.modelMultiplier
      : 1;
  const duration = Math.max(0, params.durationSeconds || 0);
  return ceil2(base * duration * multiplier);
}

/**
 * 把基础视频成本叠加 Adobe 后端计费倍率（组倍率已合入该值），向上取整并非负。
 * 与扣费侧（video-operations）共用同一口径，确保前端预估与实际扣费完全一致。
 * @param baseCost getVideoCreditCost 的产物。
 * @param backendMultiplier config.backend.billingMultiplier（缺省 1）。
 */
export function applyVideoBackendMultiplier(
  baseCost: number,
  backendMultiplier?: number | null
): number {
  const multiplier =
    typeof backendMultiplier === "number" &&
    Number.isFinite(backendMultiplier) &&
    backendMultiplier > 0
      ? backendMultiplier
      : 1;
  return Math.max(0, Math.ceil(baseCost * multiplier));
}

/**
 * 使用统一模型定价引擎计算视频生成积分。
 *
 * WHY：视频旧口径是 `ceil2(每秒基价 × 时长 × 模型族倍率)` 后再叠 Adobe 后端
 * 倍率并向上取整。这里把模型族倍率预先折入 creditsPerSecond，再交给
 * resolveModelPricing 的 baseRoundingMode / roundingMode，保持旧结果不变，同时
 * 产出 pricingSnapshot 供 video_generation.metadata 和账本排查使用。
 *
 * @param params 视频模型、族、时长、基础价格和倍率上下文。
 * @returns 最终扣费、旧口径基础价和可落库快照。
 */
export function resolveVideoModelPricing(params: {
  model: string;
  family: string;
  durationSeconds: number;
  basePerSecond?: number | null;
  modelMultiplier?: number | null;
  backendMultiplier?: number | null;
  groupId?: string | null;
}): {
  baseCostCredits: number;
  finalCredits: number;
  pricingSnapshot: PricingSnapshot;
} {
  const base =
    typeof params.basePerSecond === "number" &&
    Number.isFinite(params.basePerSecond) &&
    params.basePerSecond > 0
      ? params.basePerSecond
      : DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND;
  const modelMultiplier =
    typeof params.modelMultiplier === "number" &&
    Number.isFinite(params.modelMultiplier) &&
    params.modelMultiplier > 0
      ? params.modelMultiplier
      : 1;
  const result = resolveModelPricing({
    rules: [
      {
        id: "video-generation.firefly",
        scope: {
          family: params.family,
          modality: "video",
        },
        billingMode: "per_call",
        perCall: {
          creditsPerSecond: base * modelMultiplier,
        },
        baseRoundingMode: "ceil_2dp",
        roundingMode: "ceil_integer",
        enabled: true,
      },
    ],
    query: {
      model: params.model,
      family: params.family,
      modality: "video",
      groupId: params.groupId ?? null,
    },
    perCallUsage: {
      durationSeconds: Math.max(0, params.durationSeconds || 0),
    },
    backendMultiplier: params.backendMultiplier ?? null,
  });

  if (!result) {
    throw new Error("无法解析视频模型定价规则");
  }

  return {
    baseCostCredits: result.baseCostCredits,
    finalCredits: result.finalCredits,
    pricingSnapshot: result.pricingSnapshot,
  };
}
