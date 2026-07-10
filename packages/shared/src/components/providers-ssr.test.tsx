/**
 * 锁定主题 Provider 的 SSR 首屏初始化脚本。
 *
 * React 19 兼容补丁只允许客户端省略脚本；服务端必须继续输出脚本，避免用户保存的
 * 深色主题在水合前先闪成浅色。
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Providers } from "./providers";

describe("Providers SSR", () => {
  it("服务端仍输出首屏主题初始化脚本", () => {
    const html = renderToStaticMarkup(
      createElement(Providers, null, createElement("div", null, "content"))
    );

    expect(html).toContain("<script");
    expect(html).toContain("prefers-color-scheme: dark");
  });
});
