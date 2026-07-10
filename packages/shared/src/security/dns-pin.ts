/**
 * DNS-pinning fetch：解决 DNS 重绑定（rebinding）攻击的连接层防护。
 *
 * 问题：传统 SSRF 防护在 DNS 解析后校验 IP，但实际连接时可能获得不同的 IP
 * （攻击者在第二次 DNS 查询返回内网 IP）。
 *
 * 方案：
 * 1. 解析主机名，获得所有 IP
 * 2. 校验所有 IP 均为公网地址（任一内网即拒绝）
 * 3. 将 URL 中的主机名替换为第一个合法公网 IP，强制连接到该 IP
 * 4. 设置 Host 头以保留虚拟主机路由
 * 5. HTTPS 场景通过 servername 指定 SNI 以通过证书校验
 *
 * 关键设计决策：
 * - 使用 node:http / node:https 原生模块而非 globalThis.fetch，
 *   因为 Next.js 16 patchFetch() 会替换 globalThis.fetch 且不可配置。
 * - 无条件执行（不检测环境，不区分生产/测试），避免被绕过。
 * - redirect:"manual" 由本模块强制，调用方负责对重定向目标重新调用 fetchWithDnsPin。
 *
 * 使用方：safe-image-fetch.ts 中的 fetchPublicImage / fetchPublicCallback
 * 依赖：ip-validation.ts（纯函数 IP 校验）
 */

import { resolve4, resolve6 } from "node:dns/promises";
import type { IncomingMessage, RequestOptions } from "node:http";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { isBlockedIP } from "./ip-validation";

/**
 * SSRF 请求被阻断时抛出的错误类型。
 * 调用方可据此向用户返回友好错误而非暴露内部细节。
 */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** fetchWithDnsPin 的可选配置 */
export interface DnsPinFetchOptions {
  /** 请求方法，默认 GET */
  method?: string;
  /** 额外请求头（Host 头由内部设置，不应在此传入） */
  headers?: Record<string, string>;
  /** 请求正文 */
  body?: string | Buffer;
  /** 超时毫秒数，默认 10000（10秒） */
  timeoutMs?: number;
  /** AbortSignal 用于外部取消 */
  signal?: AbortSignal;
}

/**
 * 解析主机名并校验所有返回 IP 均为公网地址。
 *
 * @param hostname 待解析的主机名
 * @returns 第一个合法公网 IPv4 地址
 * @throws SsrfBlockedError 若任一 IP 为私有/保留地址
 * @throws Error 若 DNS 解析失败或无结果
 */
async function resolveAndValidate(hostname: string): Promise<string> {
  let addresses: string[] = [];

  try {
    const ipv4 = await resolve4(hostname);
    addresses = addresses.concat(ipv4);
  } catch {
    // IPv4 解析失败，尝试 IPv6
  }

  if (addresses.length === 0) {
    try {
      const ipv6 = await resolve6(hostname);
      addresses = addresses.concat(ipv6);
    } catch {
      // IPv6 也失败
    }
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      `DNS resolution failed for hostname: ${hostname}`
    );
  }

  // 校验所有解析出的 IP 均为公网地址（ANY 内网即阻断）
  for (const ip of addresses) {
    if (isBlockedIP(ip)) {
      throw new SsrfBlockedError(
        "Image URL resolved to a private/reserved IP address."
      );
    }
  }

  // 返回第一个合法 IPv4（优先）用于 pin
  const firstAddress = addresses[0];
  if (!firstAddress) {
    throw new SsrfBlockedError("Image URL did not resolve to an IP address.");
  }
  return firstAddress;
}

/**
 * 使用 node:http/node:https 发起请求，将主机名 pin 到已校验的 IP。
 *
 * 关键行为：
 * - 强制 redirect:"manual"（返回 3xx 响应本身，不跟踪重定向）
 * - 对 HTTPS 设置 servername 以保持 SNI/证书校验
 * - 设置 Host 头以保留虚拟主机路由
 * - 超时后自动销毁请求
 *
 * @param url 完整 URL（http:// 或 https://）
 * @param init 可选的请求配置
 * @returns 标准流式 Response；调用方必须有界读取正文。
 * @throws SsrfBlockedError 若目标解析到内网地址
 * @throws Error 若请求超时或网络错误
 */
export async function fetchWithDnsPin(
  url: string | URL,
  init?: DnsPinFetchOptions
): Promise<Response> {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.href);
  const isHttps = parsed.protocol === "https:";
  const hostname = parsed.hostname;
  const timeoutMs = init?.timeoutMs ?? 10_000;

  // 若 URL 已是 IP 字面量，直接校验
  const isLiteralIP =
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");

  let pinnedIP: string;
  if (isLiteralIP) {
    if (isBlockedIP(hostname)) {
      throw new SsrfBlockedError(
        "Image URL resolved to a private/reserved IP address."
      );
    }
    pinnedIP = hostname;
  } else {
    pinnedIP = await resolveAndValidate(hostname);
  }

  // 构造请求选项，将 host 替换为 pinned IP
  const port = parsed.port
    ? Number(parsed.port)
    : isHttps
      ? 443
      : 80;

  const headers: Record<string, string> = {
    ...(init?.headers ?? {}),
    Host: parsed.port ? `${hostname}:${parsed.port}` : hostname,
  };

  const requestOptions: RequestOptions = {
    hostname: pinnedIP,
    port,
    path: parsed.pathname + parsed.search,
    method: init?.method ?? "GET",
    headers,
    timeout: timeoutMs,
  };

  // HTTPS: 设置 servername 以通过 TLS 证书校验（SNI）
  if (isHttps) {
    (requestOptions as https.RequestOptions).servername = hostname;
    // 禁止 TLS session 复用到不同主机（防止绕过 pin）
    requestOptions.agent = new https.Agent({
      servername: hostname,
      maxSockets: 1,
    });
  }

  const transport = isHttps ? https : http;

  return new Promise<Response>((resolve, reject) => {
    // 处理外部 AbortSignal
    if (init?.signal?.aborted) {
      reject(init.signal.reason ?? new Error("Request aborted"));
      return;
    }

    const req = transport.request(
      requestOptions,
      (res: IncomingMessage) => {
        const responseHeaders = new Headers();

        // 转换 Node.js 响应头到 Web Headers
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const item of value) {
              responseHeaders.append(key, item);
            }
          } else {
            responseHeaders.set(key, value);
          }
        }

        // 不能先 Buffer.concat 整段正文：那会让上层大小限制在内存放大后才生效。
        // 直接桥接 IncomingMessage，超限读取器 cancel 时也会销毁底层 Node 流。
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err: Error) => {
      reject(err);
    });

    // 外部取消
    if (init?.signal) {
      const onAbort = () => {
        const reason = init.signal?.reason ?? new Error("Request aborted");
        req.destroy(reason instanceof Error ? reason : undefined);
        reject(reason);
      };
      init.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => {
        init.signal?.removeEventListener("abort", onAbort);
      });
    }

    // 写入请求正文
    if (init?.body) {
      req.write(init.body);
    }
    req.end();
  });
}
