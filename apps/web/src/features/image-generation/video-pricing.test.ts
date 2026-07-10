/**
 * 创作页视频价格预览测试。
 *
 * 覆盖价格预览借用后端池成员时的租约释放，避免只读页面访问占满视频后端并发。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const systemSettingsMock = vi.hoisted(() => ({
  getRuntimeSettingJson: vi.fn(async () => ({ sora2: 1.5 })),
  getRuntimeSettingNumber: vi.fn(async () => 30),
}));

const backendPoolMock = vi.hoisted(() => ({
  releaseImageBackendInflightLease: vi.fn(async () => undefined),
}));

const imageServiceMock = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  logError: vi.fn(),
  createContextLogger: vi.fn(() => ({ warn: vi.fn() })),
}));

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/shared/credits/core", () => ({ consumeCredits: vi.fn() }));
vi.mock("@repo/shared/generation-maintenance", () => ({
  refundGenerationCredits: vi.fn(),
}));
vi.mock("@repo/shared/logger", () => loggerMock);
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  ...systemSettingsMock,
  getRuntimeSettingString: vi.fn(),
  isOperationFeatureEnabled: vi.fn(async () => true),
}));
vi.mock("@/features/image-backend-pool/service", () => ({
  ...backendPoolMock,
  poolBackendMemberType: vi.fn(() => "adobe"),
}));
vi.mock("@/features/external-api/quota", () => ({
  refundExternalApiKeyCredits: vi.fn(),
  reserveExternalApiKeyCredits: vi.fn(),
}));
vi.mock("./adobe-direct", () => ({ runAdobeDirectVideoRequest: vi.fn() }));
vi.mock("./gallery-cache", () => ({
  invalidateGalleryCountsCache: vi.fn(),
}));
vi.mock("./service", () => ({
  ...imageServiceMock,
  poolBackendMemberType: vi.fn(() => "adobe"),
}));

describe("getVideoPricingForUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("releases the backend lease acquired for pricing preview", async () => {
    const backend = {
      type: "pool-adobe" as const,
      id: "adobe-1",
      billingMultiplier: 1.25,
      inflightLease: true,
      inflightLeaseId: "lease-1",
      inflightLeasePersisted: true,
    };
    imageServiceMock.getEffectiveConfig.mockResolvedValue({
      config: {
        baseUrl: "https://adobe.example.test",
        apiKey: "test-key",
        backend,
      },
      useCredits: true,
    });

    const { getVideoPricingForUser } = await import("./video-operations");
    const pricing = await getVideoPricingForUser({ userId: "user-1" });

    expect(pricing).toEqual({
      basePerSecond: 30,
      multipliers: { sora2: 1.5 },
      backendMultiplier: 1.25,
    });
    expect(
      backendPoolMock.releaseImageBackendInflightLease
    ).toHaveBeenCalledWith({
      memberType: "adobe",
      memberId: "adobe-1",
      leaseId: "lease-1",
      leasePersisted: true,
    });
    expect(backend.inflightLease).toBe(false);
  });

  it("keeps pricing available when persisted lease cleanup fails", async () => {
    const backend = {
      type: "pool-adobe" as const,
      id: "adobe-2",
      billingMultiplier: 1.1,
      inflightLease: true,
      inflightLeaseId: "lease-2",
      inflightLeasePersisted: true,
    };
    imageServiceMock.getEffectiveConfig.mockResolvedValue({
      config: {
        baseUrl: "https://adobe.example.test",
        apiKey: "test-key",
        backend,
      },
      useCredits: true,
    });
    backendPoolMock.releaseImageBackendInflightLease.mockRejectedValueOnce(
      new Error("database unavailable")
    );

    const { getVideoPricingForUser } = await import("./video-operations");
    const pricing = await getVideoPricingForUser({ userId: "user-2" });

    expect(pricing.backendMultiplier).toBe(1.1);
    expect(backend.inflightLease).toBe(false);
    expect(loggerMock.logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "database unavailable" }),
      {
        context: "release video pricing backend lease",
        backendId: "adobe-2",
        backendType: "pool-adobe",
      }
    );
  });
});
