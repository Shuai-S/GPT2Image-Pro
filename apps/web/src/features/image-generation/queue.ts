/**
 * 图像生成队列生产入口。
 *
 * 将 DB-free 本地优先级等待队列与 PostgreSQL 集群并发协调器组装为单例，供统一
 * 图像管线调用。等待超时与全局并发分别读取环境变量和运行时设置。
 */

import { randomUUID } from "node:crypto";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";

import { postgresImageGenerationConcurrencyCoordinator } from "./distributed-concurrency";
import { createImageGenerationQueue } from "./queue-core";

/** 从正整数环境变量读取配置，无效时使用回退值。 */
function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 读取集群级图像生成全局并发上限。 */
export async function getImageGenerationGlobalConcurrency(): Promise<number> {
  const value = await getRuntimeSettingNumber(
    "IMAGE_GENERATION_GLOBAL_CONCURRENCY",
    500,
    { positive: true }
  );
  return Math.max(1, Math.floor(value));
}

/** 读取请求在本副本等待分布式许可的最长时间。 */
function getQueueTimeoutMs(): number {
  return getPositiveIntegerEnv(
    "IMAGE_GENERATION_QUEUE_TIMEOUT_MS",
    20 * 60_000
  );
}

export const withImageGenerationQueue = createImageGenerationQueue({
  coordinator: postgresImageGenerationConcurrencyCoordinator,
  getGlobalConcurrency: getImageGenerationGlobalConcurrency,
  getQueueTimeoutMs,
  createTaskId: randomUUID,
});
