/**
 * callback outbox 单条投递状态机测试。
 *
 * 使用 DB-free 依赖覆盖成功终态、网络失败退避、缺失 URL 和 fencing token 丢失，
 * 验证 worker 不会把未持有租约的投递误记为成功。
 */

import { describe, expect, it, vi } from "vitest";
import { processAsyncCallbackClaim } from "./async-callback-worker-core";

type CallbackRow = {
  id: string;
  callbackUrl: string | null;
  attempts: number;
};

/**
 * 构造 callback worker 的确定性测试依赖。
 *
 * @param overrides 需要覆盖的投递或终态函数。
 * @returns 注入状态机的依赖对象及可断言 mock，无外部副作用。
 */
function makeDependencies(overrides?: {
  deliver?: (url: string, payload: { id: string }) => Promise<void>;
  complete?: (id: string, token: string) => Promise<boolean>;
  retry?: (input: {
    id: string;
    callbackToken: string;
    attempts: number;
    error: string;
  }) => Promise<boolean>;
}) {
  const deliver = vi.fn(
    overrides?.deliver ?? (async (_url: string, _payload: { id: string }) => {})
  );
  const complete = vi.fn(
    overrides?.complete ?? (async (_id: string, _token: string) => true)
  );
  const retry = vi.fn(
    overrides?.retry ??
      (async (_input: {
        id: string;
        callbackToken: string;
        attempts: number;
        error: string;
      }) => true)
  );
  return {
    deliver,
    complete,
    retry,
    dependencies: {
      getTaskId: (row: CallbackRow) => row.id,
      getCallbackUrl: (row: CallbackRow) => row.callbackUrl,
      getAttempts: (row: CallbackRow) => row.attempts,
      materializePayload: (row: CallbackRow) => ({ id: row.id }),
      deliver,
      complete,
      retry,
    },
  };
}

const claim = {
  row: {
    id: "task-1",
    callbackUrl: "https://example.com/callback",
    attempts: 2,
  },
  callbackToken: "callback-token-1",
};

describe("processAsyncCallbackClaim", () => {
  it("投递成功且 fencing token 有效时标记 sent", async () => {
    const { dependencies, deliver, complete, retry } = makeDependencies();

    await expect(processAsyncCallbackClaim(claim, dependencies)).resolves.toBe(
      "sent"
    );
    expect(deliver).toHaveBeenCalledWith(claim.row.callbackUrl, {
      id: claim.row.id,
    });
    expect(complete).toHaveBeenCalledWith(claim.row.id, claim.callbackToken);
    expect(retry).not.toHaveBeenCalled();
  });

  it("网络失败时携带当前尝试数和错误安排退避", async () => {
    const { dependencies, complete, retry } = makeDependencies({
      deliver: async () => {
        throw new Error("upstream unavailable");
      },
    });

    await expect(processAsyncCallbackClaim(claim, dependencies)).resolves.toBe(
      "retry_scheduled"
    );
    expect(complete).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({
      id: claim.row.id,
      callbackToken: claim.callbackToken,
      attempts: 2,
      error: "upstream unavailable",
    });
  });

  it("投递成功但终态 token 已失时返回 lease_lost", async () => {
    const { dependencies, retry } = makeDependencies({
      complete: async () => false,
    });

    await expect(processAsyncCallbackClaim(claim, dependencies)).resolves.toBe(
      "lease_lost"
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it("持久行缺少 URL 时进入有限重试而不尝试网络", async () => {
    const { dependencies, deliver, retry } = makeDependencies();

    await expect(
      processAsyncCallbackClaim(
        { ...claim, row: { ...claim.row, callbackUrl: null } },
        dependencies
      )
    ).resolves.toBe("retry_scheduled");
    expect(deliver).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Persisted callback URL is missing" })
    );
  });
});
