/**
 * Web UOL 延迟绑定的身份边界测试。
 *
 * 覆盖会产生扣费的图像与可编辑文件操作，确保业务层只使用 Principal 中
 * 已鉴权的用户身份，忽略传输参数中伪造的 userId，并强制 API Key 中转约束。
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
  runEditableFileForUser: vi.fn(),
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));

vi.mock("@/features/image-generation/editable-file-operations", () => ({
  runEditableFileForUser: mocks.runEditableFileForUser,
}));

vi.mock("@/features/image-backend-pool/service", () => ({
  getUserImageBackendPreference: vi.fn(),
  listAdminImageBackendPool: vi.fn(),
  listSelectableImageBackendGroups: vi.fn(),
  setUserImageBackendPreference: vi.fn(),
}));

vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: vi.fn(),
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
  mocks.runEditableFileForUser.mockResolvedValue({
    primaryUrl: "https://cdn.example/file.pptx",
    zipUrl: null,
    creditsCharged: 10,
  });
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

  it("derives editable file billing ownership from the user principal", async () => {
    await invokeOperation(
      "file.generatePpt",
      {
        userId: "user-b",
        clientRequestId: "request-1",
        prompt: "quarterly report",
      },
      USER_PRINCIPAL
    );

    expect(mocks.runEditableFileForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        taskId: "request-1",
      })
    );
  });
});
