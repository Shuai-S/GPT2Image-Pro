/**
 * Firefly HTTP 传输资源边界的 DB-free 单测。
 *
 * 验证直连和 Go 旁路两种实现都通过统一截止时间请求，并按解码后的真实正文大小
 * 拒绝超限响应；协议编排由 client.test.ts 覆盖。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FetchFireflyTransport,
  ProxyFireflyTransport,
} from "./transport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FetchFireflyTransport", () => {
  it("rejects a direct response that exceeds the declared byte limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too-large")));
    const transport = new FetchFireflyTransport();

    await expect(
      transport.request({
        method: "GET",
        url: "https://cdn.example.com/image.png",
        headers: {},
        timeoutMs: 1_000,
        maxResponseBytes: 4,
      })
    ).rejects.toThrow("exceeded 4 bytes");
  });
});

describe("ProxyFireflyTransport", () => {
  it("validates and decodes a bounded proxy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 200,
              headers: { "content-type": ["image/png"] },
              bodyBase64: Buffer.from("png").toString("base64"),
            })
          )
      )
    );
    const transport = new ProxyFireflyTransport({
      proxyUrl: "https://proxy.example.com",
      sessionKey: "session-1",
    });
    const response = await transport.request({
      method: "GET",
      url: "https://firefly.example.com/result",
      headers: {},
      timeoutMs: 1_000,
      maxResponseBytes: 4,
    });

    await expect(response.bytes()).resolves.toEqual(Buffer.from("png"));
    expect(response.headers["content-type"]).toBe("image/png");
  });

  it("rejects a decoded proxy body above the caller limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 200,
              bodyBase64: Buffer.from("too-large").toString("base64"),
            })
          )
      )
    );
    const transport = new ProxyFireflyTransport({
      proxyUrl: "https://proxy.example.com",
      sessionKey: "session-1",
    });

    await expect(
      transport.request({
        method: "GET",
        url: "https://firefly.example.com/result",
        headers: {},
        timeoutMs: 1_000,
        maxResponseBytes: 4,
      })
    ).rejects.toThrow("exceeded 4 bytes");
  });
});
