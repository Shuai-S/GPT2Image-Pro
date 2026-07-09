"use client";

/**
 * 当前会话客户端状态。
 *
 * 职责：在路由树内共享服务端预取的会话，并集中处理显式刷新和页面重新可见时的
 * 被动刷新。使用方：Marketing、Dashboard、Docs 布局及其 Header/CTA/Sidebar。
 * 关键依赖：`/api/session/current` 作为会话权威读取端点。
 */

import type { AppUserRole } from "@repo/shared/auth/roles";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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

type CurrentSessionState = {
  data: CurrentSession;
  isPending: boolean;
  reload: () => void;
};

const CurrentSessionContext = createContext<CurrentSessionState | null>(null);

/**
 * 创建一份会话状态及其刷新生命周期。
 *
 * @param initialData 服务端预取的会话；`undefined` 表示需要客户端读取。
 * @returns 当前会话、加载状态与手动刷新函数。
 * @sideEffects 请求会话端点并监听 focus/pageshow/visibilitychange。
 * @failureMode 请求失败时保留已有会话；没有已有值时回退 null。
 */
function useCurrentSessionState(
  initialData: CurrentSession | undefined
): CurrentSessionState {
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

/**
 * 在同一路由树内提供唯一会话状态。
 *
 * @param props.initialData 服务端预取的会话；不传时由 Provider 客户端读取一次。
 * @param props.children 会话消费者子树。
 * @returns 会话上下文 Provider。
 * @sideEffects 维护一份共享会话请求与浏览器可见性监听。
 */
export function CurrentSessionProvider({
  children,
  initialData,
}: {
  children?: ReactNode;
  initialData?: CurrentSession;
}) {
  const state = useCurrentSessionState(initialData);

  return createElement(
    CurrentSessionContext.Provider,
    { value: state },
    children
  );
}

/**
 * 读取当前浏览器会话，并在用户主动回到页面时刷新。
 *
 * @returns 当前会话、加载状态与手动刷新函数。
 * @sideEffects Provider 统一负责请求与浏览器事件监听，消费者本身无副作用。
 * @throws 不在 CurrentSessionProvider 内调用时抛出错误。
 */
export function useCurrentSession() {
  const sharedState = useContext(CurrentSessionContext);
  if (!sharedState) {
    throw new Error(
      "useCurrentSession must be used within CurrentSessionProvider"
    );
  }
  return sharedState;
}
