/**
 * 图像模型定价适配层测试。
 *
 * 职责：锁定旧图像计费口径经统一模型定价引擎后的等价结果，并验证
 * pricingSnapshot 会随结果返回供账本落库。
 */

import { describe, expect, it } from "vitest";

import {
  getImageModelPricingBreakdown,
  resolveConfiguredImageModelMultiplier,
  resolveFixedImageModelCharge,
} from "./model-pricing-adapter";

describe("image model pricing adapter", () => {
  it("通过统一模型定价引擎计算尺寸基础价、审核价、后端倍率和模型倍率", () => {
    const result = getImageModelPricingBreakdown({
      size: "1024x1024",
      options: {
        basePricing: {
          base1024Credits: 1.27,
          base4kCredits: 10,
        },
        textModerationCount: 1,
        imageModerationCount: 2,
      },
      context: {
        model: "firefly-gpt-image-2",
        backendMultiplier: 2,
        modelMultiplier: 3,
        billingGroupId: "vip",
      },
    });

    expect(result.totalCredits).toBe(8.58);
    expect(result.baseCredits).toBe(7.62);
    expect(result.moderationOnlyCredits).toBe(0.96);
    expect(result.pricingSnapshot).toMatchObject({
      ruleId: "image-generation.total",
      model: "firefly-gpt-image-2",
      modality: "image",
      groupId: "vip",
      backendMultiplier: 2,
      parameterMultiplier: 3,
      finalCredits: 8.58,
    });
  });

  it("透传可配置审核定价到统一模型定价引擎", () => {
    const result = getImageModelPricingBreakdown({
      size: "1024x1024",
      options: {
        basePricing: {
          base1024Credits: 1.27,
          base4kCredits: 10,
        },
        moderationPricing: {
          referenceCreditPriceCny: 0.1,
          textModerationPriceCny: 0.01,
          imageModerationPriceCny: 0.02,
        },
        textModerationCount: 1,
        imageModerationCount: 1,
      },
      context: {
        model: "gpt-image-2",
        backendMultiplier: 2,
        modelMultiplier: 1,
      },
    });

    expect(result.moderationOnlyCredits).toBe(0.6);
    expect(result.totalCredits).toBe(3.14);
    expect(result.pricingSnapshots.moderationOnly.finalCredits).toBe(0.6);
  });

  it("优先生效 MODEL_PRICING_RULES 中的 1K/2K/4K 生图按次定价", () => {
    const result = getImageModelPricingBreakdown({
      size: "2048x2048",
      options: {
        textModerationCount: 0,
        imageModerationCount: 0,
      },
      context: {
        model: "firefly-gpt-image-2",
        backendMultiplier: 2,
        modelMultiplier: 1,
        modelPricingRules: [
          {
            id: "image-tiered",
            name: "Image Tiered",
            public: true,
            sortOrder: 1,
            scope: { model: "firefly-gpt-image-2", modality: "image" },
            billingMode: "per_call",
            perCall: {
              creditsPerImageByResolution: {
                "1k": 1,
                "2k": 4,
                "4k": 10,
              },
            },
            roundingMode: "ceil_2dp",
            enabled: true,
          },
        ],
      },
    });

    expect(result.baseCredits).toBe(8);
    expect(result.totalCredits).toBe(8);
    expect(result.pricingSnapshots.base.ruleId).toBe("image-tiered");
  });

  it("固定聊天轮次费用也走统一模型定价引擎", () => {
    const result = resolveFixedImageModelCharge({
      amount: 1,
      ruleId: "image-generation.chat-round",
      context: {
        model: "firefly-nano-banana-pro",
        backendMultiplier: 1.5,
        modelMultiplier: 2,
      },
    });

    expect(result.credits).toBe(3);
    expect(result.pricingSnapshot.ruleId).toBe("image-generation.chat-round");
  });

  it("Firefly 模型族倍率解析保留既有 IMAGE_MODEL_MULTIPLIERS 口径", () => {
    expect(
      resolveConfiguredImageModelMultiplier("firefly-nano-banana-pro", {
        "nano-banana": 2,
        "nano-banana-pro": 4,
      })
    ).toBe(4);
    expect(
      resolveConfiguredImageModelMultiplier("gpt-image-2", {
        "gpt-image-2": 4,
      })
    ).toBe(1);
  });
});
