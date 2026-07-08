/**
 * 模型定价规则解析与积分计算测试。
 *
 * 覆盖 New API 倍率公式在本项目 credits 单位下的等价表达、同模型分组覆盖、
 * 按次/组合计费、缓存/多模态 token、旧图片和视频计费映射。测试为 DB-free，
 * 使用方可放心把该模块接入 UOL 或生成管线前先做纯函数回归。
 */

import { describe, expect, it } from "vitest";
import {
  type ModelPricingRule,
  resolveModelPricing,
  resolveModelPricingRule,
  roundPricingCredits,
} from "./pricing-resolver";

const modalityDefaultRule: ModelPricingRule = {
  id: "default-text",
  scope: { modality: "text" },
  billingMode: "token",
  token: {
    inputCreditsPer1M: 100,
    outputCreditsPer1M: 200,
  },
  roundingMode: "ceil_2dp",
  enabled: true,
};

describe("resolveModelPricingRule", () => {
  it("按 model + endpoint + group 优先于 model + group 和 model", () => {
    const rules: ModelPricingRule[] = [
      {
        ...modalityDefaultRule,
        id: "model",
        scope: { model: "gpt-4o" },
      },
      {
        ...modalityDefaultRule,
        id: "model-group",
        scope: { model: "gpt-4o", groupId: "vip" },
      },
      {
        ...modalityDefaultRule,
        id: "model-endpoint-group",
        scope: {
          model: "gpt-4o",
          endpoint: "/v1/responses",
          groupId: "vip",
        },
      },
    ];

    const match = resolveModelPricingRule(rules, {
      model: "gpt-4o",
      modality: "text",
      endpoint: "/v1/responses",
      groupId: "vip",
    });

    expect(match?.rule.id).toBe("model-endpoint-group");
  });

  it("支持同一模型按不同分组选择不同计费模式", () => {
    const rules: ModelPricingRule[] = [
      {
        id: "gpt-4o-a-per-call",
        scope: { model: "gpt-4o", groupId: "a" },
        billingMode: "per_call",
        perCall: { creditsPerCall: 3 },
        roundingMode: "ceil_2dp",
        enabled: true,
      },
      {
        id: "gpt-4o-b-token",
        scope: { model: "gpt-4o", groupId: "b" },
        billingMode: "token",
        token: { inputCreditsPer1M: 100, outputCreditsPer1M: 400 },
        roundingMode: "ceil_2dp",
        enabled: true,
      },
    ];

    expect(
      resolveModelPricingRule(rules, { model: "gpt-4o", groupId: "a" })?.rule
        .billingMode
    ).toBe("per_call");
    expect(
      resolveModelPricingRule(rules, { model: "gpt-4o", groupId: "b" })?.rule
        .billingMode
    ).toBe("token");
  });

  it("model + group 优先于 model + endpoint 默认规则", () => {
    const rules: ModelPricingRule[] = [
      {
        ...modalityDefaultRule,
        id: "endpoint-default",
        scope: { model: "gpt-4o", endpoint: "/v1/responses" },
      },
      {
        ...modalityDefaultRule,
        id: "vip-group",
        scope: { model: "gpt-4o", groupId: "vip" },
      },
    ];

    const match = resolveModelPricingRule(rules, {
      model: "gpt-4o",
      endpoint: "/v1/responses",
      groupId: "vip",
    });

    expect(match?.rule.id).toBe("vip-group");
  });

  it("禁用规则不参与匹配并回退到族规则", () => {
    const rules: ModelPricingRule[] = [
      {
        ...modalityDefaultRule,
        id: "disabled-model",
        scope: { model: "firefly-sora2" },
        enabled: false,
      },
      {
        ...modalityDefaultRule,
        id: "family",
        scope: { family: "sora2" },
      },
    ];

    const match = resolveModelPricingRule(rules, {
      model: "firefly-sora2",
      family: "sora2",
    });

    expect(match?.rule.id).toBe("family");
  });
});

describe("resolveModelPricing", () => {
  it("按 token 单价计算输入、输出、缓存和多模态 token", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "gpt-4o-token",
          scope: { model: "gpt-4o" },
          billingMode: "token",
          token: {
            inputCreditsPer1M: 100,
            outputCreditsPer1M: 400,
            cachedInputCreditsPer1M: 25,
            cacheWriteCreditsPer1M: 120,
            imageInputCreditsPer1M: 80,
            audioInputCreditsPer1M: 60,
          },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "gpt-4o" },
      tokenUsage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 100_000,
        imageInputTokens: 50_000,
        audioInputTokens: 25_000,
      },
      groupMultiplier: 1.5,
      backendMultiplier: 2,
    });

    expect(result?.baseCostCredits).toBe(322.5);
    expect(result?.finalCredits).toBe(967.5);
    expect(result?.pricingSnapshot.usage.token.outputTokens).toBe(500_000);
  });

  it("可表达 New API 三层倍率公式但保留 credits 单位", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "new-api-equivalent",
          scope: { model: "gpt-4" },
          billingMode: "token",
          token: {
            inputCreditsPer1M: 15_000_000,
            outputCreditsPer1M: 30_000_000,
          },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "gpt-4" },
      tokenUsage: { inputTokens: 1_000, outputTokens: 500 },
      groupMultiplier: 1,
    });

    expect(result?.finalCredits).toBe(30_000);
  });

  it("按次计费叠加分组、后端和参数倍率", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "image-per-call",
          scope: { model: "firefly-gpt-image-2", groupId: "vip" },
          billingMode: "per_call",
          perCall: { creditsPerImage: 8 },
          multipliers: {
            size: { "4k": 2 },
            quality: { high: 1.25 },
          },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "firefly-gpt-image-2", groupId: "vip" },
      perCallUsage: { imageCount: 2 },
      parameterKeys: { size: "4k", quality: "high" },
      groupMultiplier: 0.8,
      backendMultiplier: 1.5,
    });

    expect(result?.baseCostCredits).toBe(16);
    expect(result?.parameterMultiplier).toBe(2.5);
    expect(result?.finalCredits).toBe(48);
  });

  it("按图像分辨率档位选择每张图片单价", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "image-resolution-tiers",
          scope: { model: "firefly-gpt-image-2", modality: "image" },
          billingMode: "per_call",
          perCall: {
            creditsPerImage: 1,
            creditsPerImageByResolution: {
              "1k": 1.31,
              "2k": 4,
              "4k": 10,
            },
          },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "firefly-gpt-image-2", modality: "image" },
      perCallUsage: { imageCount: 1 },
      parameterKeys: { resolution: "2k" },
      backendMultiplier: 2,
    });

    expect(result?.baseCostCredits).toBe(4);
    expect(result?.finalCredits).toBe(8);
  });

  it("组合计费支持 token 加固定图片附加费", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "multimodal-composite",
          scope: { model: "gpt-image-plus" },
          billingMode: "composite",
          token: { inputCreditsPer1M: 100, outputCreditsPer1M: 400 },
          perCall: { creditsPerImage: 8 },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "gpt-image-plus" },
      tokenUsage: { inputTokens: 10_000, outputTokens: 5_000 },
      perCallUsage: { imageCount: 1 },
    });

    expect(result?.baseCostCredits).toBe(11);
    expect(result?.finalCredits).toBe(11);
  });

  it("最小扣费在最终倍率前生效并写入快照", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "minimum",
          scope: { modality: "text" },
          billingMode: "token",
          token: { inputCreditsPer1M: 1 },
          minimumChargeCredits: 0.5,
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { modality: "text" },
      tokenUsage: { inputTokens: 1 },
      groupMultiplier: 2,
    });

    expect(result?.baseCostCredits).toBe(0.5);
    expect(result?.finalCredits).toBe(1);
    expect(result?.pricingSnapshot.ruleId).toBe("minimum");
  });

  it("旧图片计费可映射为每张基础价乘模型和后端倍率", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "legacy-image",
          scope: { model: "firefly-gpt-image-2" },
          billingMode: "per_call",
          perCall: { creditsPerImage: 1.31 },
          roundingMode: "ceil_2dp",
          enabled: true,
        },
      ],
      query: { model: "firefly-gpt-image-2" },
      perCallUsage: { imageCount: 1 },
      parameterMultiplier: 1.5,
      backendMultiplier: 2,
    });

    expect(result?.finalCredits).toBe(3.93);
  });

  it("旧视频计费可用基础 2 位取整和最终整数取整保持结果不变", () => {
    const result = resolveModelPricing({
      rules: [
        {
          id: "legacy-video",
          scope: { family: "sora2" },
          billingMode: "per_call",
          perCall: { creditsPerSecond: 30 * 1.333 },
          baseRoundingMode: "ceil_2dp",
          roundingMode: "ceil_integer",
          enabled: true,
        },
      ],
      query: { model: "firefly-sora2", family: "sora2" },
      perCallUsage: { durationSeconds: 5 },
      backendMultiplier: 2,
    });

    expect(result?.baseCostCredits).toBe(199.95);
    expect(result?.finalCredits).toBe(400);
  });
});

describe("roundPricingCredits", () => {
  it("支持向上取两位小数和整数", () => {
    expect(roundPricingCredits(1.23001, "ceil_2dp")).toBe(1.24);
    expect(roundPricingCredits(199.95, "ceil_integer")).toBe(200);
    expect(roundPricingCredits(-1, "ceil_2dp")).toBe(0);
  });
});
