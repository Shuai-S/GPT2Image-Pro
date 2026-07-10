// @vitest-environment jsdom

/**
 * 回归验证全局主题 Provider 在 React 19 客户端渲染时不会输出脚本标签告警。
 *
 * next-themes 仍需在 SSR HTML 中注入首屏主题脚本，但客户端重渲染不得再次返回
 * script 元素，否则 Next.js 16.2 开发环境会显示错误覆盖层。
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "./providers";

let container: HTMLDivElement;
let root: Root | null;

/** 为每个用例创建独立的 React 客户端根节点。 */
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string): MediaQueryList => {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      };
    }),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

/** 卸载根节点并清理 DOM，避免监听器和主题状态跨用例泄漏。 */
afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  root = null;
  vi.restoreAllMocks();
});

describe("Providers", () => {
  it("客户端渲染不输出内联 script 元素", async () => {
    await act(async () => {
      root?.render(
        <Providers>
          <div>content</div>
        </Providers>
      );
    });

    expect(container.querySelector("script")).toBeNull();
  });
});
