/**
 * 模型定价规则解析与积分计算纯函数。
 *
 * 使用方：后续 server-action、API route、MCP/UOL operation 和生成管线都应先调用本
 * 模块算出应扣 credits，再交给现有 credits_transaction 幂等扣费入口。本文件不读 DB、
 * 不扣费、不记录日志，只输出可写入交易 metadata 的定价快照。
 * 关键依赖：无运行时依赖；所有输入必须由调用方在传入前完成鉴权与业务校验。
 */

export type PricingBillingMode = "token" | "per_call" | "composite";

export type PricingModality =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "multimodal";

export type PricingRoundingMode = "ceil_2dp" | "ceil_integer";

export type PricingRuleScope = {
  model?: string;
  family?: string;
  modality?: PricingModality;
  endpoint?: string;
  groupId?: string;
};

export type TokenPricingConfig = {
  inputCreditsPer1M?: number;
  outputCreditsPer1M?: number;
  cachedInputCreditsPer1M?: number;
  cacheWriteCreditsPer1M?: number;
  imageInputCreditsPer1M?: number;
  audioInputCreditsPer1M?: number;
};

export type PerCallPricingConfig = {
  creditsPerCall?: number;
  creditsPerImage?: number;
  creditsPerSecond?: number;
  creditsPerToolCall?: number;
};

export type ParameterMultiplierConfig = {
  size?: Record<string, number>;
  resolution?: Record<string, number>;
  quality?: Record<string, number>;
  duration?: Record<string, number>;
};

export type ModelPricingRule = {
  id: string;
  scope: PricingRuleScope;
  billingMode: PricingBillingMode;
  token?: TokenPricingConfig;
  perCall?: PerCallPricingConfig;
  multipliers?: ParameterMultiplierConfig;
  minimumChargeCredits?: number;
  baseRoundingMode?: PricingRoundingMode;
  roundingMode: PricingRoundingMode;
  enabled: boolean;
};

export type PricingRuleQuery = {
  model?: string | null;
  family?: string | null;
  modality?: PricingModality | null;
  endpoint?: string | null;
  groupId?: string | null;
};

export type PricingTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  imageInputTokens?: number;
  audioInputTokens?: number;
};

export type PricingPerCallUsage = {
  quantity?: number;
  imageCount?: number;
  durationSeconds?: number;
  toolCallCount?: number;
};

export type PricingParameterKeys = {
  size?: string | null;
  resolution?: string | null;
  quality?: string | null;
  duration?: string | null;
};

export type ResolveModelPricingInput = {
  rules: readonly ModelPricingRule[];
  query: PricingRuleQuery;
  tokenUsage?: PricingTokenUsage;
  perCallUsage?: PricingPerCallUsage;
  parameterKeys?: PricingParameterKeys;
  groupMultiplier?: number | null;
  backendMultiplier?: number | null;
  parameterMultiplier?: number | null;
};

export type PricingRuleMatch = {
  rule: ModelPricingRule;
  priority: number;
};

export type PricingSnapshot = {
  ruleId: string;
  billingMode: PricingBillingMode;
  model: string | null;
  family: string | null;
  modality: PricingModality | null;
  endpoint: string | null;
  groupId: string | null;
  baseCostCredits: number;
  groupMultiplier: number;
  backendMultiplier: number;
  parameterMultiplier: number;
  finalCredits: number;
  usage: {
    token: Required<PricingTokenUsage>;
    perCall: Required<PricingPerCallUsage>;
  };
};

export type ModelPricingResolution = {
  rule: ModelPricingRule;
  baseCostCredits: number;
  groupMultiplier: number;
  backendMultiplier: number;
  parameterMultiplier: number;
  finalCredits: number;
  pricingSnapshot: PricingSnapshot;
};

const ONE_MILLION = 1_000_000;
const ROUNDING_EPSILON = 1e-9;

/**
 * 判断数值是否可用于计费；非有限数和负数都视为 0，避免外部 usage 污染计费。
 * @param value 待收窄的未知数值。
 * @returns 非负有限数；非法值返回 0。
 */
function toNonNegativeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * 规范化倍率；倍率非法时回退 1，避免某个可选维度误配置导致免费或负扣费。
 * @param value 倍率候选值。
 * @returns 正有限倍率，非法值返回 1。
 */
function normalizeMultiplier(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

/**
 * 按规则指定模式向上取整。
 * @param value 原始积分。
 * @param mode 取整模式；图像/文本默认 2 位，旧视频可用整数模式保持兼容。
 * @returns 非负、已取整的积分。
 */
export function roundPricingCredits(
  value: number,
  mode: PricingRoundingMode
): number {
  const safeValue = Math.max(0, toNonNegativeNumber(value));
  const rounded =
    mode === "ceil_integer"
      ? Math.ceil(safeValue - ROUNDING_EPSILON)
      : Math.ceil((safeValue - ROUNDING_EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 用规则集解析当前请求应采用的模型定价规则。
 * @param rules 候选规则，越具体的 scope 优先；同优先级保持数组靠前者优先。
 * @param query 当前请求的模型、族、端点和分组。
 * @returns 命中的规则与优先级；未命中返回 null。
 */
export function resolveModelPricingRule(
  rules: readonly ModelPricingRule[],
  query: PricingRuleQuery
): PricingRuleMatch | null {
  let selected: PricingRuleMatch | null = null;

  for (const rule of rules) {
    const priority = getRulePriority(rule, query);
    if (priority === null) continue;
    if (!selected || priority > selected.priority) {
      selected = { rule, priority };
    }
  }

  return selected;
}

/**
 * 计算一次请求的最终积分并生成可落库的定价快照。
 * @param input 规则集、请求维度、usage 与倍率上下文。
 * @returns 命中规则后的积分明细；无规则时返回 null，由调用方决定 fail-closed 或兜底。
 */
export function resolveModelPricing(
  input: ResolveModelPricingInput
): ModelPricingResolution | null {
  const match = resolveModelPricingRule(input.rules, input.query);
  if (!match) return null;

  const tokenUsage = normalizeTokenUsage(input.tokenUsage);
  const perCallUsage = normalizePerCallUsage(input.perCallUsage);
  const groupMultiplier = normalizeMultiplier(input.groupMultiplier);
  const backendMultiplier = normalizeMultiplier(input.backendMultiplier);
  const parameterMultiplier =
    normalizeMultiplier(input.parameterMultiplier) *
    resolveParameterMultiplier(match.rule, input.parameterKeys);
  const rawBaseCost = calculateBaseCost(match.rule, tokenUsage, perCallUsage);
  const roundedBaseCost =
    match.rule.baseRoundingMode === undefined
      ? rawBaseCost
      : roundPricingCredits(rawBaseCost, match.rule.baseRoundingMode);
  const minimum = toNonNegativeNumber(match.rule.minimumChargeCredits);
  const baseCostCredits = Math.max(roundedBaseCost, minimum);
  const finalCredits = roundPricingCredits(
    baseCostCredits * groupMultiplier * backendMultiplier * parameterMultiplier,
    match.rule.roundingMode
  );
  const pricingSnapshot = buildPricingSnapshot({
    query: input.query,
    rule: match.rule,
    baseCostCredits,
    groupMultiplier,
    backendMultiplier,
    parameterMultiplier,
    finalCredits,
    tokenUsage,
    perCallUsage,
  });

  return {
    rule: match.rule,
    baseCostCredits,
    groupMultiplier,
    backendMultiplier,
    parameterMultiplier,
    finalCredits,
    pricingSnapshot,
  };
}

/**
 * 根据规则 scope 与请求维度计算优先级。
 * @param rule 候选定价规则。
 * @param query 当前请求维度。
 * @returns 可匹配时返回优先级；不匹配或被禁用返回 null。
 */
function getRulePriority(
  rule: ModelPricingRule,
  query: PricingRuleQuery
): number | null {
  if (!rule.enabled || !scopeMatches(rule.scope, query)) return null;

  const hasModel = Boolean(rule.scope.model);
  const hasFamily = Boolean(rule.scope.family);
  const hasModality = Boolean(rule.scope.modality);
  const hasEndpoint = Boolean(rule.scope.endpoint);
  const hasGroup = Boolean(rule.scope.groupId);

  if (hasModel && hasEndpoint && hasGroup) return 600;
  if (hasModel && hasGroup) return 500;
  if (hasModel && hasEndpoint) return 450;
  if (hasModel) return 400;
  if (hasFamily && hasEndpoint && hasGroup) return 350;
  if (hasFamily && hasGroup) return 300;
  if (hasFamily && hasEndpoint) return 250;
  if (hasFamily) return 200;
  if (hasModality) return 100;
  return null;
}

/**
 * 判断规则 scope 中声明的每个维度是否都命中请求。
 * @param scope 规则作用域。
 * @param query 当前请求维度。
 * @returns 全部声明维度都相等时返回 true。
 */
function scopeMatches(scope: PricingRuleScope, query: PricingRuleQuery) {
  return (
    stringFieldMatches(scope.model, query.model) &&
    stringFieldMatches(scope.family, query.family) &&
    stringFieldMatches(scope.endpoint, query.endpoint) &&
    stringFieldMatches(scope.groupId, query.groupId) &&
    (scope.modality === undefined || scope.modality === query.modality)
  );
}

/**
 * 对可选字符串维度做精确匹配。
 * @param expected 规则声明值；未声明表示不限制该维度。
 * @param actual 请求中的实际值。
 * @returns 未声明或精确相等时返回 true。
 */
function stringFieldMatches(
  expected: string | undefined,
  actual: string | null | undefined
) {
  return expected === undefined || expected === actual;
}

/**
 * 规范化 token usage，缺省或非法值均视为 0。
 * @param usage 上游返回或预估的 token usage。
 * @returns 全字段非负数 usage。
 */
function normalizeTokenUsage(
  usage: PricingTokenUsage | undefined
): Required<PricingTokenUsage> {
  return {
    inputTokens: toNonNegativeNumber(usage?.inputTokens),
    outputTokens: toNonNegativeNumber(usage?.outputTokens),
    cachedInputTokens: toNonNegativeNumber(usage?.cachedInputTokens),
    cacheWriteTokens: toNonNegativeNumber(usage?.cacheWriteTokens),
    imageInputTokens: toNonNegativeNumber(usage?.imageInputTokens),
    audioInputTokens: toNonNegativeNumber(usage?.audioInputTokens),
  };
}

/**
 * 规范化按次 usage，缺省 quantity 为 1，其余非法值视为 0。
 * @param usage 请求数量、图片数、时长与工具调用次数。
 * @returns 全字段非负数 usage。
 */
function normalizePerCallUsage(
  usage: PricingPerCallUsage | undefined
): Required<PricingPerCallUsage> {
  return {
    quantity:
      usage?.quantity === undefined ? 1 : toNonNegativeNumber(usage.quantity),
    imageCount: toNonNegativeNumber(usage?.imageCount),
    durationSeconds: toNonNegativeNumber(usage?.durationSeconds),
    toolCallCount: toNonNegativeNumber(usage?.toolCallCount),
  };
}

/**
 * 按规则模式计算基础积分，不包含分组、后端和参数倍率。
 * @param rule 命中的定价规则。
 * @param tokenUsage 已规范化的 token usage。
 * @param perCallUsage 已规范化的按次 usage。
 * @returns 未乘外部倍率的基础积分。
 */
function calculateBaseCost(
  rule: ModelPricingRule,
  tokenUsage: Required<PricingTokenUsage>,
  perCallUsage: Required<PricingPerCallUsage>
) {
  if (rule.billingMode === "token") {
    return calculateTokenCost(rule.token, tokenUsage);
  }
  if (rule.billingMode === "per_call") {
    return calculatePerCallCost(rule.perCall, perCallUsage);
  }
  return (
    calculateTokenCost(rule.token, tokenUsage) +
    calculatePerCallCost(rule.perCall, perCallUsage)
  );
}

/**
 * 计算 token 基础积分。
 * @param config 每百万 token 的积分单价。
 * @param usage 已规范化 token usage。
 * @returns token 基础积分。
 */
function calculateTokenCost(
  config: TokenPricingConfig | undefined,
  usage: Required<PricingTokenUsage>
) {
  return (
    (usage.inputTokens * toNonNegativeNumber(config?.inputCreditsPer1M) +
      usage.outputTokens * toNonNegativeNumber(config?.outputCreditsPer1M) +
      usage.cachedInputTokens *
        toNonNegativeNumber(config?.cachedInputCreditsPer1M) +
      usage.cacheWriteTokens *
        toNonNegativeNumber(config?.cacheWriteCreditsPer1M) +
      usage.imageInputTokens *
        toNonNegativeNumber(config?.imageInputCreditsPer1M) +
      usage.audioInputTokens *
        toNonNegativeNumber(config?.audioInputCreditsPer1M)) /
    ONE_MILLION
  );
}

/**
 * 计算按次基础积分。
 * @param config 按请求、图片、秒、工具调用计费的积分单价。
 * @param usage 已规范化按次 usage。
 * @returns 按次基础积分。
 */
function calculatePerCallCost(
  config: PerCallPricingConfig | undefined,
  usage: Required<PricingPerCallUsage>
) {
  return (
    usage.quantity * toNonNegativeNumber(config?.creditsPerCall) +
    usage.imageCount * toNonNegativeNumber(config?.creditsPerImage) +
    usage.durationSeconds * toNonNegativeNumber(config?.creditsPerSecond) +
    usage.toolCallCount * toNonNegativeNumber(config?.creditsPerToolCall)
  );
}

/**
 * 解析尺寸、清晰度、质量等参数倍率，并按乘积叠加。
 * @param rule 命中的定价规则。
 * @param keys 当前请求参数 key。
 * @returns 参数倍率乘积；未配置或非法倍率回退 1。
 */
function resolveParameterMultiplier(
  rule: ModelPricingRule,
  keys: PricingParameterKeys | undefined
) {
  return (
    lookupParameterMultiplier(rule.multipliers?.size, keys?.size) *
    lookupParameterMultiplier(rule.multipliers?.resolution, keys?.resolution) *
    lookupParameterMultiplier(rule.multipliers?.quality, keys?.quality) *
    lookupParameterMultiplier(rule.multipliers?.duration, keys?.duration)
  );
}

/**
 * 从倍率表中按 key 取正数倍率。
 * @param values 倍率表。
 * @param key 请求参数值。
 * @returns 命中正数倍率；缺省或非法返回 1。
 */
function lookupParameterMultiplier(
  values: Record<string, number> | undefined,
  key: string | null | undefined
) {
  if (!values || !key) return 1;
  return normalizeMultiplier(values[key]);
}

/**
 * 构建交易 metadata 可存储的定价快照。
 * @param input 快照所需的规则、倍率、usage 与计算结果。
 * @returns 不依赖当前配置表的历史账单快照。
 */
function buildPricingSnapshot(input: {
  query: PricingRuleQuery;
  rule: ModelPricingRule;
  baseCostCredits: number;
  groupMultiplier: number;
  backendMultiplier: number;
  parameterMultiplier: number;
  finalCredits: number;
  tokenUsage: Required<PricingTokenUsage>;
  perCallUsage: Required<PricingPerCallUsage>;
}): PricingSnapshot {
  return {
    ruleId: input.rule.id,
    billingMode: input.rule.billingMode,
    model: input.query.model ?? null,
    family: input.query.family ?? null,
    modality: input.query.modality ?? null,
    endpoint: input.query.endpoint ?? null,
    groupId: input.query.groupId ?? null,
    baseCostCredits: input.baseCostCredits,
    groupMultiplier: input.groupMultiplier,
    backendMultiplier: input.backendMultiplier,
    parameterMultiplier: input.parameterMultiplier,
    finalCredits: input.finalCredits,
    usage: {
      token: input.tokenUsage,
      perCall: input.perCallUsage,
    },
  };
}
