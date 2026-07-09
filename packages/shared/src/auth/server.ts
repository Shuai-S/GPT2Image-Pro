import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "./index";

/**
 * 服务器端获取当前用户会话
 *
 * 用于 Server Components 和 Server Actions 中获取用户信息
 *
 * 用 React 19 的 cache() 包装（A-P0-1）：同一请求内 layout 与各 page
 * 共享同一 session 查询结果，消除每次导航 2~3 次冗余 getSession 往返。
 * 注意 better-auth 的 getSession 依赖 `await headers()`，必须在 cache
 * 包裹的函数内部调用 headers() 以保证请求隔离（cache 按 RSC 请求维度
 * 复用，headers() 在其内部调用才能拿到正确的请求头）。
 *
 * @example
 * ```tsx
 * // 在 Server Component 中使用
 * export default async function Page() {
 *   const session = await getServerSession();
 *   if (!session) {
 *     redirect("/sign-in");
 *   }
 *   return <div>Welcome, {session.user.name}</div>;
 * }
 * ```
 */
export const getServerSession = cache(async () => {
  return auth.api.getSession({
    headers: await headers(),
  });
});

/**
 * 获取当前用户
 *
 * 便捷方法，直接返回用户对象或 null
 */
export const getCurrentUser = cache(async () => {
  const session = await getServerSession();
  return session?.user ?? null;
});

/**
 * 检查用户是否已认证
 *
 * @returns boolean - 用户是否已登录
 */
export const isAuthenticated = cache(async () => {
  const session = await getServerSession();
  return !!session?.user;
});
