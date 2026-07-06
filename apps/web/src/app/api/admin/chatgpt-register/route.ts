/**
 * ChatGPT 账号注册机 SSE 接口
 *
 * 职责：管理后台发起注册时，把请求经 runner 转发给 chatgpt-register sidecar，
 *   把日志流式推给前端，结束后由 runner 完成 token 入库并回传导入摘要。
 *
 * 使用方：管理后台 "注册机" Tab（chatgpt-register-tab.tsx）
 * 关键依赖：
 *   - runChatgptRegisterBatch（chatgpt-register-runner，sidecar 调用 + token 入库）
 *   - @repo/shared/auth（鉴权）
 *
 * 安全设计：仅管理员可调用；moemail/代理凭据在 runner 内服务端读取，不返回客户端；
 *   count/concurrency 服务端硬限。
 */
import { auth } from "@repo/shared/auth";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { runChatgptRegisterBatch } from "@/features/image-backend-pool/chatgpt-register-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COUNT = 500;
const MAX_CONCURRENCY = 50;

const requestSchema = z.object({
  count: z.coerce.number().int().min(1).max(MAX_COUNT).default(1),
  concurrency: z.coerce.number().int().min(1).max(MAX_CONCURRENCY).default(5),
  webGroupId: z.string().trim().min(1).optional().nullable(),
  namePrefix: z.string().trim().max(80).optional(),
});

// 本路由回传给前端的事件。
type ClientEvent =
  | { type: "log"; line: string }
  | { type: "imported"; imported: number; failed: number; skipped: number }
  | { type: "error"; message: string }
  | { type: "done" };

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  // 鉴权：仅管理员可调用
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("未登录", 401);
  }
  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    return jsonError("无权限", 403);
  }

  // 解析请求参数
  let params: z.infer<typeof requestSchema>;
  try {
    const body = await request.json();
    params = requestSchema.parse(body);
  } catch {
    return jsonError("参数错误", 400);
  }

  const encoder = new TextEncoder();
  const flushPadding = `: ${" ".repeat(2048)}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: ClientEvent) => {
        write(`data: ${JSON.stringify(event)}\n\n${flushPadding}`);
      };

      try {
        const result = await runChatgptRegisterBatch(
          {
            count: params.count,
            concurrency: params.concurrency,
            webGroupId: params.webGroupId ?? null,
            namePrefix: params.namePrefix ?? null,
          },
          (line) => emit({ type: "log", line })
        );
        emit({
          type: "imported",
          imported: result.imported,
          failed: result.failed,
          skipped: result.skipped,
        });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        emit({ type: "done" });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
