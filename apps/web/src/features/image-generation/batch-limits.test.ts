/**
 * batch-limits 单测。
 *
 * 职责：锁定单次批量张数上限使用 maxBatchCount 与平台 4 张硬上限。
 * 使用方：Vitest 测试套件。
 * 关键依赖：batch-limits.ts 纯函数。
 */
import { describe, expect, it } from "vitest";

import { getImageBatchCountLimit, MAX_IMAGE_BATCH_COUNT } from "./batch-limits";

describe("getImageBatchCountLimit", () => {
  it("uses maxBatchCount rather than concurrency as the batch count limit", () => {
    expect(
      getImageBatchCountLimit({
        maxBatchCount: 4,
        imageGenerationConcurrency: 2,
      })
    ).toBe(4);
  });

  it("caps overly high plan settings to the platform max", () => {
    expect(
      getImageBatchCountLimit({
        maxBatchCount: 88,
        imageGenerationConcurrency: 88,
      })
    ).toBe(MAX_IMAGE_BATCH_COUNT);
  });

  it("falls back to 1 for invalid runtime settings", () => {
    expect(
      getImageBatchCountLimit({
        maxBatchCount: Number.NaN,
        imageGenerationConcurrency: Number.NaN,
      })
    ).toBe(1);
  });
});
