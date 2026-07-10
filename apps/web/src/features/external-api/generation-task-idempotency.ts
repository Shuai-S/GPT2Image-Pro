/**
 * 普通 image/video 异步任务的 HTTP 幂等纯协议。
 *
 * 职责：校验标准 Idempotency-Key，并用业务标量、callback 与媒体真实字节生成稳定
 * SHA-256。模块不访问数据库或对象存储，供三个 Route、入队服务和 DB-free 测试复用。
 */

import { createHash } from "node:crypto";
import type {
  GenerationTaskInputObject,
  GenerationTaskRequestPayload,
} from "./generation-task-input";

const MAX_IDEMPOTENCY_KEY_CHARACTERS = 255;
const HASH_VERSION = "gpt2image-generation-task-v1";

export type HashableGenerationTaskRequest =
  | Omit<
      Extract<GenerationTaskRequestPayload, { kind: "image_generate" }>,
      "relayOnly"
    >
  | Omit<
      Extract<GenerationTaskRequestPayload, { kind: "image_edit" }>,
      "relayOnly" | "inputReferences"
    >
  | Omit<
      Extract<GenerationTaskRequestPayload, { kind: "video" }>,
      "relayOnly" | "inputReferences"
    >;

/** Idempotency-Key 缺失内容或超长时的传输边界错误。 */
export class GenerationTaskIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key must contain between 1 and 255 characters.");
    this.name = "GenerationTaskIdempotencyKeyError";
  }
}

/** 同一幂等键被不同业务内容复用时的永久冲突。 */
export class GenerationTaskConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used with different request content.");
    this.name = "GenerationTaskConflictError";
  }
}

/**
 * 校验并规范化可选 Idempotency-Key。
 *
 * @param value 原始 HTTP header；null 表示客户端未启用幂等。
 * @returns 未提供时为 undefined，否则为 trim 后的 1..255 字符 key。
 * @throws header 存在但 trim 后为空或超过 255 字符时抛专用错误。
 * @sideEffects 无。
 */
export function normalizeGenerationIdempotencyKey(
  value: string | null | undefined
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDEMPOTENCY_KEY_CHARACTERS
  ) {
    throw new GenerationTaskIdempotencyKeyError();
  }
  return normalized;
}

/**
 * 从标准 HTTP header 读取普通 generation 幂等键。
 *
 * @param request 已解析的外部 API 请求。
 * @returns 未提供时为 undefined，否则为规范化 key。
 * @throws header 边界非法时抛 GenerationTaskIdempotencyKeyError。
 * @sideEffects 无。
 */
export function readGenerationIdempotencyKey(
  request: Request
): string | undefined {
  return normalizeGenerationIdempotencyKey(
    request.headers.get("Idempotency-Key")
  );
}

/**
 * 以排序对象键生成稳定 JSON，避免调用方构造对象的属性顺序影响请求摘要。
 *
 * @param value 仅含 JSON 标量、数组、普通对象与可省略 undefined 的业务结构。
 * @returns 确定性的紧凑 JSON 片段。
 * @throws 非有限数字或 JSON 之外的值时 fail-closed。
 * @sideEffects 无。
 */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Generation task hash contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Generation task hash contains a non-JSON value");
}

/**
 * 提取普通 generation 请求中由客户端决定的业务标量。
 *
 * @param request 已由 handler 构造的严格入队请求。
 * @returns 排除随机 generation IDs 与 createdAt、但保留批量数量的哈希投影。
 * @sideEffects 无。
 */
function businessRequestProjection(request: HashableGenerationTaskRequest) {
  return request.kind === "video"
    ? {
        kind: request.kind,
        input: request.input,
      }
    : {
        kind: request.kind,
        generationCount: request.generationIds.length,
        responseFormat: request.responseFormat,
        input: request.input,
      };
}

/**
 * 计算普通 image/video async 请求的稳定 SHA-256。
 *
 * @param input 严格业务请求、已验证 callback 与尚未写存储的媒体 Buffer。
 * @returns 64 位小写十六进制摘要。
 * @sideEffects 仅同步读取内存 Buffer，不访问外部服务。
 * @failureMode 业务标量含非法非 JSON 值时抛错；generation IDs/createdAt/文件名明确
 * 不参与哈希，媒体顺序、role、MIME、长度和真实字节均参与。
 */
export function hashGenerationTaskRequest(input: {
  request: HashableGenerationTaskRequest;
  callbackUrl?: string;
  mediaInputs: readonly GenerationTaskInputObject[];
}): string {
  const hash = createHash("sha256");
  hash.update(HASH_VERSION);
  hash.update("\0");
  hash.update(
    canonicalJson({
      callbackUrl: input.callbackUrl ?? null,
      request: businessRequestProjection(input.request),
      media: input.mediaInputs.map((media) => ({
        role: media.role,
        contentType: media.contentType,
        size: media.data.byteLength,
      })),
    })
  );
  for (const media of input.mediaInputs) {
    const byteLength = Buffer.allocUnsafe(8);
    byteLength.writeBigUInt64BE(BigInt(media.data.byteLength));
    hash.update("\0media\0");
    hash.update(byteLength);
    hash.update(media.data);
  }
  return hash.digest("hex");
}
