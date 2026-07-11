// 管理控制台原型的用户筛选与紧凑定位表格。

import { ChevronRight, Search } from "lucide-react";
import type { AdminUser } from "./admin-mock-data";
import styles from "./admin-preview.module.css";
import { copy, formatUserStatus, StatusBadge } from "./admin-preview-shared";

/**
 * 渲染用户筛选工具栏与紧凑定位表格。
 *
 * @param props 用户列表、筛选状态、积分覆盖值与交互回调。
 * @returns 保持列宽稳定且不包含批量选择的用户管理页面。
 */
export function UserManagementPage({
  creditOverrides,
  locale,
  planFilter,
  search,
  statusFilter,
  users,
  onOpenUser,
  onPlanFilterChange,
  onSearchChange,
  onStatusFilterChange,
}: {
  creditOverrides: Record<string, number>;
  locale: string;
  planFilter: string;
  search: string;
  statusFilter: string;
  users: AdminUser[];
  onOpenUser: (id: string) => void;
  onPlanFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.pageIntroRow}>
        <div>
          <p className={styles.eyebrow}>
            {copy(locale, "User directory", "用户目录")}
          </p>
          <p className={styles.pageDescription}>
            {copy(
              locale,
              "Filter and locate a user, then investigate in the inspector.",
              "列表只负责筛选定位，资料与高风险操作集中在右侧检查器。"
            )}
          </p>
        </div>
        <span className={styles.resultCount}>
          {copy(locale, `${users.length} results`, `${users.length} 条结果`)}
        </span>
      </div>

      <div className={styles.filterBar}>
        <label className={styles.searchField}>
          <Search size={14} aria-hidden="true" />
          <span className={styles.visuallyHidden}>
            {copy(locale, "Search users", "搜索用户")}
          </span>
          <input
            value={search}
            placeholder={copy(
              locale,
              "Search email, name, or user ID",
              "搜索邮箱、名称或用户 ID"
            )}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <label className={styles.selectField}>
          <span>{copy(locale, "Plan", "套餐")}</span>
          <select
            value={planFilter}
            onChange={(event) => onPlanFilterChange(event.target.value)}
          >
            <option value="all">{copy(locale, "All plans", "全部套餐")}</option>
            <option value="Free">Free</option>
            <option value="Starter">Starter</option>
            <option value="Pro">Pro</option>
            <option value="Ultra">Ultra</option>
          </select>
        </label>
        <label className={styles.selectField}>
          <span>{copy(locale, "Status", "状态")}</span>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
          >
            <option value="all">
              {copy(locale, "All statuses", "全部状态")}
            </option>
            <option value="active">{copy(locale, "Active", "正常")}</option>
            <option value="frozen">{copy(locale, "Frozen", "冻结")}</option>
            <option value="disabled">{copy(locale, "Disabled", "停用")}</option>
          </select>
        </label>
      </div>

      <section className={styles.tableSection}>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>{copy(locale, "User", "用户")}</th>
                <th>{copy(locale, "Status", "状态")}</th>
                <th>{copy(locale, "Plan", "套餐")}</th>
                <th>{copy(locale, "Credits", "积分")}</th>
                <th>{copy(locale, "Generations", "生成次数")}</th>
                <th>{copy(locale, "Last active", "最近活动")}</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <button
                      type="button"
                      className={styles.userIdentityCell}
                      onClick={() => onOpenUser(user.id)}
                    >
                      <span>{user.name}</span>
                      <small>{user.email}</small>
                    </button>
                  </td>
                  <td>
                    <StatusBadge tone={user.status}>
                      {formatUserStatus(user.status, locale)}
                    </StatusBadge>
                  </td>
                  <td>{user.plan}</td>
                  <td className={styles.monoCell}>
                    {(creditOverrides[user.id] ?? user.credits).toLocaleString(
                      locale
                    )}
                  </td>
                  <td className={styles.monoCell}>
                    {user.totalGenerations.toLocaleString(locale)}
                  </td>
                  <td>{user.lastActiveAt}</td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={copy(locale, "Open user", "打开用户")}
                      title={copy(locale, "Open user", "打开用户")}
                      onClick={() => onOpenUser(user.id)}
                    >
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className={styles.emptyTable} colSpan={7}>
                    {copy(locale, "No matching users", "没有匹配的用户")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
