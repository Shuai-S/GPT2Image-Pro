/**
 * Web UOL 延迟绑定的身份边界测试。
 *
 * 覆盖会产生扣费或查询持久任务的图像与可编辑文件操作，确保业务层只使用
 * Principal 中已鉴权的身份，忽略传输参数中伪造的 userId，并隐藏跨用户资源。
 */

import {
  clearRegistry,
  invokeOperation,
  type Principal,
} from "@repo/shared/uol";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  runImageGenerationForUser: vi.fn(),
  enqueueEditableFileTask: vi.fn(),
  getAsyncImageTask: vi.fn(),
  getUserPlan: vi.fn(),
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));

vi.mock("@/features/external-api/editable-task-service", () => ({
  enqueueEditableFileTask: mocks.enqueueEditableFileTask,
}));

vi.mock("@/features/external-api/async-image-tasks", () => ({
  getAsyncImageTask: mocks.getAsyncImageTask,
  toAsyncImageTaskResponse: vi.fn((task) => {
    const { userId: _userId, apiKeyId: _apiKeyId, ...publicTask } = task;
    return publicTask;
  }),
}));

vi.mock("@/features/image-backend-pool/service", () => ({
  getUserImageBackendPreference: vi.fn(),
  listAdminImageBackendPool: vi.fn(),
  listSelectableImageBackendGroups: vi.fn(),
  setUserImageBackendPreference: vi.fn(),
}));

vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: mocks.getUserPlan,
}));

vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  PLAN_CAPABILITY_KEYS: ["export.ppt", "export.psd"],
  canUsePlanCapability: vi.fn(async () => true),
  getPlanQueueSettings: vi.fn(async () => ({
    priority: "priority",
    userConcurrency: 3,
  })),
}));

const USER_PRINCIPAL: Principal = {
  type: "user",
  userId: "user-a",
  role: "user",
};

const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

beforeAll(async () => {
  clearRegistry();
  await import("./uol-bindings");
});

afterAll(() => {
  clearRegistry();
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runImageGenerationForUser.mockResolvedValue({
    generationId: "generation-1",
    imageUrl: "https://cdn.example/image.png",
    creditsConsumed: 1,
  });
  mocks.getUserPlan.mockResolvedValue({ plan: "pro" });
  mocks.enqueueEditableFileTask.mockResolvedValue({
    taskId: "task-1",
    status: "queued",
    kind: "ppt",
    createdAt: "2026-07-10T00:00:00.000Z",
  });
  mocks.getAsyncImageTask.mockResolvedValue(undefined);
});

describe("UOL billed operation identity", () => {
  it("derives image generation ownership from the user principal", async () => {
    await invokeOperation(
      "image.generate",
      {
        userId: "user-b",
        prompt: "mountain",
        generationId: "generation-1",
      },
      USER_PRINCIPAL
    );

    expect(mocks.runImageGenerationForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        prompt: "mountain",
        generationId: "generation-1",
      })
    );
  });

  it("cannot disable an API key relay-only restriction through input", async () => {
    const principal: Principal = {
      type: "apiKey",
      userId: "user-a",
      apiKeyId: "key-1",
      plan: "pro",
      relayOnly: true,
    };

    await invokeOperation(
      "image.generate",
      {
        prompt: "mountain",
        generationId: "generation-2",
        relayOnly: false,
      },
      principal
    );

    expect(mocks.runImageGenerationForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        apiKeyId: "key-1",
        relayOnly: true,
      })
    );
  });

  it("从用户 Principal 派生可编辑文件入队归属", async () => {
    await invokeOperation(
      "file.generatePpt",
      {
        userId: "user-b",
        clientRequestId: "request-1",
        prompt: "quarterly report",
      },
      USER_PRINCIPAL
    );

    expect(mocks.enqueueEditableFileTask).toHaveBeenCalledWith({
      userId: "user-a",
      apiKeyId: undefined,
      kind: "ppt",
      clientRequestId: "request-1",
      prompt: "quarterly report",
      base64Images: [],
      priority: "priority",
      userConcurrency: 3,
    });
  });

  it("API Key 入队时从 Principal 绑定用户、Key 与套餐", async () => {
    const principal: Principal = {
      type: "apiKey",
      userId: "user-a",
      apiKeyId: "key-1",
      plan: "ultra",
      relayOnly: false,
    };

    await invokeOperation(
      "file.generatePsd",
      {
        clientRequestId: "request-2",
        prompt: "layered poster",
        base64Images: ["aW1hZ2U="],
      },
      principal
    );

    expect(mocks.getUserPlan).not.toHaveBeenCalled();
    expect(mocks.enqueueEditableFileTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        apiKeyId: "key-1",
        kind: "psd",
      })
    );
  });

  it("跨用户查询持久任务统一返回 not_found", async () => {
    mocks.getAsyncImageTask.mockResolvedValue({
      id: "task-other",
      object: "editable_file_task",
      userId: "user-b",
      status: "processing",
      created_at: "2026-07-10T00:00:00.000Z",
    });

    await expect(
      invokeOperation(
        "file.getEditableTask",
        { taskId: "task-other" },
        USER_PRINCIPAL
      )
    ).rejects.toMatchObject({ code: "not_found", httpStatus: 404 });
  });
});
