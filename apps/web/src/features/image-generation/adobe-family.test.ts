import { describe, expect, it, vi } from "vitest";

// adobe-direct.ts 在模块顶层 import db / schema;DB-free 单测须 mock 掉这些副作用 import,
// 才能纯函数测试 resolveAdobeFamilyFromModel。
vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/database/schema", () => ({
  adobeAccount: {},
  adobeToken: {},
}));

import { resolveAdobeFamilyFromModel } from "./adobe-direct";

describe("resolveAdobeFamilyFromModel", () => {
  it("非 firefly 模型(普通 gpt-image 经 force_firefly 路由到 adobe)一律落 gpt-image-2", () => {
    expect(resolveAdobeFamilyFromModel("gpt-image")).toBe("gpt-image-2");
    expect(resolveAdobeFamilyFromModel("gpt-image-1")).toBe("gpt-image-2");
    expect(resolveAdobeFamilyFromModel(undefined)).toBe("gpt-image-2");
  });

  it("非 firefly 模型即便后端 enabledModels 含 nano-banana 也落 gpt-image-2", () => {
    expect(resolveAdobeFamilyFromModel("gpt-image", ["nano-banana"])).toBe(
      "gpt-image-2"
    );
  });

  it("firefly-* 模型按最长前缀解析出族", () => {
    expect(resolveAdobeFamilyFromModel("firefly-nano-banana-pro")).toBe(
      "nano-banana-pro"
    );
    expect(resolveAdobeFamilyFromModel("firefly-nano-banana")).toBe(
      "nano-banana"
    );
    expect(resolveAdobeFamilyFromModel("firefly-nano-banana2")).toBe(
      "nano-banana2"
    );
    expect(resolveAdobeFamilyFromModel("firefly-gpt-image-1.5-2k-1x1")).toBe(
      "gpt-image-1.5"
    );
  });
});
