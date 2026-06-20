/**
 * Adobe Firefly 直连请求签名/会话头（移植自 adobe2api core/adobe_client.py 顶部辅助 +
 * token_mgr 的 JWT 解析）。
 *
 * - decodeJwtPayload：解出 IMS token 的 claims（含 user_id/exp）。
 * - buildSubmitNonce：x-nonce = sha256(`${user_id}-${prompt[:256]}`)。
 * - buildArpSessionId：x-arp-session-id = base64({sid, ftr})，ftr 含随机串+毫秒+pid+魔法串。
 * 纯函数（buildArpSessionId 含随机/时间，故非确定），依赖 node:crypto。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

export type JwtClaims = Record<string, unknown>;

/** 移植 _decode_jwt_payload：base64url 解 JWT 第二段；失败返回 {}。 */
export function decodeJwtPayload(token: string): JwtClaims {
  const rawToken = String(token || "").trim();
  if (!rawToken) return {};
  const parts = rawToken.split(".");
  if (parts.length < 2) return {};
  let payloadPart = (parts[1] || "").trim();
  if (!payloadPart) return {};
  const padding = ((-payloadPart.length % 4) + 4) % 4;
  if (padding) payloadPart += "=".repeat(padding);
  try {
    const decoded = Buffer.from(payloadPart, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? (parsed as JwtClaims) : {};
  } catch {
    return {};
  }
}

/** 移植 account_id_from_token：取 user_id / aa_id / sub。 */
export function accountIdFromToken(token: string): string {
  const claims = decodeJwtPayload(token);
  return String(claims.user_id || claims.aa_id || claims.sub || "").trim();
}

/** 移植 _decode_jwt_exp：兼容 exp 或 created_at+expires_in（含毫秒）。返回秒级时间戳或 null。 */
export function decodeJwtExp(token: string): number | null {
  const claims = decodeJwtPayload(token);
  if (!claims || Object.keys(claims).length === 0) return null;

  const exp = claims.exp;
  if (typeof exp === "number" && Number.isFinite(exp)) return Math.trunc(exp);

  let createdAtVal: number;
  let expiresInVal: number;
  try {
    createdAtVal = Number.parseInt(String(claims.created_at).trim(), 10);
    expiresInVal = Number.parseInt(String(claims.expires_in).trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isFinite(createdAtVal) || !Number.isFinite(expiresInVal))
    return null;
  if (createdAtVal <= 0 || expiresInVal <= 0) return null;

  if (createdAtVal > 10_000_000_000)
    createdAtVal = Math.trunc(createdAtVal / 1000);
  if (expiresInVal > 86400 * 2) expiresInVal = Math.trunc(expiresInVal / 1000);

  return createdAtVal + expiresInVal;
}

/** token 是否已过期（带 skewSeconds 提前量）。无法判定 exp 时按"未过期"处理。 */
export function isTokenExpired(token: string, skewSeconds = 60): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) return false;
  return exp - skewSeconds <= Math.floor(Date.now() / 1000);
}

/** 移植 _build_submit_nonce：sha256(`${user_id}-${prompt[:256]}`)；缺 user_id/prompt 返回 ""。 */
export function buildSubmitNonce(token: string, prompt: string): string {
  const claims = decodeJwtPayload(token);
  const userId = String(
    claims.user_id || claims.aa_id || claims.sub || ""
  ).trim();
  const promptPrefix = String(prompt || "").slice(0, 256);
  if (!userId || !promptPrefix) return "";
  return createHash("sha256")
    .update(`${userId}-${promptPrefix}`, "utf-8")
    .digest("hex");
}

/** 移植 _build_arp_session_id：base64({sid:uuid, ftr:`${rand}_${ms}_${pid}_<magic>`})。 */
export function buildArpSessionId(): string {
  const nowMs = Date.now();
  const rand = randomBytes(16).toString("hex");
  const pid = typeof process !== "undefined" && process.pid ? process.pid : 0;
  const ftr = `${rand}_${nowMs}_${pid}_dUAL43-mnts-ants-d4_31ck__tt`;
  const raw = JSON.stringify({ sid: randomUUID(), ftr });
  return Buffer.from(raw, "utf-8").toString("base64");
}
