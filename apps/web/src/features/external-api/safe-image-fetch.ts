import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  fetchWithDnsPin,
  SsrfBlockedError,
} from "@repo/shared/security/dns-pin";

/**
 * 共享的图片 URL SSRF 防护。
 *
 * 用于所有"按用户提供的 URL 拉取图片"的外部 API 处理器，统一阻断：
 * - 内网 / 回环 / 链路本地（含云元数据 169.254.169.254）/ CGNAT / ULA 等地址
 * - 携带凭证的 URL、非 http(s) 协议、*.internal / localhost 主机名
 * - 重定向到内网：使用 redirect:"manual" 并逐跳复检，关闭"公网 URL 302 跳内网"绕过
 * - DNS 重绑定：通过 fetchWithDnsPin 在连接层 pin IP，根除校验-连接间重解析攻击
 *
 * 多层防御架构：
 * 1. assertPublicImageUrl：主机名黑名单 + DNS 预解析校验（快速拦截明显非法目标）
 * 2. fetchWithDnsPin：连接层 DNS pin（根除 rebinding，使用 node:http/https 不经 Next.js patch）
 * 3. 逐跳重定向复检：每次 302 对新目标重新执行 1+2（防公网跳内网）
 */
export class SafeImageFetchError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "SafeImageFetchError";
  }
}

const MAX_REDIRECTS = 3;

function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.replace(/^::ffff:/, ""));
  }

  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const [a = 0, b = 0] = parts.map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export async function assertPublicImageUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeImageFetchError("URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new SafeImageFetchError("Image URL must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }

  const strippedHostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(strippedHostname)) {
    if (isPrivateIpAddress(strippedHostname)) {
      throw new SafeImageFetchError("Image URL must be publicly reachable.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateIpAddress(entry.address))
  ) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }
}

/**
 * 校验用户自定义 API base URL 指向公网（请求时复检，弥补"仅保存时校验"的 TOCTOU）。
 * 仅校验主机；不发起请求。无法解析或指向内网即抛出。
 */
export async function assertPublicApiBaseUrl(baseUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SafeImageFetchError("API base URL is invalid.");
  }
  await assertPublicImageUrl(parsed);
}

/**
 * 校验异步任务回调 URL 指向公网且使用 https。
 *
 * 复用 isPrivateIpAddress / assertPublicImageUrl 的内网黑名单（避免各处粘贴副本漂移），
 * 并在其基础上强制 https：回调正文含生成结果与 generation_id，禁止明文外发。
 * 仅校验主机；连接时仍须经 fetchPublicCallback 逐跳复检（弥补提交->发送之间的 TOCTOU）。
 */
export async function assertPublicCallbackUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeImageFetchError("callback_url must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new SafeImageFetchError("callback_url must use https.");
  }
  await assertPublicImageUrl(parsed);
  return parsed;
}

/**
 * 以 https POST 投递回调，逐跳复检重定向目标，禁止跳转到内网地址。
 *
 * 双层防护：
 * 1. assertPublicCallbackUrl：协议/主机名/DNS 预校验（快速拒绝已知非法目标）
 * 2. fetchWithDnsPin：连接层 pin IP，根除 DNS rebinding（使用 node:http/https）
 *
 * 关闭"提交时校验通过、完成时被 302 跳内网/云元数据"的盲 SSRF 原语。
 * 返回最终的非重定向 Response，调用方负责检查 ok。
 */
export async function fetchPublicCallback(
  rawUrl: string,
  init: { headers?: Record<string, string>; body: string; signal?: AbortSignal }
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertPublicCallbackUrl(currentUrl);

    let response: Response;
    try {
      // 使用 DNS-pinning fetch 防止 rebinding 攻击
      response = await fetchWithDnsPin(parsed.href, {
        method: "POST",
        headers: init.headers,
        body: init.body,
        signal: init.signal,
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new SafeImageFetchError(err.message);
      }
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeImageFetchError(
          "callback_url redirect missing location."
        );
      }
      // 解析为绝对地址后，下一轮循环会对其再次执行 SSRF + https 校验。
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return response;
  }

  throw new SafeImageFetchError("Too many redirects while posting callback.");
}

/**
 * 流式读取响应正文并在累计字节超过 maxBytes 时主动中止。
 *
 * 防御 content-length 头可伪造导致的内存耗尽 DoS：不依赖自报的 content-length，
 * 而是逐块累加真实字节，一旦超限即 cancel reader 并抛错（不把整段正文缓冲进内存）。
 * 当响应无可读流（如测试 stub）时回退到一次性 arrayBuffer 并对其长度复核。
 */
export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  onExceeded: () => never
): Promise<Buffer<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      onExceeded();
    }
    return Buffer.from(arrayBuffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        onExceeded();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // 复制到独立的 ArrayBuffer，保证返回值可直接用于 new File([...])
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(merged.buffer);
}

/**
 * 校验并拉取一个公网图片 URL，逐跳复检重定向目标，禁止跳转到内网地址。
 *
 * 双层防护：
 * 1. assertPublicImageUrl：主机名黑名单 + DNS 预校验（快速拒绝已知非法目标）
 * 2. fetchWithDnsPin：连接层 pin IP，根除 DNS rebinding（使用 node:http/https）
 *
 * 返回最终的非重定向 Response（调用方负责检查 ok / content-type / 大小）。
 */
export async function fetchPublicImage(
  rawUrl: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new SafeImageFetchError("Image URL is invalid.");
    }

    await assertPublicImageUrl(parsed);

    let response: Response;
    try {
      // 使用 DNS-pinning fetch 防止 rebinding 攻击
      response = await fetchWithDnsPin(parsed.href, {
        method: "GET",
        headers: init.headers,
        signal: init.signal,
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new SafeImageFetchError(err.message);
      }
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeImageFetchError("Image URL redirect missing location.");
      }
      // 解析为绝对地址后，下一轮循环会对其再次执行 SSRF 校验。
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return response;
  }

  throw new SafeImageFetchError("Too many redirects while loading image.");
}
