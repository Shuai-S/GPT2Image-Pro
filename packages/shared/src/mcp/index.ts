/**
 * MCP 模块桶导出
 *
 * 职责：聚合 Admin MCP 与 User MCP 的公共 API。
 * 两套 MCP 物理隔离：独立鉴权、独立路由、独立工具集。
 */

// --- Admin MCP ---
export {
  isMcpAdminEnabled,
  getMcpAdminSecret,
  getMcpDeniedOps,
  getMcpReadOnlyMode,
  getMcpRateLimitPerMin,
} from "./config";

export {
  authenticateMcpAdmin,
  type McpAuthResult,
} from "./admin-auth";

export {
  buildAdminMcpTools,
  operationNameToToolName,
  toolNameToOperationName,
  type McpToolDefinition,
} from "./tool-factory";

export { redactSensitiveFields } from "./redact";

// --- User MCP ---
export { isMcpUserEnabled, getMcpUserRateLimitPerMin } from "./user-config";
export {
  authenticateMcpUserKey,
  bindMcpUserAuth,
  McpAuthError,
  type AuthenticateMcpUserKeyFn,
} from "./user-auth";
export { buildUserMcpTools, type McpToolDescriptor } from "./user-tool-factory";
