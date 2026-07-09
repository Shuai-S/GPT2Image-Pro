/**
 * CurrentSessionProvider 回归测试。
 *
 * 职责：验证同一路由树内多个会话消费者共享一次网络读取，并确认服务端初始会话
 * 会跳过首屏请求。使用方：前端性能回归门。关键依赖：React DOM、jsdom、Vitest。
 *
 * @vitest-environment jsdom
 */

import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CurrentSession,
  CurrentSessionProvider,
  useCurrentSession,
} from "./use-current-session";

const testGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
testGlobals.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 渲染当前会话用户 ID，便于断言多个消费者收到相同快照。
 *
 * @returns 包含用户 ID 或匿名占位的 span。
 * @sideEffects 订阅 CurrentSessionProvider 上下文。
 * @failureMode 缺少 Provider 时由 useCurrentSession 抛出明确错误。
 */
function SessionConsumer() {
  const { data } = useCurrentSession();
  return createElement("span", null, data?.user?.id ?? "anonymous");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CurrentSessionProvider", () => {
  it("shares one session request across multiple consumers", async () => {
    const session: CurrentSession = {
      user: {
        id: "user-1",
        name: "User One",
        email: "user@example.com",
      },
    };
    const fetchMock = vi.fn(async () => Response.json(session));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          CurrentSessionProvider,
          null,
          createElement(
            Fragment,
            null,
            createElement(SessionConsumer),
            createElement(SessionConsumer),
            createElement(SessionConsumer)
          )
        )
      );
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe("user-1user-1user-1");
    });

    await act(async () => root.unmount());
  });

  it("uses server-provided session without a client request", async () => {
    const session: CurrentSession = {
      user: {
        id: "server-user",
        name: "Server User",
        email: "server@example.com",
      },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          CurrentSessionProvider,
          { initialData: session },
          createElement(SessionConsumer)
        )
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("server-user");

    await act(async () => root.unmount());
  });
});
