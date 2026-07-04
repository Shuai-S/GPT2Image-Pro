/**
 * 模型定价 UOL 操作测试。
 *
 * 职责：验证公开定价规则查询与费用预览只使用用户可见规则，避免隐藏内部价格经
 * Agent/MCP 公共接口泄漏。
 * 使用方：Vitest DB-free 回归。
 * 关键依赖：model-pricing UOL operation、system-settings 的构建期跳过 DB 开关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  listPublicRules,
  previewPublicCharge,
} from "../operations/model-pricing";

const skipDbEnvKey = "GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB";
const pricingRulesEnvKey = "MODEL_PRICING_RULES";
const originalSkipDb = process.env[skipDbEnvKey];
const originalRules = process.env[pricingRulesEnvKey];

/**
 * 写入测试用运行时定价配置。
 *
 * @sideEffects 修改 process.env，afterEach 负责恢复。
 */
function setPricingRulesEnv() {
  process.env[skipDbEnvKey] = "1";
  process.env[pricingRulesEnvKey] = JSON.stringify({
    version: 1,
    rules: [
      {
        id: "public-gpt",
        name: "Public GPT",
        public: true,
        sortOrder: 1,
        scope: { model: "public-gpt", modality: "text" },
        billingMode: "token",
        token: {
          inputCreditsPer1M: 100,
          outputCreditsPer1M: 400,
        },
        roundingMode: "ceil_2dp",
        enabled: true,
      },
      {
        id: "hidden-gpt",
        name: "Hidden GPT",
        public: false,
        sortOrder: 2,
        scope: { model: "hidden-gpt", modality: "text" },
        billingMode: "token",
        token: {
          inputCreditsPer1M: 1,
          outputCreditsPer1M: 1,
        },
        roundingMode: "ceil_2dp",
        enabled: true,
      },
    ],
  });
}

describe("model pricing UOL operations", () => {
  beforeEach(() => {
    setPricingRulesEnv();
  });

  afterEach(() => {
    if (originalSkipDb === undefined) {
      delete process.env[skipDbEnvKey];
    } else {
      process.env[skipDbEnvKey] = originalSkipDb;
    }
    if (originalRules === undefined) {
      delete process.env[pricingRulesEnvKey];
    } else {
      process.env[pricingRulesEnvKey] = originalRules;
    }
  });

  it("只返回公开启用规则", async () => {
    const result = await listPublicRules.execute(
      {},
      { type: "system", reason: "test" },
      {
        requestId: "test",
        assertOwnership: () => undefined,
      }
    );

    expect(result.rules.map((rule) => rule.id)).toEqual(["public-gpt"]);
  });

  it("按公开规则预览 token 费用并拒绝命中隐藏规则", async () => {
    const visible = await previewPublicCharge.execute(
      {
        query: { model: "public-gpt", modality: "text" },
        tokenUsage: { inputTokens: 10_000, outputTokens: 5_000 },
        groupMultiplier: 2,
      },
      { type: "system", reason: "test" },
      {
        requestId: "test",
        assertOwnership: () => undefined,
      }
    );

    const hidden = await previewPublicCharge.execute(
      {
        query: { model: "hidden-gpt", modality: "text" },
        tokenUsage: { inputTokens: 10_000 },
      },
      { type: "system", reason: "test" },
      {
        requestId: "test",
        assertOwnership: () => undefined,
      }
    );

    expect(visible.matched).toBe(true);
    expect(visible.rule?.id).toBe("public-gpt");
    expect(visible.finalCredits).toBe(6);
    expect(visible.pricingSnapshot?.ruleId).toBe("public-gpt");
    expect(hidden).toMatchObject({
      matched: false,
      rule: null,
      finalCredits: null,
    });
  });
});
