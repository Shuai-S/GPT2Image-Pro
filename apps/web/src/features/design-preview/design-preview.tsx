"use client";

// 前端视觉重构高保真原型入口。仅编排模拟视图、导航与本地交互状态。

import {
  Coins,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  PanelLeftClose,
  Pin,
  Moon,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { MotionConfig } from "framer-motion";
import { useEffect, useRef, useState } from "react";
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
  const [lastCreativeView, setLastCreativeView] = useState<
    "create-empty" | "create-results" | "canvas"
  >("create-empty");
  const closeTimerRef = useRef<number | null>(null);

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
    window.history.replaceState({}, "", url);
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
          {view === "create-empty" && (
            <CreatePreview
              showResults={false}
              onShowResults={() => {
                changeView("create-results");
                setNavOpen(false);
              }}
              onOpenGallery={() => changeView("gallery")}
            />
          )}
          {view === "create-results" && (
            <CreatePreview
              showResults
              onShowResults={() => changeView("create-results")}
              onOpenGallery={() => changeView("gallery")}
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
          <div className={styles.accountDock}>
            <span className={styles.balance}>
              <Coins size={13} aria-hidden="true" />
              128.50
            </span>
            <button
              type="button"
              className={styles.accountButton}
              aria-label="打开账户"
              title="账户"
            >
              <UserRound size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className={styles.prototypeNote}>Development prototype</div>
      </div>
    </MotionConfig>
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
}: {
  view: PreviewView;
  homeSection: HomeSection;
  onHomeSectionChange: (section: HomeSection) => void;
  onStartCreation: () => void;
  onThemeChange: (theme: PreviewTheme) => void;
  theme: PreviewTheme;
  onViewChange: (view: PreviewView) => void;
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
          <button type="button" className={styles.topAction}>
            <LogIn size={13} aria-hidden="true" />
            登录状态模拟
          </button>
        )}
      </div>
    </header>
  );
}
