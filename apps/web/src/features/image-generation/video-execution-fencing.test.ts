/**
 * 视频生成执行 fencing 与资源清理测试。
 *
 * 使用方：持久 generation worker。关键依赖全部替换为 DB-free mock，锁定旧租约 abort
 * 不得退款/改终态，以及完成写库异常必须删除孤立对象并释放后端并发租约。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));
const creditsMock = vi.hoisted(() => ({ consumeCredits: vi.fn() }));
const maintenanceMock = vi.hoisted(() => ({
  refundGenerationCredits: vi.fn(),
}));
const quotaMock = vi.hoisted(() => ({
  refundExternalApiKeyCredits: vi.fn(),
  reserveExternalApiKeyCredits: vi.fn(),
}));
const storageMock = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  putObject: vi.fn(),
}));
const backendPoolMock = vi.hoisted(() => ({
  releaseImageBackendInflightLease: vi.fn(),
}));
const directMock = vi.hoisted(() => ({
  runAdobeDirectVideoRequest: vi.fn(),
}));
const serviceMock = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
  poolBackendMemberType: vi.fn(() => "adobe"),
}));
const planCapabilitiesMock = vi.hoisted(() => ({
  getPlanQueueSettings: vi.fn(async () => ({
    priority: "priority" as const,
    userConcurrency: 2,
  })),
}));
const userPlanMock = vi.hoisted(() => ({
  getUserPlan: vi.fn(async () => ({ plan: "pro" as const })),
}));
const queueMock = vi.hoisted(() => ({
  withImageGenerationQueue: vi.fn(
    async (
      _options: unknown,
      run: (signal: AbortSignal) => Promise<unknown>
    ) => await run(new AbortController().signal)
  ),
}));

vi.mock("@repo/database", () => ({ db: databaseMock }));
vi.mock("@repo/shared/credits/core", () => creditsMock);
vi.mock("@repo/shared/generation-maintenance", () => maintenanceMock);
vi.mock("@repo/shared/logger", () => ({ logError: vi.fn() }));
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => storageMock),
}));
vi.mock(
  "@repo/shared/subscription/services/plan-capabilities",
  () => planCapabilitiesMock
);
vi.mock("@repo/shared/subscription/services/user-plan", () => userPlanMock);
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingJson: vi.fn(async () => ({})),
  getRuntimeSettingNumber: vi.fn(async () => 30),
  getRuntimeSettingString: vi.fn(async () => "generations"),
  isOperationFeatureEnabled: vi.fn(async () => true),
}));
vi.mock("@/features/external-api/quota", () => quotaMock);
vi.mock("@/features/image-backend-pool/service", () => backendPoolMock);
vi.mock("./adobe-direct", () => directMock);
vi.mock("./gallery-cache", () => ({
  invalidateGalleryCountsCache: vi.fn(),
}));
vi.mock("./queue", () => queueMock);
vi.mock("./service", () => serviceMock);

/** 构造一次可直接执行的 Adobe 后端配置，每项测试使用独立对象避免租约状态串扰。 */
function createBackendConfig() {
  return {
    config: {
      baseUrl: "https://adobe.example.test",
      apiKey: "test-key",
      backend: {
        type: "pool-adobe" as const,
        adobeMode: "direct" as const,
        id: "adobe-1",
        billingMultiplier: 1,
        inflightLease: true,
        inflightLeaseId: "backend-lease-1",
        inflightLeasePersisted: true,
      },
    },
    useCredits: true,
  };
}

/**
 * 安装 video_generation insert 与按顺序返回的 update returning 结果。
 *
 * @param outcomes 每次 db.update 的 returning 结果或要抛出的错误。
 * @sideEffects 重置 databaseMock 的 insert/update 实现。
 */
function installDatabaseUpdates(
  outcomes: Array<ReadonlyArray<Record<string, unknown>> | Error>
): void {
  databaseMock.insert.mockReturnValue({
    values: vi.fn(async () => undefined),
  });
  databaseMock.update.mockImplementation(() => {
    const outcome = outcomes.shift();
    const returning = vi.fn(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome ?? [];
    });
    return {
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning })),
      })),
    };
  });
}

/**
 * 安装按调用顺序返回的 select limit 结果。
 *
 * @param outcomes 每次查询返回的行数组。
 * @sideEffects 替换 databaseMock.select，供恢复与并发终态场景使用。
 */
function installDatabaseSelects(
  outcomes: Array<ReadonlyArray<Record<string, unknown>>>
): void {
  databaseMock.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => outcomes.shift() ?? []),
      })),
    })),
  }));
}

describe("runAdobeVideoGenerationForUser fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDatabaseSelects([[]]);
    creditsMock.consumeCredits.mockResolvedValue({ success: true });
    quotaMock.reserveExternalApiKeyCredits.mockResolvedValue(undefined);
    quotaMock.refundExternalApiKeyCredits.mockResolvedValue(undefined);
    maintenanceMock.refundGenerationCredits.mockResolvedValue({
      refunded: true,
      amount: 240,
    });
    storageMock.putObject.mockResolvedValue(undefined);
    storageMock.deleteObject.mockResolvedValue(undefined);
    backendPoolMock.releaseImageBackendInflightLease.mockResolvedValue(
      undefined
    );
    serviceMock.getEffectiveConfig.mockResolvedValue(createBackendConfig());
  });

  it("按已解析套餐获取集群许可并合并 semaphore fencing 信号", async () => {
    const leaseError = new Error("image concurrency lease lost");
    queueMock.withImageGenerationQueue.mockImplementationOnce(
      async (_options, run) => {
        const controller = new AbortController();
        controller.abort(leaseError);
        return await run(controller.signal);
      }
    );

    const { runAdobeVideoGenerationForUser } = await import(
      "./video-operations"
    );
    await expect(
      runAdobeVideoGenerationForUser({
        userId: "user-1",
        resolvedUserPlan: "pro",
        prompt: "test video",
        model: "firefly-sora2-8s-16x9",
      })
    ).rejects.toThrow("image concurrency lease lost");

    expect(planCapabilitiesMock.getPlanQueueSettings).toHaveBeenCalledWith(
      "pro"
    );
    expect(queueMock.withImageGenerationQueue).toHaveBeenCalledWith(
      {
        userId: "user-1",
        priority: "priority",
        userConcurrency: 2,
        signal: undefined,
      },
      expect.any(Function)
    );
    expect(userPlanMock.getUserPlan).not.toHaveBeenCalled();
    expect(databaseMock.insert).not.toHaveBeenCalled();
  });

  it("租约丢失中止旧上游时不抢失败终态或退款", async () => {
    installDatabaseUpdates([[{ id: "video-1" }]]);
    const controller = new AbortController();
    const leaseError = new Error("generation task lease lost");
    directMock.runAdobeDirectVideoRequest.mockImplementation(async () => {
      controller.abort(leaseError);
      return { error: "upstream aborted" };
    });

    const { runAdobeVideoGenerationForUser } = await import(
      "./video-operations"
    );
    await expect(
      runAdobeVideoGenerationForUser({
        userId: "user-1",
        apiKeyId: "key-1",
        videoGenerationId: "video-1",
        prompt: "test video",
        model: "firefly-sora2-8s-16x9",
        signal: controller.signal,
      })
    ).rejects.toThrow("generation task lease lost");

    expect(databaseMock.update).toHaveBeenCalledTimes(1);
    expect(maintenanceMock.refundGenerationCredits).not.toHaveBeenCalled();
    expect(quotaMock.refundExternalApiKeyCredits).not.toHaveBeenCalled();
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(
      backendPoolMock.releaseImageBackendInflightLease
    ).toHaveBeenCalledTimes(1);
  });

  it("完成写库异常时删除本次对象并释放后端租约", async () => {
    installDatabaseUpdates([
      [{ id: "video-2" }],
      new Error("completed update unavailable"),
    ]);
    directMock.runAdobeDirectVideoRequest.mockResolvedValue({
      bytes: Buffer.from("video"),
      contentType: "video/mp4",
    });

    const { runAdobeVideoGenerationForUser } = await import(
      "./video-operations"
    );
    await expect(
      runAdobeVideoGenerationForUser({
        userId: "user-1",
        apiKeyId: "key-1",
        videoGenerationId: "video-2",
        prompt: "test video",
        model: "firefly-sora2-8s-16x9",
      })
    ).rejects.toThrow("completed update unavailable");

    expect(storageMock.putObject).toHaveBeenCalledTimes(1);
    expect(storageMock.deleteObject).toHaveBeenCalledTimes(1);
    expect(
      backendPoolMock.releaseImageBackendInflightLease
    ).toHaveBeenCalledTimes(1);
    expect(maintenanceMock.refundGenerationCredits).not.toHaveBeenCalled();
  });

  it("旧执行失败晚到 completed 终态时不退款", async () => {
    installDatabaseSelects([
      [],
      [
        {
          id: "video-3",
          userId: "user-1",
          apiKeyId: "key-1",
          status: "completed",
          storageKey: "user-1/winner.mp4",
          creditsConsumed: 240,
          error: null,
        },
      ],
    ]);
    installDatabaseUpdates([[{ id: "video-3" }], []]);
    directMock.runAdobeDirectVideoRequest.mockResolvedValue({
      error: "old upstream failed",
    });

    const { runAdobeVideoGenerationForUser } = await import(
      "./video-operations"
    );
    await expect(
      runAdobeVideoGenerationForUser({
        userId: "user-1",
        apiKeyId: "key-1",
        videoGenerationId: "video-3",
        prompt: "test video",
        model: "firefly-sora2-8s-16x9",
      })
    ).resolves.toEqual({
      videoGenerationId: "video-3",
      storageKey: "user-1/winner.mp4",
      creditsConsumed: 240,
    });

    expect(maintenanceMock.refundGenerationCredits).not.toHaveBeenCalled();
    expect(quotaMock.refundExternalApiKeyCredits).not.toHaveBeenCalled();
  });

  it("超时 running 从真实账本退款并收敛 failed", async () => {
    const staleRow = {
      id: "video-4",
      userId: "user-1",
      apiKeyId: "key-1",
      model: "firefly-sora2-8s-16x9",
      status: "running",
      storageKey: null,
      creditsConsumed: 240,
      error: null,
      updatedAt: new Date("2026-07-10T09:00:00.000Z"),
    };
    installDatabaseSelects([
      [staleRow],
      [{ amount: 240 }],
      [{ amount: 240, status: "reserved" }],
    ]);
    installDatabaseUpdates([
      [{ ...staleRow, status: "recovering" }],
      [{ id: "video-4" }],
    ]);

    const { recoverStaleVideoGeneration } = await import("./video-operations");
    await expect(
      recoverStaleVideoGeneration(
        {
          videoGenerationId: "video-4",
          userId: "user-1",
          apiKeyId: "key-1",
        },
        { now: new Date("2026-07-10T10:00:00.000Z") }
      )
    ).resolves.toEqual({
      error: "视频生成执行超时，已退款，请重试",
      videoGenerationId: "video-4",
    });

    expect(maintenanceMock.refundGenerationCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "video-4",
        userId: "user-1",
        amount: 240,
        sourceRef: "adobe-video:video-4",
      })
    );
    expect(quotaMock.refundExternalApiKeyCredits).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      userId: "user-1",
      amount: 240,
      sourceRef: "adobe-video:video-4",
    });
  });
});
