import { describe, expect, it, vi } from "vitest";

// DB-free 单测:只验证 invalidateSlaStatsCache 封装 revalidateTag 的行为与降级,
// 不触达真实 next/cache / DB。

vi.mock("server-only", () => ({}));

vi.mock("@repo/database", () => ({ db: {} }));

vi.mock("@repo/database/schema", () => ({
  generation: { status: "status", error: "error", createdAt: "created_at" },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  inArray: vi.fn(),
}));

const revalidateTagSpy = vi.hoisted(() =>
  vi.fn<(tag: string, profile?: string) => void>()
);

vi.mock("next/cache", () => ({
  unstable_cache:
    <TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => Promise<TResult>
    ) =>
    async (...args: TArgs): Promise<TResult> =>
      fn(...args),
  revalidateTag: revalidateTagSpy,
}));

const SLA_STATS_CACHE_TAG = "sla-stats";

describe("invalidateSlaStatsCache (C-P0-1)", () => {
  it("calls revalidateTag with the SLA stats cache tag", async () => {
    revalidateTagSpy.mockClear();
    const { invalidateSlaStatsCache } = await import("./sla");
    invalidateSlaStatsCache();
    // Next 16 的 revalidateTag 需要显式 profile:"max" 立即彻底失效。
    expect(revalidateTagSpy).toHaveBeenCalledWith(SLA_STATS_CACHE_TAG, "max");
  });

  it("does not throw when revalidateTag raises", async () => {
    revalidateTagSpy.mockImplementationOnce(() => {
      throw new Error("not in server action");
    });
    const { invalidateSlaStatsCache } = await import("./sla");
    expect(() => invalidateSlaStatsCache()).not.toThrow();
  });

  it("skips the SLA database query during database-free builds", async () => {
    const previousSkipValue = process.env.GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB;
    process.env.GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB = "1";

    try {
      const { getRecentGenerationSlaStats } = await import("./sla");
      await expect(getRecentGenerationSlaStats(1000)).resolves.toEqual({
        sampleSize: 0,
        completed: 0,
        failed: 0,
        successRate: 1,
        platformErrors: 0,
        moderationErrors: 0,
        userRequestErrors: 0,
      });
    } finally {
      if (previousSkipValue === undefined) {
        delete process.env.GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB;
      } else {
        process.env.GPT2IMAGE_SKIP_RUNTIME_SETTINGS_DB = previousSkipValue;
      }
    }
  });
});
