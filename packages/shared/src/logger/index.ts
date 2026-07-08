/**
 * 日志模块
 *
 * 使用 Pino 实现结构化日志
 * 生产环境同时写入 stdout 与本地运行日志文件
 *
 * 环境变量:
 * - GPT2IMAGE_SYSTEM_LOG_PATH: 系统运行日志文件路径（可选，默认
 *   "/app/.gpt2image/system.log"）
 */

import pino from "pino";
import {
  createAsyncRotatingFileStream,
  DEFAULT_ROTATING_LOG_MAX_BYTES,
} from "./async-rotating-file-stream";

const DEFAULT_SYSTEM_LOG_PATH = "/app/.gpt2image/system.log";

// ============================================
// 配置检查
// ============================================

/**
 * 检查是否为生产环境
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * 获取系统运行日志文件路径
 *
 * @returns 系统运行日志文件路径。
 */
function getSystemLogPath(): string {
  return process.env.GPT2IMAGE_SYSTEM_LOG_PATH ?? DEFAULT_SYSTEM_LOG_PATH;
}

/**
 * 序列化未知错误
 *
 * @param error 未知错误对象。
 * @returns 可安全写入日志的错误结构。
 */
function serializeUnknownError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

// ============================================
// Logger 创建
// ============================================

/**
 * 创建 Logger 实例
 *
 * 日志级别:
 * - production: info 及以上
 * - development: debug 及以上
 *
 * 输出目标:
 * - production: stdout + 系统运行日志文件
 * - development: console（美化输出）
 *
 * @returns Pino Logger 实例；文件写入失败只写 stderr，不影响 stdout 日志。
 */
function createLogger(): pino.Logger {
  const level = isProduction() ? "info" : "debug";

  // 基础配置
  const baseOptions: pino.LoggerOptions = {
    level,
    base: {
      env: process.env.NODE_ENV,
      service: "gpt2image",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // 纵深防御：即便未来误传敏感字段，也在日志层做脱敏。
    redact: {
      paths: [
        "password",
        "*.password",
        "token",
        "*.token",
        "apiKey",
        "*.apiKey",
        "secret",
        "*.secret",
        "authorization",
        "*.authorization",
        "creem-signature",
        "*.creem-signature",
        "*.sign",
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  };

  // 开发环境：美化输出
  if (!isProduction()) {
    try {
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // pino-pretty 不可用时降级
      return pino(baseOptions);
    }
  }

  // 生产环境同时写 stdout 与持久化文件。文件落盘必须异步进行：
  // 业务请求只把日志写入 Pino/SonicBoom 缓冲区，实际 fs 写入由后台异步完成。
  // 文件目标失败时必须保留 stdout，避免日志问题反过来影响应用启动。
  try {
    const fileDestination = createAsyncRotatingFileStream({
      filePath: getSystemLogPath(),
      maxBytes: DEFAULT_ROTATING_LOG_MAX_BYTES,
      onError: (error) => {
        process.stderr.write(
          `${JSON.stringify({
            level: "error",
            msg: "System log file write failed",
            err: serializeUnknownError(error),
            logPath: getSystemLogPath(),
          })}\n`
        );
      },
    });

    return pino(
      baseOptions,
      pino.multistream([
        { level, stream: pino.destination(1) },
        { level, stream: fileDestination },
      ])
    );
  } catch (error) {
    const fallbackLogger = pino(baseOptions);
    fallbackLogger.error(
      {
        err: serializeUnknownError(error),
        logPath: getSystemLogPath(),
      },
      "System log file destination initialization failed"
    );
    return fallbackLogger;
  }
}

// ============================================
// Logger 实例（单例）
// ============================================

/**
 * 全局 Logger 实例
 */
export const logger = createLogger();

// ============================================
// 便捷方法
// ============================================

/**
 * 创建带上下文的子 Logger
 *
 * @example
 * ```ts
 * const log = createContextLogger({ userId: "123", requestId: "abc" });
 * log.info("User action");
 * ```
 */
export function createContextLogger(
  context: Record<string, unknown>
): pino.Logger {
  return logger.child(context);
}

/**
 * 创建请求级别的 Logger
 *
 * @example
 * ```ts
 * const log = createRequestLogger(request);
 * log.info("Processing request");
 * ```
 */
export function createRequestLogger(request: Request): pino.Logger {
  const url = new URL(request.url);

  return logger.child({
    requestId: crypto.randomUUID(),
    method: request.method,
    path: url.pathname,
    userAgent: request.headers.get("user-agent")?.slice(0, 100),
  });
}

// ============================================
// 类型化日志辅助
// ============================================

/**
 * 业务事件类型
 */
export type BusinessEvent =
  | "user.signup"
  | "user.login"
  | "user.logout"
  | "payment.checkout.started"
  | "payment.checkout.completed"
  | "payment.subscription.created"
  | "payment.subscription.canceled"
  | "credits.purchased"
  | "credits.consumed"
  | "credits.expired"
  | "referral.binding.created"
  | "referral.commission.accrued"
  | "referral.commission.canceled"
  | "referral.transfer.completed"
  | "ticket.created"
  | "ticket.replied"
  | "ticket.closed"
  | "email.sent"
  | "file.uploaded"
  | "file.deleted"
  | "admin.user.banned"
  | "admin.user.unbanned";

/**
 * 记录业务事件
 *
 * @example
 * ```ts
 * logEvent("user.signup", { userId: "123", provider: "github" });
 * logEvent("payment.checkout.completed", { userId: "123", amount: 9.99 });
 * ```
 */
export function logEvent(
  event: BusinessEvent,
  data?: Record<string, unknown>
): void {
  logger.info({ event, ...data }, `Event: ${event}`);
}

/**
 * 记录错误（带堆栈）
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError(error, { context: "payment processing" });
 * }
 * ```
 */
export function logError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (error instanceof Error) {
    logger.error(
      {
        err: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...context,
      },
      error.message
    );
  } else {
    logger.error({ err: error, ...context }, "Unknown error");
  }
}

/**
 * 记录警告
 */
export function logWarn(message: string, data?: Record<string, unknown>): void {
  logger.warn(data, message);
}

/**
 * 记录调试信息（仅开发环境）
 */
export function logDebug(
  message: string,
  data?: Record<string, unknown>
): void {
  logger.debug(data, message);
}

// ============================================
// API 响应日志
// ============================================

/**
 * 记录 API 响应
 */
export function logApiResponse(
  request: Request,
  response: Response,
  duration: number
): void {
  const url = new URL(request.url);
  const level =
    response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";

  logger[level](
    {
      method: request.method,
      path: url.pathname,
      status: response.status,
      duration,
    },
    `${request.method} ${url.pathname} ${response.status} ${duration}ms`
  );
}

// ============================================
// 导出类型
// ============================================

export type { Logger } from "pino";
