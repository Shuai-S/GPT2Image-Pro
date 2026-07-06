import { describe, expect, it } from "vitest";
import {
  isInternalDatabaseError,
  toClientErrorMessage,
} from "./error-sanitize";

// Drizzle 池查询失败的真实形态（issue #35）：message 以 "Failed query:" 开头。
function drizzleError(): Error {
  return new Error(
    'Failed query: select "image_backend_api"."api_key" from "image_backend_api" ' +
      'inner join "image_backend_api_group" ... params: true,true,active'
  );
}

// node-postgres 原始错误：带 5 位 SQLSTATE code（42703=undefined_column）。
function pgError(code = "42703"): Error {
  const e = new Error("column does not exist");
  (e as Error & { code: string }).code = code;
  return e;
}

describe("isInternalDatabaseError", () => {
  it("识别 Drizzle Failed query 与 Postgres SQLSTATE/severity", () => {
    expect(isInternalDatabaseError(drizzleError())).toBe(true);
    expect(isInternalDatabaseError(pgError("42703"))).toBe(true);
    expect(isInternalDatabaseError(pgError("57P01"))).toBe(true);
    const sev = new Error("db down");
    (sev as Error & { severity: string }).severity = "FATAL";
    expect(isInternalDatabaseError(sev)).toBe(true);
  });

  it("放行已知用户级错误与非 DB 错误", () => {
    expect(isInternalDatabaseError(new Error("Insufficient credits"))).toBe(
      false
    );
    expect(isInternalDatabaseError(new Error("分组无可用后端"))).toBe(false);
    // Node 系统错误码（非 5 位 SQLSTATE）不应误判。
    const enoent = new Error("ENOENT");
    (enoent as Error & { code: string }).code = "ENOENT";
    expect(isInternalDatabaseError(enoent)).toBe(false);
    expect(isInternalDatabaseError("plain string")).toBe(false);
    expect(isInternalDatabaseError(null)).toBe(false);
  });
});

describe("toClientErrorMessage", () => {
  const ctx = { source: "test", generationId: "g1" };

  it("DB/内部错误回 fallback（不暴露裸 SQL）", () => {
    const msg = toClientErrorMessage(drizzleError(), ctx, "请稍后重试");
    expect(msg).toBe("请稍后重试");
    expect(msg).not.toContain("Failed query");
    expect(msg).not.toContain("api_key");
    expect(toClientErrorMessage(pgError(), ctx, "请稍后重试")).toBe(
      "请稍后重试"
    );
  });

  it("用户级错误原样透传", () => {
    expect(
      toClientErrorMessage(new Error("Insufficient credits"), ctx, "fallback")
    ).toBe("Insufficient credits");
  });

  it("非 Error 回 fallback", () => {
    expect(toClientErrorMessage("boom", ctx, "fallback")).toBe("fallback");
  });
});
