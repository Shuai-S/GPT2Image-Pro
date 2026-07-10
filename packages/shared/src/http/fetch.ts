/**
 * 第三方 HTTP 请求的统一资源边界。
 *
 * 服务端支付、审核和上游 API 客户端通过本模块统一设置总截止时间，并按实际
 * 读取字节限制响应正文。调用方仍需负责协议级状态码与响应结构校验；用户提供的
 * 外链图片还必须先经过 DNS pin / SSRF 校验，不能用本模块替代网络边界校验。
 */

export const DEFAULT_JSON_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_VIDEO_FETCH_TIMEOUT_MS = 120_000;
export const DEFAULT_THIRD_PARTY_FETCH_TIMEOUT_MS =
  DEFAULT_JSON_FETCH_TIMEOUT_MS;
export const DEFAULT_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
export const DEFAULT_JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
export const DEFAULT_IMAGE_RESPONSE_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_VIDEO_RESPONSE_MAX_BYTES = 200 * 1024 * 1024;

const responseDeadlineCleanups = new WeakMap<Response, () => void>();

export interface FetchWithDeadlineOptions {
  timeoutMs?: number;
  /** 可选的响应正文真实字节上限；用于保留原生 Response 解析接口的协议适配器。 */
  maxResponseBytes?: number;
}

/** 响应正文超过调用方声明上限时抛出的错误。 */
export class ResponseBodyTooLargeError extends Error {
  /**
   * @param maxBytes - 允许读取的最大真实字节数。
   * @param actualBytes - 发现超限时已读取的真实字节数。
   */
  constructor(
    readonly maxBytes: number,
    readonly actualBytes: number
  ) {
    super(`Response body exceeded ${maxBytes} bytes`);
    this.name = "ResponseBodyTooLargeError";
  }
}

/**
 * 校验正数型资源上限。
 *
 * @param value - 待校验的毫秒数或字节数。
 * @param label - 错误信息中的参数名。
 * @returns 无返回值；输入合法时继续执行。
 * @throws 输入不是安全正整数时抛出 RangeError，避免配置错误关闭保护。
 */
function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

/**
 * 结束响应的截止时间追踪。
 *
 * @param response - 由 fetchWithDeadline 返回的响应。
 * @returns 无返回值；允许重复调用。
 * @sideEffects 清理定时器与外部 signal 监听器。
 */
function finishResponse(response: Response): void {
  responseDeadlineCleanups.get(response)?.();
  responseDeadlineCleanups.delete(response);
}

/**
 * 用有限 Web Stream 包装第三方响应。
 *
 * @param response - 原始 fetch 响应。
 * @param maxBytes - 允许消费的最大真实字节数。
 * @returns 保留状态码与响应头的新 Response；text/json/reader 均受同一限制。
 * @throws 消费正文时超过上限会抛 ResponseBodyTooLargeError。
 * @sideEffects 锁定原始响应流；完成、超限或取消时释放底层连接与截止定时器。
 */
function limitResponseBody(
  response: Response,
  maxBytes: number,
  onFinished: () => void
): Response {
  assertPositiveSafeInteger(maxBytes, "maxResponseBytes");
  if (!response.body) {
    onFinished();
    return response;
  }

  const reader = response.body.getReader();
  let totalBytes = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onFinished();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish();
          return;
        }
        if (!value) return;

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          controller.error(new ResponseBodyTooLargeError(maxBytes, totalBytes));
          finish();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      finish();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * 发起带总截止时间的第三方请求。
 *
 * @param input - 与原生 fetch 相同的 URL 或 Request。
 * @param init - 原生 fetch 参数；已有 signal 会与截止时间组合，任一中止即失败。
 * @param options - 截止时间配置，默认 15 秒。
 * @returns 原生 Response。正文必须继续通过本模块有限读取器消费。
 * @throws 网络错误、调用方中止或截止时间到达时拒绝。
 * @sideEffects 发起网络请求并创建定时器；有限读取器完成后会立即清理定时器。
 */
export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithDeadlineOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_THIRD_PARTY_FETCH_TIMEOUT_MS;
  assertPositiveSafeInteger(timeoutMs, "timeoutMs");
  if (options.maxResponseBytes !== undefined) {
    assertPositiveSafeInteger(options.maxResponseBytes, "maxResponseBytes");
  }

  const deadlineController = new AbortController();
  const timeout = setTimeout(() => {
    deadlineController.abort(
      new DOMException(
        `Third-party request exceeded ${timeoutMs}ms deadline`,
        "TimeoutError"
      )
    );
  }, timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadlineController.signal])
    : deadlineController.signal;

  try {
    const response = await fetch(input, { ...init, signal });
    const cleanup = () => clearTimeout(timeout);
    if (options.maxResponseBytes !== undefined) {
      return limitResponseBody(response, options.maxResponseBytes, cleanup);
    }
    responseDeadlineCleanups.set(response, cleanup);
    if (!response.body) finishResponse(response);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * 按真实流字节读取响应，拒绝伪造 Content-Length 绕过。
 *
 * @param response - 待读取响应；可来自 fetchWithDeadline 或其他受信传输。
 * @param maxBytes - 最大正文大小，必须是正安全整数。
 * @returns 独立 Uint8Array，大小不超过 maxBytes。
 * @throws 流读取失败或实际字节数超过上限时拒绝。
 * @sideEffects 消费并锁定响应流；超限时主动取消读取，结束时清理截止定时器。
 */
export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  assertPositiveSafeInteger(maxBytes, "maxBytes");
  const reader = response.body?.getReader();
  if (!reader) {
    finishResponse(response);
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseBodyTooLargeError(maxBytes, totalBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    finishResponse(response);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * 有界读取 UTF-8 响应正文。
 *
 * @param response - 待读取响应。
 * @param maxBytes - 最大正文大小，默认使用 64 KiB 错误正文上限。
 * @returns 解码后的 UTF-8 文本。
 * @throws 继承有限字节读取器的超限、截止时间与流错误。
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes = DEFAULT_ERROR_RESPONSE_MAX_BYTES
): Promise<string> {
  const bytes = await readResponseBytesWithLimit(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

/**
 * 有界读取并解析 JSON 响应。
 *
 * @param response - 待读取响应。
 * @param maxBytes - 最大 JSON 正文字节数，默认 1 MiB。
 * @returns 未信任的解析结果；调用方必须继续用 Zod 或类型收窄校验结构。
 * @throws 超限、截止时间、流错误或非法 JSON 时拒绝，关键路径因此 fail-closed。
 */
export async function readResponseJsonWithLimit(
  response: Response,
  maxBytes = DEFAULT_JSON_RESPONSE_MAX_BYTES
): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, maxBytes);
  return JSON.parse(text) as unknown;
}

/**
 * 净化从客户端请求继承的转发头。
 *
 * @param sourceHeaders - 客户端原始请求头。
 * @param sourceUrl - 收到客户端请求的第一方 URL。
 * @param destinationUrl - 即将请求的目标 URL，可为相对地址。
 * @returns 新 Headers；跨源时移除 Authorization、Cookie 与代理认证头。
 * @throws URL 无法解析时拒绝，避免错误目标被当成同源。
 * @sideEffects 无；不会修改传入 Headers。
 */
export function sanitizeForwardedClientHeaders(
  sourceHeaders: HeadersInit,
  sourceUrl: string | URL,
  destinationUrl: string | URL
): Headers {
  const source = new URL(sourceUrl);
  const destination = new URL(destinationUrl, source);
  const headers = new Headers(sourceHeaders);
  if (source.origin !== destination.origin) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("proxy-authorization");
  }
  return headers;
}
