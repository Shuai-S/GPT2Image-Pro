"use client";

import type { AppUserRole } from "@repo/shared/auth/roles";
import { useCallback, useEffect, useRef, useState } from "react";

const PASSIVE_SESSION_REFRESH_MIN_INTERVAL_MS = 30_000;

export type CurrentSession = {
  user?: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    role?: AppUserRole;
  };
} | null;

/**
 * 读取当前浏览器会话，并在用户主动回到页面时刷新。
 *
 * @param initialData 服务端布局预取的会话；传入后首屏不再重复请求。
 * @returns 当前会话、加载状态与手动刷新函数。
 * @sideEffects 仅在缺少 initialData、显式 reload、窗口重新获得焦点时请求 /api/session/current。
 */
export function useCurrentSession(initialData?: CurrentSession) {
  const [data, setData] = useState<CurrentSession>(initialData ?? null);
  const [isPending, setIsPending] = useState(initialData === undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const lastReloadAtRef = useRef(0);
  const lastPassiveReloadAtRef = useRef(Date.now());

  const reload = useCallback(() => {
    const now = Date.now();
    if (now - lastReloadAtRef.current < 1000) return;
    lastReloadAtRef.current = now;
    lastPassiveReloadAtRef.current = now;
    setReloadToken((value) => value + 1);
  }, []);

  const reloadPassively = useCallback(() => {
    const now = Date.now();
    if (
      now - lastPassiveReloadAtRef.current <
      PASSIVE_SESSION_REFRESH_MIN_INTERVAL_MS
    ) {
      return;
    }
    lastPassiveReloadAtRef.current = now;
    reload();
  }, [reload]);

  useEffect(() => {
    if (initialData !== undefined && reloadToken === 0) {
      setData(initialData);
      setIsPending(false);
      return;
    }

    const controller = new AbortController();

    async function loadSession() {
      setIsPending(true);

      try {
        const requestTag = `${Date.now().toString(36)}-${reloadToken}`;
        const response = await fetch(`/api/session/current?t=${requestTag}`, {
          cache: "no-store",
          credentials: "include",
          method: "POST",
          headers: {
            "Cache-Control": "no-store",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          setData((current) => current ?? null);
          return;
        }

        setData((await response.json()) as CurrentSession);
      } catch {
        if (!controller.signal.aborted) {
          setData((current) => current ?? null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPending(false);
        }
      }
    }

    loadSession();

    return () => controller.abort();
  }, [initialData, reloadToken]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") reloadPassively();
    };

    window.addEventListener("focus", reloadPassively);
    window.addEventListener("pageshow", reloadPassively);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      window.removeEventListener("focus", reloadPassively);
      window.removeEventListener("pageshow", reloadPassively);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [reloadPassively]);

  return { data, isPending, reload };
}
