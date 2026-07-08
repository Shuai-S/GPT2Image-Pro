/**
 * Dashboard 侧边栏未读角标 Hook
 *
 * 职责：集中读取工单与公告未读数量，并提供按导航 href 取角标数量的函数。
 *
 * 使用方：NavLinkItem 渲染前由 DashboardSidebar 调用。
 * 关键依赖：support/announcements server actions、next-safe-action。
 */
"use client";

import { getMyUnreadAnnouncementCountAction } from "@repo/shared/announcements/actions";
import { getMyUnreadTicketCountAction } from "@repo/shared/support/actions/ticket";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef } from "react";

/**
 * 读取并维护侧边栏未读角标数量。
 *
 * @param userId 当前登录用户 ID。
 * @returns getUnreadCount 函数，用于按 href 读取对应角标数量。
 * @sideEffects 用户登录、窗口重新可见或获得焦点时调用 server actions 刷新未读数。
 * @failureMode 请求失败时 next-safe-action result 保持空值，角标按 0 展示。
 */
export function useUnreadBadges(userId?: string) {
  const lastUnreadRefreshAtRef = useRef(0);
  const { execute: fetchUnreadTickets, result: unreadTicketsResult } =
    useAction(getMyUnreadTicketCountAction);
  const {
    execute: fetchUnreadAnnouncements,
    result: unreadAnnouncementsResult,
  } = useAction(getMyUnreadAnnouncementCountAction);

  const unreadTicketCount = Math.max(
    0,
    Number(unreadTicketsResult.data?.count ?? 0)
  );
  const unreadAnnouncementCount = Math.max(
    0,
    Number(unreadAnnouncementsResult.data?.count ?? 0)
  );

  /**
   * 刷新侧边栏角标计数。
   *
   * @returns 无返回值。
   * @sideEffects 调用 server actions 读取未读工单与公告数量。
   */
  const refreshUnreadCounts = useCallback(() => {
    const now = Date.now();
    if (now - lastUnreadRefreshAtRef.current < 1000) return;
    lastUnreadRefreshAtRef.current = now;
    fetchUnreadTickets();
    fetchUnreadAnnouncements();
  }, [fetchUnreadTickets, fetchUnreadAnnouncements]);

  useEffect(() => {
    if (userId) {
      refreshUnreadCounts();
    }
  }, [userId, refreshUnreadCounts]);

  useEffect(() => {
    if (!userId) return;

    /**
     * 页面从后台回到前台时刷新计数。
     *
     * @returns 无返回值。
     * @sideEffects 触发未读计数查询；避免每次路由切换都抢占导航请求。
     */
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshUnreadCounts();
      }
    };

    window.addEventListener("focus", refreshUnreadCounts);
    window.addEventListener("pageshow", refreshUnreadCounts);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshUnreadCounts);
      window.removeEventListener("pageshow", refreshUnreadCounts);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [userId, refreshUnreadCounts]);

  /**
   * 根据导航 href 返回应展示的未读数量。
   *
   * @param href 导航项 href。
   * @returns 对应未读数量；非角标菜单返回 0。
   * @sideEffects 无。
   * @failureMode 未知 href 返回 0。
   */
  const getUnreadCount = useCallback(
    (href: string) => {
      if (href === "/dashboard/announcements") return unreadAnnouncementCount;
      if (href === "/dashboard/support") return unreadTicketCount;
      return 0;
    },
    [unreadAnnouncementCount, unreadTicketCount]
  );

  return {
    getUnreadCount,
  };
}
