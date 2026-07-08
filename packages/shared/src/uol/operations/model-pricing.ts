/**
 * UOL Operations - 模型定价领域操作注册。
 *
 * 职责：把模型定价的公开规则查询与费用预览暴露为统一接口层操作，供
 * 站内页面、MCP/Agent 和后续传输适配器复用。
 * 使用方：operations/index.ts 副作用导入；invoke 网关按名称调用。
 * 关键依赖：model-pricing 纯计算模块、system-settings 运行时配置读取、zod。
 */
import { z } from "zod";

import {
  DEFAULT_MODEL_PRICING_RULES,
  getPublicModelPricingRules,
  normalizeModelPricingRulesConfig,
  type PricingParameterKeys,
  type PricingPerCallUsage,
  type PricingRuleQuery,
  type PricingTokenUsage,
  type PublicModelPricingRule,
  resolveModelPricing,
} from "../../model-pricing";
import { getRuntimeSettingJson } from "../../system-settings";
import { defineOperation } from "../registry";

const pricingModalitySchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "multimodal",
]);

const pricingRoundingModeSchema = z.enum(["ceil_2dp", "ceil_integer"]);
const pricingBillingModeSchema = z.enum(["token", "per_call", "composite"]);

const pricingScopeSchema = z.object({
  model: z.string().optional(),
  family: z.string().optional(),
  modality: pricingModalitySchema.optional(),
  endpoint: z.string().optional(),
  groupId: z.string().optional(),
});

const tokenPricingSchema = z.object({
  inputCreditsPer1M: z.number().nonnegative().optional(),
  outputCreditsPer1M: z.number().nonnegative().optional(),
  cachedInputCreditsPer1M: z.number().nonnegative().optional(),
  cacheWriteCreditsPer1M: z.number().nonnegative().optional(),
  imageInputCreditsPer1M: z.number().nonnegative().optional(),
  audioInputCreditsPer1M: z.number().nonnegative().optional(),
});

const perCallPricingSchema = z.object({
  creditsPerCall: z.number().nonnegative().optional(),
  creditsPerImage: z.number().nonnegative().optional(),
  creditsPerImageByResolution: z
    .record(z.string(), z.number().nonnegative())
    .optional(),
  creditsPerSecond: z.number().nonnegative().optional(),
  creditsPerToolCall: z.number().nonnegative().optional(),
});

const parameterMultiplierSchema = z.object({
  size: z.record(z.string(), z.number().positive()).optional(),
  resolution: z.record(z.string(), z.number().positive()).optional(),
  quality: z.record(z.string(), z.number().positive()).optional(),
  duration: z.record(z.string(), z.number().positive()).optional(),
});

const publicRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  public: z.boolean(),
  sortOrder: z.number(),
  scope: pricingScopeSchema,
  billingMode: pricingBillingModeSchema,
  token: tokenPricingSchema.optional(),
  perCall: perCallPricingSchema.optional(),
  multipliers: parameterMultiplierSchema.optional(),
  minimumChargeCredits: z.number().positive().optional(),
  baseRoundingMode: pricingRoundingModeSchema.optional(),
  roundingMode: pricingRoundingModeSchema,
  enabled: z.boolean(),
});

const pricingQuerySchema = z.object({
  model: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  modality: pricingModalitySchema.nullable().optional(),
  endpoint: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
});

const tokenUsageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cachedInputTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  imageInputTokens: z.number().nonnegative().optional(),
  audioInputTokens: z.number().nonnegative().optional(),
});

const perCallUsageSchema = z.object({
  quantity: z.number().nonnegative().optional(),
  imageCount: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  toolCallCount: z.number().nonnegative().optional(),
});

const parameterKeysSchema = z.object({
  size: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  quality: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
});

const requiredTokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteTokens: z.number(),
  imageInputTokens: z.number(),
  audioInputTokens: z.number(),
});

const requiredPerCallUsageSchema = z.object({
  quantity: z.number(),
  imageCount: z.number(),
  durationSeconds: z.number(),
  toolCallCount: z.number(),
});

const pricingSnapshotSchema = z.object({
  ruleId: z.string(),
  billingMode: pricingBillingModeSchema,
  model: z.string().nullable(),
  family: z.string().nullable(),
  modality: pricingModalitySchema.nullable(),
  endpoint: z.string().nullable(),
  groupId: z.string().nullable(),
  baseCostCredits: z.number(),
  groupMultiplier: z.number(),
  backendMultiplier: z.number(),
  parameterMultiplier: z.number(),
  finalCredits: z.number(),
  usage: z.object({
    token: requiredTokenUsageSchema,
    perCall: requiredPerCallUsageSchema,
  }),
});

/**
 * 读取运行时模型定价配置并收窄为公开规则。
 *
 * @returns 公开且启用的模型定价规则，读取失败时回退代码默认配置。
 * @sideEffects 正常运行时读取 system_settings；构建期可由环境变量跳过 DB。
 */
async function getRuntimePublicRules() {
  const raw = await getRuntimeSettingJson("MODEL_PRICING_RULES");
  const config = normalizeModelPricingRulesConfig(
    raw ?? DEFAULT_MODEL_PRICING_RULES
  );
  return getPublicModelPricingRules(config);
}

/**
 * 删除 Zod optional 字段中的 undefined，满足 exactOptionalPropertyTypes 下
 * PricingRuleQuery 的“存在即 string/null”约束。
 *
 * @param query 预览输入中的作用域查询。
 * @returns 可直接传入定价解析器的查询对象。
 */
function normalizePricingQuery(query: z.infer<typeof pricingQuerySchema>) {
  const normalized: PricingRuleQuery = {};
  if (query.model !== undefined) normalized.model = query.model;
  if (query.family !== undefined) normalized.family = query.family;
  if (query.modality !== undefined) normalized.modality = query.modality;
  if (query.endpoint !== undefined) normalized.endpoint = query.endpoint;
  if (query.groupId !== undefined) normalized.groupId = query.groupId;
  return normalized;
}

/**
 * 删除 usage 对象中的 undefined 字段，避免公共接口输入的稀疏对象在 strict
 * optional 类型下污染纯计算层。
 *
 * @param usage token usage 输入。
 * @returns 无 undefined 字段的 token usage；缺省时返回 undefined。
 */
function normalizeTokenUsageInput(
  usage: z.infer<typeof tokenUsageSchema> | undefined
) {
  if (!usage) return undefined;
  const normalized: PricingTokenUsage = {};
  if (usage.inputTokens !== undefined) {
    normalized.inputTokens = usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    normalized.outputTokens = usage.outputTokens;
  }
  if (usage.cachedInputTokens !== undefined) {
    normalized.cachedInputTokens = usage.cachedInputTokens;
  }
  if (usage.cacheWriteTokens !== undefined) {
    normalized.cacheWriteTokens = usage.cacheWriteTokens;
  }
  if (usage.imageInputTokens !== undefined) {
    normalized.imageInputTokens = usage.imageInputTokens;
  }
  if (usage.audioInputTokens !== undefined) {
    normalized.audioInputTokens = usage.audioInputTokens;
  }
  return normalized;
}

/**
 * 删除按次 usage 对象中的 undefined 字段。
 *
 * @param usage 按次计费 usage 输入。
 * @returns 无 undefined 字段的按次 usage；缺省时返回 undefined。
 */
function normalizePerCallUsageInput(
  usage: z.infer<typeof perCallUsageSchema> | undefined
) {
  if (!usage) return undefined;
  const normalized: PricingPerCallUsage = {};
  if (usage.quantity !== undefined) normalized.quantity = usage.quantity;
  if (usage.imageCount !== undefined) normalized.imageCount = usage.imageCount;
  if (usage.durationSeconds !== undefined) {
    normalized.durationSeconds = usage.durationSeconds;
  }
  if (usage.toolCallCount !== undefined) {
    normalized.toolCallCount = usage.toolCallCount;
  }
  return normalized;
}

/**
 * 删除参数 key 对象中的 undefined 字段。
 *
 * @param keys 尺寸、分辨率、质量、时长等参数 key。
 * @returns 无 undefined 字段的参数 key；缺省时返回 undefined。
 */
function normalizeParameterKeysInput(
  keys: z.infer<typeof parameterKeysSchema> | undefined
) {
  if (!keys) return undefined;
  const normalized: PricingParameterKeys = {};
  if (keys.size !== undefined) normalized.size = keys.size;
  if (keys.resolution !== undefined) normalized.resolution = keys.resolution;
  if (keys.quality !== undefined) normalized.quality = keys.quality;
  if (keys.duration !== undefined) normalized.duration = keys.duration;
  return normalized;
}

/**
 * modelPricing.listPublicRules - 查询公开模型定价规则。
 *
 * 用于用户定价页、Agent 展示可用价格说明，以及后台保存后快速校验公开规则。
 */
export const listPublicRules = defineOperation({
  name: "modelPricing.listPublicRules",
  domain: "credits",
  title: "List Public Model Pricing Rules",
  description:
    "读取 MODEL_PRICING_RULES 并返回公开且启用的模型定价规则。只返回用户可见规则，不暴露隐藏内部价格。",
  input: z.object({}),
  output: z.object({
    rules: z.array(publicRuleSchema),
    generatedAt: z.string(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => ({
    rules: await getRuntimePublicRules(),
    generatedAt: new Date().toISOString(),
  }),
});

/**
 * modelPricing.previewPublicCharge - 预览公开规则下的单次费用。
 *
 * 仅使用公开规则进行匹配，避免用户侧通过预览接口探测隐藏内部定价。生产扣费仍须
 * 在生成管线内写入 pricingSnapshot 并走 consumeCredits(sourceRef)。
 */
export const previewPublicCharge = defineOperation({
  name: "modelPricing.previewPublicCharge",
  domain: "credits",
  title: "Preview Public Model Pricing Charge",
  description:
    "按公开模型定价规则预览一次请求的积分成本。支持 token、按次和组合计费，并叠加分组、后端和参数倍率。",
  input: z.object({
    query: pricingQuerySchema,
    tokenUsage: tokenUsageSchema.optional(),
    perCallUsage: perCallUsageSchema.optional(),
    parameterKeys: parameterKeysSchema.optional(),
    groupMultiplier: z.number().positive().nullable().optional(),
    backendMultiplier: z.number().positive().nullable().optional(),
    parameterMultiplier: z.number().positive().nullable().optional(),
  }),
  output: z.object({
    matched: z.boolean(),
    rule: publicRuleSchema.nullable(),
    baseCostCredits: z.number().nullable(),
    finalCredits: z.number().nullable(),
    pricingSnapshot: pricingSnapshotSchema.nullable(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input) => {
    const rules = await getRuntimePublicRules();
    const query = normalizePricingQuery(input.query);
    const tokenUsage = normalizeTokenUsageInput(input.tokenUsage);
    const perCallUsage = normalizePerCallUsageInput(input.perCallUsage);
    const parameterKeys = normalizeParameterKeysInput(input.parameterKeys);
    const result = resolveModelPricing({
      rules,
      query,
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(perCallUsage ? { perCallUsage } : {}),
      ...(parameterKeys ? { parameterKeys } : {}),
      ...(input.groupMultiplier != null
        ? { groupMultiplier: input.groupMultiplier }
        : {}),
      ...(input.backendMultiplier != null
        ? { backendMultiplier: input.backendMultiplier }
        : {}),
      ...(input.parameterMultiplier != null
        ? { parameterMultiplier: input.parameterMultiplier }
        : {}),
    });

    if (!result) {
      return {
        matched: false,
        rule: null,
        baseCostCredits: null,
        finalCredits: null,
        pricingSnapshot: null,
      };
    }

    const publicRule = rules.find((rule) => rule.id === result.rule.id) ?? null;

    return {
      matched: true,
      rule: publicRule satisfies PublicModelPricingRule | null,
      baseCostCredits: result.baseCostCredits,
      finalCredits: result.finalCredits,
      pricingSnapshot: result.pricingSnapshot,
    };
  },
});
