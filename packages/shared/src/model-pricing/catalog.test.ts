/**
 * 模型定价规则配置目录测试。
 *
 * 覆盖 MODEL_PRICING_RULES 的默认配置、公开规则筛选和未知 JSON 收窄，确保后台设置
 * 与用户定价页共用的配置层不会把非法数据透传到展示或后续算价路径。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PRICING_RULES,
  getPublicModelPricingRules,
  normalizeModelPricingRulesConfig,
} from "./catalog";

describe("model pricing catalog", () => {
  it("默认配置包含公开启用的 token、图像和视频规则", () => {
    const publicRules = getPublicModelPricingRules(DEFAULT_MODEL_PRICING_RULES);

    expect(publicRules.some((rule) => rule.billingMode === "token")).toBe(true);
    expect(publicRules.some((rule) => rule.scope.modality === "image")).toBe(
      true
    );
    expect(publicRules.some((rule) => rule.scope.modality === "video")).toBe(
      true
    );
  });

  it("非法 JSON 回退默认配置", () => {
    expect(normalizeModelPricingRulesConfig("not-json")).toEqual(
      DEFAULT_MODEL_PRICING_RULES
    );
  });

  it("显式空规则保留为空，允许后台删除全部模型定价", () => {
    expect(normalizeModelPricingRulesConfig({ rules: [] })).toEqual(
      {
        version: 1,
        rules: [],
      }
    );
    expect(normalizeModelPricingRulesConfig("[]")).toEqual(
      {
        version: 1,
        rules: [],
      }
    );
  });

  it("只公开 enabled 且 public 的规则", () => {
    const config = normalizeModelPricingRulesConfig({
      rules: [
        {
          id: "visible",
          name: "Visible",
          scope: { model: "visible", modality: "text" },
          billingMode: "token",
          token: { inputCreditsPer1M: 1 },
          public: true,
          enabled: true,
          roundingMode: "ceil_2dp",
        },
        {
          id: "hidden",
          name: "Hidden",
          scope: { model: "hidden", modality: "text" },
          billingMode: "token",
          public: false,
          enabled: true,
          roundingMode: "ceil_2dp",
        },
        {
          id: "disabled",
          name: "Disabled",
          scope: { model: "disabled", modality: "text" },
          billingMode: "token",
          public: true,
          enabled: false,
          roundingMode: "ceil_2dp",
        },
      ],
    });

    expect(getPublicModelPricingRules(config).map((rule) => rule.id)).toEqual([
      "visible",
    ]);
  });
});
