import {
  DEFAULT_MODEL_PRICING_RULES,
  getPublicModelPricingRules,
  normalizeModelPricingRulesConfig,
} from "@repo/shared/model-pricing";
import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";

import {
  DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
  type ImageBaseCreditPricing,
  type ImageModerationCreditPricing,
  IMAGE_MODERATION_PRICE_CNY,
  REFERENCE_CREDIT_PRICE_CNY,
  TEXT_MODERATION_PRICE_CNY,
} from "./resolution";

export async function getRuntimeImageBaseCreditPricing(): Promise<ImageBaseCreditPricing> {
  const [base1024Credits, base4kCredits] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_1024",
      DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_4K",
      DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
      { positive: true }
    ),
  ]);

  return { base1024Credits, base4kCredits };
}

/**
 * 读取运行时审核成本折算价格。
 *
 * @returns 文本审核、图片审核人民币成本和积分参考人民币单价。
 * @sideEffects 读取 system_setting；未配置或非法时回退旧代码默认值。
 */
export async function getRuntimeModerationCreditPricing(): Promise<ImageModerationCreditPricing> {
  const [
    referenceCreditPriceCny,
    textModerationPriceCny,
    imageModerationPriceCny,
  ] = await Promise.all([
    getRuntimeSettingNumber(
      "REFERENCE_CREDIT_PRICE_CNY",
      REFERENCE_CREDIT_PRICE_CNY,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "TEXT_MODERATION_PRICE_CNY",
      TEXT_MODERATION_PRICE_CNY,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_MODERATION_PRICE_CNY",
      IMAGE_MODERATION_PRICE_CNY,
      { positive: true }
    ),
  ]);

  return {
    referenceCreditPriceCny,
    textModerationPriceCny,
    imageModerationPriceCny,
  };
}

export async function getRuntimePublicModelPricingRules() {
  const raw = await getRuntimeSettingJson("MODEL_PRICING_RULES");
  const config = normalizeModelPricingRulesConfig(
    raw ?? DEFAULT_MODEL_PRICING_RULES
  );
  return getPublicModelPricingRules(config);
}

/**
 * 读取运行时完整模型定价规则。
 *
 * @returns 后台 MODEL_PRICING_RULES 中所有启用/禁用规则；调用方再由定价引擎按 enabled 过滤。
 * @sideEffects 读取 system_setting；未配置时回退默认规则。
 */
export async function getRuntimeModelPricingRules() {
  const raw = await getRuntimeSettingJson("MODEL_PRICING_RULES");
  return normalizeModelPricingRulesConfig(raw ?? DEFAULT_MODEL_PRICING_RULES)
    .rules;
}
