/**
 * 创作页模式水合决策回归测试。
 *
 * 使用方：创作页客户端状态初始化；关键依赖：纯模式决策函数与 Vitest。
 * 测试确保服务端/客户端首帧共享固定默认值，持久模式只在挂载后恢复。
 */

import { describe, expect, it } from "vitest";
import { resolveHydratedCreateActiveMode } from "./create-page-utils";

describe("resolveHydratedCreateActiveMode", () => {
  it("首次客户端 effect 在 URL 未指定时恢复持久模式", () => {
    expect(
      resolveHydratedCreateActiveMode({
        activeMode: "text",
        requestedMode: null,
        storedMode: "image",
        shouldRestoreStoredMode: true,
      })
    ).toBe("image");
  });

  it("显式 URL 模式优先于持久模式", () => {
    expect(
      resolveHydratedCreateActiveMode({
        activeMode: "text",
        requestedMode: "agent",
        storedMode: "image",
        shouldRestoreStoredMode: true,
      })
    ).toBe("text");
  });

  it("首次恢复后不再用 localStorage 覆盖运行时模式", () => {
    expect(
      resolveHydratedCreateActiveMode({
        activeMode: "chat",
        requestedMode: null,
        storedMode: "image",
        shouldRestoreStoredMode: false,
      })
    ).toBe("chat");
  });
});
