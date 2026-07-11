// 管理使用记录原型的只读详情检查器，展示媒体、渠道、积分和请求上下文。

import {
  CircleAlert,
  Coins,
  ImageIcon,
  Layers3,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  copy,
  formatCredits,
  formatDuration,
  formatUsageDate,
} from "./admin-usage-format";
import { StatusBadge } from "./admin-usage-list";
import type { AdminUsageRecord } from "./admin-usage-mock-data";
import styles from "./admin-usage-preview.module.css";

/**
 * 渲染完整提示词、错误、渠道、积分口径、图片与 ID 的右侧检查器。
 *
 * @param props.record 当前选中使用记录。
 * @param props.locale 当前语言。
 * @param props.onClose 关闭检查器。
 * @param props.onOpenUser 可选的用户详情跳转命令。
 * @returns 只读调查面板，不包含删除或批量命令。
 */
export function AdminUsageInspector({
  record,
  locale,
  onClose,
  onOpenUser,
}: {
  record: AdminUsageRecord;
  locale: string;
  onClose: () => void;
  onOpenUser?: (userId: string) => void;
}) {
  return (
    <aside className={styles.inspector} aria-label="Usage record inspector">
      <header className={styles.inspectorHeader}>
        <div>
          <span className={styles.eyebrow}>{record.id}</span>
          <h2>{copy(locale, "Generation record", "生成记录")}</h2>
          <div className={styles.inspectorUserLine}>
            <p>{record.user.email}</p>
            {onOpenUser && (
              <button
                type="button"
                className={styles.userCommand}
                onClick={() => onOpenUser(record.user.id)}
              >
                <UserRound size={12} aria-hidden="true" />
                {copy(locale, "View user", "查看用户")}
              </button>
            )}
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
      </header>

      <div className={styles.inspectorStatusBand}>
        <StatusBadge locale={locale} status={record.status} />
        <span>{record.model}</span>
        <span>{record.size}</span>
        <strong>
          {formatCredits(record.credits.total, locale)}{" "}
          {copy(locale, "credits", "积分")}
        </strong>
      </div>

      <div className={styles.inspectorBody}>
        <InspectorMedia record={record} locale={locale} />

        <InspectorSection title={copy(locale, "Full prompt", "完整提示词")}>
          <p className={styles.fullPrompt}>{record.prompt}</p>
          {record.revisedPrompt && (
            <div className={styles.revisedPrompt}>
              <span>{copy(locale, "Revised prompt", "修订提示词")}</span>
              <p>{record.revisedPrompt}</p>
            </div>
          )}
          {record.promptRepairNotice && (
            <p className={styles.repairNotice}>{record.promptRepairNotice}</p>
          )}
        </InspectorSection>

        {record.error && (
          <InspectorSection title={copy(locale, "Failure", "失败信息")}>
            <div className={styles.errorPanel}>
              <CircleAlert size={16} aria-hidden="true" />
              <div>
                <strong>{record.error.code}</strong>
                <p>{record.error.message}</p>
                <code>{record.error.raw}</code>
              </div>
            </div>
          </InspectorSection>
        )}

        <InspectorSection title={copy(locale, "Channel", "执行渠道")}>
          <dl className={styles.detailGrid}>
            <div>
              <dt>{copy(locale, "Provider", "渠道类型")}</dt>
              <dd>{record.channel.provider}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Detail", "渠道明细")}</dt>
              <dd>{record.channel.detail}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Group", "分组")}</dt>
              <dd>{record.channel.group ?? "-"}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Request kind", "请求类型")}</dt>
              <dd>{record.channel.requestKind}</dd>
            </div>
          </dl>
        </InspectorSection>

        <InspectorSection title={copy(locale, "Credit basis", "积分口径")}>
          <div className={styles.creditBreakdown}>
            <div>
              <span>{copy(locale, "Image", "图片")}</span>
              <strong>{formatCredits(record.credits.image, locale)}</strong>
            </div>
            <div>
              <span>{copy(locale, "Moderation", "审核")}</span>
              <strong>
                {formatCredits(record.credits.moderation, locale)}
              </strong>
            </div>
            <div>
              <span>{copy(locale, "Conversation", "对话")}</span>
              <strong>
                {formatCredits(record.credits.conversation, locale)}
              </strong>
            </div>
            <div>
              <span>{copy(locale, "Multiplier", "倍率")}</span>
              <strong>x{record.credits.multiplier}</strong>
            </div>
          </div>
          <p className={styles.ledgerTruth}>
            <Coins size={14} aria-hidden="true" />
            {copy(
              locale,
              "Financial truth comes from credits_transaction.",
              "账务真相来自 credits_transaction。"
            )}
          </p>
          <dl className={styles.idList}>
            <div>
              <dt>transaction_id</dt>
              <dd>{record.credits.transactionId}</dd>
            </div>
            <div>
              <dt>source_ref</dt>
              <dd>{record.credits.sourceRef}</dd>
            </div>
          </dl>
        </InspectorSection>

        <InspectorSection title={copy(locale, "Request context", "请求上下文")}>
          <dl className={styles.detailGrid}>
            <div>
              <dt>generation_id</dt>
              <dd>{record.id}</dd>
            </div>
            <div>
              <dt>request_id</dt>
              <dd>{record.requestId}</dd>
            </div>
            <div>
              <dt>user_id</dt>
              <dd>{record.user.id}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Source", "来源")}</dt>
              <dd>{record.source}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Created", "创建时间")}</dt>
              <dd>{formatUsageDate(record.createdAt, locale, true)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Completed", "完成时间")}</dt>
              <dd>
                {record.completedAt
                  ? formatUsageDate(record.completedAt, locale, true)
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>{copy(locale, "Duration", "耗时")}</dt>
              <dd>{formatDuration(record.durationMs, locale)}</dd>
            </div>
          </dl>
        </InspectorSection>
      </div>
    </aside>
  );
}

/**
 * 渲染结果图与引用图，并为失败或处理中状态提供明确占位。
 *
 * @param props.record 当前记录。
 * @param props.locale 当前语言。
 * @returns 结果和引用媒体带。
 */
function InspectorMedia({
  record,
  locale,
}: {
  record: AdminUsageRecord;
  locale: string;
}) {
  return (
    <section className={styles.mediaSection}>
      <div className={styles.mediaHeading}>
        <span>
          <ImageIcon size={14} aria-hidden="true" />
          {copy(locale, "Results", "生成结果")}
        </span>
        <span>
          <Layers3 size={14} aria-hidden="true" />
          {copy(locale, "References", "引用图")} {record.referenceImages.length}
        </span>
      </div>
      <div className={styles.mediaGrid}>
        {record.resultImages.map((src) => (
          <div className={styles.mediaItem} key={src}>
            <Image
              src={src}
              alt={copy(locale, "Generated result", "生成结果")}
              fill
              loading="eager"
              sizes="260px"
              className={styles.mediaImage}
            />
          </div>
        ))}
        {record.resultImages.length === 0 && (
          <div className={styles.mediaPlaceholder}>
            <ImageIcon size={20} aria-hidden="true" />
            {record.status === "pending"
              ? copy(locale, "Waiting for result", "等待生成结果")
              : copy(locale, "No result image", "没有结果图片")}
          </div>
        )}
        {record.referenceImages.map((src) => (
          <div className={styles.referenceItem} key={src}>
            <Image
              src={src}
              alt={copy(locale, "Reference image", "引用图")}
              fill
              loading="eager"
              sizes="100px"
              className={styles.mediaImage}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 统一检查器内部标题和内容间距。
 *
 * @param props.title 区块标题。
 * @param props.children 区块内容。
 * @returns 无装饰卡片嵌套的详情区块。
 */
function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.inspectorSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
