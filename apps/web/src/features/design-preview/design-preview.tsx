"use client";

// 前端视觉重构高保真原型入口。仅编排模拟视图、导航与本地交互状态。

import { MotionConfig } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Coins,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  Moon,
  PanelLeftClose,
  Pin,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import {
  AuthOverlayPreview,
  type AuthPreviewMode,
  type AuthRequestContext,
  isAuthPreviewMode,
} from "./auth-overlay-preview";
import { CanvasPreview } from "./canvas-preview";
import { CreatePreview } from "./create-preview";
import styles from "./design-preview.module.css";
import { GalleryPreview } from "./gallery-preview";
import { HomePreview, type HomeSection } from "./home-preview";
import type { PreviewView } from "./mock-data";

const LAST_CREATIVE_VIEW_KEY = "gpt2image.design-preview.last-creative-view";
const PREVIEW_THEME_KEY = "gpt2image.design-preview.theme";

type PreviewTheme = "dark" | "light";

const navigationItems: Array<{
  id: PreviewView;
  label: string;
  icon: typeof Home;
}> = [
  { id: "home", label: "首页", icon: Home },
  { id: "create-empty", label: "创作", icon: Sparkles },
  { id: "canvas", label: "无限画布", icon: LayoutDashboard },
  { id: "gallery", label: "图库", icon: Images },
];

/**
 * 渲染五视图高保真原型并管理全站导航状态。
 *
 * @param props.initialView 由开发预览 URL 的 view 参数决定的初始视图。
 * @returns 独立、无真实业务副作用的全屏交互原型。
 */
export function DesignPreview({ initialView }: { initialView: PreviewView }) {
  const [view, setView] = useState<PreviewView>(initialView);
  const [homeSection, setHomeSection] = useState<HomeSection>("gallery");
  const [navOpen, setNavOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const [theme, setTheme] = useState<PreviewTheme>("dark");
  const [authMode, setAuthMode] = useState<AuthPreviewMode | null>(null);
  const [authRequestContext, setAuthRequestContext] =
    useState<AuthRequestContext | null>(null);
  const [initialInviteCode, setInitialInviteCode] = useState("");
  const [authenticated, setAuthenticated] = useState(
    initialView !== "home" && initialView !== "create-empty"
  );
  const [lastCreativeView, setLastCreativeView] = useState<
    "create-empty" | "create-results" | "canvas"
  >("create-empty");
  const closeTimerRef = useRef<number | null>(null);
  const pendingAuthActionRef = useRef<(() => void) | null>(null);
  const authOpenedByUiRef = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_CREATIVE_VIEW_KEY);
    if (
      stored === "create-empty" ||
      stored === "create-results" ||
      stored === "canvas"
    ) {
      setLastCreativeView(stored);
    }
    const storedTheme = window.localStorage.getItem(PREVIEW_THEME_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }

    const url = new URL(window.location.href);
    const urlAuthMode = url.searchParams.get("auth");
    if (isAuthPreviewMode(urlAuthMode)) {
      setAuthMode(urlAuthMode);
      setView("home");
      if (url.searchParams.get("view") !== "home") {
        url.searchParams.set("view", "home");
        window.history.replaceState({}, "", url);
      }
    }
    setInitialInviteCode(url.searchParams.get("aff") ?? "");

    if (
      !isAuthPreviewMode(urlAuthMode) &&
      url.searchParams.get("resume") === "1" &&
      (stored === "create-empty" ||
        stored === "create-results" ||
        stored === "canvas")
    ) {
      setView(stored);
    }
  }, []);

  useEffect(() => {
    /** 同步浏览器前进后退后的创作视图与认证覆盖层。 */
    const syncUrlState = () => {
      const url = new URL(window.location.href);
      const nextView = url.searchParams.get("view");
      if (nextView && isPreviewView(nextView)) setView(nextView);

      const nextAuthMode = url.searchParams.get("auth");
      setAuthMode(isAuthPreviewMode(nextAuthMode) ? nextAuthMode : null);
      setInitialInviteCode(url.searchParams.get("aff") ?? "");
      if (!isAuthPreviewMode(nextAuthMode)) {
        pendingAuthActionRef.current = null;
        setAuthRequestContext(null);
      }
      authOpenedByUiRef.current = false;
    };

    window.addEventListener("popstate", syncUrlState);
    return () => window.removeEventListener("popstate", syncUrlState);
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    []
  );

  /**
   * 切换原型视图并同步 URL，方便刷新与 Playwright 直接截图。
   */
  const changeView = (nextView: PreviewView) => {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.pushState({}, "", url);
    if (
      nextView === "create-empty" ||
      nextView === "create-results" ||
      nextView === "canvas"
    ) {
      setLastCreativeView(nextView);
      window.localStorage.setItem(LAST_CREATIVE_VIEW_KEY, nextView);
    }
    if (!navPinned) setNavOpen(false);
  };

  /**
   * 延迟关闭临时导航，避免指针跨过边缘时闪退。
   */
  const scheduleNavClose = () => {
    if (navPinned) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setNavOpen(false), 300);
  };

  /**
   * 立即展开导航并取消尚未执行的关闭任务。
   */
  const openNav = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setNavOpen(true);
  };

  const isCreateView = view === "create-empty" || view === "create-results";

  /**
   * 切换整套原型主题并保留本地选择。
   *
   * @param nextTheme 用户明确选择的明暗主题。
   * @sideEffects 写入 localStorage，刷新后继续展示同一主题。
   */
  const changeTheme = (nextTheme: PreviewTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem(PREVIEW_THEME_KEY, nextTheme);
  };

  /**
   * 打开统一认证覆盖层，并可暂存登录后需要继续的本地动作。
   *
   * @param mode 需要打开的认证步骤。
   * @param pendingAction 认证成功后继续执行的原型动作。
   * @param context 被拦截创作的只读摘要。
   * @sideEffects 写入 URL 历史并更新认证层状态。
   */
  const openAuth = (
    mode: AuthPreviewMode,
    pendingAction: (() => void) | null = null,
    context: AuthRequestContext | null = null
  ) => {
    pendingAuthActionRef.current = pendingAction;
    setAuthRequestContext(context);
    setAuthMode(mode);
    authOpenedByUiRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.set("auth", mode);
    window.history.pushState({}, "", url);
  };

  /**
   * 在同一覆盖层内切换认证步骤并保持可分享 URL。
   *
   * @param mode 目标认证步骤。
   * @sideEffects 替换当前认证历史项，避免关闭时逐级回退表单。
   */
  const changeAuthMode = (mode: AuthPreviewMode) => {
    setAuthMode(mode);
    const url = new URL(window.location.href);
    url.searchParams.set("auth", mode);
    window.history.replaceState({}, "", url);
  };

  /**
   * 关闭认证层，并恢复打开前的页面历史状态。
   *
   * @sideEffects 清除待继续动作；交互打开时回退历史，直接访问时移除查询参数。
   */
  const closeAuth = () => {
    pendingAuthActionRef.current = null;
    setAuthRequestContext(null);
    if (authOpenedByUiRef.current) {
      window.history.back();
      return;
    }

    setAuthMode(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", url);
  };

  /**
   * 完成本地认证模拟并恢复先前被拦截的动作。
   *
   * @sideEffects 标记本地已登录、清理认证 URL，并执行一次暂存回调。
   */
  const completeAuthentication = () => {
    const pendingAction = pendingAuthActionRef.current;
    pendingAuthActionRef.current = null;
    setAuthenticated(true);
    setAuthMode(null);
    setAuthRequestContext(null);
    authOpenedByUiRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", url);
    pendingAction?.();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={styles.root}
        data-nav-pinned={view !== "home" && navPinned}
        data-theme={theme}
      >
        <Topbar
          view={view}
          homeSection={homeSection}
          onHomeSectionChange={(section) => {
            setHomeSection(section);
            if (view !== "home") changeView("home");
          }}
          onStartCreation={() => changeView(lastCreativeView)}
          onThemeChange={changeTheme}
          theme={theme}
          onViewChange={changeView}
          authenticated={authenticated}
          onOpenAuth={() => openAuth("sign-in")}
        />

        {view !== "home" && (
          <>
            <button
              type="button"
              className={styles.edgeTrigger}
              aria-label="展开全站导航"
              onMouseEnter={openNav}
              onFocus={openNav}
            />
            <aside
              className={styles.sideNav}
              data-open={navOpen || navPinned}
              onMouseEnter={openNav}
              onMouseLeave={scheduleNavClose}
            >
              <div className={styles.sideNavHeader}>
                <span>Navigation</span>
                <button
                  type="button"
                  className={styles.pinButton}
                  data-pinned={navPinned}
                  aria-label={navPinned ? "取消固定导航" : "固定导航"}
                  title={navPinned ? "取消固定" : "固定展开"}
                  onClick={() => {
                    setNavPinned((current) => !current);
                    setNavOpen(true);
                  }}
                >
                  {navPinned ? (
                    <PanelLeftClose size={13} aria-hidden="true" />
                  ) : (
                    <Pin size={13} aria-hidden="true" />
                  )}
                </button>
              </div>
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const active =
                  item.id === "create-empty" ? isCreateView : view === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    data-active={active}
                    onClick={() => changeView(item.id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </aside>
          </>
        )}

        <div className={styles.contentFrame} data-nav-pinned={navPinned}>
          {view === "home" && (
            <HomePreview
              section={homeSection}
              theme={theme}
              onStartCreation={() => changeView(lastCreativeView)}
            />
          )}
          {isCreateView && (
            <CreatePreview
              showResults={view === "create-results"}
              authenticated={authenticated}
              onShowResults={() => {
                changeView("create-results");
                setNavOpen(false);
              }}
              onOpenGallery={() => changeView("gallery")}
              onRequireAuthentication={(pendingAction, context) =>
                openAuth("sign-in", pendingAction, context)
              }
            />
          )}
          {view === "gallery" && (
            <GalleryPreview
              onUseAsReference={() => changeView("create-results")}
            />
          )}
          {view === "canvas" && <CanvasPreview />}
        </div>

        {view !== "home" && (
          <AccountDock
            authenticated={authenticated}
            onOpenAuth={(mode) => openAuth(mode)}
          />
        )}

        {authMode && (
          <AuthOverlayPreview
            mode={authMode}
            initialInviteCode={initialInviteCode}
            requestContext={authRequestContext}
            onModeChange={changeAuthMode}
            onClose={closeAuth}
            onAuthenticated={completeAuthentication}
          />
        )}

        <div className={styles.prototypeNote}>Development prototype</div>
      </div>
    </MotionConfig>
  );
}

/**
 * 渲染创作空间账户菜单，承载三空间入口、余额和未读摘要。
 *
 * @param props.authenticated 当前本地认证模拟状态。
 * @param props.onOpenAuth 匿名状态下打开登录或注册覆盖层。
 * @returns 左下账户摘要与可关闭菜单。
 * @sideEffects 只管理菜单开关和焦点，不读取真实账户数据。
 */
function AccountDock({
  authenticated,
  onOpenAuth,
}: {
  authenticated: boolean;
  onOpenAuth: (mode: AuthPreviewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={styles.accountDock}>
      <span className={styles.balance}>
        <Coins size={13} aria-hidden="true" />
        {authenticated ? "128.50" : "未登录"}
      </span>
      <button
        type="button"
        className={styles.accountButton}
        data-unread={authenticated}
        aria-label="打开账户菜单"
        aria-expanded={open}
        title="账户"
        onClick={() => setOpen((current) => !current)}
      >
        <UserRound size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.accountMenu} role="menu">
          {authenticated ? (
            <>
              <div className={styles.accountMenuIdentity}>
                <span>ZS</span>
                <span>
                  <strong>赵思</strong>
                  <small>Pro · super_admin</small>
                </span>
              </div>
              <div className={styles.accountMenuSummary}>
                <span>
                  <small>总积分</small>
                  <strong>128.50</strong>
                </span>
                <span>
                  <small>未读</small>
                  <strong>3</strong>
                </span>
              </div>
              <Link
                href="/design-preview/account"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <UserRound size={14} aria-hidden="true" />
                <span>账户中心</span>
                <Bell size={12} aria-hidden="true" />
              </Link>
              <Link
                href="/design-preview/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                <span>管理控制台</span>
                <ChevronRight size={13} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <div className={styles.accountMenuAnonymous}>
                <strong>继续使用 GPT2IMAGE</strong>
                <span>登录后保存作品与账户权益。</span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenAuth("sign-in");
                }}
              >
                <LogIn size={14} aria-hidden="true" />
                <span>登录</span>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenAuth("sign-up");
                }}
              >
                <UserRound size={14} aria-hidden="true" />
                <span>注册</span>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 渲染首页场景导航或工作区快速视图切换。
 */
function Topbar({
  view,
  homeSection,
  onHomeSectionChange,
  onStartCreation,
  onThemeChange,
  theme,
  onViewChange,
  authenticated,
  onOpenAuth,
}: {
  view: PreviewView;
  homeSection: HomeSection;
  onHomeSectionChange: (section: HomeSection) => void;
  onStartCreation: () => void;
  onThemeChange: (theme: PreviewTheme) => void;
  theme: PreviewTheme;
  onViewChange: (view: PreviewView) => void;
  authenticated: boolean;
  onOpenAuth: () => void;
}) {
  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.brandMark}
        onClick={() => onViewChange("home")}
      >
        GPT2IMAGE
        <span>PROTOTYPE</span>
      </button>
      {view === "home" ? (
        <nav className={styles.sceneNav} aria-label="首页空间场景">
          {[
            ["gallery", "画廊"],
            ["pricing", "定价"],
            ["docs", "文档"],
          ].map(([id, label]) => (
            <button
              type="button"
              data-active={homeSection === id}
              key={id}
              onClick={() => onHomeSectionChange(id as HomeSection)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : (
        <nav className={styles.sceneNav} aria-label="原型视图切换">
          <button
            type="button"
            data-active={view === "create-empty"}
            onClick={() => onViewChange("create-empty")}
          >
            空状态
          </button>
          <button
            type="button"
            data-active={view === "create-results"}
            onClick={() => onViewChange("create-results")}
          >
            结果状态
          </button>
          <button
            type="button"
            data-active={view === "gallery"}
            onClick={() => onViewChange("gallery")}
          >
            图库
          </button>
          <button
            type="button"
            data-active={view === "canvas"}
            onClick={() => onViewChange("canvas")}
          >
            无限画布
          </button>
        </nav>
      )}
      <div className={styles.topActions}>
        <fieldset className={styles.themeSwitch} aria-label="界面主题">
          <button
            type="button"
            data-active={theme === "light"}
            aria-label="切换到明亮主题"
            title="明亮主题"
            onClick={() => onThemeChange("light")}
          >
            <Sun size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-active={theme === "dark"}
            aria-label="切换到暗色主题"
            title="暗色主题"
            onClick={() => onThemeChange("dark")}
          >
            <Moon size={13} aria-hidden="true" />
          </button>
        </fieldset>
        {view === "home" && (
          <button
            type="button"
            className={styles.topAction}
            onClick={onOpenAuth}
          >
            {authenticated ? (
              <UserRound size={13} aria-hidden="true" />
            ) : (
              <LogIn size={13} aria-hidden="true" />
            )}
            {authenticated ? "已登录" : "登录"}
          </button>
        )}
        {view === "home" ? (
          <button
            type="button"
            className={styles.topAction}
            onClick={onStartCreation}
          >
            <Sparkles size={13} aria-hidden="true" />
            开始创作
          </button>
        ) : (
          <button
            type="button"
            className={styles.topAction}
            onClick={onOpenAuth}
          >
            {authenticated ? (
              <UserRound size={13} aria-hidden="true" />
            ) : (
              <LogIn size={13} aria-hidden="true" />
            )}
            {authenticated ? "已登录" : "登录"}
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * 校验浏览器历史中的创作原型视图。
 *
 * @param value 未信任的查询参数。
 * @returns 参数属于现有创作视图时返回 true。
 * @sideEffects 无。
 */
function isPreviewView(value: string): value is PreviewView {
  return (
    navigationItems.some((item) => item.id === value) ||
    value === "create-results"
  );
}
