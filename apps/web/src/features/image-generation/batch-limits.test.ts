/**
 * batch-limits 单测。
 *
 * 职责：锁定单次批量张数上限使用 imageGenerationConcurrency 的回归保护。
 * 使用方：Vitest 测试套件。
 * 关键依赖：batch-limits.ts 纯函数。
 */
import { describe, expect, it } from "vitest";

import { getImageBatchCountLimit } from "./batch-limits";

describe("getImageBatchCountLimit", () => {
  it("uses imageGenerationConcurrency as the single batch count limit", () => {
    expect(
      getImageBatchCountLimit({
        imageGenerationConcurrency: 88,
      })
    ).toBe(88);
  });

  it("falls back to 1 for invalid runtime settings", () => {
    expect(
      getImageBatchCountLimit({
        imageGenerationConcurrency: Number.NaN,
      })
    ).toBe(1);
  });
});
