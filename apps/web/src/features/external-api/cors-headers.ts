/**
 * 外部 API 跨域(CORS)响应头构建(纯函数,DB-free,可单测)。
 *
 * 策略由管理员开关 EXTERNAL_API_CORS_ENABLED 控制(见 ./cors.ts):开启时对所有
 * 来源开放(Access-Control-Allow-Origin: *)且不开启凭据——外部 API 是 Bearer
 * 鉴权、不带 cookie,故 * 安全、不构成 CSRF 面;关闭时调用方不附加任何 CORS 头
 * (浏览器跨域自行拦截,服务端到服务端调用不受影响)。
 *
 * 本模块只构建头、不读取配置,便于直接单测。使用方:./cors.ts。
 */

// 允许浏览器读取的响应头(限流额度 + 重试),与 @repo/shared/rate-limit 的输出对齐。
const EXPOSE_HEADERS =
  "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After";

// 预检默认放行的请求头(无 Access-Control-Request-Headers 时的兜底)。
const DEFAULT_ALLOW_HEADERS = "Authorization, Content-Type";

/**
 * 构建"对所有来源开放"的 CORS 头。
 *
 * @param options.preflight - 是否为 OPTIONS 预检(预检追加 Allow-Methods/Headers/Max-Age)。
 * @param options.requestedHeaders - 预检的 Access-Control-Request-Headers,原样回显,
 *   以兼容各 SDK 携带的自定义头(如 OpenAI SDK 的 x-stainless-*);为空时用默认集合。
 */
export function buildOpenCorsHeaders(options?: {
  preflight?: boolean;
  requestedHeaders?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": EXPOSE_HEADERS,
  };
  if (options?.preflight) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      options.requestedHeaders?.trim() || DEFAULT_ALLOW_HEADERS;
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}
