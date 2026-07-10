/**
 * Firefly 直连的 HTTP 传输抽象。
 *
 * ⚠️ TLS 指纹：adobe2api 用 curl_cffi `impersonate=chrome124` 伪造浏览器 TLS/JA3 指纹来过
 * firefly-3p.ff.adobe.io 的风控。Node 原生 fetch 无法伪造 TLS 指纹，**直连可能在 TLS
 * 握手就被拦**。本仓库既有的解法是 Go 旁路代理 `services/chatgpt-web-proxy`
 * （bogdanfinn/tls-client + utls），见 image-generation/chatgpt-web.ts 的 fetchChatGptWeb。
 *
 * 故传输层抽象成两种实现，与 chatgpt-web 一致的协议复用同一个 Go 旁路：
 * - ProxyFireflyTransport：POST {proxyUrl}/request，body `{sessionKey, method, targetUrl,
 *   headers, headerOrder, bodyBase64}` → `{status, headers, bodyBase64}`（带 TLS 伪装）。
 * - FetchFireflyTransport：原生 fetch（无 TLS 伪装，用于产物下载/本地联调/未配代理回落）。
 */

import {
  DEFAULT_JSON_RESPONSE_MAX_BYTES,
  fetchWithDeadline,
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from "../../http/fetch";
import { z } from "zod";

export type FireflyTransportRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer | Uint8Array | string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** 响应正文上限；API JSON 默认 1 MiB，媒体下载必须由调用方显式放宽。 */
  maxResponseBytes?: number | undefined;
};

export type FireflyTransportResponse = {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  bytes(): Promise<Buffer>;
};

export interface FireflyTransport {
  request(req: FireflyTransportRequest): Promise<FireflyTransportResponse>;
}

/**
 * 解析单次 Firefly 响应正文上限。
 *
 * @param req - 传输请求；媒体下载由调用方显式传入图片或视频上限。
 * @returns 正安全整数，API JSON 默认 1 MiB。
 * @throws 非法配置时拒绝请求，避免错误配置关闭保护。
 */
function getMaxResponseBytes(req: FireflyTransportRequest): number {
  const maxBytes = req.maxResponseBytes ?? DEFAULT_JSON_RESPONSE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxResponseBytes must be a positive safe integer");
  }
  return maxBytes;
}

function buildResponse(
  status: number,
  headers: Record<string, string>,
  bytesPromise: () => Promise<Buffer>
): FireflyTransportResponse {
  let cached: Buffer | null = null;
  const readBytes = async (): Promise<Buffer> => {
    if (cached === null) cached = await bytesPromise();
    return cached;
  };
  return {
    status,
    headers,
    bytes: readBytes,
    text: async () => (await readBytes()).toString("utf-8"),
    json: async () => JSON.parse((await readBytes()).toString("utf-8")),
  };
}

function encodeBodyBase64(
  body: Buffer | Uint8Array | string | undefined
): string {
  if (body === undefined) return "";
  if (typeof body === "string")
    return Buffer.from(body, "utf-8").toString("base64");
  return Buffer.from(body).toString("base64");
}

/** 默认 fetch 传输（无 TLS 伪装）。 */
export class FetchFireflyTransport implements FireflyTransport {
  async request(
    req: FireflyTransportRequest
  ): Promise<FireflyTransportResponse> {
    const maxResponseBytes = getMaxResponseBytes(req);
    const init: RequestInit = {
      method: req.method,
      headers: req.headers,
      redirect: "manual",
      ...(req.signal ? { signal: req.signal } : {}),
    };
    if (req.body !== undefined) init.body = req.body as BodyInit;
    const resp = await fetchWithDeadline(
      req.url,
      init,
      req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}
    );
    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body = Buffer.from(
      await readResponseBytesWithLimit(
        resp,
        maxResponseBytes
      )
    );
    return buildResponse(resp.status, headers, async () => body);
  }
}

const proxyResponsePayloadSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.array(z.string())).optional(),
  bodyBase64: z.string().optional(),
});

/** Go 旁路代理传输（TLS 伪装），协议与 chatgpt-web-proxy 一致。 */
export class ProxyFireflyTransport implements FireflyTransport {
  constructor(
    private readonly opts: {
      proxyUrl: string;
      secret?: string;
      sessionKey: string;
    }
  ) {}

  async request(
    req: FireflyTransportRequest
  ): Promise<FireflyTransportResponse> {
    const maxResponseBytes = getMaxResponseBytes(req);
    const proxyUrl = this.opts.proxyUrl.replace(/\/+$/, "");
    const resp = await fetchWithDeadline(
      `${proxyUrl}/request`,
      {
        method: "POST",
        ...(req.signal ? { signal: req.signal } : {}),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.opts.secret ? { "X-Proxy-Secret": this.opts.secret } : {}),
        },
        body: JSON.stringify({
          sessionKey: this.opts.sessionKey,
          method: req.method,
          targetUrl: req.url,
          headers: req.headers,
          headerOrder: Object.keys(req.headers),
          bodyBase64: encodeBodyBase64(req.body),
        }),
      },
      req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}
    );
    if (!resp.ok) {
      const text = await readResponseTextWithLimit(resp);
      throw new Error(
        `Firefly proxy failed: HTTP ${resp.status}${text ? ` ${text.slice(0, 300)}` : ""}`
      );
    }
    const payload = proxyResponsePayloadSchema.parse(
      await readResponseJsonWithLimit(
        resp,
        Math.ceil(maxResponseBytes / 3) * 4 + 64 * 1024
      )
    );
    const headers: Record<string, string> = {};
    for (const [key, values] of Object.entries(payload.headers || {})) {
      if (key.toLowerCase() === "content-encoding") continue;
      headers[key.toLowerCase()] = values[0] ?? "";
    }
    const body = payload.bodyBase64
      ? Buffer.from(payload.bodyBase64, "base64")
      : Buffer.alloc(0);
    if (body.byteLength > maxResponseBytes) {
      throw new Error(
        `Firefly proxy body exceeded ${maxResponseBytes} bytes`
      );
    }
    return buildResponse(payload.status, headers, async () => body);
  }
}
