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
  vi.fn<(tag: string) => void>()
);

vi.mock("next/cache", () => ({
  unstable_cache: <TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>
  ) => async (...args: TArgs): Promise<TResult> => fn(...args),
  revalidateTag: revalidateTagSpy,
}));

const SLA_STATS_CACHE_TAG = "sla-stats";

describe("invalidateSlaStatsCache (C-P0-1)", () => {
  it("calls revalidateTag with the SLA stats cache tag", async () => {
    revalidateTagSpy.mockClear();
    const { invalidateSlaStatsCache } = await import("./sla");
    invalidateSlaStatsCache();
    expect(revalidateTagSpy).toHaveBeenCalledWith(SLA_STATS_CACHE_TAG);
  });

  it("does not throw when revalidateTag raises", async () => {
    revalidateTagSpy.mockImplementationOnce(() => {
      throw new Error("not in server action");
    });
    const { invalidateSlaStatsCache } = await import("./sla");
    expect(() => invalidateSlaStatsCache()).not.toThrow();
  });
});