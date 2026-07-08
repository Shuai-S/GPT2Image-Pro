/**
 * 异步轮转文件日志流
 *
 * 供日志模块在生产环境将结构化日志异步落盘。调用方只把日志行放入内存队列，
 * 实际文件写入、轮转与 gzip 压缩都在后台执行，避免磁盘 I/O 阻塞业务请求。
 * 关键依赖：Node.js fs/path/stream/zlib。
 */

import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const DEFAULT_ROTATING_LOG_MAX_BYTES = 100 * 1024 * 1024;

type LogStreamErrorHandler = (error: unknown) => void;

export type AsyncRotatingFileStream = {
  write(message: string): void;
  flush(): Promise<void>;
};

type AsyncRotatingFileStreamOptions = {
  filePath: string;
  maxBytes?: number;
  onError?: LogStreamErrorHandler;
};

let rotationSequence = 0;

/**
 * 判断未知错误是否为指定 Node.js 错误码
 *
 * @param error 未知错误对象。
 * @param code 期望的 Node.js 错误码。
 * @returns 错误码是否匹配。
 */
function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * 生成适合作为文件名片段的 UTC 时间戳
 *
 * @param date 当前时间。
 * @returns 不含冒号与点号的 ISO 时间片段。
 */
function formatRotationTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

/**
 * gzip 压缩已轮转出的日志文件
 *
 * @param plainPath 轮转后的未压缩日志文件。
 * @param gzipPath 压缩后的目标文件。
 * @sideEffects 读取 plainPath，写入 gzipPath，成功后删除 plainPath。
 * @throws 当读写或删除失败时抛出，由调用方异步记录。
 */
async function gzipAndRemovePlainLog(
  plainPath: string,
  gzipPath: string
): Promise<void> {
  await pipeline(
    createReadStream(plainPath),
    createGzip(),
    createWriteStream(gzipPath, { flags: "wx" })
  );
  await unlink(plainPath);
}

/**
 * 创建异步轮转文件日志流
 *
 * @param options 文件路径、单文件大小上限与错误处理器。
 * @returns 兼容 Pino DestinationStream 的异步文件流。
 */
export function createAsyncRotatingFileStream(
  options: AsyncRotatingFileStreamOptions
): AsyncRotatingFileStream {
  return new RotatingFileStream(options);
}

/**
 * 异步轮转文件流实现
 *
 * @remarks
 * `write` 只入队并调度后台任务；`drainQueue` 顺序处理队列，确保日志行顺序写入。
 * 单文件超过阈值前会把当前 system.log 改名为带时间戳的文件，并异步压缩为
 * `.gz`，随后继续写新的 system.log。
 */
class RotatingFileStream implements AsyncRotatingFileStream {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly onError: LogStreamErrorHandler;
  private readonly queue: string[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private currentSize: number | null = null;
  private drainScheduled = false;

  /**
   * 初始化异步轮转文件流
   *
   * @param options 文件路径、轮转阈值与错误处理器。
   */
  constructor(options: AsyncRotatingFileStreamOptions) {
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes ?? DEFAULT_ROTATING_LOG_MAX_BYTES;
    this.onError = options.onError ?? (() => undefined);
  }

  /**
   * 写入一行日志
   *
   * @param message Pino 已序列化好的日志行。
   * @sideEffects 将日志行加入内存队列，并调度后台异步落盘。
   */
  write(message: string): void {
    this.queue.push(message);
    this.scheduleDrain();
  }

  /**
   * 等待当前队列写完
   *
   * @returns 当前已入队日志全部处理完成后的 Promise。
   */
  flush(): Promise<void> {
    if (!this.drainScheduled && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
      this.scheduleDrain();
    });
  }

  /**
   * 调度后台队列消费
   *
   * @sideEffects 创建一个 setImmediate 任务，避免在调用 write 的请求栈中执行 I/O。
   */
  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    setImmediate(() => {
      void this.drainQueue().finally(() => {
        this.drainScheduled = false;
        if (this.queue.length > 0) {
          this.scheduleDrain();
          return;
        }
        this.resolveIdle();
      });
    });
  }

  /**
   * 后台顺序消费日志队列
   *
   * @sideEffects 异步写文件；写入失败会调用 onError，失败日志行不重试。
   */
  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message === undefined) {
        return;
      }

      try {
        await this.writeMessage(message);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  /**
   * 写入单条日志并按大小轮转
   *
   * @param message Pino 已序列化好的日志行。
   * @sideEffects 必要时轮转 system.log，并异步追加写入新日志。
   */
  private async writeMessage(message: string): Promise<void> {
    await this.ensureInitialized();

    const messageBytes = Buffer.byteLength(message);
    if (
      this.currentSize !== null &&
      this.currentSize > 0 &&
      this.currentSize + messageBytes > this.maxBytes
    ) {
      await this.rotateCurrentFile();
    }

    await appendFile(this.filePath, message);
    this.currentSize = (this.currentSize ?? 0) + messageBytes;

    if (this.currentSize >= this.maxBytes) {
      await this.rotateCurrentFile();
    }
  }

  /**
   * 初始化目标目录与当前文件大小
   *
   * @sideEffects 确保日志目录存在。
   */
  private async ensureInitialized(): Promise<void> {
    if (this.currentSize !== null) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const fileStat = await stat(this.filePath);
      this.currentSize = fileStat.isFile() ? fileStat.size : 0;
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        throw error;
      }
      this.currentSize = 0;
    }
  }

  /**
   * 轮转当前日志文件并启动后台 gzip 压缩
   *
   * @sideEffects 将当前日志文件改名为时间戳文件，随后异步压缩为 .gz。
   */
  private async rotateCurrentFile(): Promise<void> {
    const rotatedPath = this.buildRotatedPath();

    try {
      await rename(this.filePath, rotatedPath);
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        throw error;
      }
      this.currentSize = 0;
      return;
    }

    this.currentSize = 0;
    await appendFile(this.filePath, "");
    void gzipAndRemovePlainLog(rotatedPath, `${rotatedPath}.gz`).catch(
      this.onError
    );
  }

  /**
   * 构造带时间戳的轮转文件路径
   *
   * @returns 同目录下的轮转日志文件路径。
   */
  private buildRotatedPath(): string {
    const directory = dirname(this.filePath);
    const extension = extname(this.filePath) || ".log";
    const stem = basename(this.filePath, extname(this.filePath));
    rotationSequence += 1;

    return join(
      directory,
      `${stem}-${formatRotationTimestamp(new Date())}-${process.pid}-${rotationSequence}${extension}`
    );
  }

  /**
   * 唤醒等待 flush 的调用方
   *
   * @sideEffects 清空 idleResolvers。
   */
  private resolveIdle(): void {
    while (this.idleResolvers.length > 0) {
      this.idleResolvers.shift()?.();
    }
  }
}
