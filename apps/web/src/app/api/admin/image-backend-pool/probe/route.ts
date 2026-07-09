/**
 * 图像后端测活（可手动终止）API route。
 *
 * 职责：管理员在后台点"测活"时由本 route 调 probeImageBackendApi，把请求自身的
 *   NextRequest.signal 中继给 probeImageBackendApi 的 AbortController，使前端 fetch
 *   被 AbortController.abort() 时本 route 也 abort、把"已手动终止"回传给前端。
 *   替代旧的 testImageBackendApiAction（Server Action 无法把前端 abort 信号中继到
 *   长任务），保留与原 action 同样的 admin 鉴权与无副作用语义。
 *
 * 使用方：image-backend-pool/admin-panel.tsx 的 runApiHealthCheck。
 * 关键依赖：@repo/shared/auth + probeImageBackendApi。
 */
import { auth } from "@repo/shared/auth";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import type { NextRequest } from "next/server";

import { probeImageBackendApi } from "@/features/image-backend-pool/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/admin/image-backend-pool/probe
 * body: { id: string }
 * 鉴权：admin。
 * 返回 { success, id, name, result }；result 与 ImageApiHealthResult 一致。
 * 前端 abort 后本 route 因 request.signal 被 next 自动触发，probeImageBackendApi
 * 内部 controller.abort()，返回 unreachable + "已手动终止"。
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return jsonError("未登录", 401);
  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) return jsonError("无权限", 403);

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("参数错误", 400);
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return jsonError("缺少 id", 400);

  // request.signal 由 Next 提供：客户端 fetch 一旦 abort，本 signal 立即触发，从而
  // 中断 probeImageBackendApi 内部的上游 fetch 并回报 unreachable + "已手动终止"。
  try {
    const probe = await probeImageBackendApi(id, { signal: request.signal });
    return Response.json({ success: true, ...probe });
  } catch (error) {
    const message = error instanceof Error ? error.message : "测活失败";
    return jsonError(message, 500);
  }
}
