/**
 * 用户对象存储直传的 HTTP 薄适配器。
 *
 * 职责：解析会话与 JSON，构造 UOL Principal，调用 storage.createDirectUpload 后编码
 * HTTP 响应。套餐、用途/MIME、用户 key、provider 能力和错误语义均由操作层负责；
 * 该路由不直接构造 S3Client，也不接收客户端指定的 bucket/key。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { normalizeUserRole } from "@repo/shared/auth/roles";
import type { DirectUploadAuthorization } from "@repo/shared/storage/direct-upload";
import {
  invokeOperation,
  OperationError,
  type Principal,
} from "@repo/shared/uol";
import "@repo/shared/uol/operations/storage";
import { type NextRequest, NextResponse } from "next/server";

/** 判断 JSON 值是否为可读取字段的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 把新旧 HTTP 字段归一为 UOL 原始输入。
 *
 * @param body request.json() 返回的不可信值。
 * @returns 保留 unknown 字段值的操作输入，由 invokeOperation 的 Zod schema 最终校验。
 */
function toOperationInput(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  return {
    purpose: body.purpose ?? "document",
    filename: body.filename,
    contentType: body.contentType ?? "",
    contentLength: body.contentLength ?? body.fileSize,
  };
}

/**
 * 创建当前登录用户的短期 PUT URL。
 *
 * @param request 含会话 Cookie 与 JSON 文件元数据的请求。
 * @returns 成功时返回稳定 reference；认证、校验、provider 错误沿用 UOL HTTP 状态。
 * @sideEffects 读取会话/套餐/运行时设置并调用对象存储签名器，不接收文件正文。
 */
export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const principal: Principal = {
    type: "user",
    userId: session.user.id,
    role: normalizeUserRole(session.user.role),
  };
  try {
    const authorization = await invokeOperation<DirectUploadAuthorization>(
      "storage.createDirectUpload",
      toOperationInput(body),
      principal,
      { requestId: request.headers.get("x-request-id") || undefined }
    );
    return NextResponse.json({
      uploadUrl: authorization.uploadUrl,
      // 兼容旧调用方字段；新代码只使用 uploadUrl + reference。
      presignedUrl: authorization.uploadUrl,
      uploadContentType: authorization.uploadContentType,
      contentType: authorization.reference.contentType,
      expiresIn: authorization.expiresIn,
      fileKey: authorization.reference.key,
      reference: authorization.reference,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.httpStatus }
      );
    }
    return NextResponse.json(
      { error: "Failed to create upload authorization" },
      { status: 500 }
    );
  }
});
