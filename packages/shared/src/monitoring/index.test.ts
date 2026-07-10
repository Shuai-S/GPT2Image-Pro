/**
 * 可选 Sentry 客户端初始化测试。
 *
 * 职责：锁定 DSN 缺失降级和 Next 新旧客户端入口并存时的幂等初始化。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  init: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  getClient: sentryMocks.getClient,
  init: sentryMocks.init,
}));

import { initSentryClient } from "./index";

const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
});

afterEach(() => {
  if (originalDsn === undefined) {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  } else {
    process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  }
});

describe("initSentryClient", () => {
  it("DSN 未配置时不初始化", () => {
    initSentryClient();
    expect(sentryMocks.getClient).not.toHaveBeenCalled();
    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it("已有 client 时幂等返回", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.test/1";
    sentryMocks.getClient.mockReturnValue({});

    initSentryClient();

    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it("首次初始化后第二个入口不重复初始化", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.test/1";
    sentryMocks.getClient
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({});

    initSentryClient();
    initSentryClient();

    expect(sentryMocks.init).toHaveBeenCalledOnce();
  });
});
