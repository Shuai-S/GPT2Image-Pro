/**
 * 图库计数缓存与失效工具。
 *
 * 职责：为用户图库四个 tab 的计数提供按用户隔离的 Next data cache tag，
 * 并在生成、删除、视频完成等写路径后做 best-effort 失效。
 * 使用方：gallery-data 查询层与图像/视频生成写路径。
 * 关键依赖：next/cache 的 revalidateTag。
 */

import { logWarn } from "@repo/shared/logger";
import { revalidateTag } from "next/cache";

export const GALLERY_COUNTS_CACHE_TAG_PREFIX = "gallery-counts:user:";

/**
 * 构造图库计数缓存 tag。
 *
 * @param userId - 当前用户 ID。
 * @returns 仅用于 Next data cache 的 tag。
 * @sideEffects 无。
 * @failureMode 空 userId 仍返回可预测 tag，调用方应保证输入来自已认证用户。
 */
export function galleryCountsCacheTag(userId: string) {
  return `${GALLERY_COUNTS_CACHE_TAG_PREFIX}${userId}`;
}

/**
 * 失效某个用户的图库计数缓存。
 *
 * @param userId - 发生图库写入的用户 ID。
 * @returns void。
 * @sideEffects 调用 Next data cache revalidateTag。
 * @failureMode 在非 Next 缓存上下文或边缘异常时记录 warn，不阻断主流程。
 */
export function invalidateGalleryCountsCache(userId: string) {
  try {
    revalidateTag(galleryCountsCacheTag(userId), "max");
  } catch (error) {
    logWarn("Failed to invalidate gallery counts cache", {
      source: "gallery-cache",
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
