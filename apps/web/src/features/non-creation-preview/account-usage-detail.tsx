"use client";

// 普通用户使用记录的只读详情检查器。仅展示当前用户可理解的生成上下文与结果。

import { AlertTriangle, ImageIcon, LoaderCircle, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef } from "react";
import type { GenerationUsageRow } from "./account-mock-data";
import sharedStyles from "./account-preview.module.css";
import { formatCredits, StatusText } from "./account-preview-shared";
import styles from "./account-usage-preview.module.css";

/**
 * 渲染生成结果或参考图的稳定缩略图网格。
 *
 * @param props.images 当前用户有权查看的站内图片路径。
 * @param props.label 图片组的无障碍名称。
 * @returns 非空图片网格；空数组返回 null。
 * @sideEffects 仅加载仓库内原型图片，不访问真实存储或第三方地址。
 */
function UsageImageGrid({
  images,
  label,
}: {
  images: string[];
  label: string;
}) {
  if (images.length === 0) return null;

  return (
    <div className={styles.detailImageGrid}>
      {images.map((src, index) => (
        <div className={styles.detailImage} key={src}>
          <Image
            src={src}
            alt={`${label} ${index + 1}`}
            width={640}
            height={480}
            sizes="(max-width: 680px) 46vw, 220px"
            unoptimized
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 渲染当前用户单条使用记录的只读检查器。
 *
 * @param props.record 已从当前用户记录集合中选出的记录。
 * @param props.onClose 关闭检查器并清理 URL 详情状态。
 * @returns 结果图、参考图、提示词、参数、积分及友好失败信息。
 * @sideEffects 挂载时聚焦检查器；按 Escape 时调用关闭回调。
 */
export function UsageRecordInspector({
  record,
  onClose,
}: {
  record: GenerationUsageRow;
  onClose: () => void;
}) {
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    inspectorRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.inspectorLayer}>
      <button
        type="button"
        className={styles.inspectorScrim}
        aria-label="关闭使用记录详情"
        onClick={onClose}
      />
      <aside
        ref={inspectorRef}
        className={styles.inspector}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-record-title"
        tabIndex={-1}
      >
        <header className={styles.inspectorHeader}>
          <div>
            <span>使用记录详情</span>
            <h2 id="usage-record-title">{record.id}</h2>
          </div>
          <button
            type="button"
            className={sharedStyles.iconButton}
            aria-label="关闭详情"
            title="关闭"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.inspectorBody}>
          <div className={styles.detailStatusLine}>
            <StatusText status={record.status} />
            <time>{record.occurredAt}</time>
          </div>

          {record.resultImages.length > 0 && (
            <section className={styles.detailSection}>
              <h3>
                <ImageIcon size={14} aria-hidden="true" />
                生成结果
              </h3>
              <UsageImageGrid images={record.resultImages} label="生成结果" />
            </section>
          )}

          {record.failureMessage && (
            <div className={styles.failureNotice} role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>本次生成未完成</strong>
                <p>{record.failureMessage}</p>
              </div>
            </div>
          )}

          {record.status === "处理中" && (
            <div className={styles.processingNotice} role="status">
              <LoaderCircle size={16} aria-hidden="true" />
              <div>
                <strong>任务仍在处理中</strong>
                <p>结果完成后会显示在此处，实际积分以任务终态记录为准。</p>
              </div>
            </div>
          )}

          <section className={styles.detailSection}>
            <h3>完整提示词</h3>
            <p className={styles.fullPrompt}>{record.prompt}</p>
          </section>

          {record.referenceImages.length > 0 && (
            <section className={styles.detailSection}>
              <h3>参考图</h3>
              <UsageImageGrid
                images={record.referenceImages}
                label="生成参考图"
              />
            </section>
          )}

          <section className={styles.detailSection}>
            <h3>生成参数</h3>
            <dl className={styles.detailFacts}>
              <div>
                <dt>模型</dt>
                <dd>{record.model}</dd>
              </div>
              <div>
                <dt>尺寸</dt>
                <dd>{record.size}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{record.source}</dd>
              </div>
              <div>
                <dt>请求张数</dt>
                <dd>{record.images}</dd>
              </div>
              <div>
                <dt>实际积分</dt>
                <dd>{formatCredits(record.credits)}</dd>
              </div>
              <div>
                <dt>完成时间</dt>
                <dd>{record.completedAt ?? "尚未完成"}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.detailSection}>
            <h3>记录标识</h3>
            <dl className={styles.identifierList}>
              <div>
                <dt>生成 ID</dt>
                <dd>{record.id}</dd>
              </div>
              <div>
                <dt>请求 ID</dt>
                <dd>{record.requestId}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
