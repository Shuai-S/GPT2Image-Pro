import { describe, expect, it } from "vitest";

import { buildOpenCorsHeaders } from "./cors-headers";

describe("buildOpenCorsHeaders", () => {
  it("普通响应:开放 * 且暴露限流头,不含预检专属头", () => {
    const headers = buildOpenCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Expose-Headers"]).toContain(
      "X-RateLimit-Remaining"
    );
    // 预检专属头不应出现在普通响应上。
    expect(headers["Access-Control-Allow-Methods"]).toBeUndefined();
    expect(headers["Access-Control-Max-Age"]).toBeUndefined();
  });

  it("预检:补 Allow-Methods/Headers/Max-Age", () => {
    const headers = buildOpenCorsHeaders({ preflight: true });
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe(
      "Authorization, Content-Type"
    );
    expect(headers["Access-Control-Max-Age"]).toBe("86400");
  });

  it("预检:原样回显客户端请求的自定义头(兼容 OpenAI SDK 的 x-stainless-*)", () => {
    const requested = "authorization, content-type, x-stainless-os";
    const headers = buildOpenCorsHeaders({
      preflight: true,
      requestedHeaders: requested,
    });
    expect(headers["Access-Control-Allow-Headers"]).toBe(requested);
  });

  it("预检:请求头为空/空白时回退到默认集合", () => {
    expect(
      buildOpenCorsHeaders({ preflight: true, requestedHeaders: "   " })[
        "Access-Control-Allow-Headers"
      ]
    ).toBe("Authorization, Content-Type");
    expect(
      buildOpenCorsHeaders({ preflight: true, requestedHeaders: null })[
        "Access-Control-Allow-Headers"
      ]
    ).toBe("Authorization, Content-Type");
  });
});
