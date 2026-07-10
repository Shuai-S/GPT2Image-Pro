/**
 * 生图后端错误分类、冷却窗口与失败状态收敛。
 *
 * service.ts 通过运行时读取器注入系统设置；单元测试可不注入任何数据库依赖，
 * 直接验证分类和时间边界。
 */

import {
  isContentSafetyRejection,
  USER_INPUT_LIMIT_PATTERNS,
} from "@/features/image-generation/sla-classification";

export type BackendFailureContext = {
  upstreamResetAt?: string | Date | null;
  retryAfterSeconds?: number | null;
};

export type BackendFailure = {
  status?: string;
  cooldownUntil?: Date | null;
};

export type BackendCooldownSettingKey =
  | "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_TOOL_RATE_LIMIT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES";

export type BackendFailureRuntime = {
  readUnrecoverableKeywords?: () => Promise<string | null | undefined>;
  readCooldownMinutes?: (
    key: BackendCooldownSettingKey,
    fallback: number
  ) => Promise<number>;
};

const DEFAULT_BACKEND_COOLDOWN_MINUTES = 15;
const DEFAULT_TOOL_RATE_LIMIT_COOLDOWN_MINUTES = 3;
const MAX_PARSED_RESET_COOLDOWN_DAYS = 14;
const MIN_RESET_COOLDOWN_MS = 60_000;
const DEFAULT_UNRECOVERABLE_BACKEND_ERROR_KEYWORDS = [
  "refresh token",
  "invalid refresh token",
  "invalid_refresh_token",
  "invalid_grant",
  "authentication",
  "authentication failed",
  "token_invalidated",
  "token_revoked",
  "account deactivated",
  "deactivated account",
  "deactivated_workspace",
  "workspace deactivated",
  "organization has been disabled",
  "identity verification is required",
];

/** 把管理员配置的逗号、分号或换行关键字归一化为小写列表。 */
function splitKeywordList(value?: string | null) {
  return (value || "")
    .split(/[\n,;，；]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** 延迟读取不可恢复错误关键字，未配置时使用内置保守列表。 */
async function getUnrecoverableBackendErrorKeywords(
  runtime: BackendFailureRuntime
) {
  const configured = await runtime.readUnrecoverableKeywords?.();
  const keywords = splitKeywordList(configured);
  return keywords.length
    ? keywords
    : DEFAULT_UNRECOVERABLE_BACKEND_ERROR_KEYWORDS;
}

/** 判断错误是否命中管理员配置或内置的不可恢复凭证关键字。 */
async function isUnrecoverableBackendError(
  error: string | null | undefined,
  runtime: BackendFailureRuntime
) {
  const normalized = (error || "").toLowerCase();
  if (!normalized) return false;
  const keywords = await getUnrecoverableBackendErrorKeywords(runtime);
  return keywords.some((keyword) => normalized.includes(keyword));
}

/** 按默认冷却桶和可选运行时设置解析指定错误类别的分钟数。 */
export async function resolveBackendCooldownMinutes(
  key: BackendCooldownSettingKey,
  runtime: BackendFailureRuntime = {}
) {
  const defaultMinutes = runtime.readCooldownMinutes
    ? await runtime.readCooldownMinutes(
        "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES",
        DEFAULT_BACKEND_COOLDOWN_MINUTES
      )
    : DEFAULT_BACKEND_COOLDOWN_MINUTES;
  if (key === "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES") {
    return defaultMinutes;
  }
  const keyFallback =
    key === "IMAGE_BACKEND_TOOL_RATE_LIMIT_COOLDOWN_MINUTES"
      ? DEFAULT_TOOL_RATE_LIMIT_COOLDOWN_MINUTES
      : defaultMinutes;
  return runtime.readCooldownMinutes
    ? await runtime.readCooldownMinutes(key, keyFallback)
    : keyFallback;
}

/** 解析上游重置文案中的毫秒、秒、分钟、小时或天数。 */
function parseDurationMs(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?\s*ms$/.test(trimmed)) {
    return Number.parseFloat(trimmed) || null;
  }
  if (/^\d+(?:\.\d+)?\s*s$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 1000;
  }
  if (/^\d+(?:\.\d+)?\s*m$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*h$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60 * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*d(?:ay|ays)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 24 * 60 * 60_000;
  }
  const parts = [
    ...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|day|days)/g),
  ];
  if (!parts.length) return null;
  const total = parts.reduce((sum, match) => {
    const amount = Number.parseFloat(match[1] || "0");
    const unit = match[2];
    if (unit === "ms") return sum + amount;
    if (unit === "s") return sum + amount * 1000;
    if (unit === "m") return sum + amount * 60_000;
    if (unit === "h") return sum + amount * 60 * 60_000;
    if (unit === "d" || unit === "day" || unit === "days") {
      return sum + amount * 24 * 60 * 60_000;
    }
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

/** 判断失败是否可通过切换成员或等待短期冷却恢复。 */
export function isRecoverableBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    isUnsupportedModelBackendError(error) ||
    isTransientNetworkBackendError(error) ||
    isToolRateLimitBackendError(error) ||
    normalized.includes("429") ||
    normalized.includes("529") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("usage limit") ||
    normalized.includes("usage_limit") ||
    normalized.includes("limit has been reached") ||
    normalized.includes("limit_reached") ||
    normalized.includes("rate_limit_exceeded") ||
    normalized.includes("no available image quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("quota_exhausted") ||
    normalized.includes("daily quota exceeded") ||
    normalized.includes("account quota exceeded") ||
    normalized.includes("quota has been exceeded") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("quota_exceeded") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("insufficient credit") ||
    normalized.includes("insufficient credits") ||
    normalized.includes("not enough credit") ||
    normalized.includes("not enough credits") ||
    normalized.includes("credit exhausted") ||
    normalized.includes("credits exhausted") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("minimumcreditamountforusage") ||
    normalized.includes("minimum credit amount for usage") ||
    normalized.includes("minimum credit") ||
    normalized.includes("billing_hard_limit") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("fetch failed") ||
    normalized.includes("empty non-json") ||
    normalized.includes("empty response") ||
    normalized.includes("non-json responses api response") ||
    normalized.includes("non-json images api response") ||
    normalized.includes("upstream returned no image output") ||
    normalized.includes("returned no image output") ||
    normalized.includes("api returned no image data") ||
    normalized.includes("http 500") ||
    normalized.includes("status_code=500") ||
    normalized.includes("status code 500") ||
    normalized.includes('"status":500') ||
    normalized.includes("internal server error") ||
    normalized.includes("server_error") ||
    normalized.includes("something seems to have gone wrong") ||
    normalized.includes("an error occurred while processing your request") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("server overloaded") ||
    normalized.includes("overloaded") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("temporary unavailable") ||
    normalized.includes("service unavailable") ||
    // 我方算 token 下载图片因 429/限流/超时/5xx 失败属瞬时，可切后端重试。
    (isTokenCountDownloadFailure(normalized) &&
      isTransientFileDownloadFailure(normalized))
  );
}

/** 识别连接被重置、socket 关闭或 Undici 中止等瞬时网络故障。 */
function isTransientNetworkBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized === "terminated" ||
    normalized.includes("typeerror: terminated") ||
    normalized.includes("request aborted") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("socket closed") ||
    normalized.includes("socket hang up") ||
    normalized.includes("other side closed") ||
    normalized.includes("connection closed") ||
    normalized.includes("connection terminated") ||
    normalized.includes("connection reset") ||
    normalized.includes("econnreset") ||
    (normalized.includes("undici") && normalized.includes("terminated"))
  );
}

/** 区分本站总请求截止时间触发的 abort，避免继续换号放大请求。 */
function isLocalAbortTimeoutError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("operation was aborted") &&
    normalized.includes("timeout")
  );
}

/**
 * 识别"上游模型缺少 image_generation 工具 / 不具备出图能力"导致只回文字的错误。
 *
 * WHY 单列：这类响应往往以"抱歉…我无法…"开头，会被内容安全拒绝启发式
 * （isApologyRefusal）误判为"用户内容被拒"，从而既不切换后端、也不惩罚后端，
 * 导致请求当场失败、坏后端长期留在轮换里。但它本质是后端配错（模型没有图像
 * 工具 / 环境未提供该工具），应当：可切换到别的后端 + 把该后端标记为 error。
 *
 * 为避免误伤"真正的内容拒绝"（如「图像生成请求被系统拒绝」），要求同时命中
 * "image_generation 工具 / 图像生成工具"字样与"未提供/不可用"语义。
 *
 * @param error 上游或本站包装后的错误文本。
 * @returns 是否为"后端缺少出图能力"类错误。
 */
export function isMissingImageToolBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  const mentionsImageTool =
    normalized.includes("图像生成工具") ||
    (normalized.includes("image_generation") &&
      (normalized.includes("工具") || normalized.includes("tool")));
  if (!mentionsImageTool) return false;
  return (
    normalized.includes("未提供") ||
    normalized.includes("没有提供") ||
    normalized.includes("没有可调用") ||
    normalized.includes("未提供可调用") ||
    normalized.includes("无法调用") ||
    normalized.includes("不可用") ||
    normalized.includes("不支持") ||
    normalized.includes("not available") ||
    normalized.includes("isn't available") ||
    normalized.includes("is not available") ||
    normalized.includes("not provided") ||
    normalized.includes("not enabled") ||
    normalized.includes("does not have") ||
    normalized.includes("doesn't have") ||
    normalized.includes("no image_generation") ||
    normalized.includes("unavailable")
  );
}

/**
 * 识别"中转本身坏掉/不可用"的确定性错误，按用户判定升级为 error（粘性下线）。
 *
 * - "没有可用token"：中转无上游额度/令牌（如 sub2api 中转池空）。
 * - "html response body"：端点返回 HTML（源站宕机/网关错误页/baseUrl 配错），
 *   非 OpenAI 兼容 JSON。
 * - "service temporarily unavailable"：中转上游 502/服务不可用（典型
 *   "Upstream service temporarily unavailable"）。按运维要求标 error 踢出轮换（持续不可用
 *   的中转不自愈），由测活/重新启用复活；当次请求仍换号重试（文案含 502/temporarily
 *   unavailable，被 isRecoverableBackendError 判为可切换）。
 * 这类不会自愈，应踢出轮换直到管理员处理（测活/重新启用/常驻）。
 * 注意副作用：firefly-* / nano-banana 仅由 Adobe / adobe_sourced 后端出图，若这些后端因本
 * 错误被全部踢出，firefly 请求将无后端可解析——此时由 getEffectiveConfig 给出「无可用 Adobe
 * 后端」的明确报错（而非泛化的"默认后端缺失"），便于运维定位是后端被踢空而非模型问题。
 */
/**
 * 中转确定性坏掉（dead-relay）判定。
 *
 * 仅以「指针型」证据判死：没有可用 token、HTML response body（中了 OpenAI 不
 * 兼容的 /v1 端点）。单纯的「service temporarily unavailable」文案常见于 502/
 * 504 上游瞬时抖动、不一定代表中转本身坏掉，已被抽离到 `isOverloadBackendError`
 * /`isRecoverableBackendError` 走 active + 短期冷却，避免误踢可用后端。
 *
 * WHY 拆分：2026-07 排查日志显示「Upstream Images API returned HTTP 502:
 * Upstream service temporarily unavailable | upstream_error」被原 dead-relay
 * 规则命中后立即 status='error' 踢出；但这类错误换号重试经常就能拿到图，不该
 * 当终态处理。
 */
function isDeadRelayBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("没有可用token") ||
    normalized.includes("没有可用 token") ||
    normalized.includes("html response body")
  );
}

/** 上游「service temporarily unavailable」类临时不可用文案（502/504 旁路）。
 * 不再纳入 dead-relay 终态判定，而是放给 isRecoverableBackendError 走 active +
 * 冷却，由换号重试恢复。 */
function isServiceTemporarilyUnavailableError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("service temporarily unavailable") ||
    normalized.includes("temporary unavailable") ||
    normalized.includes("service unavailable")
  );
}

// "failed to download file" 专指我方（如上游 new-api 为算 token）下载图片失败，
// 与 "error while downloading file"（上游下载用户提供的 url）区分：
// 后者是用户链接问题（终态、不切换），前者若是 429/超时/5xx 则属瞬时、可切后端。
function isTokenCountDownloadFailure(normalized: string) {
  return normalized.includes("failed to download file");
}

// 文件下载失败是否属于瞬时/可重试原因（429/限流/超时/5xx），而非客户端坏链接。
function isTransientFileDownloadFailure(normalized: string) {
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    /status code:\s*5\d\d/.test(normalized)
  );
}

/**
 * 识别"该后端/分组未开通图像生成"(HTTP 403 permission_error)的确定性坏配置错误。
 * 不会自愈，应可切换到别的后端 + 把该后端标记为 error 踢出轮换，
 * 等管理员开通/测活后再启用，避免请求一直被路由到坏后端而当场失败。
 */
export function isImageGenDisabledBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("image generation is not enabled") ||
    normalized.includes("image_generation is not enabled") ||
    (normalized.includes("permission_error") &&
      normalized.includes("image generation"))
  );
}

/**
 * 识别"API Key 所属分组被上游停用"(HTTP 403 GROUP_DISABLED)的确定性坏配置错误。
 *
 * WHY 单列：中转把整组 Key 停用后，该后端的一切请求都会 403 且不会自愈。
 * 2026-06-10 事故：该文案不命中任何白名单 → 不切换当场失败，叠加 always_active
 * 不下线，形成"持续吃流量、每次都失败"的黑洞。应当：可切换到别的后端 +
 * 把该后端标记为 error 踢出轮换，等管理员处理(测活/重新启用)后再回来。
 */
export function isGroupDisabledBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("group_disabled") ||
    normalized.includes("分组已停用") ||
    normalized.includes("分组已禁用")
  );
}

/** 判断错误是否源自用户内容、输入格式或请求体边界。 */
function isUserRequestBackendError(error?: string | null) {
  // 缺图像工具是后端能力问题（非用户内容拒绝）：放行去走"可切换 + 标记 error"，
  // 否则会被下方 isApologyRefusal 误判成用户拒绝而当场失败、不切换。
  if (isMissingImageToolBackendError(error)) return false;
  const normalized = (error || "").toLowerCase();
  return (
    isContentSafetyRejection(error) ||
    normalized.includes("moderation_blocked") ||
    normalized.includes("image_generation_user_error") ||
    normalized.includes("user_error") ||
    normalized.includes("content_policy") ||
    normalized.includes("policy_violation") ||
    // 用户输入超限(提示词过长 / 参考图超数 / 输入图过大):切后端也救不了 → 不重试、直接报。
    // 与 SLA 侧共用 USER_INPUT_LIMIT_PATTERNS(sla-classification.ts),码 + 中英文案兜底,避免
    // 两处分类器漂移;限流类(rate limit/concurrency/too many requests)不在表内,仍可切换。
    USER_INPUT_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
    // 请求体过大(上传图/请求超出上游或我方 body 上限):换任何后端都不解决 → 算用户错、不重试。
    // 上游中转常以 413/414 或 "payload too large" 文案回传,因此按码与文案双重判定。
    normalized.includes("http 413") ||
    normalized.includes("http 414") ||
    normalized.includes("payload too large") ||
    normalized.includes("payload_too_large") ||
    normalized.includes("request entity too large") ||
    normalized.includes("content too large") ||
    normalized.includes(
      "the image data you provided does not represent a valid image"
    ) ||
    normalized.includes("error while downloading file") ||
    normalized.includes("unable to download content from the provided url") ||
    normalized.includes("file urls cannot be larger than") ||
    normalized.includes("transparent background is not supported") ||
    // 分辨率/尺寸不对（用户给的 size/分辨率/蒙版尺寸不符）：切后端也救不了，算用户错。
    normalized.includes("unsupported size") ||
    normalized.includes("invalid size") ||
    normalized.includes("size is not supported") ||
    normalized.includes("size not supported") ||
    normalized.includes("invalid resolution") ||
    normalized.includes("unsupported resolution") ||
    normalized.includes("resolution is not supported") ||
    normalized.includes("invalid dimensions") ||
    normalized.includes("unsupported dimensions") ||
    normalized.includes("does not match image size") ||
    normalized.includes("invalid_mask_image_format") ||
    // 无效图像（用户提供的图片本身无法识别/格式不对）：同理算用户错。
    normalized.includes("not a valid image") ||
    normalized.includes("invalid image data") ||
    normalized.includes("invalid image format") ||
    normalized.includes("unsupported image format") ||
    // 我方为算 token 下载图片失败（failed to download file）默认算用户错（坏链接/非图片/403/404），
    // 但若是 429/限流/超时/5xx 等瞬时原因（典型：上游为算 token 下载我方图片被限流），
    // 不算用户错，放行给 isRecoverableBackendError 走"切后端 + 冷却"。
    (isTokenCountDownloadFailure(normalized) &&
      !isTransientFileDownloadFailure(normalized))
  );
}

/** 判断错误是否允许在当前请求中切换到另一后端成员。 */
export function isImageBackendSwitchableError(error?: string | null) {
  return Boolean(
    error &&
      !isUserRequestBackendError(error) &&
      !isLocalAbortTimeoutError(error) &&
      (isRecoverableBackendError(error) ||
        isBackendProtocolCompatibilityError(error) ||
        isInvalidBackendCredentialError(error) ||
        isImageGenDisabledBackendError(error) ||
        isGroupDisabledBackendError(error))
  );
}

/**
 * 识别"未被任何已知规则记录"的未知后端错误：非用户请求错误、非本地超时
 * abort，也不命中任何可切换白名单。
 *
 * WHY 单列：isImageBackendSwitchableError 是白名单制，首次出现的新形态平台
 * 错误(上游新增的错误文案)默认不可切换，会当场失败砸在用户头上(GROUP_DISABLED
 * 事故即此类)。重试循环对这类错误允许有限次切换后端兜底，见
 * image-generation/service.ts 的 retryPoolBackendResult。
 */
export function isUnclassifiedBackendError(error?: string | null) {
  return Boolean(
    error &&
      !isUserRequestBackendError(error) &&
      !isLocalAbortTimeoutError(error) &&
      !isImageBackendSwitchableError(error)
  );
}

/** 判断已分类失败是否仍属于可恢复状态，用于报告结果的 retryable 字段。 */
export function isClassifiedFailureRecoverable(
  error: string | null,
  failure: { status?: string; cooldownUntil?: Date | null }
) {
  return Boolean(
    error &&
      !isUserRequestBackendError(error) &&
      isRecoverableBackendError(error) &&
      failure.status !== "error"
  );
}

/** 识别无效、过期或被撤销的上游凭证。 */
export function isInvalidBackendCredentialError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key") ||
    normalized.includes("invalid_api_key") ||
    normalized.includes("invalid access token") ||
    normalized.includes("invalid_access_token") ||
    normalized.includes("invalid auth") ||
    normalized.includes("invalid authentication") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("token has been invalidated") ||
    normalized.includes("token expired") ||
    normalized.includes("expired token") ||
    normalized.includes("token is expired") ||
    normalized.includes("access token expired") ||
    normalized.includes("signing in again") ||
    normalized.includes("please sign in again") ||
    normalized.includes("please try signing in again")
  );
}

/** 识别账号额度、余额或长期使用配额耗尽。 */
export function isUsageLimitBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("usage limit") ||
    normalized.includes("usage_limit") ||
    normalized.includes("limit has been reached") ||
    normalized.includes("limit_reached") ||
    normalized.includes("no available image quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("quota_exhausted") ||
    normalized.includes("daily quota exceeded") ||
    normalized.includes("account quota exceeded") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota has been exceeded") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("quota_exceeded") ||
    normalized.includes("insufficient credit") ||
    normalized.includes("insufficient credits") ||
    normalized.includes("not enough credit") ||
    normalized.includes("not enough credits") ||
    normalized.includes("credit exhausted") ||
    normalized.includes("credits exhausted") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("minimumcreditamountforusage") ||
    normalized.includes("minimum credit amount for usage") ||
    normalized.includes("minimum credit") ||
    normalized.includes("billing_hard_limit")
  );
}

/**
 * 识别 ChatGPT 账号侧"画图工具被限流"——image_gen.text2im 工具级 RateLimitException。
 *
 * WHY 单列:ChatGPT 在该账号画图额度用满时不会返回图片,而是回一条
 * content_type=system_error、name=ChatGPTAgentToolRateLimitException 的消息
 * (chatgpt-web.ts 的 extractWebSystemError 已把它从 o/v 流里抽成错误文案)。它是
 * 账号级的滚动限流、恢复快,必须按限流处理(短冷却 + 换号重试),不能被当成
 * 通用 "no image output" 落进 15 分钟临时桶,也利于 SLA 把它归类为限流而非平台故障。
 * "ratelimitexception"(小写)即可命中 ChatGPTAgentToolRateLimitException。
 */
function isToolRateLimitBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("ratelimitexception") ||
    (normalized.includes("image_gen.text2im") &&
      (normalized.includes("right now") || normalized.includes("rate limit")))
  );
}

/** 判断错误是否应优先采用上游给出的重置时间。 */
export function isResetAwareLimitedBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    isUsageLimitBackendError(error) ||
    isToolRateLimitBackendError(error) ||
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  );
}

/** 识别上游过载、网关空响应与临时容量不足。 */
export function isOverloadBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("529") ||
    normalized.includes("overloaded") ||
    normalized.includes("server overloaded") ||
    normalized.includes("http 500") ||
    normalized.includes("status_code=500") ||
    normalized.includes("status code 500") ||
    normalized.includes('"status":500') ||
    normalized.includes("internal server error") ||
    normalized.includes("server_error") ||
    normalized.includes("something seems to have gone wrong") ||
    normalized.includes("an error occurred while processing your request") ||
    normalized.includes("empty non-json") ||
    normalized.includes("empty response") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("temporary unavailable") ||
    normalized.includes("service unavailable") ||
    normalized.includes("capacity") ||
    normalized.includes("try again later")
  );
}

/** 识别模型、工具或账号能力不支持当前请求。 */
export function isUnsupportedModelBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("unsupported model") ||
    normalized.includes("model not supported") ||
    normalized.includes("model is not supported") ||
    normalized.includes("model_not_supported") ||
    normalized.includes("unsupported_model") ||
    normalized.includes("model_not_found") ||
    normalized.includes("model_not_available") ||
    normalized.includes("does not support this model") ||
    normalized.includes("not support this model") ||
    normalized.includes("tool choice 'image_generation' not found") ||
    normalized.includes("tool choice image_generation not found") ||
    (normalized.includes("image_generation") &&
      normalized.includes("not found in") &&
      normalized.includes("tools")) ||
    normalized.includes("not allowed to use model") ||
    normalized.includes("not have access to the model") ||
    normalized.includes("account does not support") ||
    normalized.includes("账户不支持此模型") ||
    normalized.includes("不支持此模型") ||
    normalized.includes("不支持该模型")
  );
}

/**
 * 识别上游 OpenAI 兼容层的请求编码或字段类型不兼容。
 *
 * @remarks 这类 400 通常只影响某个中转实现，切换到另一成员可能成功，但不应
 * 继续走“未知错误最多三次”的放大兜底。
 */
export function isBackendProtocolCompatibilityError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return Boolean(
    normalized &&
      (normalized.includes("cannot unmarshal") ||
        normalized.includes("json: cannot decode") ||
        normalized.includes("unsupported parameter") ||
        normalized.includes("unknown parameter") ||
        normalized.includes("unexpected field"))
  );
}

/** 解析绝对时间戳、ISO 时间或相对时长；非法输入返回 null。 */
export function parseDateValue(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const durationMs = parseDurationMs(trimmed);
  if (durationMs) {
    return new Date(Date.now() + durationMs);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 把上游重置时间限制在一分钟地板与十四天上限之间。 */
function clampResetDate(date: Date | null, now: Date) {
  if (!date || date.getTime() <= now.getTime()) return null;
  // 地板:亚秒级/过短的上游重置抬到至少 MIN_RESET_COOLDOWN_MS,避免冷却形同虚设。
  const min = now.getTime() + MIN_RESET_COOLDOWN_MS;
  const max = now.getTime() + MAX_PARSED_RESET_COOLDOWN_DAYS * 24 * 60 * 60_000;
  return new Date(Math.min(Math.max(date.getTime(), min), max));
}

/** 从 Retry-After、reset 字段或自然语言文案中提取重置时间。 */
function parseResetDateFromError(error?: string | null) {
  if (!error) return null;
  const normalized = error.replace(/\\"/g, '"');
  const retryAfter = normalized.match(/retry-after["'\s:=]+(\d{1,8})/i)?.[1];
  if (retryAfter) {
    return new Date(Date.now() + Number(retryAfter) * 1000);
  }
  const retryAfterSeconds = normalized.match(
    /(?:retryAfterSeconds|retry_after_seconds|retry_after|retryAfter|reset_after_seconds|resets_in_seconds|quotaResetDelay)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (retryAfterSeconds) {
    const numeric = Number(retryAfterSeconds);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(Date.now() + numeric * 1000);
    }
    const durationMs = parseDurationMs(retryAfterSeconds);
    if (durationMs) return new Date(Date.now() + durationMs);
  }

  const relativeResetMatch = normalized.match(
    /(?:reset_after|resetAfter|restore_after|restoreAfter)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (relativeResetMatch) {
    const numeric = Number(relativeResetMatch);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(Date.now() + numeric * 1000);
    }
    const durationMs = parseDurationMs(relativeResetMatch);
    if (durationMs) return new Date(Date.now() + durationMs);
  }

  const resetMatch = normalized.match(
    /(?:x-ratelimit-reset(?:-[a-z0-9_-]+)?|upstreamResetAt|upstream_reset_at|resetAt|reset_at|resetsAt|resets_at|restore_at|restoreAt)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (resetMatch) {
    const parsed = parseDateValue(resetMatch);
    if (parsed) return parsed;
  }

  const proseMatch = normalized.match(
    /(?:reset|resets|restore|available again|try again)(?:\s+\w+){0,4}\s+(?:at|after|on|in)[:\s]+([^"',}\]\n]+)/i
  )?.[1];
  return parseDateValue(proseMatch);
}

/** 在允许时优先采用显式或正文重置时间，否则返回分类桶的兜底时间。 */
function resolveCooldownDate(
  error: string | null,
  fallback: Date | null,
  input?: Pick<BackendFailureContext, "upstreamResetAt" | "retryAfterSeconds">,
  options?: { useUpstreamReset?: boolean }
) {
  if (!options?.useUpstreamReset) return fallback;

  const now = new Date();
  const retryAfter = Number(input?.retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const parsed = clampResetDate(
      new Date(now.getTime() + retryAfter * 1000),
      now
    );
    if (parsed) return parsed;
  }
  const explicitReset = clampResetDate(
    parseDateValue(input?.upstreamResetAt),
    now
  );
  if (explicitReset) return explicitReset;
  const bodyReset = clampResetDate(parseResetDateFromError(error), now);
  if (bodyReset) return bodyReset;
  return fallback;
}

/** 从正分钟数创建冷却截止时间，非法或过小值至少按一分钟处理。 */
export function cooldownFromMinutes(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000);
}

/** 判断来源冷却时间是否仍有效且与限流类错误相匹配。 */
export function isMeaningfulSourceCooldownForError(
  error: string | null,
  cooldownUntil: Date | null
) {
  return Boolean(
    cooldownUntil &&
      cooldownUntil.getTime() > Date.now() &&
      isResetAwareLimitedBackendError(error)
  );
}

/**
 * 将上游失败映射为后端状态与冷却截止时间。
 *
 * @param error 上游或本站包装后的错误文本。
 * @param input 上游显式重置时间与 Retry-After 秒数。
 * @param runtime 可选运行时设置读取器；省略时使用 DB-free 默认值。
 * @returns 分类后的状态与冷却时间；未知错误进入默认短期冷却。
 */
export async function classifyBackendFailure(
  error?: string | null,
  input?: BackendFailureContext,
  runtime: BackendFailureRuntime = {}
): Promise<BackendFailure> {
  const getCooldownMinutes = (key: BackendCooldownSettingKey) =>
    resolveBackendCooldownMinutes(key, runtime);
  const normalized = (error || "").toLowerCase();
  if (isUserRequestBackendError(error)) {
    return {};
  }
  // 后端缺少出图能力（只回文字/无 image_generation 工具）：标记 error 踢出轮换，
  // 与 isImageBackendSwitchableError 配合实现"本次切换到别的后端 + 后续不再选它"。
  if (isMissingImageToolBackendError(error)) {
    return { status: "error", cooldownUntil: null };
  }
  // 中转坏掉（无 token / 返回 HTML / service temporarily unavailable 文案）：
  // 仅当错误同时具备「指针型」证据（html response body / 没有可用 token）时才
  // 判定为 dead-relay 并升级为 error 踢出。单纯的 502/504「service temporarily
  // unavailable」文案很常见于上游瞬时网关抖动，不一定代表中转死掉；先把它放给
  // 下方 isRecoverableBackendError 走「active + 短期冷却」更稳健，避免误踢导致
  // 可用后端被清空。
  if (isDeadRelayBackendError(error)) {
    return { status: "error", cooldownUntil: null };
  }
  // 该后端/分组未开通图像生成(403 permission)：确定性坏配置，标记 error 踢出轮换。
  if (isImageGenDisabledBackendError(error)) {
    return { status: "error", cooldownUntil: null };
  }
  // API Key 所属分组被上游停用(403 GROUP_DISABLED)：确定性坏配置，标记 error 踢出轮换。
  if (isGroupDisabledBackendError(error)) {
    return { status: "error", cooldownUntil: null };
  }
  if (
    (await isUnrecoverableBackendError(error, runtime)) ||
    isInvalidBackendCredentialError(error)
  ) {
    return { status: "error", cooldownUntil: null };
  }
  // ChatGPT 画图工具级限流(image_gen.text2im / ChatGPTAgentToolRateLimitException):
  // 账号级滚动限流、恢复快,按限流标 limited(管理后台可见)+ 独立短冷却(默认 3 分钟),
  // 上游若给出 reset 时间则优先。仍属可切换错误(见 isRecoverableBackendError),换号重试。
  // 放在 usage-limit 之前:即便文案同时带通用 "limit" 字样,也走 3 分钟工具桶而非 15 分钟额度桶。
  if (isToolRateLimitBackendError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_TOOL_RATE_LIMIT_COOLDOWN_MINUTES"
    );
    return {
      status: "limited",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input,
        { useUpstreamReset: true }
      ),
    };
  }
  if (isUsageLimitBackendError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
    );
    return {
      status: "limited",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input,
        { useUpstreamReset: true }
      ),
    };
  }
  if (isUnsupportedModelBackendError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (isBackendProtocolCompatibilityError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input,
        { useUpstreamReset: true }
      ),
    };
  }
  // 502/504 + 「service temporarily unavailable」：上游网关瞬时抖动，先按 overload 桶
  // 走 active + 冷却，不踢出；冷却窗口期内换到别的成员，窗口一过该后端可重新参与。
  // 放在 isRecoverableBackendError 之前以便命中更具体的冷却分钟配置。
  if (isServiceTemporarilyUnavailableError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (isOverloadBackendError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (isRecoverableBackendError(error)) {
    const minutes = await getCooldownMinutes(
      "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  const minutes = await getCooldownMinutes(
    "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES"
  );
  return {
    status: "active",
    cooldownUntil: cooldownFromMinutes(minutes),
  };
}

/**
 * 把分类结果按"该后端是否启用失败冷却"收敛。
 *
 * 账号永远按分类结果走。API/Adobe 后端由各自的 `failureCooldownEnabled` 决定（取代
 * 旧的全局开关）。
 *
 * 收敛规则：
 * - 开启冷却时原样返回分类结果（含 status: limited/active 与冷却时间）。
 * - 关闭冷却（默认）时，仅保留确定性 `error` 终态；其余临时错误丢弃 status/cooldown，
 *   但对「API 返回空成功」「本次 attempt 超时」「fetch failed/terminated」这类高频瞬时抖动
 *   保留一个最小缓冲冷却（默认 30 秒），避免坏后端在同一秒内被连续选中、反复白消耗配额。
 *   最小缓冲使用 IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES 配置项但截断到 30 秒上限，
 *   防止运营把该桶调大时反而把"关闭冷却"的后端长期下线。
 */
const MIN_FAILURE_COOLDOWN_MS = 30_000;

/** 按成员类型和冷却开关收敛分类结果，关闭时仍保留最长 30 秒缓冲。 */
export function resolveEffectiveFailureForMember(
  memberType: "api" | "account" | "adobe",
  failure: {
    status?: string;
    cooldownUntil?: Date | null;
  },
  apiFailureCooldownEnabled: boolean
) {
  // adobe 与 api 同属"中转型"后端，受各自 failureCooldownEnabled 门控；account 永远按
  // 分类结果走。
  if (
    (memberType !== "api" && memberType !== "adobe") ||
    apiFailureCooldownEnabled
  ) {
    return failure;
  }
  if (failure.status === "error") {
    return { status: failure.status, cooldownUntil: failure.cooldownUntil };
  }
  // 对"关闭冷却"的后端也加最小缓冲冷却：cooldownUntil 若 > now+30s 则截到 30s；
  // 若原本就没有冷却时间（dead-relay 例外不会到这里），则不补(buffer=0)。
  if (failure.cooldownUntil) {
    const now = Date.now();
    const original = failure.cooldownUntil.getTime();
    const buffered = Math.min(original, now + MIN_FAILURE_COOLDOWN_MS);
    return {
      status: failure.status,
      cooldownUntil: buffered > now ? new Date(buffered) : undefined,
    };
  }
  return { status: undefined, cooldownUntil: undefined };
}

// always_active（遇错常驻）的失败处置：常驻后端遇【任何】失败都不自动下线——返回空对象
// 表示"不改 status、不进冷却，仅由调用方记 lastError/failCount"。含 502/HTML、dead-relay、
// 凭证/分组等终态错误：运营勾了"遇错常驻"即要求它永不被自动标 error 踢出。
// WHY 含终态：曾经只豁免临时错误、对 status='error' 仍踢出，导致常驻 relay 撞到
// 「HTTP 502: HTML response body」这类 dead-relay 错误被标 error 踢空，进而触发「没有可用的
// 默认生图后端」。代价：真·死号会持续被选中、每次浪费一次尝试后换号，需人工停用——这是
// "常驻"语义的固有取舍，由运营自行承担。非常驻后端不走此函数，按 classifyFailure 的判定
// （临时冷却 / status='error' 粘性踢出）。
export function resolveAlwaysActiveFailure(
  alwaysActive: boolean,
  effectiveFailure: { status?: string; cooldownUntil?: Date | null }
): { status?: string; cooldownUntil?: Date | null } {
  return alwaysActive ? {} : effectiveFailure;
}
