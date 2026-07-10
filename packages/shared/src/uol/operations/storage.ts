/**
 * UOL 操作注册 - storage（对象存储）领域
 *
 * 职责：注册所有 storage 领域的操作定义到全局注册表。
 * 包含用户面（上传/删除/读取）与系统内部（put/get/delete/signedUrl）操作。
 *
 * 使用方：应用启动时通过 operations/index.ts 统一导入完成注册。
 * 关键依赖：../registry（defineOperation）、zod（schema 校验）
 *
 * 注意：
 * - 本域不涉及扣费，存储操作天然幂等。
 * - local provider 下 getSignedUploadUrl 返回的是 GET 路由（不可 PUT），
 *   预签名直传仅 S3 可用。
 */
import { isSubscriptionPlan } from "../../config/subscription-plan";
import {
  createDirectUploadKey,
  directUploadAuthorizationSchema,
  DIRECT_UPLOAD_PURPOSES,
  DirectUploadInputError,
  resolveDirectUploadMetadata,
} from "../../storage/direct-upload";
import { getStorageProvider } from "../../storage/providers/index";
import { getPlanUploadLimits } from "../../subscription/services/upload-limits";
import { getUserPlan } from "../../subscription/services/user-plan";
import { getRuntimeSettingString } from "../../system-settings";
import { OperationError } from "../errors";
import { getPrincipalUserId, type Principal } from "../principal";
import { defineOperation } from "../registry";
import { z } from "zod";

const DIRECT_UPLOAD_URL_EXPIRES_SECONDS = 10 * 60;

const createDirectUploadInputSchema = z.object({
  purpose: z.enum(DIRECT_UPLOAD_PURPOSES),
  filename: z.string().min(1).max(512),
  contentType: z.string().max(128),
  contentLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

type CreateDirectUploadInput = z.infer<typeof createDirectUploadInputSchema>;

/**
 * 解析直传调用者的用户与套餐。
 *
 * @param principal UOL 网关已鉴权身份。
 * @returns 用户 ID 与唯一能力来源中的套餐。
 * @throws OperationError 非用户身份或 API Key 套餐非法时 fail-closed。
 */
async function resolveDirectUploadPrincipal(principal: Principal) {
  const userId = getPrincipalUserId(principal);
  if (!userId) {
    throw new OperationError(
      "unauthenticated",
      "Direct upload requires a user identity"
    );
  }
  if (principal.type === "apiKey") {
    if (!isSubscriptionPlan(principal.plan)) {
      throw new OperationError(
        "capability_required",
        "A valid subscription plan is required for direct upload"
      );
    }
    return { userId, plan: principal.plan };
  }
  return { userId, plan: (await getUserPlan(userId)).plan };
}

/**
 * 创建绑定当前 Principal 的对象存储直传授权。
 *
 * @param input 已通过 Zod 校验的用途、文件名、MIME 与声明大小。
 * @param principal UOL 调用身份，用户 ID 不从 input 接收。
 * @returns 短期 PUT URL 和供后续控制面请求使用的稳定引用。
 * @sideEffects 读取套餐/运行时设置并调用 S3 签名器，不写数据库或对象正文。
 * @throws OperationError local 存储、超套餐上限、类型非法或签名失败时显式失败。
 */
async function createDirectUploadAuthorization(
  input: CreateDirectUploadInput,
  principal: Principal
) {
  const { userId, plan } = await resolveDirectUploadPrincipal(principal);
  const limits = await getPlanUploadLimits(plan);
  if (input.contentLength > limits.maxFileSizeBytes) {
    throw new OperationError(
      "validation_error",
      "File exceeds the current plan upload limit",
      { maxFileSizeBytes: limits.maxFileSizeBytes },
      413
    );
  }

  const storageEndpoint = await getRuntimeSettingString("STORAGE_ENDPOINT");
  if (!storageEndpoint) {
    throw new OperationError(
      "not_implemented",
      "Direct upload requires S3-compatible storage",
      undefined,
      501
    );
  }
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";

  let metadata: ReturnType<typeof resolveDirectUploadMetadata>;
  try {
    metadata = resolveDirectUploadMetadata(input);
  } catch (error) {
    if (error instanceof DirectUploadInputError) {
      throw new OperationError("validation_error", error.message);
    }
    throw error;
  }

  const key = createDirectUploadKey(
    userId,
    input.purpose,
    metadata.storageExtension
  );
  try {
    const provider = await getStorageProvider();
    const uploadUrl = await provider.getSignedUploadUrl(
      key,
      bucket,
      metadata.uploadContentType,
      DIRECT_UPLOAD_URL_EXPIRES_SECONDS
    );
    return {
      uploadUrl,
      uploadContentType: metadata.uploadContentType,
      expiresIn: DIRECT_UPLOAD_URL_EXPIRES_SECONDS,
      reference: {
        bucket,
        key,
        filename: metadata.filename,
        contentType: metadata.contentType,
        contentLength: input.contentLength,
        purpose: input.purpose,
      },
    };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError(
      "upstream_error",
      "Failed to create direct upload authorization",
      undefined,
      503
    );
  }
}

// ---------------------------------------------------------------------------
// 0. storage.createDirectUpload
//    套餐感知、用户隔离且传输无关的 S3 直传授权
// ---------------------------------------------------------------------------
export const createDirectUpload = defineOperation({
  name: "storage.createDirectUpload",
  domain: "storage",
  title: "创建用户直传授权",
  description:
    "按已鉴权 Principal、套餐上传上限和业务用途生成短期 S3 PUT URL。" +
    "对象 key 由服务端随机生成并绑定用户前缀；后续业务请求只提交稳定 bucket/key 引用，" +
    "服务端仍会重新校验归属与实际对象大小。local 存储明确不支持该能力。",
  input: createDirectUploadInputSchema,
  output: directUploadAuthorizationSchema,
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["storage", "external-call"],
  execute: async (input, principal, _ctx) =>
    await createDirectUploadAuthorization(input, principal),
});

// ---------------------------------------------------------------------------
// 1. storage.getSignedUploadUrl
//    获取头像/用户文件的预签名上传 URL（S3 直传）
// ---------------------------------------------------------------------------
export const getSignedUploadUrl = defineOperation({
  name: "storage.getSignedUploadUrl",
  domain: "storage",
  title: "获取预签名上传 URL",
  description:
    "为已认证用户生成预签名的对象存储上传 URL（头像/用户文件）。" +
    "S3 后端返回可直传的 PUT URL；local 后端返回 GET 路由地址（不可 PUT）。" +
    "需验证桶白名单与套餐能力。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    contentType: z.string().min(1),
  }),
  output: z.object({
    url: z.string(),
    key: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    const url = await provider.getSignedUploadUrl(
      input.key,
      input.bucket,
      input.contentType
    );
    return { url, key: input.key };
  },
});

// ---------------------------------------------------------------------------
// 2. storage.deleteFile
//    删除用户文件（需归属校验）
// ---------------------------------------------------------------------------
export const deleteFile = defineOperation({
  name: "storage.deleteFile",
  domain: "storage",
  title: "删除用户文件",
  description:
    "删除用户拥有的存储文件。需验证桶白名单与文件归属（owner）。" +
    "操作幂等：删除不存在的 key 不报错。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "owner", resource: "storage-file" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    await provider.deleteObject(input.key, input.bucket);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// 3. storage.readObject
//    读取存储对象（GET 代理），权限因桶而异
// ---------------------------------------------------------------------------
export const readObject = defineOperation({
  name: "storage.readObject",
  domain: "storage",
  title: "读取存储对象",
  description:
    "通过 GET 代理读取对象存储中的文件。权限因桶而异：" +
    "avatars 桶公开访问；generations 桶需已认证 + 属主校验。" +
    "执行桶白名单与路径防穿越校验。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    data: z.instanceof(Uint8Array).or(z.unknown()),
    contentType: z.string().optional(),
    contentLength: z.number().optional(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    const data = await provider.getObject(input.key, input.bucket);
    return { data, contentType: undefined, contentLength: data.length };
  },
});

// ---------------------------------------------------------------------------
// 4. storage.createPresignedUpload
//    兼容旧文档上传调用，内部复用统一直传授权
// ---------------------------------------------------------------------------
export const createPresignedUpload = defineOperation({
  name: "storage.createPresignedUpload",
  domain: "storage",
  title: "创建预签名上传 URL（文档上传）",
  description:
    "兼容旧文档上传操作；内部委托统一直传授权，按 Principal 和套餐限制生成" +
    "用户隔离 key，Content-Type 仅由服务端按扩展名派生。",
  input: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    contentLength: z.number().int().positive(),
  }),
  output: z.object({
    url: z.string(),
    fileKey: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["storage", "external-call"],
  execute: async (input, principal, _ctx) => {
    const authorization = await createDirectUploadAuthorization(
      {
        purpose: "document",
        filename: input.filename,
        contentType: input.contentType,
        contentLength: input.contentLength,
      },
      principal
    );
    return {
      url: authorization.uploadUrl,
      fileKey: authorization.reference.key,
    };
  },
});

// ---------------------------------------------------------------------------
// 5. storage.putObject
//    写入对象到存储（系统内部调用，管线调用方已完成鉴权与扣费）
// ---------------------------------------------------------------------------
export const putObject = defineOperation({
  name: "storage.putObject",
  domain: "storage",
  title: "写入存储对象",
  description:
    "将数据写入对象存储（S3 PutObject / local writeFile）。" +
    "仅供系统内部调用（图像管线等），调用方已完成鉴权与扣费。" +
    "key 含随机 nanoid，覆盖写天然幂等。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    data: z.unknown(),
    contentType: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    key: z.string(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    await provider.putObject(
      input.key,
      input.bucket,
      input.data as Buffer,
      input.contentType ?? "application/octet-stream"
    );
    return { success: true, key: input.key };
  },
});

// ---------------------------------------------------------------------------
// 6. storage.getObject
//    从存储读取对象（系统内部调用）
// ---------------------------------------------------------------------------
export const getObject = defineOperation({
  name: "storage.getObject",
  domain: "storage",
  title: "读取存储对象（内部）",
  description:
    "从对象存储读取文件内容（S3 GetObject / local readFile）。" +
    "仅供系统内部调用，调用方负责桶限制与防穿越校验。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    data: z.unknown(),
    contentType: z.string().optional(),
    contentLength: z.number().optional(),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    const data = await provider.getObject(input.key, input.bucket);
    return { data, contentType: undefined, contentLength: data.length };
  },
});

// ---------------------------------------------------------------------------
// 7. storage.deleteObject
//    删除存储对象（系统内部，维护任务批量清理）
// ---------------------------------------------------------------------------
export const deleteObject = defineOperation({
  name: "storage.deleteObject",
  domain: "storage",
  title: "删除存储对象（内部维护）",
  description:
    "从对象存储删除文件（批量清理过期生成图等维护任务）。" +
    "仅供系统内部 cron/admin 调用。操作幂等：删除不存在的 key 不报错。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  hasMaintenanceWrite: true,
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    await provider.deleteObject(input.key, input.bucket);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// 8. storage.getSignedReadUrl
//    获取预签名读取 URL（系统内部调用）
// ---------------------------------------------------------------------------
export const getSignedReadUrl = defineOperation({
  name: "storage.getSignedReadUrl",
  domain: "storage",
  title: "获取预签名读取 URL（内部）",
  description:
    "为存储对象生成临时可读的预签名 URL。" +
    "S3 后端使用 getSignedUrl；local 后端拼接本地路由地址。" +
    "仅供系统内部调用。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    expiresIn: z.number().positive().optional(),
  }),
  output: z.object({
    url: z.string(),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input, _principal, _ctx) => {
    const provider = await getStorageProvider();
    const url = await provider.getSignedUrl(
      input.key,
      input.bucket,
      input.expiresIn ?? 3600
    );
    return { url };
  },
});
