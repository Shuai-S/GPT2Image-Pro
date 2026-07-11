// 管理控制台原型的常驻导航、顶部栏、桌面门槛与工具集成插槽。

import {
  ArrowLeft,
  Bell,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  CircleGauge,
  CircleUserRound,
  CreditCard,
  FileText,
  LifeBuoy,
  type LucideIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TicketCheck,
  Users,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import styles from "./admin-preview.module.css";
import {
  type AdminSection,
  copy,
  type PreviewTheme,
} from "./admin-preview-shared";

type NavigationItem = {
  id: AdminSection;
  labelZh: string;
  labelEn: string;
  icon: LucideIcon;
};

type NavigationGroup = {
  labelZh: string;
  labelEn: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    labelZh: "总览",
    labelEn: "Overview",
    items: [
      {
        id: "overview",
        labelZh: "指标与趋势",
        labelEn: "Metrics & trends",
        icon: ChartNoAxesCombined,
      },
    ],
  },
  {
    labelZh: "用户与服务",
    labelEn: "Users & service",
    items: [
      {
        id: "users",
        labelZh: "用户管理",
        labelEn: "Users",
        icon: Users,
      },
      {
        id: "tickets",
        labelZh: "工单管理",
        labelEn: "Tickets",
        icon: TicketCheck,
      },
    ],
  },
  {
    labelZh: "资金与增长",
    labelEn: "Finance & growth",
    items: [
      {
        id: "payments",
        labelZh: "支付订单",
        labelEn: "Payments",
        icon: CreditCard,
      },
      {
        id: "referrals",
        labelZh: "邀请返佣",
        labelEn: "Referrals",
        icon: CircleDollarSign,
      },
    ],
  },
  {
    labelZh: "内容运营",
    labelEn: "Content",
    items: [
      {
        id: "announcements",
        labelZh: "公告管理",
        labelEn: "Announcements",
        icon: Bell,
      },
    ],
  },
  {
    labelZh: "平台管理",
    labelEn: "Platform",
    items: [
      {
        id: "backends",
        labelZh: "生图后端池",
        labelEn: "Backend pool",
        icon: ServerCog,
      },
      {
        id: "settings",
        labelZh: "系统与定价设置",
        labelEn: "System & pricing",
        icon: Settings2,
      },
    ],
  },
];

export const adminSections = navigationGroups.flatMap((group) =>
  group.items.map((item) => item.id)
);

/**
 * 在小于 1024px 时替代完整后台，避免渲染危险写操作。
 *
 * @param props.locale 当前语言。
 * @param props.theme 当前主题。
 * @returns 桌面端使用提示与返回产品入口。
 */
export function DesktopRequired({
  locale,
  theme,
}: {
  locale: string;
  theme: PreviewTheme;
}) {
  return (
    <div className={styles.mobileGate} data-theme={theme}>
      <div className={styles.mobileGateMark}>
        <CircleGauge size={22} aria-hidden="true" />
      </div>
      <p className={styles.eyebrow}>GPT2IMAGE · SUPER ADMIN</p>
      <h1>{copy(locale, "Desktop required", "请使用桌面端")}</h1>
      <p>
        {copy(
          locale,
          "The management console requires a viewport at least 1024px wide.",
          "管理控制台需要至少 1024px 宽的视口，小屏不会加载管理写操作。"
        )}
      </p>
      <Link href="/design-preview?resume=1" locale={locale}>
        <ArrowLeft size={15} aria-hidden="true" />
        {copy(locale, "Back to product", "返回产品")}
      </Link>
    </div>
  );
}

/**
 * 渲染超级管理员常驻、可手动折叠的分组导航。
 *
 * @param props 当前导航状态与切换回调。
 * @returns 管理空间专属导航，不复用创作空间隐藏导航。
 */
export function AdminNavigation({
  collapsed,
  locale,
  section,
  onCollapseChange,
  onNavigate,
}: {
  collapsed: boolean;
  locale: string;
  section: AdminSection;
  onCollapseChange: (collapsed: boolean) => void;
  onNavigate: (section: AdminSection) => void;
}) {
  return (
    <aside className={styles.navigation} aria-label="Admin navigation">
      <div className={styles.navigationBrand}>
        <div className={styles.brandMark}>G2</div>
        <div className={styles.brandCopy}>
          <strong>GPT2IMAGE</strong>
          <span>SUPER ADMIN</span>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={copy(
            locale,
            collapsed ? "Expand navigation" : "Collapse navigation",
            collapsed ? "展开导航" : "折叠导航"
          )}
          title={copy(
            locale,
            collapsed ? "Expand navigation" : "Collapse navigation",
            collapsed ? "展开导航" : "折叠导航"
          )}
          onClick={() => onCollapseChange(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className={styles.navigationGroups}>
        {navigationGroups.map((group) => (
          <div className={styles.navigationGroup} key={group.labelEn}>
            <span className={styles.navigationGroupLabel}>
              {copy(locale, group.labelEn, group.labelZh)}
            </span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  className={styles.navigationItem}
                  data-active={section === item.id}
                  key={item.id}
                  title={copy(locale, item.labelEn, item.labelZh)}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{copy(locale, item.labelEn, item.labelZh)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={styles.navigationFooter}>
        <Link
          className={styles.navigationItem}
          href="/design-preview?resume=1"
          locale={locale}
          title={copy(locale, "Back to product", "返回产品")}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span>{copy(locale, "Back to product", "返回产品")}</span>
        </Link>
        <Link
          className={styles.navigationItem}
          href="/design-preview/account"
          locale={locale}
          title={copy(locale, "Account center", "账户中心")}
        >
          <CircleUserRound size={16} aria-hidden="true" />
          <span>{copy(locale, "Account center", "账户中心")}</span>
        </Link>
      </div>
    </aside>
  );
}

/**
 * 渲染管理页面的稳定顶部栏、超级管理员语境与主题控制。
 *
 * @param props 当前页面、语言、主题及主题变更回调。
 * @returns 固定高度的管理页标题栏。
 */
export function AdminHeader({
  locale,
  section,
  theme,
  onThemeChange,
}: {
  locale: string;
  section: AdminSection;
  theme: PreviewTheme;
  onThemeChange: (theme: PreviewTheme) => void;
}) {
  const activeItem = navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === section);
  const title = activeItem
    ? copy(locale, activeItem.labelEn, activeItem.labelZh)
    : copy(locale, "Management", "管理控制台");

  return (
    <header className={styles.header}>
      <div>
        <div className={styles.headerBreadcrumb}>
          {copy(locale, "Management console", "管理控制台")}
          <ChevronRight size={12} aria-hidden="true" />
          <span>{title}</span>
        </div>
        <h1>{title}</h1>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.prototypeBadge}>
          {copy(locale, "Local prototype", "本地模拟")}
        </span>
        <fieldset className={styles.themeControl}>
          <legend className={styles.visuallyHidden}>Theme</legend>
          <button
            type="button"
            data-active={theme === "light"}
            aria-label={copy(locale, "Light theme", "浅色主题")}
            title={copy(locale, "Light theme", "浅色主题")}
            onClick={() => onThemeChange("light")}
          >
            <Sun size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-active={theme === "dark"}
            aria-label={copy(locale, "Dark theme", "深色主题")}
            title={copy(locale, "Dark theme", "深色主题")}
            onClick={() => onThemeChange("dark")}
          >
            <Moon size={14} aria-hidden="true" />
          </button>
        </fieldset>
        <div className={styles.adminIdentity}>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <strong>root@example.test</strong>
            <small>super_admin</small>
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * 为本轮未制作高保真状态的管理模块显示克制占位。
 *
 * @param props.section 当前延期模块。
 * @param props.locale 当前语言。
 * @returns 保持导航可探索但不伪造真实功能的页面。
 */
export function DeferredAdminPage({
  locale,
  section,
}: {
  locale: string;
  section: Exclude<
    AdminSection,
    "overview" | "users" | "backends" | "settings"
  >;
}) {
  const labels: Record<typeof section, [string, string, LucideIcon]> = {
    tickets: ["Ticket management", "工单管理", LifeBuoy],
    payments: ["Payment orders", "支付订单", CreditCard],
    referrals: ["Referral commission", "邀请返佣", CircleDollarSign],
    announcements: ["Announcement management", "公告管理", FileText],
  };
  const item = labels[section];
  const Icon = item[2];

  return (
    <section className={styles.integrationSlot}>
      <div className={styles.integrationMark}>
        <Icon size={21} aria-hidden="true" />
      </div>
      <p className={styles.eyebrow}>
        {copy(locale, "Navigation architecture", "导航结构验证")}
      </p>
      <h2>{copy(locale, item[0], item[1])}</h2>
      <p>
        {copy(
          locale,
          "The navigation destination is reserved. Its full workflow is outside this prototype slice.",
          "已保留明确导航位置；完整业务流程不属于本次代表性原型范围。"
        )}
      </p>
    </section>
  );
}
