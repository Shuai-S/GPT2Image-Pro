import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// moderation/index.ts 通过 '../system-settings'（→ @repo/database）读取运行时配置，
// 这里用 vi.mock 把配置层替换为可控的内存实现，使整套编排可在 DB-free 下单测。
// 与 subscription/services/plan-capabilities.test.ts 的隔离手法一致。

const runtimeSettingsMock = vi.hoisted(() => {
  const stringValues = new Map<string, string>();
  const booleanValues = new Map<string, boolean>();
  const numberValues = new Map<string, number>();

  return {
    stringValues,
    booleanValues,
    numberValues,
    getRuntimeSettingString: vi.fn(async (key: string) =>
      stringValues.get(key)
    ),
    getRuntimeSettingBoolean: vi.fn(async (key: string, fallback: boolean) =>
      booleanValues.has(key) ? booleanValues.get(key) : fallback
    ),
    getRuntimeSettingNumber: vi.fn(async (key: string, fallback: number) =>
      numberValues.has(key) ? numberValues.get(key) : fallback
    ),
  };
});

const loggerMock = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// 编排测试不调用阿里云 SDK；隔离其 CommonJS 传递依赖，避免测试环境是否安装
// 可选 debug 包影响审核 fail-closed 回归。
vi.mock("@alicloud/green20220302", () => {
  class GreenClient {}
  return {
    default: GreenClient,
    ImageModerationRequest: class ImageModerationRequest {},
    MultiModalAgentRequest: class MultiModalAgentRequest {},
    TextModerationPlusRequest: class TextModerationPlusRequest {},
  };
});
vi.mock("@alicloud/openapi-client", () => ({
  Config: class Config {},
}));
vi.mock("@alicloud/tea-util", () => ({
  RuntimeOptions: class RuntimeOptions {},
}));
vi.mock("../system-settings", () => runtimeSettingsMock);
vi.mock("../logger", () => loggerMock);

import { getConfiguredModerationProviders, moderateContent } from "./index";

const PROXY_URL = "https://moderation.example.com/check";

beforeEach(() => {
  runtimeSettingsMock.stringValues.clear();
  runtimeSettingsMock.booleanValues.clear();
  runtimeSettingsMock.numberValues.clear();
  runtimeSettingsMock.getRuntimeSettingString.mockClear();
  runtimeSettingsMock.getRuntimeSettingBoolean.mockClear();
  runtimeSettingsMock.getRuntimeSettingNumber.mockClear();
  loggerMock.logError.mockClear();
  loggerMock.logWarn.mockClear();
  // 防止 getOpenAiApiKey 读到环境变量误判 openai 已配置。
  delete process.env.MODERATION_OPENAI_API_KEY;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getConfiguredModerationProviders", () => {
  it("returns an empty list when moderation is disabled", async () => {
    runtimeSettingsMock.booleanValues.set("CONTENT_MODERATION_ENABLED", false);

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });

  it("returns empty when the selected provider lacks credentials", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });

  it("returns the selected provider when its credentials are present", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([
      "openai",
    ]);
  });

  it("auto-detects both providers when all credentials are present", async () => {
    runtimeSettingsMock.stringValues.set(
      "ALIYUN_MODERATION_ACCESS_KEY_ID",
      "id"
    );
    runtimeSettingsMock.stringValues.set(
      "ALIYUN_MODERATION_ACCESS_KEY_SECRET",
      "secret"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([
      "aliyun",
      "openai",
    ]);
  });

  it("returns empty when provider is explicitly set to none", async () => {
    runtimeSettingsMock.stringValues.set("CONTENT_MODERATION_PROVIDER", "none");

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });
});

describe("moderateContent orchestration", () => {
  it("skips when moderation is disabled", async () => {
    runtimeSettingsMock.booleanValues.set("CONTENT_MODERATION_ENABLED", false);

    await expect(moderateContent({ prompt: "hi" })).resolves.toEqual({
      decision: "skipped",
    });
  });

  it("skips when no provider and no proxy are configured", async () => {
    await expect(moderateContent({ prompt: "hi" })).resolves.toEqual({
      decision: "skipped",
    });
  });

  it("returns the proxy block decision and short-circuits providers", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            decision: "block",
            provider: "openai",
            reason: "blocked",
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(moderateContent({ prompt: "bad" })).resolves.toMatchObject({
      decision: "block",
      reason: "blocked",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed to error when only the proxy is configured and it throws", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("connection refused");
    expect(loggerMock.logError).toHaveBeenCalledOnce();
  });

  it("fails open to allow with a warning when fail-closed is disabled", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    runtimeSettingsMock.booleanValues.set(
      "CONTENT_MODERATION_FAIL_CLOSED",
      false
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("allow");
    expect(loggerMock.logWarn).toHaveBeenCalledOnce();
  });

  it("fails closed to error on a non-ok proxy response", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(
      async () => new Response("upstream failed", { status: 502 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("502");
  });

  it("fails closed to error when the proxy returns an invalid decision", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ decision: "maybe" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("invalid decision");
  });

  it("fails closed when the proxy JSON exceeds the shared limit", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              decision: "allow",
              details: "x".repeat(1024 * 1024),
            })
          )
      )
    );

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("Response body exceeded");
  });

  it("sends the configured proxy secret on both auth headers", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_SECRET",
      "top-secret"
    );
    const fetchMock = vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) =>
        new Response(JSON.stringify({ decision: "allow" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await moderateContent({ prompt: "hi" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers.authorization).toBe("Bearer top-secret");
    expect(init?.headers["x-moderation-proxy-secret"]).toBe("top-secret");
  });

  it("allows content after parsing a bounded OpenAI response", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "modr-test",
            model: "omni-moderation-latest",
            results: [
              {
                flagged: false,
                categories: {},
                category_scores: {},
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
          }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(moderateContent({ prompt: "hi" })).resolves.toMatchObject({
      decision: "allow",
      provider: "openai",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts the OpenAI request when the provider deadline expires", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );
    runtimeSettingsMock.numberValues.set(
      "CONTENT_MODERATION_PROVIDER_TIMEOUT_MS",
      20
    );
    const observedSignals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("OpenAI request did not receive an abort signal"));
            return;
          }
          observedSignals.push(signal);
          const rejectOnAbort = () => {
            reject(
              signal.reason ??
                new DOMException("OpenAI moderation aborted", "AbortError")
            );
          };
          if (signal.aborted) {
            rejectOnAbort();
            return;
          }
          signal.addEventListener("abort", rejectOnAbort, {
            once: true,
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0]?.aborted).toBe(true);
  });

  it("fails closed when the OpenAI response exceeds the shared limit", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "modr-test",
            model: "omni-moderation-latest",
            results: [
              {
                flagged: false,
                categories: {},
                category_scores: {},
              },
            ],
            padding: "x".repeat(1024 * 1024),
          }),
          {
            headers: { "content-type": "application/json" },
          }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("Response body exceeded");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
