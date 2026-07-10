/**
 * Next.js 服务端 instrumentation 入口。
 *
 * 职责：按 Node/Edge runtime 初始化系统设置、超级管理员、内部调度器、持久异步 worker
 * 与 Sentry。生产构建阶段不会安装后台循环。
 */

/**
 * 初始化当前 Next.js runtime。
 *
 * Node 副本各自启动 worker，跨副本互斥由 PostgreSQL 租约保证；初始化错误向上抛，
 * 避免服务在关键启动步骤失败后悄悄进入部分可用状态。
 */
export async function register(): Promise<void> {
  // 服务端初始化
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapSystemSettingsEnv } = await import(
      "@repo/shared/system-settings/bootstrap"
    );
    await bootstrapSystemSettingsEnv();
    const { bootstrapSelfUseSuperAdmin } = await import(
      "@repo/shared/auth/bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();
    const { startInternalJobScheduler } = await import(
      "./server/internal-job-scheduler"
    );
    await startInternalJobScheduler();
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const [{ startEditableTaskWorker }, { startAsyncCallbackWorker }] =
        await Promise.all([
          import("./features/external-api/editable-task-worker"),
          import("./features/external-api/async-callback-worker"),
        ]);
      await Promise.all([
        startEditableTaskWorker(),
        startAsyncCallbackWorker(),
      ]);
    }
    // Sentry 服务端初始化
    await import("../sentry.server.config");
  }

  // Edge Runtime 初始化
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
