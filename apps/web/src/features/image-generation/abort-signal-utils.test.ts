/**
 * AbortSignal 合并工具回归测试。
 *
 * 使用方：图像/视频生成 semaphore 与持久 worker fencing。验证取消原因不会在
 * 合并边界丢失，使旧执行者可以保留可定位的租约失权错误。
 */

import { describe, expect, it } from "vitest";

import { mergeAbortSignals } from "./abort-signal-utils";

describe("mergeAbortSignals", () => {
  it("透传调用前已经中止的源信号 reason", () => {
    const reason = new Error("generation lease lost");
    const controller = new AbortController();
    controller.abort(reason);

    const merged = mergeAbortSignals(
      new AbortController().signal,
      controller.signal
    );

    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe(reason);
  });

  it("透传合并后才中止的源信号 reason", () => {
    const reason = new Error("request disconnected");
    const controller = new AbortController();
    const merged = mergeAbortSignals(controller.signal);

    controller.abort(reason);

    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe(reason);
  });
});
