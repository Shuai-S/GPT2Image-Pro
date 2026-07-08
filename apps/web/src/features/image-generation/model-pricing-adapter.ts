/**
 * 图像生成模型定价适配层。
 *
 * 职责：把现有图像计费口径转换为统一模型定价引擎的 ModelPricingRule，并返回
 * 可直接用于扣费与落库的 pricingSnapshot。使用方是 image-generation/operations。
 * 关键依赖：@repo/shared/model-pricing 纯计算引擎、图像分辨率计价函数、Adobe
 * Firefly 模型族倍率解析。
 */

import { resolveImageModelMultiplier } from "@repo/shared/adobe";
import {
  type ModelPricingRule,
  type PublicModelPricingRule,
  type PricingSnapshot,
  resolveModelPricing,
} from "@repo/shared/model-pricing";

import {
  AUTO_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  type ImageBaseCreditPricing,
  type ImageModerationCreditPricing,
  type ImageQualityLevel,
  type ImageThinkingLevel,
} from "./resolution";

export type ImageModelPricingBreakdown = ReturnType<
  typeof getImageCreditCostBreakdown
> & {
  pricingSnapshot: PricingSnapshot;
  pricingSnapshots: {
    total: PricingSnapshot;
    base: PricingSnapshot;
    moderation: PricingSnapshot;
    moderationOnly: PricingSnapshot;
  };
};

export type FixedModelCharge = {
  credits: number;
  pricingSnapshot: PricingSnapshot;
};

type ImagePricingContext = {
  model: string;
  billingGroupId?: string | null;
  backendMultiplier: number;
  modelMultiplier: number;
  modelPricingRules?: readonly PublicModelPricingRule[];
};

type ImageCostOptions = {
  textModerationCount?: number;
  imageModerationCount?: number;
  basePricing?: ImageBaseCreditPricing;
  moderationPricing?: ImageModerationCreditPricing | null;
  quality?: ImageQualityLevel | null;
  thinking?: ImageThinkingLevel | null;
};

function normalizePricingMultiplier(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function buildGeneratedRule(params: {
  ruleId: string;
  model: string;
  amount: number;
  unit: "call" | "image";
}): ModelPricingRule {
  return {
    id: params.ruleId,
    scope: {
      model: params.model,
      modality: "image",
    },
    billingMode: "per_call",
    perCall:
      params.unit === "image"
        ? { creditsPerImage: params.amount }
        : { creditsPerCall: params.amount },
    roundingMode: "ceil_2dp",
    enabled: true,
  };
}

function getImageResolutionTier(size?: string | null) {
  const normalizedSize = size?.trim().toLowerCase();
  if (!normalizedSize || normalizedSize === AUTO_IMAGE_SIZE) return "1k";
  const match = normalizedSize.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return "1k";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const longestEdge = Math.max(width, height);
  if (longestEdge > 2048) return "4k";
  if (longestEdge > 1536) return "2k";
  return "1k";
}

function resolveConfiguredBaseImagePrice(params: {
  size?: string | null;
  context: ImagePricingContext;
}) {
  const rules = params.context.modelPricingRules;
  if (!rules) return null;
  const resolution = getImageResolutionTier(params.size);
  const result = resolveModelPricing({
    rules,
    query: {
      model: params.context.model,
      modality: "image",
      groupId: params.context.billingGroupId ?? null,
    },
    perCallUsage: { imageCount: 1 },
    parameterKeys: { resolution },
    backendMultiplier: normalizePricingMultiplier(
      params.context.backendMultiplier
    ),
    parameterMultiplier: normalizePricingMultiplier(
      params.context.modelMultiplier
    ),
  });

  if (!result) return null;
  return {
    credits: result.finalCredits,
    pricingSnapshot: result.pricingSnapshot,
    resolution,
  };
}

/**
 * 读取 Firefly 图像模型族倍率。
 *
 * @param model 图像模型 ID。
 * @param multipliers 系统设置 IMAGE_MODEL_MULTIPLIERS 解析后的倍率表。
 * @returns 命中 Firefly 模型族时返回配置倍率，否则返回 1。
 */
export function resolveConfiguredImageModelMultiplier(
  model: string,
  multipliers: Record<string, number>
) {
  return resolveImageModelMultiplier(model, multipliers);
}

/**
 * 用统一模型定价引擎计算一个固定积分项。
 *
 * @param amount 未乘后端/模型倍率前的基础积分。
 * @param context 当前图像模型和倍率上下文。
 * @param ruleId 写入 pricingSnapshot.ruleId 的规则 ID。
 * @returns 最终积分与快照。
 */
export function resolveFixedImageModelCharge(params: {
  amount: number;
  context: ImagePricingContext;
  ruleId: string;
}): FixedModelCharge {
  const resolution = resolveGeneratedModelPricing({
    amount: params.amount,
    context: params.context,
    ruleId: params.ruleId,
    unit: "call",
  });

  return {
    credits: resolution.finalCredits,
    pricingSnapshot: resolution.pricingSnapshot,
  };
}

/**
 * 按尺寸和审核数量计算单张图像的计费明细。
 *
 * @param size 图像尺寸。
 * @param options 图像基础计费参数。
 * @param context 当前图像模型和倍率上下文。
 * @returns 与旧 creditCost 兼容的字段，加上模型定价快照。
 */
export function getImageModelPricingBreakdown(params: {
  size?: string | null;
  options?: ImageCostOptions;
  context: ImagePricingContext;
}): ImageModelPricingBreakdown {
  const base = getImageCreditCostBreakdown(params.size, params.options);
  const configuredBase = resolveConfiguredBaseImagePrice({
    size: params.size,
    context: params.context,
  });
  const total = resolveGeneratedModelPricing({
    amount:
      (configuredBase?.pricingSnapshot.baseCostCredits ?? base.baseCredits) +
      base.moderationOnlyCredits,
    context: params.context,
    ruleId: "image-generation.total",
    unit: "image",
  });
  const baseOnly = resolveGeneratedModelPricing({
    amount: base.baseCredits,
    context: params.context,
    ruleId: "image-generation.base",
    unit: "image",
  });
  const moderation = resolveGeneratedModelPricing({
    amount: base.moderationCredits,
    context: params.context,
    ruleId: "image-generation.moderation",
    unit: "image",
  });
  const moderationOnly = resolveGeneratedModelPricing({
    amount: base.moderationOnlyCredits,
    context: params.context,
    ruleId: "image-generation.moderation-only",
    unit: "image",
  });

  return {
    ...base,
    baseCredits: configuredBase?.credits ?? baseOnly.finalCredits,
    moderationCredits: moderation.finalCredits,
    moderationOnlyCredits: moderationOnly.finalCredits,
    totalCredits: total.finalCredits,
    pricingSnapshot: total.pricingSnapshot,
    pricingSnapshots: {
      total: total.pricingSnapshot,
      base: configuredBase?.pricingSnapshot ?? baseOnly.pricingSnapshot,
      moderation: moderation.pricingSnapshot,
      moderationOnly: moderationOnly.pricingSnapshot,
    },
  };
}

function resolveGeneratedModelPricing(params: {
  amount: number;
  context: ImagePricingContext;
  ruleId: string;
  unit: "call" | "image";
}) {
  const safeAmount =
    Number.isFinite(params.amount) && params.amount > 0 ? params.amount : 0;
  const rule = buildGeneratedRule({
    ruleId: params.ruleId,
    model: params.context.model,
    amount: safeAmount,
    unit: params.unit,
  });
  const result = resolveModelPricing({
    rules: [rule],
    query: {
      model: params.context.model,
      modality: "image",
      groupId: params.context.billingGroupId ?? null,
    },
    perCallUsage:
      params.unit === "image" ? { imageCount: 1 } : { quantity: 1 },
    backendMultiplier: normalizePricingMultiplier(
      params.context.backendMultiplier
    ),
    parameterMultiplier: normalizePricingMultiplier(
      params.context.modelMultiplier
    ),
  });

  if (!result) {
    throw new Error("无法解析图像模型定价规则");
  }

  return result;
}
