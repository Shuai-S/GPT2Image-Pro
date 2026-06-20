/**
 * Firefly 直连错误类型（移植自 adobe2api core/adobe_client.py 的异常体系）。
 * 供错误分类映射（鉴权失效/配额耗尽/上游临时错误）使用。
 */

export type AdobeErrorType =
  | ""
  | "timeout"
  | "connection"
  | "proxy"
  | "network"
  | "status";

export class AdobeRequestError extends Error {
  statusCode: number | undefined;
  errorType: string;
  userMessage: string;

  constructor(
    message: string,
    opts?: { statusCode?: number; errorType?: string; userMessage?: string }
  ) {
    super(message);
    this.name = "AdobeRequestError";
    this.statusCode = opts?.statusCode;
    this.errorType = String(opts?.errorType || "")
      .trim()
      .toLowerCase();
    this.userMessage =
      String(opts?.userMessage || "").trim() || String(message || "").trim();
  }
}

/** Adobe 账号配额耗尽（x-access-error: taste_exhausted）。 */
export class QuotaExhaustedError extends AdobeRequestError {
  constructor(message: string, opts?: { statusCode?: number }) {
    super(message, { ...opts, errorType: "status" });
    this.name = "QuotaExhaustedError";
  }
}

/** token 失效/过期（401/403）。 */
export class AuthError extends AdobeRequestError {
  constructor(message: string, opts?: { statusCode?: number }) {
    super(message, opts);
    this.name = "AuthError";
  }
}

/** 上游临时错误（429/451/5xx 或网络层），可重试。 */
export class UpstreamTemporaryError extends AdobeRequestError {
  constructor(
    message: string,
    opts?: { statusCode?: number; errorType?: string }
  ) {
    super(message, opts);
    this.name = "UpstreamTemporaryError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 451 || status >= 500;
}
