/**
 * 模型定价规则配置目录。
 *
 * 使用方：系统设置把 MODEL_PRICING_RULES 作为可编辑 JSON 保存，营销定价页和后续
 * UOL/生成管线通过本模块规范化配置后展示或计算。模块只负责配置形状、默认值和
 * DB-free 收窄，不读取系统设置、不执行扣费。
 * 关键依赖：pricing-resolver 中的规则类型。
 */

import type { ModelPricingRule, PricingModality } from "./pricing-resolver";

export const MODEL_PRICING_RULES_SETTING_KEY = "MODEL_PRICING_RULES";

export type PublicModelPricingRule = ModelPricingRule & {
  name: string;
  description?: string;
  public: boolean;
  sortOrder: number;
};

export type ModelPricingRulesConfig = {
  version: 1;
  rules: PublicModelPricingRule[];
};

export type ModelPricingRulesValidationIssue = {
  index: number;
  field: string;
  message: string;
};

type RawModelPricingRulesInput = {
  rules: unknown[];
  explicit: boolean;
};

const ALLOWED_MODALITIES = [
  "text",
  "image",
  "video",
  "audio",
  "multimodal",
] as const satisfies readonly PricingModality[];

const DEFAULT_RULES = [
  {
    id: "text-gpt-4o",
    name: "GPT-4o",
    description: "Responses 与 Chat 文本模型示例，按输入/输出 token 计费。",
    public: true,
    sortOrder: 10,
    scope: {
      model: "gpt-4o",
      modality: "text",
    },
    billingMode: "token",
    token: {
      inputCreditsPer1M: 100,
      outputCreditsPer1M: 400,
      cachedInputCreditsPer1M: 25,
    },
    roundingMode: "ceil_2dp",
    enabled: true,
  },
  {
    id: "text-gpt-4o-mini",
    name: "GPT-4o mini",
    description: "轻量文本模型示例，适合低成本对话和工具编排。",
    public: true,
    sortOrder: 20,
    scope: {
      model: "gpt-4o-mini",
      modality: "text",
    },
    billingMode: "token",
    token: {
      inputCreditsPer1M: 15,
      outputCreditsPer1M: 60,
      cachedInputCreditsPer1M: 4,
    },
    roundingMode: "ceil_2dp",
    enabled: true,
  },
  {
    id: "image-firefly-gpt-image-2",
    name: "Firefly GPT Image 2",
    description: "图像模型展示价；实际生图还会按尺寸、审核和后端倍率结算。",
    public: true,
    sortOrder: 100,
    scope: {
      model: "firefly-gpt-image-2",
      family: "gpt-image-2",
      modality: "image",
    },
    billingMode: "per_call",
    perCall: {
      creditsPerImage: 1.31,
      creditsPerImageByResolution: {
        "1k": 1.31,
        "2k": 4,
        "4k": 10.04,
      },
    },
    roundingMode: "ceil_2dp",
    enabled: true,
  },
  {
    id: "video-firefly-sora2",
    name: "Firefly Sora 2",
    description: "视频模型展示价；实际视频还会叠加模型族和后端倍率。",
    public: true,
    sortOrder: 200,
    scope: {
      model: "firefly-sora2",
      family: "sora2",
      modality: "video",
    },
    billingMode: "per_call",
    perCall: {
      creditsPerSecond: 30,
    },
    baseRoundingMode: "ceil_2dp",
    roundingMode: "ceil_integer",
    enabled: true,
  },
] as const satisfies readonly PublicModelPricingRule[];

export const DEFAULT_MODEL_PRICING_RULES: ModelPricingRulesConfig = {
  version: 1,
  rules: [...DEFAULT_RULES],
};

/**
 * 把系统设置中的 MODEL_PRICING_RULES 收窄成可展示/可计算的规则配置。
 *
 * @param value 来自系统设置 JSON、环境变量 JSON 或前端草稿的未知值。
 * @returns 规范化后的配置；无有效规则时回退到代码默认规则。
 */
export function normalizeModelPricingRulesConfig(
  value: unknown
): ModelPricingRulesConfig {
  const source = getRawRules(value);
  const rules = source.rules
    .map(normalizeRule)
    .filter((rule): rule is PublicModelPricingRule => Boolean(rule))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    version: 1,
    rules:
      rules.length > 0 || (source.explicit && source.rules.length === 0)
        ? rules
        : DEFAULT_MODEL_PRICING_RULES.rules,
  };
}

/**
 * 把前端编辑中的 MODEL_PRICING_RULES 草稿收窄成可渲染规则。
 *
 * @param value 来自系统设置表单的未知值。
 * @returns 草稿配置；显式 rules 会保留空 id 等未完成输入，不回退示例规则。
 */
export function normalizeModelPricingRulesDraftConfig(
  value: unknown
): ModelPricingRulesConfig {
  const source = getRawRules(value);
  if (!source.explicit) {
    return normalizeModelPricingRulesConfig(value);
  }

  return {
    version: 1,
    rules: source.rules
      .map(normalizeRuleDraft)
      .filter((rule): rule is PublicModelPricingRule => Boolean(rule))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/**
 * 校验显式 MODEL_PRICING_RULES 配置是否可保存。
 *
 * @param value 来自后台表单、环境变量或导入流程的未知值。
 * @returns 校验问题列表；空数组表示可保存，非显式配置由调用方按默认值处理。
 */
export function getModelPricingRulesValidationIssues(
  value: unknown
): ModelPricingRulesValidationIssue[] {
  const source = getRawRules(value);
  if (!source.explicit) return [];

  const issues: ModelPricingRulesValidationIssue[] = [];
  const seenIds = new Map<string, number>();

  source.rules.forEach((rule, index) => {
    if (!isRecord(rule)) {
      issues.push({
        index,
        field: "rule",
        message: `第 ${index + 1} 条规则必须是对象`,
      });
      return;
    }

    const id = stringValue(rule.id).trim();
    if (!id) {
      issues.push({
        index,
        field: "id",
        message: `第 ${index + 1} 条规则缺少规则 ID`,
      });
    } else {
      const firstIndex = seenIds.get(id);
      if (firstIndex !== undefined) {
        issues.push({
          index,
          field: "id",
          message: `第 ${index + 1} 条规则 ID 与第 ${firstIndex + 1} 条重复`,
        });
      } else {
        seenIds.set(id, index);
      }
    }

    const scope = normalizeScope(rule.scope);
    if (!Object.values(scope).some(Boolean)) {
      issues.push({
        index,
        field: "scope",
        message: `第 ${index + 1} 条规则至少需要一个 scope 条件`,
      });
    }
  });

  return issues;
}

/**
 * 从配置中取出公开且启用的规则。
 *
 * @param config 已规范化的模型定价配置。
 * @returns 按 sortOrder 排序的公开规则列表。
 */
export function getPublicModelPricingRules(
  config: ModelPricingRulesConfig
): PublicModelPricingRule[] {
  return config.rules.filter((rule) => rule.enabled && rule.public);
}

/**
 * 读取数组或 { rules } 包装结构中的原始规则。
 *
 * @param value 未知配置值。
 * @returns 原始规则数组，以及输入是否显式声明了规则列表。
 */
function getRawRules(value: unknown): RawModelPricingRulesInput {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { rules: [], explicit: false };
    try {
      return getRawRules(JSON.parse(trimmed) as unknown);
    } catch {
      return { rules: [], explicit: false };
    }
  }
  if (Array.isArray(value)) return { rules: value, explicit: true };
  if (isRecord(value) && Array.isArray(value.rules)) {
    return { rules: value.rules, explicit: true };
  }
  return { rules: [], explicit: false };
}

/**
 * 规范化单条规则。
 *
 * @param value 未知规则对象。
 * @returns 可用规则；缺 id 或 scope 过空时返回 null。
 */
function normalizeRule(value: unknown): PublicModelPricingRule | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  if (!id) return null;

  const scope = normalizeScope(value.scope);
  if (!Object.values(scope).some(Boolean)) return null;

  const billingMode = normalizeBillingMode(value.billingMode);
  const minimumChargeCredits = positiveNumberValue(value.minimumChargeCredits);
  const rule: PublicModelPricingRule = {
    id,
    name: stringValue(value.name, id).trim() || id,
    description: stringValue(value.description).trim(),
    public: booleanValue(value.public, true),
    sortOrder: numberValue(value.sortOrder, 1000),
    scope,
    billingMode,
    ...(billingMode !== "per_call"
      ? { token: normalizeTokenConfig(value.token) }
      : {}),
    ...(billingMode !== "token"
      ? { perCall: normalizePerCallConfig(value.perCall) }
      : {}),
    ...(isRecord(value.multipliers)
      ? { multipliers: normalizeMultipliers(value.multipliers) }
      : {}),
    ...(minimumChargeCredits !== undefined ? { minimumChargeCredits } : {}),
    ...(value.baseRoundingMode === "ceil_integer" ||
    value.baseRoundingMode === "ceil_2dp"
      ? { baseRoundingMode: value.baseRoundingMode }
      : {}),
    roundingMode:
      value.roundingMode === "ceil_integer" ? "ceil_integer" : "ceil_2dp",
    enabled: booleanValue(value.enabled, true),
  };

  return rule;
}

/**
 * 规范化编辑草稿中的单条规则，允许暂时缺少必填字段。
 *
 * @param value 未知规则对象。
 * @returns 可渲染的草稿规则；非对象时返回 null。
 */
function normalizeRuleDraft(value: unknown): PublicModelPricingRule | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const billingMode = normalizeBillingMode(value.billingMode);
  const minimumChargeCredits = positiveNumberValue(value.minimumChargeCredits);

  return {
    id,
    name: stringValue(value.name).trim(),
    description: stringValue(value.description).trim(),
    public: booleanValue(value.public, true),
    sortOrder: numberValue(value.sortOrder, 1000),
    scope: normalizeScope(value.scope),
    billingMode,
    ...(billingMode !== "per_call"
      ? { token: normalizeTokenConfig(value.token) }
      : {}),
    ...(billingMode !== "token"
      ? { perCall: normalizePerCallConfig(value.perCall) }
      : {}),
    ...(isRecord(value.multipliers)
      ? { multipliers: normalizeMultipliers(value.multipliers) }
      : {}),
    ...(minimumChargeCredits !== undefined ? { minimumChargeCredits } : {}),
    ...(value.baseRoundingMode === "ceil_integer" ||
    value.baseRoundingMode === "ceil_2dp"
      ? { baseRoundingMode: value.baseRoundingMode }
      : {}),
    roundingMode:
      value.roundingMode === "ceil_integer" ? "ceil_integer" : "ceil_2dp",
    enabled: booleanValue(value.enabled, true),
  };
}

/**
 * 规范化规则 scope。
 *
 * @param value 原始 scope。
 * @returns 已去空白字段的 scope。
 */
function normalizeScope(value: unknown): PublicModelPricingRule["scope"] {
  const raw = isRecord(value) ? value : {};
  const modality = ALLOWED_MODALITIES.includes(raw.modality as PricingModality)
    ? (raw.modality as PricingModality)
    : undefined;
  return {
    ...(stringValue(raw.model).trim()
      ? { model: stringValue(raw.model).trim() }
      : {}),
    ...(stringValue(raw.family).trim()
      ? { family: stringValue(raw.family).trim() }
      : {}),
    ...(modality ? { modality } : {}),
    ...(stringValue(raw.endpoint).trim()
      ? { endpoint: stringValue(raw.endpoint).trim() }
      : {}),
    ...(stringValue(raw.groupId).trim()
      ? { groupId: stringValue(raw.groupId).trim() }
      : {}),
  };
}

/**
 * 规范化计费模式。
 *
 * @param value 原始模式。
 * @returns 支持的计费模式。
 */
function normalizeBillingMode(
  value: unknown
): PublicModelPricingRule["billingMode"] {
  if (value === "per_call" || value === "composite") return value;
  return "token";
}

/**
 * 规范化 token 价格配置。
 *
 * @param value 原始 token 配置。
 * @returns 非负 token 单价配置。
 */
function normalizeTokenConfig(
  value: unknown
): NonNullable<ModelPricingRule["token"]> {
  const raw = isRecord(value) ? value : {};
  return {
    inputCreditsPer1M: numberValue(raw.inputCreditsPer1M, 0),
    outputCreditsPer1M: numberValue(raw.outputCreditsPer1M, 0),
    cachedInputCreditsPer1M: numberValue(raw.cachedInputCreditsPer1M, 0),
    cacheWriteCreditsPer1M: numberValue(raw.cacheWriteCreditsPer1M, 0),
    imageInputCreditsPer1M: numberValue(raw.imageInputCreditsPer1M, 0),
    audioInputCreditsPer1M: numberValue(raw.audioInputCreditsPer1M, 0),
  };
}

/**
 * 规范化按次价格配置。
 *
 * @param value 原始按次配置。
 * @returns 非负按次单价配置。
 */
function normalizePerCallConfig(
  value: unknown
): NonNullable<ModelPricingRule["perCall"]> {
  const raw = isRecord(value) ? value : {};
  return {
    creditsPerCall: numberValue(raw.creditsPerCall, 0),
    creditsPerImage: numberValue(raw.creditsPerImage, 0),
    creditsPerImageByResolution: normalizeNumberRecord(
      raw.creditsPerImageByResolution
    ),
    creditsPerSecond: numberValue(raw.creditsPerSecond, 0),
    creditsPerToolCall: numberValue(raw.creditsPerToolCall, 0),
  };
}

/**
 * 规范化参数倍率配置。
 *
 * @param value 原始倍率配置。
 * @returns 只保留正数倍率的参数配置。
 */
function normalizeMultipliers(value: Record<string, unknown>) {
  return {
    size: normalizeNumberRecord(value.size),
    resolution: normalizeNumberRecord(value.resolution),
    quality: normalizeNumberRecord(value.quality),
    duration: normalizeNumberRecord(value.duration),
  };
}

/**
 * 规范化 key-value 数值表。
 *
 * @param value 原始对象。
 * @returns 只包含正有限数的对象。
 */
function normalizeNumberRecord(value: unknown) {
  const raw = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, rawValue]) => [key, positiveNumberValue(rawValue)] as const)
      .filter(
        (entry): entry is readonly [string, number] => entry[1] !== undefined
      )
  );
}

/**
 * 判断未知值是否为普通对象。
 *
 * @param value 未知值。
 * @returns 是普通对象时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 读取字符串值。
 *
 * @param value 原始值。
 * @param fallback 兜底值。
 * @returns 字符串。
 */
function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/**
 * 读取布尔值。
 *
 * @param value 原始值。
 * @param fallback 兜底值。
 * @returns 布尔值。
 */
function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 读取非负数。
 *
 * @param value 原始值。
 * @param fallback 兜底值。
 * @returns 非负有限数。
 */
function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * 读取正数。
 *
 * @param value 原始值。
 * @returns 正有限数；非法时返回 undefined。
 */
function positiveNumberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
