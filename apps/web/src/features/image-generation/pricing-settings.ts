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

export async function getRuntimePublicModelPricingRules() {
  const raw = await getRuntimeSettingJson("MODEL_PRICING_RULES");
  const config = normalizeModelPricingRulesConfig(
    raw ?? DEFAULT_MODEL_PRICING_RULES
  );
  return getPublicModelPricingRules(config);
}
