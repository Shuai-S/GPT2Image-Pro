/**
 * 可编辑文件(PPT/PSD)编排:租 web 账号 → generateFileWithChatGptWeb → 存 storage → 扣固定积分。
 *
 * 职责:把「对话式生成可编辑文件」串成一条业务链路(供同步 handler 与持久 worker 调用):
 *   ① base64 输入图解码;② 从后端池租一个 web 账号(accountBackendPreference="web",失败换号,
 *   带 in-flight 租约 + 结果上报,保证不泄露租约、不误伤池健康);③ 调 generateFileWithChatGptWeb
 *   出 .pptx/.psd(+可选 zip);④ 二进制存进站内 storage，并返回稳定对象引用与即时签名 URL;
 *   ⑤ 成功后按固定价 consumeCredits(双重记账,幂等键 sourceRef=editable-file:{taskId},只成功才扣)。
 *
 * WHY:符合 CLAUDE.md 单一账号池/单一计费真相;不复用图片 batch-runner(产物非图片)。
 * 账号能力(plus/pro + 代码解释器 + gpt-5-5-thinking)由后续调度过滤保证(见设计文档 §8);
 * 本编排在无可用账号/生成失败时明确报错、不扣费。
 * 长任务态由 external-api/editable-task-worker.ts 负责，本文件不持有进程内队列状态。
 */
import { createHash } from "node:crypto";
import { consumeCredits } from "@repo/shared/credits/core";
import { logWarn } from "@repo/shared/logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import {
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import {
  refundExternalApiKeyCredits,
  reserveExternalApiKeyCredits,
} from "@/features/external-api/quota";
import {
  ImageBackendPoolUnavailableError,
  releaseImageBackendInflightLease,
  reportImageBackendResult,
  resolveImageBackendPoolConfig,
} from "@/features/image-backend-pool/service";
import {
  type EditableFileBinary,
  type EditableFileKind,
  generateFileWithChatGptWeb,
} from "./chatgpt-web";
import {
  decodeEditableInputImages,
  type EditableInputImage,
  editableFileExtension,
  editableFileServiceName,
  MAX_EDITABLE_INPUT_IMAGE_BYTES,
  MAX_EDITABLE_INPUT_IMAGES,
  MAX_EDITABLE_INPUT_TOTAL_BYTES,
  NO_WEB_ACCOUNT_ERROR,
} from "./editable-file-util";

const DEFAULT_EDITABLE_CREDITS = 25;
const MAX_ACCOUNT_SWITCHES = 3;

export type EditableFileStorageReference = {
  bucket: string;
  key: string;
  contentType: string;
  size: number;
};

export type EditableFileOutput = {
  conversationId: string;
  primaryStorage: EditableFileStorageReference;
  zipStorage: EditableFileStorageReference | null;
  primaryUrl: string;
  zipUrl: string | null;
  creditsCharged: number;
};

/** pool-account/api/adobe → 租约/上报用的 memberType。web 账号为 pool-account → "account"。 */
function poolMemberType(type?: string): "api" | "account" | "adobe" {
  if (type === "pool-api") return "api";
  if (type === "pool-adobe") return "adobe";
  return "account";
}

/** 读取可编辑文件产物使用的存储桶；未配置时与生图统一回退 generations。 */
async function storageBucket(): Promise<string> {
  return (
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations"
  );
}

/**
 * 把一个文件二进制写入稳定任务前缀并返回对象引用。
 *
 * taskId 经 SHA-256 处理后进入 key，避免客户端幂等键造成路径穿越；同一任务重试会
 * 覆盖同一对象而不是制造孤儿文件。签名 URL 不进入持久结果。
 */
async function storeEditableBinary(
  userId: string,
  kind: EditableFileKind,
  taskId: string,
  binary: EditableFileBinary,
  isZip: boolean
): Promise<EditableFileStorageReference> {
  const bucket = await storageBucket();
  const namespace = createHash("sha256")
    .update(`${kind}:${taskId}`)
    .digest("hex");
  const extension = editableFileExtension(kind, isZip);
  const key = `${userId}/editable-file-results/${namespace}/${
    isZip ? "assets" : "document"
  }.${extension}`;
  const contentType = binary.mimeType || "application/octet-stream";
  const storage = await getStorageProvider();
  await storage.putObject(key, bucket, binary.buffer, contentType);
  return { bucket, key, contentType, size: binary.buffer.byteLength };
}

/** 为稳定可编辑文件对象引用生成当前有效的下载 URL。 */
export function signEditableFileStorageReference(
  reference: EditableFileStorageReference
): string {
  return buildSignedStorageImageUrl(reference.key, reference.bucket) ?? "";
}

/** 尽力删除本轮已写产物；清理失败由对象生命周期规则兜底，不覆盖原业务错误。 */
async function cleanupEditableOutputs(
  references: readonly EditableFileStorageReference[]
): Promise<void> {
  if (references.length === 0) return;
  const storage = await getStorageProvider();
  await Promise.allSettled(
    references.map((reference) =>
      storage.deleteObject(reference.key, reference.bucket)
    )
  );
}

/**
 * 复核 worker 从对象存储恢复的二进制图片边界。
 *
 * 该路径不重新分配 Buffer；非法数量、MIME、单图或总大小会在调用上游前失败。
 */
function validateLoadedImages(
  kind: EditableFileKind,
  images: readonly EditableInputImage[]
): EditableInputImage[] {
  if (kind === "psd" && images.length === 0) {
    throw new Error("base64_images is empty");
  }
  if (images.length > MAX_EDITABLE_INPUT_IMAGES) {
    throw new Error(
      `base64_images must contain at most ${MAX_EDITABLE_INPUT_IMAGES} images`
    );
  }
  let totalBytes = 0;
  for (const image of images) {
    if (
      !image.type.startsWith("image/") ||
      image.data.byteLength === 0 ||
      image.data.byteLength > MAX_EDITABLE_INPUT_IMAGE_BYTES
    ) {
      throw new Error("editable image input is invalid");
    }
    totalBytes += image.data.byteLength;
    if (totalBytes > MAX_EDITABLE_INPUT_TOTAL_BYTES) {
      throw new Error("base64_images total size exceeds 50 MiB");
    }
  }
  return [...images];
}

/**
 * 生成一份可编辑文件(PPT/PSD)。同步链路:租号→生成→存储→扣费。
 * @param taskId 幂等/审计标识(计费 sourceRef=editable-file:{taskId})。
 * @throws base64_images is empty(PSD 必须有输入图)/ no available web account / 生成失败信息。
 */
export async function runEditableFileForUser(params: {
  userId: string;
  apiKeyId?: string;
  kind: EditableFileKind;
  prompt: string;
  base64Images?: string[];
  inputImages?: readonly EditableInputImage[];
  taskId: string;
}): Promise<EditableFileOutput> {
  const { userId, apiKeyId, kind, prompt, taskId } = params;
  if (params.inputImages && (params.base64Images?.length ?? 0) > 0) {
    throw new Error("editable file input images were provided twice");
  }
  const images = params.inputImages
    ? validateLoadedImages(kind, params.inputImages)
    : decodeEditableInputImages({
        kind,
        base64Images: params.base64Images ?? [],
      });

  const excluded: string[] = [];
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_ACCOUNT_SWITCHES; attempt++) {
    let resolved: Awaited<ReturnType<typeof resolveImageBackendPoolConfig>> =
      null;
    try {
      resolved = await resolveImageBackendPoolConfig({
        userId,
        apiKeyId,
        requestKind: "image_generation",
        accountBackendPreference: "web",
        // PPT/PSD 需代码解释器,限付费账号:池只在付费级 web 账号里选(见 planType 回填/导入 check)。
        accountPlanFilter: "paid",
        // 跨组直取付费 web,忽略 API key/偏好的分组作用域——PPT/PSD 像站内 UI 一样必须命中付费
        // web 账号,不受外部 key 绑定的(可能是 api-only 的)分组限制。apiKeyId 仍用于计费归属。
        spanGroupsForWeb: true,
        excludedMemberKeys: excluded,
      });
    } catch (error) {
      if (!(error instanceof ImageBackendPoolUnavailableError)) throw error;
    }
    const config = resolved?.config;
    const backend = config?.backend;
    if (!config || !backend) break; // 池已无候选,跳出走最终报错(NO_WEB_ACCOUNT_ERROR)
    const memberType = poolMemberType(backend.type);

    // 本功能必须用真正的 ChatGPT 网页会话账号(accountBackend==="web",与主图像管线分派 web
    // 路径同一判据)。WHY:web 偏好只把"账号"候选滤成 web 实现,但池在 web 车道里仍可能返回
    // web 分组内的 api/responses 后端;这些不是 ChatGPT 网页会话,跑不了 web 文件生成。有些
    // 用户的池只有 api/codex 后端、无 web 账号——必须明确报错,绝不拿非 web 后端硬跑。
    // 遇到非 web:仅释放租约(不上报失败——它没失败,只是不适配本功能)、排除后换下一个。
    if (backend.accountBackend !== "web") {
      if (backend.id) excluded.push(`${memberType}:${backend.id}`);
      await releaseImageBackendInflightLease({
        memberType,
        memberId: backend.id,
        leaseId: backend.inflightLeaseId,
        leasePersisted: backend.inflightLeasePersisted,
      }).catch(() => {});
      lastError = NO_WEB_ACCOUNT_ERROR;
      continue;
    }

    let success = false;
    const storedOutputs: EditableFileStorageReference[] = [];
    try {
      const result = await generateFileWithChatGptWeb({
        config,
        kind,
        prompt,
        images,
      });
      // 存 storage(先存后扣费:存失败不扣费)。
      const primaryStorage = await storeEditableBinary(
        userId,
        kind,
        taskId,
        result.primary,
        false
      );
      storedOutputs.push(primaryStorage);
      const zipStorage = result.zip
        ? await storeEditableBinary(userId, kind, taskId, result.zip, true)
        : null;
      if (zipStorage) storedOutputs.push(zipStorage);
      // 按固定价扣费(仅成功;幂等键防重复扣;金额后台可配,默认 25)。
      const amount = Math.max(
        0,
        Math.trunc(
          await getRuntimeSettingNumber(
            kind === "psd"
              ? "EDITABLE_FILE_PSD_CREDITS"
              : "EDITABLE_FILE_PPT_CREDITS",
            DEFAULT_EDITABLE_CREDITS
          )
        )
      );
      let creditsCharged = 0;
      if (amount > 0) {
        const sourceRef = `editable-file:${taskId}`;
        await reserveExternalApiKeyCredits({
          apiKeyId,
          userId,
          amount,
          sourceRef,
        });
        let userCreditsConsumed = false;
        try {
          await consumeCredits({
            userId,
            amount,
            serviceName: editableFileServiceName(kind),
            description: kind === "psd" ? "生成 PSD 文件" : "生成 PPT 文件",
            sourceRef,
            metadata: {
              kind,
              taskId,
              conversationId: result.conversationId,
              apiKeyId: apiKeyId || null,
            },
          });
          userCreditsConsumed = true;
        } finally {
          if (!userCreditsConsumed) {
            await refundExternalApiKeyCredits({
              apiKeyId,
              userId,
              amount,
              sourceRef,
            });
          }
        }
        creditsCharged = amount;
      }
      success = true;
      return {
        conversationId: result.conversationId,
        primaryStorage,
        zipStorage,
        primaryUrl: signEditableFileStorageReference(primaryStorage),
        zipUrl: zipStorage
          ? signEditableFileStorageReference(zipStorage)
          : null,
        creditsCharged,
      };
    } catch (error) {
      await cleanupEditableOutputs(storedOutputs);
      lastError = error instanceof Error ? error.message : String(error);
      if (backend.id) excluded.push(`${memberType}:${backend.id}`);
      logWarn("可编辑文件生成失败,换号重试", {
        taskId,
        kind,
        attempt,
        memberId: backend.id,
        error: lastError,
      });
    } finally {
      // 无论成败都释放租约 + 上报池健康(不阻断主流程)。
      await releaseImageBackendInflightLease({
        memberType,
        memberId: backend.id,
        leaseId: backend.inflightLeaseId,
        leasePersisted: backend.inflightLeasePersisted,
      }).catch(() => {});
      await reportImageBackendResult({
        memberType,
        memberId: backend.id,
        success,
        error: success ? undefined : lastError,
      }).catch(() => {});
    }
  }
  throw new Error(lastError || "editable file generation failed after retries");
}
