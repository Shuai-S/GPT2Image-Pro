/**
 * MCP 审计日志脱敏工具
 *
 * 职责：对即将写入审计日志的 MCP 调用参数进行敏感字段脱敏。
 * 递归遍历对象，将包含 password/secret/token/apiKey 等关键词的字段值
 * 替换为 "[REDACTED]"。
 *
 * ���用方：route.ts 中记录 MCP 调用日志前对参数做脱敏处理
 * 关键依赖：无外部依赖
 *
 * 设计决策：
 * - 按字段名关键词匹配（不区分大小写），覆盖常见敏感命名
 * - 深拷贝后修改，不影响原始对象
 * - 最大递归深度 10 层，防止循环引用或超深嵌套导致栈溢出
 */

/**
 * 敏感字段名关键词列表（小写）。
 * 字段名包含这些关键词之一则被脱敏。
 */
const SENSITIVE_KEYWORDS = [
  "password",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "credential",
];

/** 脱敏替换值 */
const REDACTED = "[REDACTED]";

/** 最大递归深度 */
const MAX_DEPTH = 10;

/**
 * 判断字段名是否为敏感字段。
 * 将字段名转为小写后检查是否包含任一敏感关键词。
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 对对象进行深度脱敏，移除/遮蔽敏感字段值。
 *
 * 返回深拷贝后的新对象（不修改原始输入）。
 * 对于非对象输入（null/undefined/primitive），原样返回。
 *
 * @param obj - 待脱敏的对象
 * @returns 脱敏后的深拷贝
 */
export function redactSensitiveFields(obj: unknown): unknown {
  return redactRecursive(obj, 0);
}

function redactRecursive(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH_EXCEEDED]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  // 数组：递归处理每个元素
  if (Array.isArray(value)) {
    return value.map((item) => redactRecursive(item, depth + 1));
  }

  // 普通对象：逐字段检查
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redactRecursive(val, depth + 1);
    }
  }
  return result;
}
