/**
 * 图像统一管线的业务行 fencing 调用级测试。
 *
 * 使用方：普通 generation worker。通过 DB-free 边界 mock 覆盖 pending 接管、旧执行
 * 失权、对象清理和终态赢家恢复，避免只验证 task 外壳而遗漏财务/存储副作用。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type PersistedGeneration = {
  id: string;
  userId: string;
  status: "pending" | "completed" | "failed";
  executionToken: string | null;
  model: string;
  size: string;
  storageKey: string | null;
  storageBucket: string | null;
  revisedPrompt: string | null;
  creditsConsumed: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

const state = vi.hoisted(() => ({
  recoverRows: [] as Array<PersistedGeneration | null>,
  claimSucceeds: true,
  completionSucceeds: true,
  ownershipLost: false,
  useCredits: false,
  price: 0,
  updateSets: [] as Array<Record<string, unknown>>,
  insertedValues: [] as Array<Record<string, unknown>>,
}));
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
const serviceMock = vi.hoisted(() => ({
  createImageBackendRetryCoordinator: vi.fn(() => ({ resolve: vi.fn() })),
  editImage: vi.fn(),
  generateChatImage: vi.fn(),
  generateImage: vi.fn(),
  getEffectiveConfig: vi.fn(),
  getResponsesModel: vi.fn(),
  getUserApiConfig: vi.fn(async () => null),
  poolBackendMemberType: vi.fn(() => "api"),
  repairModerationBlockedPromptWithResponses: vi.fn(),
}));

vi.mock("@repo/database", () => ({ db: databaseMock }));
vi.mock("@repo/shared/credits/core", () => creditsMock);
vi.mock("@repo/shared/generation-maintenance", () => ({
  IMAGE_GENERATION_PENDING_TIMEOUT_MS: 20 * 60_000,
  ...maintenanceMock,
  resolveImageGenerationTimeoutError: vi.fn(() => "timed out"),
}));
vi.mock("@repo/shared/generation-settlement", () => ({
  getFailedGenerationTargetCredits: vi.fn(() => 0),
}));
vi.mock("@repo/shared/http/fetch", () => ({
  DEFAULT_IMAGE_RESPONSE_MAX_BYTES: 20 * 1024 * 1024,
  DEFAULT_JSON_RESPONSE_MAX_BYTES: 2 * 1024 * 1024,
  fetchWithDeadline: vi.fn(),
  readResponseJsonWithLimit: vi.fn(),
  readResponseTextWithLimit: vi.fn(),
}));
vi.mock("@repo/shared/logger", () => ({ logWarn: vi.fn() }));
vi.mock("@repo/shared/moderation", () => ({
  isContentModerationEnabled: vi.fn(async () => false),
  moderateContent: vi.fn(),
}));
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => storageMock),
}));
vi.mock("@repo/shared/storage/signed-url", () => ({
  buildSignedStorageImageUrl: vi.fn(
    (key: string, bucket: string | null) =>
      `https://images.example/${bucket ?? "generations"}/${key}`
  ),
}));
vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  getPlanCapabilitySnapshot: vi.fn(async () => ({
    features: new Proxy({}, { get: () => true }) as Record<string, boolean>,
    limits: { maxChatContextChars: 100_000 },
    billing: { agentRoundCredits: 0, chatRoundCredits: 0 },
  })),
  getPlanQueueSettings: vi.fn(async () => ({
    priority: 0,
    userConcurrency: 1,
  })),
  normalizePlanModerationBlockRiskLevel: vi.fn(
    async (_plan: string, requested: string) => requested
  ),
}));
vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: vi.fn(async () => ({ plan: "free" })),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeOperationFeatureFlags: vi.fn(async () => ({
    agent: true,
    chat: true,
    imageToImage: true,
    textToImage: true,
    video: true,
    waterfall: true,
  })),
  getRuntimeSettingBoolean: vi.fn(
    async (_key: string, fallback: boolean) => fallback
  ),
  getRuntimeSettingJson: vi.fn(async () => ({})),
  getRuntimeSettingNumber: vi.fn(
    async (_key: string, fallback: number) => fallback
  ),
  getRuntimeSettingString: vi.fn(async () => "bucket-b"),
}));
vi.mock("@/features/external-api/quota", () => quotaMock);
vi.mock("@/features/image-backend-pool/service", () => ({
  ImageBackendPoolUnavailableError: class extends Error {},
  releaseImageBackendInflightLease: vi.fn(),
}));
vi.mock("./batch-limits", () => ({
  getImageBatchCountLimit: vi.fn(() => 10),
}));
vi.mock("./gallery-cache", () => ({
  invalidateGalleryCountsCache: vi.fn(),
}));
vi.mock("./model-pricing-adapter", () => ({
  getImageModelPricingBreakdown: vi.fn(() => ({
    baseCredits: state.price,
    effectiveBaseCredits: state.price,
    totalCredits: state.price,
    imageModerationCount: 0,
    moderationCny: 0,
    moderationCredits: 0,
    moderationOnlyCredits: 0,
    qualityMultiplier: 1,
    textModerationCredits: 0,
    textModerationCount: 0,
    thinkingMultiplier: 1,
    pixels: 1_048_576,
    pricingSnapshot: {},
  })),
  resolveConfiguredImageModelMultiplier: vi.fn(() => 1),
  resolveFixedImageModelCharge: vi.fn(() => ({ credits: 0 })),
}));
vi.mock("./pricing-settings", () => ({
  getRuntimeImageBaseCreditPricing: vi.fn(async () => ({})),
  getRuntimeModelPricingRules: vi.fn(async () => []),
  getRuntimeModerationCreditPricing: vi.fn(async () => ({})),
}));
vi.mock("./queue", () => ({
  withImageGenerationQueue: vi.fn(
    async (_options: unknown, run: (signal: AbortSignal) => Promise<unknown>) =>
      await run(new AbortController().signal)
  ),
}));
vi.mock("./service", () => serviceMock);
vi.mock("./sla", () => ({ invalidateSlaStatsCache: vi.fn() }));

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

/** 构造测试使用的 pending generation。 */
function pendingGeneration(token: string): PersistedGeneration {
  return {
    id: "generation-1",
    userId: "user-1",
    status: "pending",
    executionToken: token,
    model: "gpt-image-1",
    size: "1024x1024",
    storageKey: null,
    storageBucket: "bucket-a",
    revisedPrompt: null,
    creditsConsumed: 0,
    error: null,
    metadata: null,
  };
}

/** 安装按字段类型区分 ownership 与终态恢复的 Drizzle mock。 */
function installDatabaseMock(): void {
  databaseMock.select.mockImplementation(
    (selection: Record<string, unknown> | undefined) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (selection && "status" in selection) {
              const row = state.recoverRows.shift();
              return row ? [row] : [];
            }
            return state.ownershipLost ? [] : [{ id: "generation-1" }];
          }),
        })),
      })),
    })
  );
  databaseMock.insert.mockReturnValue({
    values: vi.fn((values: Record<string, unknown>) => {
      state.insertedValues.push(values);
      return { onConflictDoNothing: vi.fn(async () => undefined) };
    }),
  });
  databaseMock.update.mockReturnValue({
    set: vi.fn((values: Record<string, unknown>) => {
      state.updateSets.push(values);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (values.executionToken) {
              return state.claimSucceeds ? [{ id: "generation-1" }] : [];
            }
            if (values.status === "completed") {
              return state.completionSucceeds ? [{ id: "generation-1" }] : [];
            }
            return [];
          }),
        })),
      };
    }),
  });
}

/** 执行一条最小 generate 请求。 */
async function runGeneration(signal?: AbortSignal) {
  const { runImageGenerationForUser } = await import("./operations");
  return await runImageGenerationForUser({
    mode: "generate",
    userId: "user-1",
    apiKeyId: "key-1",
    generationId: "generation-1",
    executionToken: "token-b",
    resolvedUserPlan: "free",
    moderationBlockRiskLevel: "medium",
    prompt: "test image",
    model: "gpt-image-1",
    size: "1024x1024",
    moderationPromptRepair: false,
    ...(signal ? { signal } : {}),
  });
}

describe("runImageGenerationForUser fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.recoverRows = [null];
    state.claimSucceeds = true;
    state.completionSucceeds = true;
    state.ownershipLost = false;
    state.useCredits = false;
    state.price = 0;
    state.updateSets = [];
    state.insertedValues = [];
    installDatabaseMock();
    creditsMock.consumeCredits.mockResolvedValue({ consumedAmount: 0 });
    maintenanceMock.refundGenerationCredits.mockResolvedValue({
      refunded: true,
      amount: 0,
    });
    quotaMock.reserveExternalApiKeyCredits.mockResolvedValue(undefined);
    quotaMock.refundExternalApiKeyCredits.mockResolvedValue(undefined);
    storageMock.putObject.mockResolvedValue(undefined);
    storageMock.deleteObject.mockResolvedValue(undefined);
    serviceMock.getEffectiveConfig.mockImplementation(async () => ({
      config: {
        baseUrl: "https://images.example",
        apiKey: "test-key",
        model: "gpt-image-1",
        backend: { type: "platform" as const },
      },
      useCredits: state.useCredits,
    }));
    serviceMock.generateImage.mockResolvedValue({
      imageBase64: ONE_PIXEL_PNG,
    });
  });

  it("新 token 原子接管 pending 并复用同一业务行完成", async () => {
    state.recoverRows = [pendingGeneration("token-a")];

    await expect(runGeneration()).resolves.toMatchObject({
      generationId: "generation-1",
      imageUrl: expect.stringContaining("bucket-b/"),
    });

    expect(state.updateSets).toContainEqual({ executionToken: "token-b" });
    expect(state.insertedValues).toHaveLength(1);
    expect(state.updateSets).toContainEqual(
      expect.objectContaining({
        status: "completed",
        storageBucket: "bucket-b",
      })
    );
  });

  it("旧执行在 token 失权后不退款也不写业务终态", async () => {
    state.useCredits = true;
    state.price = 10;
    serviceMock.generateImage.mockImplementation(async () => {
      state.ownershipLost = true;
      return { error: "old upstream failed" };
    });

    await expect(runGeneration()).resolves.toMatchObject({
      generationId: "generation-1",
      error: expect.any(String),
    });

    expect(creditsMock.consumeCredits).toHaveBeenCalledTimes(1);
    expect(maintenanceMock.refundGenerationCredits).not.toHaveBeenCalled();
    expect(
      state.updateSets.some(
        (values) => values.status === "failed" || values.status === "completed"
      )
    ).toBe(false);
  });

  it("存储完成后 task abort 会删除本次对象且不写 completed", async () => {
    const controller = new AbortController();
    storageMock.putObject.mockImplementation(async () => {
      controller.abort(new Error("task lease lost"));
    });

    await expect(runGeneration(controller.signal)).resolves.toMatchObject({
      generationId: "generation-1",
      error: expect.any(String),
    });

    expect(storageMock.deleteObject).toHaveBeenCalledTimes(1);
    expect(
      state.updateSets.some((values) => values.status === "completed")
    ).toBe(false);
    expect(maintenanceMock.refundGenerationCredits).not.toHaveBeenCalled();
  });

  it("completed 条件写丢失时清对象并恢复终态赢家", async () => {
    state.completionSucceeds = false;
    state.recoverRows = [
      null,
      {
        ...pendingGeneration("token-c"),
        status: "completed",
        storageKey: "user-1/winner.png",
        storageBucket: "bucket-a",
        creditsConsumed: 10,
      },
    ];

    await expect(runGeneration()).resolves.toMatchObject({
      generationId: "generation-1",
      imageUrl: "https://images.example/bucket-a/user-1/winner.png",
      creditsConsumed: 10,
    });

    expect(storageMock.deleteObject).toHaveBeenCalledTimes(1);
  });
});
