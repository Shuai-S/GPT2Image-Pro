/**
 * cf_clearance 后备纯函数单测(DB-free):挑战判定、Cookie 拼接、注入头(含 Sec-Ch-Ua 重建)。
 */
import { describe, expect, it } from "vitest";

import {
  applyClearanceHeaders,
  buildClearanceCookie,
  isCloudflareChallenge,
  type WebClearance,
} from "./chatgpt-web-clearance-util";

describe("isCloudflareChallenge", () => {
  it("403 + 挑战页特征 → true", () => {
    expect(isCloudflareChallenge(403, "<title>Just a moment...</title>")).toBe(
      true
    );
    expect(isCloudflareChallenge(503, "cf-browser-verification")).toBe(true);
    expect(isCloudflareChallenge(403, "id=challenge-platform")).toBe(true);
  });

  it("非 403/503 → false(即便有特征串)", () => {
    expect(isCloudflareChallenge(200, "just a moment")).toBe(false);
    expect(isCloudflareChallenge(401, "attention required")).toBe(false);
  });

  it("403 但无挑战特征 → false", () => {
    expect(isCloudflareChallenge(403, '{"detail":"unauthorized"}')).toBe(false);
  });
});

describe("buildClearanceCookie", () => {
  it("只保留 clearance 相关 cookie 并拼串", () => {
    const cookie = buildClearanceCookie([
      { name: "cf_clearance", value: "abc" },
      { name: "oai-did", value: "x" },
      { name: "__cf_bm", value: "def" },
      { name: "empty" },
    ]);
    expect(cookie).toBe("cf_clearance=abc; __cf_bm=def");
  });

  it("空数组 → 空串", () => {
    expect(buildClearanceCookie([])).toBe("");
  });
});

describe("applyClearanceHeaders", () => {
  const clearance: WebClearance = {
    cookie: "cf_clearance=abc; __cf_bm=def",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    expiresAt: Date.now() + 3600_000,
  };

  it("覆盖 UA、加 Cookie、按 UA 重建 Sec-Ch-Ua*/Platform", () => {
    const headers: Record<string, string> = {
      "User-Agent": "old-edge-143",
      "Sec-Ch-Ua": '"Microsoft Edge";v="143"',
      "Sec-Ch-Ua-Platform": '"Windows"',
    };
    applyClearanceHeaders(headers, clearance);
    expect(headers["User-Agent"]).toContain("Chrome/148");
    expect(headers.Cookie).toBe("cf_clearance=abc; __cf_bm=def");
    expect(headers["Sec-Ch-Ua"]).toContain('v="148"');
    expect(headers["Sec-Ch-Ua"]).not.toContain("Edge");
    expect(headers["Sec-Ch-Ua-Full-Version"]).toBe('"148.0.0.0"');
    expect(headers["Sec-Ch-Ua-Platform"]).toBe('"Linux"');
  });

  it("已有 Cookie 时追加而非覆盖", () => {
    const headers: Record<string, string> = { Cookie: "a=1" };
    applyClearanceHeaders(headers, clearance);
    expect(headers.Cookie).toBe("a=1; cf_clearance=abc; __cf_bm=def");
  });
});
