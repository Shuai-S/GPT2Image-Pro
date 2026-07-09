import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingBoolean: vi.fn(async () => false),
  getRuntimeSettingNumber: vi.fn(
    async (_key: string, fallback: number) => fallback
  ),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

vi.mock("@repo/shared/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const backendPoolMock = vi.hoisted(() => {
  class ImageBackendPoolUnavailableError extends Error {}
  return {
    ImageBackendPoolUnavailableError,
    acquireImageBackendInflight: vi.fn(),
    bindImageBackendStickyMember: vi.fn(async () => undefined),
    releaseImageBackendInflight: vi.fn(),
    releaseImageBackendInflightLease: vi.fn(async () => undefined),
    renewImageBackendInflightLease: vi.fn(async () => undefined),
    recordImageBackendSchedulerSwitch: vi.fn(async () => undefined),
    isImageBackendSwitchableError: vi.fn((error?: string | null) =>
      (error || "").includes("terminated")
    ),
    // 本测试只关注可切换错误的回退路径，未知错误兜底固定不触发。
    isUnclassifiedBackendError: vi.fn(() => false),
    reportImageBackendResult: vi.fn(async (input: { success: boolean }) => ({
      success: input.success,
      retryable: !input.success,
      switchable: !input.success,
    })),
    resolveImageBackendPoolConfig: vi.fn(),
  };
});

const systemSettingsMock = vi.mocked(
  await import("@repo/shared/system-settings")
);

vi.mock("@/features/image-backend-pool/service", () => backendPoolMock);

vi.mock("./chatgpt-web", () => ({
  generateImageWithChatGptWeb: vi.fn(async () => ({ error: "terminated" })),
  editImageWithChatGptWeb: vi.fn(async () => ({ error: "terminated" })),
}));

describe("image service Web-first fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    systemSettingsMock.getRuntimeSettingNumber.mockImplementation(
      async (_key: string, fallback: number) => fallback
    );
  });

  it("serializes concurrent member resolution and excludes all reserved members", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { createImageBackendRetryCoordinator } = await import("./service");
    const resolvedConfigs = ["api-2", "api-3"].map((id) => ({
      config: {
        baseUrl: `https://${id}.example.test/v1`,
        apiKey: `${id}-key`,
        backend: {
          type: "pool-api" as const,
          id,
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation" as const,
          reportResult: true,
        },
      },
    }));
    backendPoolMock.resolveImageBackendPoolConfig
      .mockResolvedValueOnce(resolvedConfigs[0])
      .mockResolvedValueOnce(resolvedConfigs[1]);
    const coordinator = createImageBackendRetryCoordinator([
      {
        baseUrl: "https://api-1.example.test/v1",
        apiKey: "api-1-key",
        backend: {
          type: "pool-api",
          id: "api-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          reportResult: true,
        },
      },
    ]);
    const options = {
      userId: "user-1",
      requestKind: "image_generation" as const,
    };

    await Promise.all([
      coordinator.resolve(options),
      coordinator.resolve(options),
    ]);

    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ excludedMemberKeys: ["api:api-1"] })
    );
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        excludedMemberKeys: ["api:api-1", "api:api-2"],
      })
    );
  });

  it("falls back to Responses when force Web exhausts Web candidates", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("codex-fallback-image").toString("base64");
    // codex(responses 账号)的普通生成现在直连 /images/generations(size 走顶层),
    // 不再走 /responses 工具路径;mock 返回标准 images JSON。
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: [{ b64_json: imageBase64 }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    backendPoolMock.resolveImageBackendPoolConfig
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        config: {
          baseUrl: "https://api.example.test/v1",
          apiKey: "codex-key",
          model: "gpt-5.4",
          backend: {
            type: "pool-account",
            id: "codex-1",
            groupId: "group-1",
            userId: "user-1",
            requestKind: "image_generation",
            accountBackend: "responses",
            reportResult: true,
          },
        },
      });

    const result = await generateImage(
      {
        baseUrl: "https://chatgpt.com",
        apiKey: "web-key",
        backend: {
          type: "pool-account",
          id: "web-1",
          groupId: "group-1",
          // 混合分组:web 先行,轮询完才回退 codex(回退仅 mixed 生效)。
          groupBackendType: "mixed",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "web",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
        forceWebBackend: true,
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountBackendPreference: "web",
        accountBackendPreferenceMode: "mixed-only",
      })
    );
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountBackendPreference: "responses",
        accountBackendPreferenceMode: "mixed-only",
      })
    );
    // 回退到的 codex 账号在普通生成下命中直连 images 端点,而非 /responses。
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/images/generations",
      expect.anything()
    );
  });

  it("非混合分组:Web 耗尽不回退 Codex(回退仅 mixed 生效)", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    // 纯 web 分组的 web 成员撞可切换错误 → 换号 re-resolve 返回 null(web 已轮询完)。
    // 因目标分组非 mixed,不应触发 web→codex 回退,直接返回失败结果。
    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce(null);

    const result = await generateImage(
      {
        baseUrl: "https://chatgpt.com",
        apiKey: "web-key",
        backend: {
          type: "pool-account",
          id: "web-1",
          groupId: "group-web",
          // 纯 web 分组:闭环,web 耗尽即止,不跨车道回退 codex。
          groupBackendType: "web",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "web",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
        forceWebBackend: true,
      }
    );

    // 返回失败结果(未回退到 codex,无图)。
    expect(result.imageBase64).toBeUndefined();
    expect(result.error).toContain("terminated");
    // 只发生一次 web 侧 re-resolve;绝不应再以 responses 偏好回退。
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledTimes(
      1
    );
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ accountBackendPreference: "responses" })
    );
  });

  it("retries another pool member when an account returns no image", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("second-member-image").toString("base64");
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        // 首个 codex 成员的 /images/generations 返回无图,触发切换到下一个成员。
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ data: [{ b64_json: imageBase64 }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce({
      config: {
        baseUrl: "https://api.example.test/v1",
        apiKey: "codex-key-2",
        model: "gpt-5.4",
        backend: {
          type: "pool-account",
          id: "codex-2",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "responses",
          reportResult: true,
        },
      },
    });

    const result = await generateImage(
      {
        baseUrl: "https://api.example.test/v1",
        apiKey: "codex-key-1",
        model: "gpt-5.4",
        backend: {
          type: "pool-account",
          id: "codex-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "responses",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(backendPoolMock.reportImageBackendResult).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "codex-1",
        success: false,
        error: expect.stringContaining("API returned no image data"),
      })
    );
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedMemberKeys: ["account:codex-1"],
      })
    );
  });

  it("does not switch API backend when retry switch limit is zero", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage(
      {
        baseUrl: "https://api-1.example.test/v1",
        apiKey: "api-key-1",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          retrySwitchLimit: 0,
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    expect(result.error).toContain("429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).not.toHaveBeenCalled();
  });

  it("switches API backend up to configured retry switch limit", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("api-retry-image").toString("base64");
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ data: [{ b64_json: imageBase64 }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce({
      config: {
        baseUrl: "https://api-2.example.test/v1",
        apiKey: "api-key-2",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-2",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          reportResult: true,
        },
      },
    });

    const result = await generateImage(
      {
        baseUrl: "https://api-1.example.test/v1",
        apiKey: "api-key-1",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          retrySwitchLimit: 1,
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledTimes(
      1
    );
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedMemberKeys: ["api:api-1"],
      })
    );
  });

  it("switches Adobe backend after a recoverable failure", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("adobe-retry-image").toString("base64");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("adobe-1.example.test")) {
        return new Response("temporary failure", { status: 503 });
      }
      if (url.endsWith("/generated/result.png")) {
        return new Response(Buffer.from("adobe-retry-image"), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "![Generated](/generated/result.png)",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce({
      config: {
        baseUrl: "https://adobe-2.example.test",
        apiKey: "adobe-key-2",
        backend: {
          type: "pool-adobe",
          id: "adobe-2",
          groupId: "group-adobe",
          userId: "user-1",
          requestKind: "image_generation",
          fireflyOnly: true,
          adobeMode: "gateway",
          reportResult: true,
        },
      },
    });

    const result = await generateImage(
      {
        baseUrl: "https://adobe-1.example.test",
        apiKey: "adobe-key-1",
        backend: {
          type: "pool-adobe",
          id: "adobe-1",
          groupId: "group-adobe",
          userId: "user-1",
          requestKind: "image_generation",
          fireflyOnly: true,
          adobeMode: "gateway",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "firefly-image-4",
        size: "1024x1024",
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedMemberKeys: ["adobe:adobe-1"],
        forceFirefly: true,
      })
    );
  });

  it("switches backend when a single attempt times out", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    systemSettingsMock.getRuntimeSettingNumber.mockImplementation(
      async (key: string, fallback: number) =>
        key === "IMAGE_PER_ATTEMPT_TIMEOUT_MS" ? 10 : fallback
    );
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("timeout-retry-image").toString("base64");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (fetchMock.mock.calls.length === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          });
        }
        return new Response(
          JSON.stringify({ data: [{ b64_json: imageBase64 }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce({
      config: {
        baseUrl: "https://api-2.example.test/v1",
        apiKey: "api-key-2",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-2",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          reportResult: true,
        },
      },
    });

    const result = await generateImage(
      {
        baseUrl: "https://api-1.example.test/v1",
        apiKey: "api-key-1",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(backendPoolMock.reportImageBackendResult).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "api-1",
        error: "upstream per-attempt timed out",
      })
    );
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledWith(
      expect.objectContaining({ excludedMemberKeys: ["api:api-1"] })
    );
  });

  it("renews persisted pool leases while a generation is still running", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    vi.useFakeTimers();
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("slow-api-image").toString("base64");
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      return new Response(
        JSON.stringify({ data: [{ b64_json: imageBase64 }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = generateImage(
      {
        baseUrl: "https://api-lease.example.test/v1",
        apiKey: "api-key-lease",
        model: "gpt-image-2",
        backend: {
          type: "pool-api",
          id: "api-lease",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          reportResult: true,
          inflightLease: true,
          inflightLeaseId: "lease-1",
          inflightLeasePersisted: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    await vi.advanceTimersByTimeAsync(61_000);
    const result = await resultPromise;

    expect(result.imageBase64).toBe(imageBase64);
    expect(backendPoolMock.renewImageBackendInflightLease).toHaveBeenCalledWith(
      expect.objectContaining({
        memberType: "api",
        memberId: "api-lease",
        leaseId: "lease-1",
        leasePersisted: true,
      })
    );
    expect(
      backendPoolMock.releaseImageBackendInflightLease
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        memberType: "api",
        memberId: "api-lease",
        leaseId: "lease-1",
        leasePersisted: true,
      })
    );
  });
});
