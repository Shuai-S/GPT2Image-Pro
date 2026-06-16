/**
 * MCP Admin 鉴权模块
 *
 * 职责：验证 MCP Admin 请求的 Bearer token，
 * 使用 SHA-256 哈希 + timingSafeEqual 恒定时间比对防止时序攻击。
 *
 * 使用方：apps/web/src/app/api/mcp/admin/route.ts
 * 关键依赖：node:crypto（createHash、timingSafeEqual）、config.ts（getMcpAdminSecret）
 *
 * 设计决策：
 * - Fail-closed：无 secret 配置时始终拒绝
 * - 返回固定 Principal（super_admin 身份），代表 MCP 管理密钥绑定的系统管理员
 * - 不读取 DB（鉴权无 IO 依赖，极快且无连接要求）
 * - 先哈希再比对：SHA-256 输出定长 32 字节，
 *   避免长度不等时短路泄露密钥长度信息（与 cron-auth.ts 一致）
 */
import { createHash, timingSafeEqual } from "node:crypto";

import type { Principal } from "../uol/principal";
import { getMcpAdminSecret } from "./config";

/**
 * MCP Admin 鉴权结果
 */
export type McpAuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; error: string };

/**
 * MCP Admin 固定管理员 userId（MCP 密钥绑定的虚拟身份）。
 * 审计日志中以此标识 MCP 调用来源。
 */
const MCP_ADMIN_PRINCIPAL_USER_ID = "__mcp_admin__";

/**
 * 验证 MCP Admin 请求的 Authorization header。
 *
 * 预期格式：Bearer <secret>
 * - 无 secret 配置 → 拒绝（fail-closed）
 * - header 格式不正确 → 拒绝
 * - secret 不匹配 → 拒绝
 * - 匹配 → 返回 super_admin Principal
 *
 * @param authHeader - 请求的 Authorization header 值（可能为 null/undefined）
 * @returns 鉴权结果（含 principal 或错误描述）
 */
export function authenticateMcpAdmin(
  authHeader: string | null | undefined,
): McpAuthResult {
  const configuredSecret = getMcpAdminSecret();

  // Fail-closed：未配置 secret 时一律拒绝
  if (!configuredSecret) {
    return {
      ok: false,
      error: "MCP admin secret not configured",
    };
  }

  if (!authHeader) {
    return {
      ok: false,
      error: "Missing Authorization header",
    };
  }

  // 解析 Bearer token
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      ok: false,
      error: "Invalid Authorization header format (expected: Bearer <token>)",
    };
  }

  const providedToken = parts[1];
  if (!providedToken) {
    return {
      ok: false,
      error: "Empty bearer token",
    };
  }

  // 先将 token 和 secret 分别做 SHA-256 哈希，再用 timingSafeEqual 比对。
  // SHA-256 输出定长 32 字节，保证 timingSafeEqual 不因长度不等而抛出，
  // 且无论输入长度如何，比对时间恒定，不泄露密钥长度信息。
  const tokenHash = createHash("sha256")
    .update(Buffer.from(providedToken))
    .digest();
  const secretHash = createHash("sha256")
    .update(Buffer.from(configuredSecret))
    .digest();

  if (!timingSafeEqual(tokenHash, secretHash)) {
    return { ok: false, error: "Invalid credentials" };
  }

  return {
    ok: true,
    principal: {
      type: "user",
      userId: MCP_ADMIN_PRINCIPAL_USER_ID,
      role: "super_admin",
    },
  };
}
