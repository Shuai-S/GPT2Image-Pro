/**
 * 第三方 HTTP 资源边界的 DB-free 单测。
 *
 * 覆盖截止时间、流式真实字节上限、JSON 解析和跨源客户端凭据剥离，避免支付、
 * 审核等调用方各自复制不完整的保护逻辑。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithDeadline,
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
  sanitizeForwardedClientHeaders,
} from "./fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithDeadline", () => {
  it("aborts a request after the total deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true }
            );
          })
      )
    );

    const request = fetchWithDeadline("https://api.example.com", undefined, {
      timeoutMs: 25,
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("preserves an earlier caller abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        controller.abort(new DOMException("caller stopped", "AbortError"));
        throw init?.signal?.reason;
      })
    );

    await expect(
      fetchWithDeadline(
        "https://api.example.com",
        { signal: controller.signal },
        { timeoutMs: 1_000 }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the deadline active while the response body is streaming", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true }
                );
              },
            })
          )
      )
    );

    const response = await fetchWithDeadline(
      "https://api.example.com/slow-body",
      undefined,
      { timeoutMs: 25 }
    );
    const body = readResponseBytesWithLimit(response, 64);
    const rejection = expect(body).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("limits native Response text consumption by actual streamed bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("0123456789"))
    );

    const response = await fetchWithDeadline(
      "https://api.example.com/large",
      undefined,
      { timeoutMs: 1_000, maxResponseBytes: 4 }
    );

    await expect(response.text()).rejects.toThrow("exceeded 4 bytes");
  });

  it.each([
    0,
    Number.NaN,
  ])("rejects invalid response limit %s before starting the request", async (maxResponseBytes) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithDeadline("https://api.example.com/invalid-limit", undefined, {
        timeoutMs: 1_000,
        maxResponseBytes,
      })
    ).rejects.toThrow("maxResponseBytes must be a positive safe integer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans up an immediately completed bounded stream", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(""))
    );
    const response = await fetchWithDeadline(
      "https://api.example.com/empty",
      undefined,
      { timeoutMs: 25, maxResponseBytes: 4 }
    );

    await expect(response.text()).resolves.toBe("");
    await vi.advanceTimersByTimeAsync(25);
    expect(response.bodyUsed).toBe(true);
  });

  it("cancels the original stream when a bounded response is cancelled", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array([1]));
              },
              cancel,
            })
          )
      )
    );
    const response = await fetchWithDeadline(
      "https://api.example.com/cancel",
      undefined,
      { timeoutMs: 1_000, maxResponseBytes: 4 }
    );

    await response.body?.cancel("done");

    expect(cancel).toHaveBeenCalledWith("done");
  });
});

describe("limited response readers", () => {
  it("reads and parses JSON below the byte limit", async () => {
    const response = new Response('{"ok":true}');

    await expect(readResponseJsonWithLimit(response, 64)).resolves.toEqual({
      ok: true,
    });
  });

  it("counts streamed bytes instead of trusting Content-Length", async () => {
    const response = new Response("0123456789", {
      headers: { "content-length": "1" },
    });

    await expect(readResponseBytesWithLimit(response, 4)).rejects.toEqual(
      expect.objectContaining({
        name: "ResponseBodyTooLargeError",
        message: expect.any(String),
        maxBytes: 4,
        actualBytes: 10,
      })
    );
  });

  it("rejects invalid limits instead of silently disabling protection", async () => {
    await expect(
      readResponseBytesWithLimit(new Response("ok"), 0)
    ).rejects.toThrow("maxBytes must be a positive safe integer");
  });
});

describe("sanitizeForwardedClientHeaders", () => {
  const sourceHeaders = {
    Authorization: "Bearer client-secret",
    Cookie: "session=client-secret",
    "Proxy-Authorization": "Basic proxy-secret",
    "X-Request-Id": "request-1",
  };

  it("keeps client credentials for same-origin forwarding", () => {
    const headers = sanitizeForwardedClientHeaders(
      sourceHeaders,
      "https://app.example.com/v1/images",
      "/api/storage/image"
    );

    expect(headers.get("authorization")).toBe("Bearer client-secret");
    expect(headers.get("cookie")).toBe("session=client-secret");
  });

  it("removes client credentials for cross-origin forwarding", () => {
    const headers = sanitizeForwardedClientHeaders(
      sourceHeaders,
      "https://app.example.com/v1/images",
      "https://cdn.example.net/image.png"
    );

    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("proxy-authorization")).toBeNull();
    expect(headers.get("x-request-id")).toBe("request-1");
  });
});
