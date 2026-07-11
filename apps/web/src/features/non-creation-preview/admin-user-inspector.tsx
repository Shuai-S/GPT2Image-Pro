// 管理控制台原型的用户七标签检查器与资源级明细。

import { Coins, KeyRound, LockKeyhole, RotateCcwKey, X } from "lucide-react";
import type { AdminUser } from "./admin-mock-data";
import styles from "./admin-preview.module.css";
import {
  CompactTable,
  copy,
  DetailSection,
  formatCny,
  formatUserStatus,
  InspectorEmpty,
  StatusBadge,
  type UserInspectorTab,
} from "./admin-preview-shared";

const userInspectorTabs: Array<{
  id: UserInspectorTab;
  labelZh: string;
  labelEn: string;
}> = [
  { id: "overview", labelZh: "概览", labelEn: "Overview" },
  { id: "credits", labelZh: "积分", labelEn: "Credits" },
  { id: "orders", labelZh: "订单", labelEn: "Orders" },
  { id: "generations", labelZh: "生成", labelEn: "Generations" },
  { id: "api", labelZh: "API", labelEn: "API" },
  { id: "support", labelZh: "支持", labelEn: "Support" },
  { id: "audit", labelZh: "审计", labelEn: "Audit" },
];

/**
 * 渲染用户详情、七个标签和高风险操作入口。
 *
 * @param props 当前用户、标签、积分与操作回调。
 * @returns 右侧稳定宽度的用户资源检查器。
 */
export function UserInspector({
  creditBalance,
  locale,
  tab,
  user,
  onAdjustCredits,
  onClose,
  onResetPassword,
  onTabChange,
}: {
  creditBalance: number;
  locale: string;
  tab: UserInspectorTab;
  user: AdminUser;
  onAdjustCredits: () => void;
  onClose: () => void;
  onResetPassword: () => void;
  onTabChange: (tab: UserInspectorTab) => void;
}) {
  return (
    <aside className={styles.inspector} aria-label="User inspector">
      <div className={styles.inspectorHeader}>
        <div className={styles.inspectorUserHeading}>
          <div className={styles.userAvatar}>{user.name.slice(0, 1)}</div>
          <div>
            <span className={styles.eyebrow}>{user.id}</span>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={copy(locale, "Close inspector", "关闭检查器")}
          title={copy(locale, "Close inspector", "关闭检查器")}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.inspectorActions}>
        <button type="button" onClick={onAdjustCredits}>
          <Coins size={14} aria-hidden="true" />
          {copy(locale, "Adjust credits", "调整积分")}
        </button>
        <button type="button" onClick={onResetPassword}>
          <RotateCcwKey size={14} aria-hidden="true" />
          {copy(locale, "Reset password", "重设密码")}
        </button>
      </div>

      <div className={styles.inspectorTabs} role="tablist">
        {userInspectorTabs.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-active={tab === item.id}
            key={item.id}
            onClick={() => onTabChange(item.id)}
          >
            {copy(locale, item.labelEn, item.labelZh)}
          </button>
        ))}
      </div>

      <div className={styles.inspectorBody}>
        {tab === "overview" && (
          <UserOverviewTab
            creditBalance={creditBalance}
            locale={locale}
            user={user}
          />
        )}
        {tab === "credits" && (
          <UserCreditsTab
            creditBalance={creditBalance}
            locale={locale}
            user={user}
          />
        )}
        {tab === "orders" && <UserOrdersTab locale={locale} user={user} />}
        {tab === "generations" && (
          <UserGenerationsTab locale={locale} user={user} />
        )}
        {tab === "api" && <UserApiTab locale={locale} user={user} />}
        {tab === "support" && <UserSupportTab locale={locale} user={user} />}
        {tab === "audit" && <UserAuditTab locale={locale} user={user} />}
      </div>
    </aside>
  );
}

/**
 * 展示用户身份、状态、套餐、余额与活动摘要。
 *
 * @param props.user 当前模拟用户。
 * @param props.creditBalance 包含本地调整后的余额。
 * @param props.locale 当前语言。
 * @returns 用户检查器概览标签内容。
 */
function UserOverviewTab({
  creditBalance,
  locale,
  user,
}: {
  creditBalance: number;
  locale: string;
  user: AdminUser;
}) {
  return (
    <div className={styles.tabStack}>
      <div className={styles.statusStrip}>
        <StatusBadge tone={user.status}>
          {formatUserStatus(user.status, locale)}
        </StatusBadge>
        <span>{user.plan}</span>
        <strong>
          {creditBalance.toLocaleString(locale)}{" "}
          {copy(locale, "credits", "积分")}
        </strong>
      </div>
      <DetailSection title={copy(locale, "Account", "账户信息")}>
        <dl className={styles.detailList}>
          <div>
            <dt>{copy(locale, "User ID", "用户 ID")}</dt>
            <dd className={styles.monoCell}>{user.id}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Locale", "语言")}</dt>
            <dd>{user.locale}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Registered", "注册时间")}</dt>
            <dd>{user.registeredAt}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Last active", "最近活动")}</dt>
            <dd>{user.lastActiveAt}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Active sessions", "现有会话")}</dt>
            <dd>{user.currentSessions}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Generations", "累计生成")}</dt>
            <dd>{user.totalGenerations.toLocaleString(locale)}</dd>
          </div>
        </dl>
      </DetailSection>
      <div className={styles.contextNotice}>
        <LockKeyhole size={15} aria-hidden="true" />
        <p>
          <strong>{copy(locale, "Controlled operations", "受控操作")}</strong>
          <span>
            {copy(
              locale,
              "Status, plan, financial, and authentication changes require an impact preview and reason.",
              "状态、套餐、财务与认证变更必须预览影响、填写原因并生成审计编号。"
            )}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * 展示用户积分余额与账本片段。
 *
 * @param props.user 当前模拟用户。
 * @param props.creditBalance 本地模拟调整后的总余额。
 * @param props.locale 当前语言。
 * @returns 积分标签的账本表格。
 */
function UserCreditsTab({
  creditBalance,
  locale,
  user,
}: {
  creditBalance: number;
  locale: string;
  user: AdminUser;
}) {
  return (
    <div className={styles.tabStack}>
      <div className={styles.balanceBand}>
        <span>{copy(locale, "Total credits", "总积分")}</span>
        <strong>{creditBalance.toLocaleString(locale)}</strong>
        <small>{copy(locale, "Mock ledger context", "模拟账本上下文")}</small>
      </div>
      <DetailSection title={copy(locale, "Recent ledger", "最近流水")}>
        <CompactTable>
          <thead>
            <tr>
              <th>{copy(locale, "Time", "时间")}</th>
              <th>{copy(locale, "Type", "类型")}</th>
              <th>{copy(locale, "Change", "变更")}</th>
              <th>{copy(locale, "Balance", "余额")}</th>
            </tr>
          </thead>
          <tbody>
            {user.creditsLedger.map((item) => (
              <tr key={item.id}>
                <td>{item.occurredAt}</td>
                <td>
                  <span>{item.label}</span>
                  <small className={styles.sourceRef}>{item.sourceRef}</small>
                </td>
                <td
                  className={styles.monoCell}
                  data-tone={item.change >= 0 ? "positive" : "negative"}
                >
                  {item.change >= 0 ? "+" : ""}
                  {item.change}
                </td>
                <td className={styles.monoCell}>{item.balance}</td>
              </tr>
            ))}
          </tbody>
        </CompactTable>
      </DetailSection>
    </div>
  );
}

/**
 * 展示支付状态与履约状态分离的用户订单片段。
 *
 * @param props.user 当前模拟用户。
 * @param props.locale 当前语言。
 * @returns 只读订单表格或明确空状态。
 */
function UserOrdersTab({ locale, user }: { locale: string; user: AdminUser }) {
  if (user.orders.length === 0) {
    return <InspectorEmpty locale={locale} label="orders" />;
  }

  return (
    <DetailSection title={copy(locale, "Payment orders", "支付订单")}>
      <CompactTable>
        <thead>
          <tr>
            <th>{copy(locale, "Order", "订单")}</th>
            <th>{copy(locale, "Product", "商品")}</th>
            <th>{copy(locale, "Amount", "金额")}</th>
            <th>{copy(locale, "Payment / fulfillment", "支付 / 履约")}</th>
          </tr>
        </thead>
        <tbody>
          {user.orders.map((order) => (
            <tr key={order.id}>
              <td>
                <span className={styles.monoCell}>{order.id}</span>
                <small className={styles.sourceRef}>{order.occurredAt}</small>
              </td>
              <td>{order.product}</td>
              <td>{formatCny(order.amountCny, locale)}</td>
              <td>
                <StatusBadge tone={order.paymentStatus}>
                  {order.paymentStatus}
                </StatusBadge>
                <span className={styles.statusDivider}>/</span>
                <StatusBadge tone={order.fulfillmentStatus}>
                  {order.fulfillmentStatus}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </CompactTable>
    </DetailSection>
  );
}

/**
 * 展示用户最近生成、完整提示词、错误和实际扣费。
 *
 * @param props.user 当前模拟用户。
 * @param props.locale 当前语言。
 * @returns 生成上下文记录列表。
 */
function UserGenerationsTab({
  locale,
  user,
}: {
  locale: string;
  user: AdminUser;
}) {
  return (
    <DetailSection title={copy(locale, "Recent requests", "最近请求")}>
      <div className={styles.recordList}>
        {user.generations.map((generation) => (
          <article className={styles.recordItem} key={generation.id}>
            <div className={styles.recordHeader}>
              <span className={styles.monoCell}>{generation.id}</span>
              <StatusBadge tone={generation.status}>
                {generation.status}
              </StatusBadge>
            </div>
            <p>{generation.prompt}</p>
            <div className={styles.recordMeta}>
              <span>{generation.occurredAt}</span>
              <span>{generation.model}</span>
              <span>
                {generation.credits} {copy(locale, "credits", "积分")}
              </span>
            </div>
            {generation.error && (
              <code className={styles.inlineError}>{generation.error}</code>
            )}
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

/**
 * 展示用户 API 状态、配额与最近使用，永不回显密钥。
 *
 * @param props.user 当前模拟用户。
 * @param props.locale 当前语言。
 * @returns API 能力摘要与安全边界提示。
 */
function UserApiTab({ locale, user }: { locale: string; user: AdminUser }) {
  return (
    <div className={styles.tabStack}>
      <DetailSection title={copy(locale, "API access", "API 状态")}>
        <dl className={styles.detailList}>
          <div>
            <dt>{copy(locale, "Status", "状态")}</dt>
            <dd>
              <StatusBadge tone={user.api.status}>
                {user.api.status}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt>{copy(locale, "Active keys", "有效 Key")}</dt>
            <dd>{user.api.keyCount}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Quota", "配额")}</dt>
            <dd>{user.api.quota.toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Used", "已用")}</dt>
            <dd>{user.api.used.toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Last used", "最近使用")}</dt>
            <dd>{user.api.lastUsedAt ?? copy(locale, "Never", "从未")}</dd>
          </div>
        </dl>
      </DetailSection>
      <div className={styles.contextNotice}>
        <KeyRound size={15} aria-hidden="true" />
        <p>
          <strong>{copy(locale, "Secrets are hidden", "密钥不可回显")}</strong>
          <span>
            {copy(
              locale,
              "Only status and usage metadata are available in this inspector.",
              "检查器只展示状态与用量元数据，不展示任何密钥内容。"
            )}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * 展示与用户关联的工单和回复状态。
 *
 * @param props.user 当前模拟用户。
 * @param props.locale 当前语言。
 * @returns 支持工单摘要或明确空状态。
 */
function UserSupportTab({ locale, user }: { locale: string; user: AdminUser }) {
  if (user.tickets.length === 0) {
    return <InspectorEmpty locale={locale} label="tickets" />;
  }

  return (
    <DetailSection title={copy(locale, "Support tickets", "支持工单")}>
      <div className={styles.recordList}>
        {user.tickets.map((ticket) => (
          <article className={styles.recordItem} key={ticket.id}>
            <div className={styles.recordHeader}>
              <span className={styles.monoCell}>{ticket.id}</span>
              <StatusBadge tone={ticket.status}>{ticket.status}</StatusBadge>
            </div>
            <p>{ticket.subject}</p>
            <span className={styles.recordTime}>
              {copy(locale, "Last reply", "最近回复")} · {ticket.lastReplyAt}
            </span>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

/**
 * 展示与当前用户有关的资源级管理员操作片段。
 *
 * @param props.user 当前模拟用户。
 * @param props.locale 当前语言。
 * @returns 审计记录列表或明确空状态，不提供全局日志入口。
 */
function UserAuditTab({ locale, user }: { locale: string; user: AdminUser }) {
  if (user.audits.length === 0) {
    return <InspectorEmpty locale={locale} label="audit" />;
  }

  return (
    <DetailSection title={copy(locale, "Resource audit", "相关审计")}>
      <div className={styles.auditTimeline}>
        {user.audits.map((audit) => (
          <article key={audit.id}>
            <span className={styles.timelineDot} data-tone={audit.result} />
            <div>
              <div className={styles.auditHeading}>
                <strong>{audit.action}</strong>
                <StatusBadge tone={audit.result}>{audit.result}</StatusBadge>
              </div>
              <p>{audit.reason}</p>
              <small>
                {audit.actor} · {audit.occurredAt} · {audit.id}
              </small>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}
