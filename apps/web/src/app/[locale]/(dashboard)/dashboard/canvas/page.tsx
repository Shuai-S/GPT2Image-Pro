import { getCurrentUser } from "@repo/shared/auth/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { InfiniteCanvasClient } from "@/features/infinite-canvas/components/infinite-canvas-client";

/**
 * 无限画布页面。
 *
 * 使用方：Dashboard 侧边栏的无限画布入口。
 * 关键依赖：当前登录用户鉴权与客户端无限画布编辑器。
 */

/**
 * 渲染登录用户的无限画布工作台。
 *
 * @returns 无限画布页面。
 * @sideEffects 未登录时重定向到登录页。
 */
export default async function InfiniteCanvasPage() {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  return <InfiniteCanvasClient />;
}
