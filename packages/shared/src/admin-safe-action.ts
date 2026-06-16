/**
 * 管理员专用 Server Action 客户端
 *
 * 与 safe-action.ts 中面向用户的 protectedAction/adminAction 隔离。
 * 本文件的 action 客户端使用 adminAuth（独立的管理员 Better Auth 实例），
 * 读取 admin.session_token cookie 进行认证，确保 apps/admin 的 server action
 * 在多应用拆分后正确校验管理员会话，而非误读用户侧 cookie。
 *
 * 使用方：apps/admin 内的 server action。
 * 依赖：adminAuth (auth/admin-auth)、next-safe-action、角色校验 (auth/roles)。
 */

import { headers } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { adminAuth } from "./auth/admin-auth";
import {
  canAccessAdminArea,
  canManageUserPermissions,
  type AppUserRole,
} from "./auth/roles";
import { logError, logger } from "./logger/index";
import { captureError } from "./monitoring/index";

/**
 * action 元数据 schema，与 safe-action.ts 保持一致
 */
const actionMetadataSchema = z
  .object({
    action: z.string().min(1),
  })
  .optional();

/**
 * 管理员认证失败错误
 */
class AdminAuthError extends Error {
  constructor() {
    super("管理员登录已失效，请重新登录");
    this.name = "AdminAuthError";
  }
}

/**
 * 管理员权限不足错误
 */
class AdminRoleError extends Error {
  constructor(message = "权限不足") {
    super(message);
    this.name = "AdminRoleError";
  }
}

/**
 * 管理员基础 Action 客户端
 *
 * 错误处理逻辑与 safe-action.ts 中的 baseActionClient 对齐：
 * - 已知认证/权限错误原样返回
 * - 未知错误记日志 + Sentry 上报，生产环境隐藏细节
 */
const adminBaseClient = createSafeActionClient({
  defineMetadataSchema: () => actionMetadataSchema,
  handleServerError(error) {
    if (
      error instanceof AdminAuthError ||
      error instanceof AdminRoleError
    ) {
      return error.message;
    }

    // 结构化日志记录
    logError(error, { source: "admin-server-action" });

    // Sentry 上报
    captureError(error, { source: "admin-server-action" });

    if (process.env.NODE_ENV === "production") {
      return "服务器错误，请稍后重试";
    }

    return error.message;
  },
});

/**
 * 管理员会话 Action 客户端
 *
 * 通过 adminAuth（独立 Better Auth 实例）校验管理员会话。
 * 读取 admin.session_token cookie，查询 admin_session 表验证。
 * 下游 action 可通过 ctx.adminUser 获取管理员信息。
 */
export const adminSessionAction = adminBaseClient
  .use(async ({ metadata, ctx, next }) => {
    // 性能日志中间件
    const startTime = Date.now();
    const result = await next();
    const duration = Date.now() - startTime;
    const adminId =
      (ctx as { adminUser?: { id?: string } }).adminUser?.id;
    const error =
      !result.success && "serverError" in result
        ? (result as { serverError?: unknown }).serverError
        : undefined;

    logger.info(
      {
        action: metadata?.action ?? "admin-server-action",
        success: result.success,
        duration,
        ...(adminId ? { adminId } : {}),
        ...(error ? { error } : {}),
      },
      "Admin server action"
    );

    return result;
  })
  .use(async ({ next }) => {
    /**
     * 通过 adminAuth 获取管理员会话
     * 读取 admin.session_token cookie，与用户侧 cookie 完全隔离
     */
    const session = await adminAuth.api.getSession({
      headers: await headers(),
    });

    if (!session || !session.user) {
      throw new AdminAuthError();
    }

    logger.debug(
      { adminId: session.user.id },
      "Admin authenticated action executed"
    );

    return next({
      ctx: {
        adminUser: session.user,
        adminSession: session.session,
      },
    });
  });

/**
 * 管理员角色校验 Action 客户端
 *
 * 在 adminSessionAction 基础上增加角色验证：
 * - 默认要求 canAccessAdminArea（admin 或 super_admin）
 * - 下游 action 可通过 ctx.adminRole 获取角色
 *
 * admin_user 表自带 role 字段（默认 'admin'），直接从会话用户读取，
 * 无需像用户侧那样查 user 表（管理员已在独立表中）。
 */
export const adminRoleAction = adminSessionAction.use(
  async ({ next, ctx }) => {
    const role =
      (ctx.adminUser as { role?: string }).role ?? "admin";

    if (!canAccessAdminArea(role)) {
      throw new AdminRoleError("此操作需要管理员权限");
    }

    return next({
      ctx: {
        ...ctx,
        adminRole: role as AppUserRole,
      },
    });
  }
);

/**
 * 超级管理员 Action 客户端
 *
 * 在 adminSessionAction 基础上验证 super_admin 角色。
 * 用于高敏操作（如管理员账户管理、系统配置变更等）。
 */
export const adminSuperAction = adminSessionAction.use(
  async ({ next, ctx }) => {
    const role =
      (ctx.adminUser as { role?: string }).role ?? "admin";

    if (!canManageUserPermissions(role)) {
      throw new AdminRoleError("此操作需要超级管理员权限");
    }

    return next({
      ctx: {
        ...ctx,
        adminRole: role as AppUserRole,
        isSuperAdmin: true,
      },
    });
  }
);
