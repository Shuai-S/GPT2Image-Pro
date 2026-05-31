/**
 * MCP Admin 配置模块
 *
 * 职责：提供 MCP Admin 服务的运行时配置读取接口。
 * 所有配置来自环境变量（MCP 功能默认关闭，不写入 DB system-settings）。
 *
 * 使用方：auth.ts（获取 secret）、route.ts（检查启用状态与限流阈值）
 * 关键依赖：无外部依赖（纯环境变量读取）
 *
 * 设计决策：
 * - 默认关闭（fail-closed）：MCP_ENABLED 必须显式设置为 truthy 才开启
 * - secret 不配置则永远拒绝：消除无鉴权状态下被访问的风险
 * - denied ops 从环境变量读取逗号分隔列表，支持运维灵活封锁操作
 * - 限流阈值读环境变量，默认 60 req/min
 */

/**
 * MCP Admin 功能是否启用。
 *
 * 检查逻辑：环境变量 MCP_ENABLED 为 "1" / "true" / "yes" / "on"（不区分大小写）
 * 才返回 true，其他任何值（包括未设置）均返回 false。
 *
 * @returns 是否启用 MCP Admin 端点
 */
export function isMcpAdminEnabled(): boolean {
  const raw = process.env.MCP_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw);
}

/**
 * 获取 MCP Admin 鉴权密钥。
 *
 * 从环境变量 MCP_ADMIN_SECRET 读取。未配置或为空串时返回 undefined，
 * 调用方应据此拒绝所有请求（fail-closed）。
 *
 * @returns 密钥字符串或 undefined
 */
export function getMcpAdminSecret(): string | undefined {
  const secret = process.env.MCP_ADMIN_SECRET?.trim();
  return secret || undefined;
}

/**
 * 获取永久封锁的操作名称列表。
 *
 * 从环境变量 MCP_DENIED_OPS 读取逗号分隔列表（如 "credits.grant,user.delete"）。
 * 列表中的操作即使满足权限也不通过 MCP 暴露。
 *
 * @returns 操作名称数组（可能为空）
 */
export function getMcpDeniedOps(): string[] {
  const raw = process.env.MCP_DENIED_OPS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

/**
 * MCP Admin 是否处于只读模式。
 *
 * 只读模式下仅暴露 readOnly=true 的操作，所有写操作被过滤掉。
 * 环境变量 MCP_READ_ONLY 为 truthy 时启用。
 *
 * @returns 是否只读
 */
export function getMcpReadOnlyMode(): boolean {
  const raw = process.env.MCP_READ_ONLY?.trim().toLowerCase();
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw);
}

/**
 * 获取 MCP Admin 每分钟请求限流阈值。
 *
 * 从环境变量 MCP_RATE_LIMIT_PER_MIN 读取正整数，
 * 不合法或未配置时回退默认值 60。
 *
 * @returns 每分钟允许的最大请求数
 */
export function getMcpRateLimitPerMin(): number {
  const raw = process.env.MCP_RATE_LIMIT_PER_MIN;
  if (!raw) return 60;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  return parsed;
}
