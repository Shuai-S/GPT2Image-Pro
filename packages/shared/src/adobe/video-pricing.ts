/**
 * Adobe Firefly 视频计费（纯函数，DB-free，可单测）。
 *
 * 口径：统一基价 = 每秒 N 积分（默认 30），按模型族倍率缩放：
 *   credits = ceil2(basePerSecond × durationSeconds × modelMultiplier)
 * basePerSecond 与 per-model 倍率由系统设置提供（VIDEO_BASE_CREDITS_PER_SECOND /
 * VIDEO_MODEL_MULTIPLIERS）；本模块只做纯计算与倍率解析，不读 DB。
 * 使用方：视频生成扣费（operations 侧），扣费须带幂等 sourceRef。
 */

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
