"use client";

// 账户中心高保真原型入口。负责编排独立导航、全局主题与各账户功能模拟页面。

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  ExternalLink,
  Gift,
  LifeBuoy,
  type LucideIcon,
  Menu,
  Moon,
  ReceiptText,
  ShieldCheck,
  Sun,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import {
  type AccountView,
  accountNavigation,
  announcements,
  type PlanId,
  type PlanTerm,
  supportTickets,
} from "./account-mock-data";
import {
  CreditPurchaseDialog,
  getPlan,
  PlanAndCreditsPage,
  PlanPurchaseDialog,
} from "./account-plans-preview";
import styles from "./account-preview.module.css";
import { type AccountNotice, formatCredits } from "./account-preview-shared";
import { ReferralPage } from "./account-referral-preview";
import {
  AnnouncementsPage,
  DataAndAccountPage,
  ProfilePage,
  SecurityPage,
  SupportPage,
} from "./account-secondary-preview";
import { UsagePage } from "./account-usage-preview";

const PREVIEW_THEME_KEY = "gpt2image.design-preview.theme";

type PreviewTheme = "dark" | "light";
type PurchaseMode = "plan" | "credits" | null;

const accountIcons: Record<AccountView, LucideIcon> = {
  plan: WalletCards,
  usage: ReceiptText,
  referral: Gift,
  announcements: Bell,
  support: LifeBuoy,
  profile: UserRound,
  security: ShieldCheck,
  data: Database,
};

const accountViewTitles: Record<AccountView, string> = {
  plan: "套餐与积分",
  usage: "订单与用量",
  referral: "邀请返利",
  announcements: "公告",
  support: "支持工单",
  profile: "个人资料",
  security: "安全",
  data: "数据与账户",
};

/**
 * 校验 URL 中的账户栏目，避免把任意查询文本写入视图状态。
 *
 * @param value 待校验的 section 查询值。
 * @returns 值属于已知账户栏目时返回 true。
 * @sideEffects 无。
 */
function isAccountView(value: string): value is AccountView {
  return Object.hasOwn(accountIcons, value);
}

/**
 * 渲染账户中心并管理全部跨页面原型状态。
 *
 * @param props.locale 当前路由语言，用于空间切换地址。
 * @returns 完整响应式账户中心原型。
 * @sideEffects 仅同步 URL 查询参数和浏览器本地主题，不调用真实业务接口。
 */
export function AccountPreview({ locale }: { locale: string }) {
  const [view, setView] = useState<AccountView>("plan");
  const [theme, setTheme] = useState<PreviewTheme>("dark");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>(null);
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>("pro");
  const [currentTerm, setCurrentTerm] = useState<PlanTerm>("month");
  const [creditBalance, setCreditBalance] = useState(1_248.5);
  const [nonPlanCreditBalance, setNonPlanCreditBalance] = useState(0);
  const [notice, setNotice] = useState<AccountNotice>(null);
  const [referralEntryVisible, setReferralEntryVisible] = useState(true);
  const [referralConverted, setReferralConverted] = useState(false);
  const [unreadAnnouncementIds, setUnreadAnnouncementIds] = useState<string[]>(
    () => announcements.filter((item) => item.unread).map((item) => item.id)
  );
  const [unreadTicketIds, setUnreadTicketIds] = useState<string[]>(() =>
    supportTickets.filter((item) => item.unread).map((item) => item.id)
  );

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(PREVIEW_THEME_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    /**
     * 从浏览器地址恢复账户栏目；隐藏的返利入口安全回退到默认页。
     */
    const applyLocation = () => {
      const url = new URL(window.location.href);
      const section = url.searchParams.get("section");
      const nextView =
        section &&
        isAccountView(section) &&
        (section !== "referral" || referralEntryVisible)
          ? section
          : "plan";
      if (section === "referral" && !referralEntryVisible) {
        url.searchParams.set("section", "plan");
        window.history.replaceState({}, "", url);
      }
      setView(nextView);
      setMobileNavigationOpen(false);
    };

    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [referralEntryVisible]);

  /**
   * 切换账户栏目并把状态写入 URL，方便刷新和直接截图。
   *
   * @param nextView 目标账户栏目。
   * @sideEffects 更新 history 与移动导航状态。
   */
  const changeView = (nextView: AccountView) => {
    if (nextView === view) {
      setMobileNavigationOpen(false);
      return;
    }
    setView(nextView);
    setMobileNavigationOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("section", nextView);
    window.history.pushState({}, "", url);
  };

  /**
   * 切换明暗主题并保存到当前浏览器。
   *
   * @param nextTheme 用户选择的主题。
   * @sideEffects 写入与创作原型共享的 localStorage 键。
   */
  const changeTheme = (nextTheme: PreviewTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem(PREVIEW_THEME_KEY, nextTheme);
  };

  /**
   * 切换免费与付费模拟状态，供高保真评审覆盖两种权益场景。
   *
   * @param mode 需要模拟的账户类型。
   * @sideEffects 更新当前套餐、期限和总积分的本地状态。
   */
  const changeAccountScenario = (mode: "free" | "paid-month" | "paid-year") => {
    if (mode === "free") {
      setCurrentPlanId("free");
      setCreditBalance(18 + nonPlanCreditBalance);
      return;
    }
    setCurrentPlanId("pro");
    setCurrentTerm(mode === "paid-year" ? "year" : "month");
    setCreditBalance(1_248.5 + nonPlanCreditBalance);
  };

  /**
   * 切换返利入口的参与状态并落实关闭策略。
   *
   * @param visible 已参与或有历史时为 true；功能关闭且从未参与时为 false。
   * @sideEffects 隐藏当前返利页时导航回套餐页并写入浏览器历史。
   */
  const changeReferralEntryVisibility = (visible: boolean) => {
    setReferralEntryVisible(visible);
    if (!visible && view === "referral") changeView("plan");
  };

  /**
   * 清除单条公告的本地未读状态。
   *
   * @param announcementId 已打开的公告标识。
   * @sideEffects 更新侧栏未读数量，不影响其他公告。
   */
  const markAnnouncementRead = (announcementId: string) => {
    setUnreadAnnouncementIds((current) =>
      current.filter((id) => id !== announcementId)
    );
  };

  /**
   * 清除单个工单的本地未读状态。
   *
   * @param ticketId 已打开的工单标识。
   * @sideEffects 更新侧栏未读数量，不影响其他工单。
   */
  const markTicketRead = (ticketId: string) => {
    setUnreadTicketIds((current) => current.filter((id) => id !== ticketId));
  };

  /**
   * 完成一次返利转换并在账户空间内锁定重复提交。
   *
   * @param credits 本次全部可用奖励积分。
   * @sideEffects 首次调用增加本地总积分；后续调用保持余额不变。
   */
  const completeReferralConversion = (credits: number) => {
    if (referralConverted || credits <= 0) return;
    setReferralConverted(true);
    setNonPlanCreditBalance((current) => current + credits);
    setCreditBalance((current) => current + credits);
  };

  /**
   * 完成本地套餐购买模拟并反馈页面结果。
   *
   * @param planId 新套餐标识。
   * @param term 固定权益期限。
   * @sideEffects 仅更新原型套餐与积分状态，不创建支付订单。
   */
  const completePlanPurchase = (planId: PlanId, term: PlanTerm) => {
    const selectedPlan = getPlan(planId);
    setCurrentPlanId(planId);
    setCurrentTerm(term);
    setCreditBalance(selectedPlan.credits + nonPlanCreditBalance);
    setPurchaseMode(null);
    setNotice({
      tone: "success",
      text: `${currentPlanId === "free" ? "模拟购买完成" : "模拟升级完成"}：${selectedPlan.name} · ${
        term === "month" ? "1 个月" : "1 年"
      }。原套餐剩余积分已按规则作废，新周期积分已发放；未产生真实扣款。`,
    });
  };

  /**
   * 完成本地积分包购买模拟并反馈余额变化。
   *
   * @param credits 选中积分包的积分数量。
   * @sideEffects 仅修改原型总积分，不创建真实订单或账务记录。
   */
  const completeCreditPurchase = (credits: number) => {
    setNonPlanCreditBalance((current) => current + credits);
    setCreditBalance((balance) => balance + credits);
    setPurchaseMode(null);
    setNotice({
      tone: "success",
      text: `模拟到账 ${formatCredits(credits)} 积分，未产生真实扣款。`,
    });
  };

  return (
    <div className={styles.root} data-theme={theme}>
      <MobileHeader
        title={accountViewTitles[view]}
        theme={theme}
        onMenuOpen={() => setMobileNavigationOpen(true)}
        onThemeChange={changeTheme}
      />

      {mobileNavigationOpen && (
        <button
          type="button"
          className={styles.mobileScrim}
          aria-label="关闭账户导航"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <AccountNavigation
        locale={locale}
        activeView={view}
        mobileOpen={mobileNavigationOpen}
        planName={getPlan(currentPlanId).name}
        creditBalance={creditBalance}
        referralEntryVisible={referralEntryVisible}
        announcementUnreadCount={unreadAnnouncementIds.length}
        ticketUnreadCount={unreadTicketIds.length}
        onClose={() => setMobileNavigationOpen(false)}
        onReferralEntryVisibilityChange={changeReferralEntryVisibility}
        onViewChange={changeView}
      />

      <main className={styles.main}>
        <header className={styles.desktopHeader}>
          <div>
            <span className={styles.workspaceLabel}>账户中心</span>
            <strong>{accountViewTitles[view]}</strong>
          </div>
          <div className={styles.headerActions}>
            <ThemeSwitch theme={theme} onChange={changeTheme} />
            <Link
              className={styles.secondaryButton}
              href="/design-preview/admin"
              locale={locale}
            >
              管理控制台
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </header>

        {notice && (
          <div className={styles.notice} data-tone={notice.tone} role="status">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{notice.text}</span>
            <button
              type="button"
              aria-label="关闭提示"
              title="关闭"
              onClick={() => setNotice(null)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className={styles.pageContent}>
          {view === "plan" && (
            <PlanAndCreditsPage
              currentPlanId={currentPlanId}
              currentTerm={currentTerm}
              creditBalance={creditBalance}
              onAccountScenarioChange={changeAccountScenario}
              onBuyCredits={() => setPurchaseMode("credits")}
              onBuyPlan={() => setPurchaseMode("plan")}
            />
          )}
          {view === "usage" && <UsagePage />}
          {view === "referral" && referralEntryVisible && (
            <ReferralPage
              creditBalance={creditBalance}
              converted={referralConverted}
              locale={locale}
              onConvert={completeReferralConversion}
            />
          )}
          {view === "announcements" && (
            <AnnouncementsPage
              unreadIds={unreadAnnouncementIds}
              onRead={markAnnouncementRead}
            />
          )}
          {view === "support" && (
            <SupportPage unreadIds={unreadTicketIds} onRead={markTicketRead} />
          )}
          {view === "profile" && <ProfilePage onNotice={setNotice} />}
          {view === "security" && <SecurityPage onNotice={setNotice} />}
          {view === "data" && <DataAndAccountPage onNotice={setNotice} />}
        </div>
      </main>

      {purchaseMode === "plan" && (
        <PlanPurchaseDialog
          currentPlanId={currentPlanId}
          currentTerm={currentTerm}
          onClose={() => setPurchaseMode(null)}
          onConfirm={completePlanPurchase}
        />
      )}
      {purchaseMode === "credits" && (
        <CreditPurchaseDialog
          balance={creditBalance}
          onClose={() => setPurchaseMode(null)}
          onConfirm={completeCreditPurchase}
        />
      )}

      <span className={styles.prototypeNote}>Development prototype</span>
    </div>
  );
}

/**
 * 渲染账户中心常驻导航及空间切换入口。
 *
 * @param props 当前栏目、路由语言、账户摘要和移动抽屉控制函数。
 * @returns 桌面侧栏或手机抽屉中的同一套账户导航。
 * @sideEffects 点击栏目时由父组件更新 URL；链接只切换原型空间。
 */
function AccountNavigation({
  locale,
  activeView,
  mobileOpen,
  planName,
  creditBalance,
  referralEntryVisible,
  announcementUnreadCount,
  ticketUnreadCount,
  onClose,
  onReferralEntryVisibilityChange,
  onViewChange,
}: {
  locale: string;
  activeView: AccountView;
  mobileOpen: boolean;
  planName: string;
  creditBalance: number;
  referralEntryVisible: boolean;
  announcementUnreadCount: number;
  ticketUnreadCount: number;
  onClose: () => void;
  onReferralEntryVisibilityChange: (visible: boolean) => void;
  onViewChange: (view: AccountView) => void;
}) {
  const totalUnreadCount = announcementUnreadCount + ticketUnreadCount;
  const navigationRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable = Array.from(
      navigationRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href]"
      ) ?? []
    );
    const closeButton = navigationRef.current?.querySelector<HTMLElement>(
      '[aria-label="关闭账户导航"]'
    );
    (closeButton ?? focusable[0])?.focus();

    /** 将键盘焦点限制在手机抽屉，并支持 Escape 关闭。 */
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusable = Array.from(
        navigationRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href]"
        ) ?? []
      );
      const first = currentFocusable[0];
      const last = currentFocusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [mobileOpen, onClose]);

  return (
    <aside
      ref={navigationRef}
      className={styles.sidebar}
      data-mobile-open={mobileOpen}
    >
      <div className={styles.sidebarBrand}>
        <Link
          href="/design-preview?resume=1"
          locale={locale}
          aria-label="返回并恢复创作空间"
        >
          GPT2IMAGE
        </Link>
        <button
          type="button"
          className={styles.mobileCloseButton}
          aria-label="关闭账户导航"
          title="关闭"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.accountIdentity}>
        <span className={styles.avatar}>ZS</span>
        <span>
          <strong>赵思</strong>
          <small>
            {planName} · {formatCredits(creditBalance)} 积分
          </small>
          <small>
            {totalUnreadCount > 0 ? `${totalUnreadCount} 条未读` : "无未读消息"}
          </small>
        </span>
      </div>

      <nav className={styles.accountNavigation} aria-label="账户中心导航">
        {accountNavigation.map((group) => (
          <div className={styles.navigationGroup} key={group.label}>
            <span className={styles.navigationGroupLabel}>{group.label}</span>
            {group.items
              .filter((item) => item.id !== "referral" || referralEntryVisible)
              .map((item) => {
                const Icon = accountIcons[item.id];
                const unreadCount =
                  item.id === "announcements"
                    ? announcementUnreadCount
                    : item.id === "support"
                      ? ticketUnreadCount
                      : 0;
                return (
                  <button
                    type="button"
                    key={item.id}
                    data-active={activeView === item.id}
                    onClick={() => onViewChange(item.id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{item.label}</span>
                    {unreadCount > 0 && (
                      <span className={styles.navigationBadge}>
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>

      <fieldset className={styles.prototypeNavigationControl}>
        <legend>返利入口模拟</legend>
        <button
          type="button"
          data-active={referralEntryVisible}
          onClick={() => onReferralEntryVisibilityChange(true)}
        >
          已参与
        </button>
        <button
          type="button"
          data-active={!referralEntryVisible}
          onClick={() => onReferralEntryVisibilityChange(false)}
        >
          关闭且未参与
        </button>
      </fieldset>

      <div className={styles.sidebarFooter}>
        <Link href="/design-preview?resume=1" locale={locale}>
          <ArrowLeft size={14} aria-hidden="true" />
          返回创作
        </Link>
        <Link href="/design-preview/admin" locale={locale}>
          <ExternalLink size={14} aria-hidden="true" />
          管理控制台
        </Link>
      </div>
    </aside>
  );
}

/**
 * 渲染手机端标题栏，避免把桌面侧栏压缩成图标栏。
 *
 * @param props 当前标题、主题和菜单操作。
 * @returns 仅在窄屏出现的稳定顶部工具栏。
 * @sideEffects 点击按钮时通知父组件切换抽屉或主题。
 */
function MobileHeader({
  title,
  theme,
  onMenuOpen,
  onThemeChange,
}: {
  title: string;
  theme: PreviewTheme;
  onMenuOpen: () => void;
  onThemeChange: (theme: PreviewTheme) => void;
}) {
  return (
    <header className={styles.mobileHeader}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="打开账户导航"
        title="菜单"
        onClick={onMenuOpen}
      >
        <Menu size={17} aria-hidden="true" />
      </button>
      <strong>{title}</strong>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
        title={theme === "dark" ? "浅色主题" : "深色主题"}
        onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? (
          <Sun size={16} aria-hidden="true" />
        ) : (
          <Moon size={16} aria-hidden="true" />
        )}
      </button>
    </header>
  );
}

/**
 * 渲染桌面明暗主题分段控件。
 *
 * @param props 当前主题和切换回调。
 * @returns 由熟悉图标组成的主题选择器。
 * @sideEffects 点击后由父组件持久化主题。
 */
function ThemeSwitch({
  theme,
  onChange,
}: {
  theme: PreviewTheme;
  onChange: (theme: PreviewTheme) => void;
}) {
  return (
    <fieldset className={styles.themeSwitch}>
      <legend className={styles.srOnly}>界面主题</legend>
      <button
        type="button"
        data-active={theme === "light"}
        aria-label="浅色主题"
        title="浅色主题"
        onClick={() => onChange("light")}
      >
        <Sun size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-active={theme === "dark"}
        aria-label="深色主题"
        title="深色主题"
        onClick={() => onChange("dark")}
      >
        <Moon size={14} aria-hidden="true" />
      </button>
    </fieldset>
  );
}
