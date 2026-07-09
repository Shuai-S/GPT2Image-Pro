import { describe, expect, it, vi } from "vitest";

import { dispatchConcurrentChannels } from "./dispatch";

describe("dispatchConcurrentChannels", () => {
  it("channels=1 时直接串行调用 attemptOne 不引入并发开销", async () => {
    const attemptOne = vi
      .fn()
      .mockResolvedValue({ imageBase64: "abc", error: undefined });

    const abortController = new AbortController();
    const result = await dispatchConcurrentChannels({
      channels: 1,
      attemptOne,
      buildAllFailed: () => ({ error: "all failed" }),
      parentSignal: abortController.signal,
    });

    expect(attemptOne).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imageBase64: "abc", error: undefined });
  });

  it("N=2 时先成功的渠道胜出并中止其它", async () => {
    let loserAborted = false;
    type R = { imageBase64?: string; error?: string };
    const seen = { count: 0 };
    const attemptOne = vi.fn(
      async ({ signal }: { signal: AbortSignal }): Promise<R> => {
        seen.count += 1;
        // 第一个很快成功；第二个挂住等被 abort
        if (seen.count === 1) {
          return { imageBase64: "winner", error: undefined };
        }
        return new Promise<R>((resolve) => {
          signal.addEventListener("abort", () => {
            loserAborted = true;
            resolve({ error: "aborted" });
          });
        });
      }
    );

    const abortController = new AbortController();
    const result = await dispatchConcurrentChannels<R>({
      channels: 2,
      attemptOne,
      buildAllFailed: () => ({ error: "all failed" }),
      parentSignal: abortController.signal,
    });

    expect(result).toEqual({ imageBase64: "winner", error: undefined });
    expect(attemptOne).toHaveBeenCalledTimes(2);
    // 输家必被 abort
    expect(loserAborted).toBe(true);
  });

  it("不会让较慢的低序号渠道阻塞已成功的后续渠道", async () => {
    type R = { imageBase64?: string; error?: string };
    let invocation = 0;
    let slowChannelAborted = false;
    const attemptOne = vi.fn(
      async ({ signal }: { signal: AbortSignal }): Promise<R> => {
        invocation += 1;
        if (invocation === 2) {
          return { imageBase64: "fast-winner" };
        }
        return new Promise<R>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              slowChannelAborted = true;
              resolve({ error: "aborted" });
            },
            { once: true }
          );
        });
      }
    );

    const dispatchPromise = dispatchConcurrentChannels<R>({
      channels: 2,
      attemptOne,
      buildAllFailed: () => ({ error: "all failed" }),
      parentSignal: new AbortController().signal,
    });
    const timedResult = await Promise.race([
      dispatchPromise,
      new Promise<"test-timeout">((resolve) => {
        setTimeout(() => resolve("test-timeout"), 100);
      }),
    ]);

    expect(timedResult).toEqual({ imageBase64: "fast-winner" });
    expect(slowChannelAborted).toBe(true);
  });

  it("全部渠道失败时返回 buildAllFailed", async () => {
    const attemptOne = vi.fn().mockResolvedValue({ error: "channel failed" });

    const abortController = new AbortController();
    const result = await dispatchConcurrentChannels({
      channels: 3,
      attemptOne,
      buildAllFailed: (errors) => ({
        error: `all ${errors.length} failed`,
      }),
      parentSignal: abortController.signal,
    });

    expect(attemptOne).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ error: "all 3 failed" });
  });

  it("attemptOne 抛错时被 catch 成 undefined 不污染整体等待", async () => {
    type R = { error?: string };
    const seen = { count: 0 };
    const attemptOne = vi.fn(
      async ({ signal }: { signal: AbortSignal }): Promise<R> => {
        seen.count += 1;
        if (seen.count === 1) {
          throw new Error("boom");
        }
        return new Promise<R>((resolve) => {
          signal.addEventListener("abort", () => resolve({ error: "aborted" }));
          setTimeout(() => resolve({ error: "timeout" }), 50);
        });
      }
    );

    const abortController = new AbortController();
    const result = await dispatchConcurrentChannels<R>({
      channels: 2,
      attemptOne,
      buildAllFailed: (errors) => ({
        error: `last ${errors.filter(Boolean).pop()?.error ?? "none"}`,
      }),
      parentSignal: abortController.signal,
    });

    expect(result.error).toMatch(/last|aborted|timeout|none/);
  });

  it("parentSignal 先 abort 时各渠道同步收到 abort", async () => {
    const abortController = new AbortController();
    abortController.abort();

    let abortedSeen = 0;
    const attemptOne = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      if (signal.aborted) abortedSeen += 1;
      return { error: "aborted" };
    });

    await dispatchConcurrentChannels({
      channels: 2,
      attemptOne,
      buildAllFailed: () => ({ error: "all failed" }),
      parentSignal: abortController.signal,
    });

    expect(abortedSeen).toBe(2);
  });
});
