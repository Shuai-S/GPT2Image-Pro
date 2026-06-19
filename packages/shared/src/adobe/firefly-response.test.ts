import { describe, expect, it } from "vitest";
import {
  extractAdobeMediaUrl,
  parseAdobeMediaResult,
  resolveAdobeMediaUrl,
} from "./firefly-response";

describe("extractAdobeMediaUrl", () => {
  it("markdown 图片", () => {
    expect(
      extractAdobeMediaUrl("![Generated Image](/generated/abc123.png)")
    ).toBe("/generated/abc123.png");
  });

  it("HTML 视频 src", () => {
    expect(
      extractAdobeMediaUrl("```html\n<video src='/generated/v1.mp4' controls></video>\n```")
    ).toBe("/generated/v1.mp4");
  });

  it("裸 URL", () => {
    expect(extractAdobeMediaUrl("https://x/generated/a.png")).toBe(
      "https://x/generated/a.png"
    );
  });

  it("无 URL 返回 null", () => {
    expect(extractAdobeMediaUrl("sorry, failed")).toBeNull();
  });
});

describe("resolveAdobeMediaUrl", () => {
  it("绝对 URL 原样返回", () => {
    expect(
      resolveAdobeMediaUrl("https://host/generated/a.png", "https://host")
    ).toBe("https://host/generated/a.png");
  });

  it("相对路径挂到 baseUrl 的 host 根", () => {
    expect(
      resolveAdobeMediaUrl("/generated/a.png", "http://127.0.0.1:6001/v1")
    ).toBe("http://127.0.0.1:6001/generated/a.png");
  });

  it("baseUrl 带尾斜杠 + 相对无前导斜杠", () => {
    expect(resolveAdobeMediaUrl("generated/a.png", "http://h:6001/")).toBe(
      "http://h:6001/generated/a.png"
    );
  });
});

describe("parseAdobeMediaResult", () => {
  const base = "http://127.0.0.1:6001";

  it("images 端点 data[].url", () => {
    const r = parseAdobeMediaResult(
      { data: [{ url: "/generated/x.png" }] },
      base
    );
    expect(r).toEqual({ url: "http://127.0.0.1:6001/generated/x.png" });
  });

  it("chat 端点 markdown content", () => {
    const r = parseAdobeMediaResult(
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "![Generated Image](/generated/y.png)",
            },
          },
        ],
      },
      base
    );
    expect(r).toEqual({ url: "http://127.0.0.1:6001/generated/y.png" });
  });

  it("chat 端点视频 content", () => {
    const r = parseAdobeMediaResult(
      {
        choices: [
          {
            message: {
              content: "```html\n<video src='https://cdn/v.mp4'></video>\n```",
            },
          },
        ],
      },
      base
    );
    expect(r).toEqual({ url: "https://cdn/v.mp4" });
  });

  it("content 无 URL 返回 error", () => {
    const r = parseAdobeMediaResult(
      { choices: [{ message: { content: "generation failed" } }] },
      base
    );
    expect("error" in r).toBe(true);
  });

  it("结构缺失返回 error", () => {
    expect("error" in parseAdobeMediaResult({}, base)).toBe(true);
    expect("error" in parseAdobeMediaResult(null, base)).toBe(true);
  });
});
