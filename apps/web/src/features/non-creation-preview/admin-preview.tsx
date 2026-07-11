"use client";

// 管理控制台高保真原型入口。负责本地状态、URL 同步和子视图编排。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AdminCustomRange,
  type AdminRange,
  type AdminUser,
  adminErrorGroups,
  adminUsers,
} from "./admin-mock-data";
import { ErrorInspector, OverviewPage } from "./admin-overview";
import styles from "./admin-preview.module.css";
import {
  type AdminSection,
  copy,
  type PreviewTheme,
  type UserInspectorTab,
} from "./admin-preview-shared";
import {
  type OperationResult,
  OperationResultDialog,
  RiskOperationDialog,
} from "./admin-risk-dialogs";
import {
  AdminHeader,
  AdminNavigation,
  adminSections,
  DeferredAdminPage,
  DesktopRequired,
} from "./admin-shell";
import { AdminToolsPreview } from "./admin-tools-preview";
import { UserInspector } from "./admin-user-inspector";
import { UserManagementPage } from "./admin-users";

const PREVIEW_THEME_KEY = "gpt2image.design-preview.theme";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const DEFAULT_CUSTOM_RANGE: AdminCustomRange = {
  start: "2026-07-01",
  end: "2026-07-10",
};
const USER_PLAN_FILTERS = ["all", "Free", "Starter", "Pro", "Ultra"] as const;
const USER_STATUS_FILTERS = ["all", "active", "frozen", "disabled"] as const;

const userTabs: UserInspectorTab[] = [
  "overview",
  "credits",
  "orders",
  "generations",
  "api",
  "support",
  "audit",
];

type AdminUrlState = {
  section: AdminSection;
  errorId: string | null;
  userId: string | null;
  userTab: UserInspectorTab;
  userSearch: string;
  userPlan: string;
  userStatus: string;
};

type UserFilterState = Pick<
  AdminUrlState,
  "userSearch" | "userPlan" | "userStatus"
>;

type AdminNavigationUrlState = Omit<
  AdminUrlState,
  "userSearch" | "userPlan" | "userStatus"
>;

type OperationDialogState = {
  kind: "credits" | "password";
  userId: string;
} | null;

/**
 * 校验 URL 中的管理页面标识。
 *
 * @param value 尚未信任的查询参数。
 * @returns 参数是否属于原型允许的管理页面。
 */
function isAdminSection(value: string | null): value is AdminSection {
  return value !== null && adminSections.some((section) => section === value);
}

/**
 * 校验 URL 中的用户检查器标签。
 *
 * @param value 尚未信任的查询参数。
 * @returns 参数是否属于用户检查器标签。
 */
function isUserInspectorTab(value: string | null): value is UserInspectorTab {
  return value !== null && userTabs.some((tab) => tab === value);
}

/**
 * 校验 URL 中的套餐筛选，拒绝把未知值带入列表状态。
 *
 * @param value 尚未信任的查询参数。
 * @returns 白名单套餐筛选或安全默认值。
 */
function parseUserPlanFilter(value: string | null): string {
  return value !== null && USER_PLAN_FILTERS.some((item) => item === value)
    ? value
    : "all";
}

/**
 * 校验 URL 中的账号状态筛选。
 *
 * @param value 尚未信任的查询参数。
 * @returns 白名单状态筛选或安全默认值。
 */
function parseUserStatusFilter(value: string | null): string {
  return value !== null && USER_STATUS_FILTERS.some((item) => item === value)
    ? value
    : "all";
}

/**
 * 从浏览器 URL 读取可分享的管理页面、对象与标签状态。
 *
 * @returns 已经过白名单收窄的 URL 状态；服务端渲染时返回安全默认值。
 */
function readAdminUrlState(): AdminUrlState {
  if (typeof window === "undefined") {
    return {
      section: "overview",
      errorId: null,
      userId: null,
      userTab: "overview",
      userSearch: "",
      userPlan: "all",
      userStatus: "all",
    };
  }

  const params = new URL(window.location.href).searchParams;
  const sectionParam = params.get("adminView");
  const userTabParam = params.get("adminUserTab");

  return {
    section: isAdminSection(sectionParam) ? sectionParam : "overview",
    errorId: params.get("adminError"),
    userId: params.get("adminUser"),
    userTab: isUserInspectorTab(userTabParam) ? userTabParam : "overview",
    userSearch: (params.get("adminUserQuery") ?? "").slice(0, 80),
    userPlan: parseUserPlanFilter(params.get("adminUserPlan")),
    userStatus: parseUserStatusFilter(params.get("adminUserStatus")),
  };
}

/**
 * 把管理原型的选择写入当前 URL，模拟可刷新、可返回和可分享的检查器。
 *
 * @param state 需要持久化的管理视图状态。
 * @param mode 新建历史记录或替换当前记录。
 * @sideEffects 调用 History API，但不会导航或请求服务端。
 */
function writeAdminUrlState(
  state: AdminNavigationUrlState,
  mode: "push" | "replace"
) {
  const url = new URL(window.location.href);
  url.searchParams.set("adminView", state.section);

  if (state.errorId) {
    url.searchParams.set("adminError", state.errorId);
  } else {
    url.searchParams.delete("adminError");
  }

  if (state.userId) {
    url.searchParams.set("adminUser", state.userId);
    url.searchParams.set("adminUserTab", state.userTab);
  } else {
    url.searchParams.delete("adminUser");
    url.searchParams.delete("adminUserTab");
  }

  if (mode === "push") {
    window.history.pushState({}, "", url);
  } else {
    window.history.replaceState({}, "", url);
  }
}

/**
 * 把用户列表筛选同步到 URL，同时保留当前检查器和一级页面参数。
 *
 * @param filters 已通过界面控件收窄的筛选值。
 * @sideEffects 使用 replaceState 避免每次输入字符污染浏览历史。
 */
function writeUserFiltersToUrl(filters: UserFilterState) {
  const url = new URL(window.location.href);
  const entries: Array<[key: string, value: string, defaultValue: string]> = [
    ["adminUserQuery", filters.userSearch, ""],
    ["adminUserPlan", filters.userPlan, "all"],
    ["adminUserStatus", filters.userStatus, "all"],
  ];
  for (const [key, value, defaultValue] of entries) {
    if (value === defaultValue) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState({}, "", url);
}

/**
 * 监听桌面断点，确保小屏时不渲染管理写操作。
 *
 * @returns 首次测量前为 null，之后为是否达到 1024px。
 * @sideEffects 注册并在卸载时清理 matchMedia 监听器。
 */
function useDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

/**
 * 管理控制台高保真原型入口。
 *
 * @param props.locale 当前设计预览路由的语言代码。
 * @returns 仅在桌面渲染的超级管理员控制台，本地交互不调用真实 action。
 * @sideEffects 同步主题偏好、URL 检查器状态和 History API。
 */
export function AdminPreview({ locale }: { locale: string }) {
  const isDesktop = useDesktopViewport();
  const [section, setSection] = useState<AdminSection>("overview");
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [theme, setTheme] = useState<PreviewTheme>("dark");
  const [range, setRange] = useState<AdminRange>("24h");
  const [customRange, setCustomRange] =
    useState<AdminCustomRange>(DEFAULT_CUSTOM_RANGE);
  const [comparePrevious, setComparePrevious] = useState(true);
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userTab, setUserTab] = useState<UserInspectorTab>("overview");
  const [userSearch, setUserSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creditOverrides, setCreditOverrides] = useState<
    Record<string, number>
  >({});
  const [operationDialog, setOperationDialog] =
    useState<OperationDialogState>(null);
  const [operationResult, setOperationResult] = useState<OperationResult>(null);
  const [users, setUsers] = useState<AdminUser[]>(adminUsers);
  const processedOperationIdsRef = useRef(new Set<string>());

  const selectedError =
    adminErrorGroups.find((group) => group.id === selectedErrorId) ?? null;
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;

  const filteredUsers = useMemo(() => {
    const normalizedSearch = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        user.name.toLowerCase().includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch) ||
        user.id.toLowerCase().includes(normalizedSearch);
      const matchesPlan = planFilter === "all" || user.plan === planFilter;
      const matchesStatus =
        statusFilter === "all" || user.status === statusFilter;
      return matchesSearch && matchesPlan && matchesStatus;
    });
  }, [planFilter, statusFilter, userSearch, users]);

  useEffect(() => {
    const applyLocation = () => {
      const nextState = readAdminUrlState();
      setSection(nextState.section);
      setSelectedErrorId(nextState.errorId);
      setSelectedUserId(nextState.userId);
      setUserTab(nextState.userTab);
      setUserSearch(nextState.userSearch);
      setPlanFilter(nextState.userPlan);
      setStatusFilter(nextState.userStatus);
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(PREVIEW_THEME_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (operationDialog) {
        setOperationDialog(null);
        return;
      }
      if (operationResult) {
        setOperationResult(null);
        return;
      }
      if (selectedErrorId || selectedUserId) {
        setSelectedErrorId(null);
        setSelectedUserId(null);
        writeAdminUrlState(
          {
            section,
            errorId: null,
            userId: null,
            userTab: "overview",
          },
          "replace"
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    operationDialog,
    operationResult,
    section,
    selectedErrorId,
    selectedUserId,
  ]);

  /**
   * 切换控制台一级页面并清理不再适用的检查器状态。
   *
   * @param nextSection 目标管理页面。
   */
  const navigateToSection = (nextSection: AdminSection) => {
    setSection(nextSection);
    setSelectedErrorId(null);
    setSelectedUserId(null);
    setUserTab("overview");
    writeAdminUrlState(
      {
        section: nextSection,
        errorId: null,
        userId: null,
        userTab: "overview",
      },
      "push"
    );
  };

  /**
   * 打开高频错误检查器并把对象写入 URL。
   *
   * @param errorId 高频错误聚合标识。
   */
  const openErrorInspector = (errorId: string) => {
    setSelectedErrorId(errorId);
    setSelectedUserId(null);
    writeAdminUrlState(
      {
        section: "overview",
        errorId,
        userId: null,
        userTab: "overview",
      },
      "push"
    );
  };

  /**
   * 打开用户检查器，可从错误样本跨页定位用户。
   *
   * @param userId 模拟用户标识。
   */
  const openUserInspector = (userId: string) => {
    setSection("users");
    setSelectedErrorId(null);
    setSelectedUserId(userId);
    setUserTab("overview");
    writeAdminUrlState(
      {
        section: "users",
        errorId: null,
        userId,
        userTab: "overview",
      },
      "push"
    );
  };

  /** 关闭当前资源检查器并清理 URL 对象状态。 */
  const closeInspector = () => {
    setSelectedErrorId(null);
    setSelectedUserId(null);
    writeAdminUrlState(
      {
        section,
        errorId: null,
        userId: null,
        userTab: "overview",
      },
      "replace"
    );
  };

  /**
   * 切换用户检查器标签并保留当前用户 URL。
   *
   * @param nextTab 目标标签。
   */
  const changeUserTab = (nextTab: UserInspectorTab) => {
    if (!selectedUserId) return;
    setUserTab(nextTab);
    writeAdminUrlState(
      {
        section: "users",
        errorId: null,
        userId: selectedUserId,
        userTab: nextTab,
      },
      "replace"
    );
  };

  /**
   * 更新用户筛选并把完整筛选状态写回 URL。
   *
   * @param patch 本次变化的一个或多个筛选字段。
   */
  const changeUserFilters = (patch: Partial<UserFilterState>) => {
    const nextFilters: UserFilterState = {
      userSearch: patch.userSearch ?? userSearch,
      userPlan: patch.userPlan ?? planFilter,
      userStatus: patch.userStatus ?? statusFilter,
    };
    setUserSearch(nextFilters.userSearch);
    setPlanFilter(nextFilters.userPlan);
    setStatusFilter(nextFilters.userStatus);
    writeUserFiltersToUrl(nextFilters);
  };

  /**
   * 切换主题并与创作原型共享浏览器偏好。
   *
   * @param nextTheme 用户选择的明暗主题。
   */
  const changeTheme = (nextTheme: PreviewTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem(PREVIEW_THEME_KEY, nextTheme);
  };

  /**
   * 完成本地积分调整并生成可验证的模拟结果。
   *
   * @param user 目标模拟用户。
   * @param amount 积分变更量，可正可负且不能为零。
   * @param reason 管理员填写的资源审计原因。
   * @param requestId 本次表单生成的稳定防重复标识。
   */
  const completeCreditAdjustment = (
    user: AdminUser,
    amount: number,
    reason: string,
    requestId: string
  ) => {
    const auditId = `audit_mock_${requestId.slice(-12)}`;
    if (processedOperationIdsRef.current.has(requestId)) {
      setOperationDialog(null);
      setOperationResult({
        title: copy(locale, "Duplicate ignored", "重复提交未执行"),
        description: copy(
          locale,
          "This request was already applied. The balance and ledger were not changed again.",
          "同一请求已完成，余额、流水与审计记录均未再次变更。"
        ),
        auditId,
        idempotencyId: `${requestId} · duplicate ignored`,
      });
      return;
    }
    processedOperationIdsRef.current.add(requestId);

    const currentCredits = creditOverrides[user.id] ?? user.credits;
    const nextCredits = Number((currentCredits + amount).toFixed(2));
    const occurredAt = new Date().toLocaleString(locale);
    setCreditOverrides((current) => ({
      ...current,
      [user.id]: nextCredits,
    }));
    setUsers((current) =>
      current.map((candidate) =>
        candidate.id === user.id
          ? {
              ...candidate,
              credits: nextCredits,
              creditsLedger: [
                {
                  id: `tx_mock_${requestId.slice(-10)}`,
                  occurredAt,
                  label: "管理员积分调整",
                  change: amount,
                  balance: nextCredits,
                  sourceRef: requestId,
                },
                ...candidate.creditsLedger,
              ],
              audits: [
                {
                  id: auditId,
                  occurredAt,
                  action: "管理员积分调整",
                  actor: "root@example.test",
                  reason,
                  result: "success",
                },
                ...candidate.audits,
              ],
            }
          : candidate
      )
    );
    setOperationDialog(null);
    setOperationResult({
      title: copy(locale, "Credits adjusted", "积分调整已完成"),
      description: copy(
        locale,
        "The local balance, mock ledger, and resource audit were updated. No database was changed.",
        "本地余额、模拟流水与资源审计已更新，未写入数据库。"
      ),
      auditId,
      idempotencyId: `${requestId} · applied once`,
    });
  };

  /**
   * 完成本地密码重设模拟，只回执撤销会话结果而不保留密码。
   *
   * @param user 目标模拟用户。
   * @param reason 管理员填写的资源审计原因。
   * @param requestId 本次表单生成的稳定防重复标识。
   */
  const completePasswordReset = (
    user: AdminUser,
    reason: string,
    requestId: string
  ) => {
    const auditId = `audit_mock_${requestId.slice(-12)}`;
    if (processedOperationIdsRef.current.has(requestId)) {
      setOperationDialog(null);
      setOperationResult({
        title: copy(locale, "Duplicate ignored", "重复提交未执行"),
        description: copy(
          locale,
          "This password reset was already applied. Sessions were not revoked a second time.",
          "同一密码重设请求已完成，会话未被重复撤销。"
        ),
        auditId,
        idempotencyId: `${requestId} · duplicate ignored`,
      });
      return;
    }
    processedOperationIdsRef.current.add(requestId);

    const occurredAt = new Date().toLocaleString(locale);
    setUsers((current) =>
      current.map((candidate) =>
        candidate.id === user.id
          ? {
              ...candidate,
              currentSessions: 0,
              audits: [
                {
                  id: auditId,
                  occurredAt,
                  action: "管理员重设正式密码并撤销会话",
                  actor: "root@example.test",
                  reason,
                  result: "success",
                },
                ...candidate.audits,
              ],
            }
          : candidate
      )
    );
    setOperationDialog(null);
    setOperationResult({
      title: copy(locale, "Password reset completed", "密码重设已完成"),
      description: copy(
        locale,
        `${user.currentSessions} active sessions were revoked and the resource audit was updated. The password was not retained or included in the receipt.`,
        `已撤销 ${user.currentSessions} 个现有会话并更新资源审计。密码未被保留，也未进入回执。`
      ),
      auditId,
      idempotencyId: `${requestId} · applied once`,
    });
  };

  if (isDesktop === null) {
    return <div className={styles.viewportProbe} aria-hidden="true" />;
  }

  if (!isDesktop) {
    return <DesktopRequired locale={locale} theme={theme} />;
  }

  const activeOperationUser = operationDialog
    ? (users.find((user) => user.id === operationDialog.userId) ?? null)
    : null;

  return (
    <div
      className={styles.root}
      data-theme={theme}
      data-navigation-collapsed={navigationCollapsed}
    >
      <AdminNavigation
        collapsed={navigationCollapsed}
        locale={locale}
        section={section}
        onCollapseChange={setNavigationCollapsed}
        onNavigate={navigateToSection}
      />

      <div className={styles.workspace}>
        <AdminHeader
          locale={locale}
          section={section}
          theme={theme}
          onThemeChange={changeTheme}
        />

        <main className={styles.main}>
          {section === "overview" && (
            <OverviewPage
              comparePrevious={comparePrevious}
              customRange={customRange}
              locale={locale}
              range={range}
              onComparePreviousChange={setComparePrevious}
              onCustomRangeApply={setCustomRange}
              onOpenError={openErrorInspector}
              onRangeChange={setRange}
            />
          )}

          {section === "users" && (
            <UserManagementPage
              creditOverrides={creditOverrides}
              locale={locale}
              planFilter={planFilter}
              search={userSearch}
              statusFilter={statusFilter}
              users={filteredUsers}
              onOpenUser={openUserInspector}
              onPlanFilterChange={(value) =>
                changeUserFilters({ userPlan: value })
              }
              onSearchChange={(value) =>
                changeUserFilters({ userSearch: value })
              }
              onStatusFilterChange={(value) =>
                changeUserFilters({ userStatus: value })
              }
            />
          )}

          {section === "backends" && <AdminToolsPreview view="backends" />}

          {section === "settings" && <AdminToolsPreview view="settings" />}

          {section !== "overview" &&
            section !== "users" &&
            section !== "backends" &&
            section !== "settings" && (
              <DeferredAdminPage locale={locale} section={section} />
            )}
        </main>
      </div>

      {selectedError && (
        <ErrorInspector
          error={selectedError}
          locale={locale}
          onClose={closeInspector}
          onOpenUser={openUserInspector}
        />
      )}

      {selectedUser && (
        <UserInspector
          creditBalance={
            creditOverrides[selectedUser.id] ?? selectedUser.credits
          }
          locale={locale}
          tab={userTab}
          user={selectedUser}
          onAdjustCredits={() =>
            setOperationDialog({
              kind: "credits",
              userId: selectedUser.id,
            })
          }
          onClose={closeInspector}
          onResetPassword={() =>
            setOperationDialog({
              kind: "password",
              userId: selectedUser.id,
            })
          }
          onTabChange={changeUserTab}
        />
      )}

      {operationDialog && activeOperationUser && (
        <RiskOperationDialog
          creditBalance={
            creditOverrides[activeOperationUser.id] ??
            activeOperationUser.credits
          }
          kind={operationDialog.kind}
          locale={locale}
          user={activeOperationUser}
          onCancel={() => setOperationDialog(null)}
          onConfirmCredits={(amount, reason, requestId) =>
            completeCreditAdjustment(
              activeOperationUser,
              amount,
              reason,
              requestId
            )
          }
          onConfirmPassword={(reason, requestId) =>
            completePasswordReset(activeOperationUser, reason, requestId)
          }
        />
      )}

      {operationResult && (
        <OperationResultDialog
          locale={locale}
          result={operationResult}
          onClose={() => setOperationResult(null)}
        />
      )}
    </div>
  );
}
