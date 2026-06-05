import { describe, expect, it, vi } from "vitest";

// 让健康映射 DB-free:冷却分钟等运行时设置一律返回默认值,避免去查 system_setting 表。
vi.mock("@repo/shared/system-settings", () => ({
  clearSystemSettingsCache: () => {},
  getRuntimeSettingJson: async (_key: string, def?: unknown) => def ?? null,
  getRuntimeSettingNumber: async (_key: string, def?: number) => def ?? 0,
  getRuntimeSettingString: async (_key: string, def?: string) => def ?? "",
}));

async function loadOverride() {
  process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
  const service = await import("./service");
  return service.getSub2ApiHealthOverride;
}

type AccountOverrides = Partial<
  Awaited<ReturnType<typeof loadOverride>> extends (
    account: infer A
  ) => unknown
    ? A
    : never
>;

// 构造最小 Sub2ApiTokenAccount:只关心健康相关字段,其余给中性默认值。
function makeAccount(overrides: AccountOverrides) {
  return {
    sourceId: "src-1",
    name: null,
    email: null,
    chatgptAccountId: null,
    codexAccessToken: null,
    refreshToken: null,
    clientId: null,
    oauthFamily: null,
    oauthType: null,
    priority: null,
    concurrency: null,
    planType: null,
    groupNames: [],
    sourceStatus: null,
    sourceSchedulable: null,
    sourceError: null,
    sourceStatusCode: null,
    sourceRateLimitResetAt: null,
    sourceOverloadUntil: null,
    sourceTempUnschedulableUntil: null,
    sourceCooldownUntil: null,
    sourceUpdatedAt: null,
    ...overrides,
  };
}

describe("getSub2ApiHealthOverride:仅同步上游错误/限流,不同步 enable/可调度态", () => {
  it("上游 active 但 schedulable=false 不再判 error(落 status:null 自愈)", async () => {
    const getSub2ApiHealthOverride = await loadOverride();
    const result = await getSub2ApiHealthOverride(
      makeAccount({ sourceStatus: "active", sourceSchedulable: false })
    );
    expect(result.status).toBeNull();
  });

  it("上游 disabled/inactive 不再判 error(enable 轴,落 status:null)", async () => {
    const getSub2ApiHealthOverride = await loadOverride();
    for (const sourceStatus of ["disabled", "inactive", "deactivated"]) {
      const result = await getSub2ApiHealthOverride(
        makeAccount({ sourceStatus })
      );
      expect(result.status).toBeNull();
    }
  });

  it("上游凭据失效/封禁仍判 error", async () => {
    const getSub2ApiHealthOverride = await loadOverride();
    const invalidated = await getSub2ApiHealthOverride(
      makeAccount({ sourceStatus: "token_invalidated" })
    );
    expect(invalidated.status).toBe("error");
    const banned = await getSub2ApiHealthOverride(
      makeAccount({ sourceStatus: "banned" })
    );
    expect(banned.status).toBe("error");
  });

  it("上游限流仍判 limited", async () => {
    const getSub2ApiHealthOverride = await loadOverride();
    const result = await getSub2ApiHealthOverride(
      makeAccount({ sourceStatus: "rate_limited" })
    );
    expect(result.status).toBe("limited");
  });
});
