import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accountIdFromToken,
  buildArpSessionId,
  buildSubmitNonce,
  decodeJwtExp,
  decodeJwtPayload,
  isTokenExpired,
} from "./signing";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj), "utf-8").toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

describe("decodeJwtPayload", () => {
  it("解出 claims", () => {
    const token = makeJwt({ user_id: "u123", exp: 999 });
    expect(decodeJwtPayload(token)).toEqual({ user_id: "u123", exp: 999 });
  });
  it("非法返回 {}", () => {
    expect(decodeJwtPayload("")).toEqual({});
    expect(decodeJwtPayload("notajwt")).toEqual({});
  });
});

describe("accountIdFromToken", () => {
  it("取 user_id/aa_id/sub", () => {
    expect(accountIdFromToken(makeJwt({ user_id: "u1" }))).toBe("u1");
    expect(accountIdFromToken(makeJwt({ aa_id: "a1" }))).toBe("a1");
    expect(accountIdFromToken(makeJwt({ sub: "s1" }))).toBe("s1");
    expect(accountIdFromToken(makeJwt({}))).toBe("");
  });
});

describe("decodeJwtExp / isTokenExpired", () => {
  it("直接 exp", () => {
    expect(decodeJwtExp(makeJwt({ exp: 1771862511 }))).toBe(1771862511);
  });
  it("created_at + expires_in（毫秒归一）", () => {
    expect(
      decodeJwtExp(makeJwt({ created_at: 1771862511913, expires_in: 86400000 }))
    ).toBe(1771862511 + 86400);
  });
  it("无可判定字段返回 null（按未过期处理）", () => {
    expect(decodeJwtExp(makeJwt({}))).toBeNull();
    expect(isTokenExpired(makeJwt({}))).toBe(false);
  });
  it("过期判定", () => {
    expect(isTokenExpired(makeJwt({ exp: 1 }))).toBe(true);
    expect(
      isTokenExpired(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    ).toBe(false);
  });
});

describe("buildSubmitNonce", () => {
  it("sha256(user_id-prompt前缀)，确定性", () => {
    const token = makeJwt({ user_id: "u123" });
    const expected = createHash("sha256")
      .update("u123-hello", "utf-8")
      .digest("hex");
    expect(buildSubmitNonce(token, "hello")).toBe(expected);
  });
  it("缺 user_id 或 prompt 返回空", () => {
    expect(buildSubmitNonce(makeJwt({}), "hello")).toBe("");
    expect(buildSubmitNonce(makeJwt({ user_id: "u" }), "")).toBe("");
  });
});

describe("buildArpSessionId", () => {
  it("base64 解出 {sid, ftr}，ftr 含魔法串", () => {
    const raw = Buffer.from(buildArpSessionId(), "base64").toString("utf-8");
    const parsed = JSON.parse(raw) as { sid: string; ftr: string };
    expect(parsed.sid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(parsed.ftr).toContain("dUAL43-mnts-ants-d4_31ck__tt");
  });
});
