import { describe, expect, it } from "vitest";

import {
  pickAdobeFamilyFromModel,
  reverseFireflyToGptRequest,
} from "./adobe-sourced-firefly";

describe("pickAdobeFamilyFromModel", () => {
  it("按最长前缀截家族，避免 nano-banana 误吞 nano-banana-pro/2", () => {
    expect(pickAdobeFamilyFromModel("firefly-nano-banana-pro-2k-1x1")).toBe(
      "nano-banana-pro"
    );
    expect(pickAdobeFamilyFromModel("firefly-nano-banana2-2k-1x1")).toBe(
      "nano-banana2"
    );
    expect(pickAdobeFamilyFromModel("firefly-nano-banana-2k-1x1")).toBe(
      "nano-banana"
    );
    expect(pickAdobeFamilyFromModel("firefly-gpt-image-2")).toBe("gpt-image-2");
  });

  it("非 firefly- 前缀或未知家族返回 null", () => {
    expect(pickAdobeFamilyFromModel("gpt-image")).toBeNull();
    expect(pickAdobeFamilyFromModel("firefly-unknown-2k-1x1")).toBeNull();
    expect(pickAdobeFamilyFromModel("")).toBeNull();
  });
});

describe("reverseFireflyToGptRequest", () => {
  it("非 firefly 请求返回 null（走普通路径）", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "gpt-image",
        requestedSize: "1024x1024",
      })
    ).toBeNull();
  });

  it("族级 id：截家族名为出站 model，size 沿用请求自带", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "firefly-gpt-image-2",
        requestedSize: "1024x1024",
      })
    ).toEqual({ model: "gpt-image-2", size: "1024x1024" });
  });

  it("全量 gpt-image id：由 res/ratio 推 size（2K 16:9 = 2560x1440）", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "firefly-gpt-image-2-2k-16x9",
        requestedSize: undefined,
      })
    ).toEqual({ model: "gpt-image-2", size: "2560x1440" });
  });

  it("全量 nano-banana id：走非 gpt-image 尺寸表（2K 1:1 = 2048x2048）", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "firefly-nano-banana-pro-2k-1x1",
        requestedSize: undefined,
      })
    ).toEqual({ model: "nano-banana-pro", size: "2048x2048" });
  });

  it("backendModel 非空时作出站 model 覆盖（provider 用不同名）", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "firefly-gpt-image-2-2k-16x9",
        requestedSize: undefined,
        backendModel: "my-provider-image",
      })
    ).toEqual({ model: "my-provider-image", size: "2560x1440" });
  });

  it("未知 firefly 家族返回 null（该后端无法服务，调度回退）", () => {
    expect(
      reverseFireflyToGptRequest({
        requestedModel: "firefly-unknown-2k-1x1",
        requestedSize: "1024x1024",
      })
    ).toBeNull();
  });
});
