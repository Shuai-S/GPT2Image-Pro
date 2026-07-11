"use client";

// 账户中心邀请返利原型。展示隐私受限的奖励账本、暂停状态与全额转换流程。

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleHelp,
  Coins,
  Copy,
  Gift,
} from "lucide-react";
import { useState } from "react";
import { referralLedger, referralTransfers } from "./account-mock-data";
import styles from "./account-preview.module.css";
import {
  DataRegion,
  DialogShell,
  EmptyState,
  formatCredits,
  PageHeading,
  SegmentedTabs,
  StatusText,
} from "./account-preview-shared";

type ReferralScenario = "active" | "empty" | "paused";
type ReferralTab = "ledger" | "transfers";

/**
 * 渲染可信奖励账本的正常、空白与暂停场景。
 *
 * @param props 当前总积分和本地余额更新函数。
 * @returns 不含被邀请人身份与消费信息的邀请返利页。
 * @sideEffects 可复制模拟链接并在本地完成全额奖励转换。
 */
export function ReferralPage({
  creditBalance,
  converted,
  locale,
  onConvert,
}: {
  creditBalance: number;
  converted: boolean;
  locale: string;
  onConvert: (credits: number) => void;
}) {
  const [scenario, setScenario] = useState<ReferralScenario>("active");
  const [tab, setTab] = useState<ReferralTab>("ledger");
  const [copied, setCopied] = useState(false);
  const [conversionStep, setConversionStep] = useState<
    "idle" | "confirm" | "success"
  >("idle");
  const initialAvailableCredits = referralLedger.reduce(
    (total, row) => total + (row.status === "可转换" ? row.reward : 0),
    0
  );
  const initialFrozenCredits = referralLedger.reduce(
    (total, row) => total + (row.status === "冻结中" ? row.reward : 0),
    0
  );
  const initialConvertedCredits = referralLedger.reduce(
    (total, row) => total + (row.status === "已转换" ? row.reward : 0),
    0
  );
  const canceledCredits = referralLedger.reduce(
    (total, row) => total + (row.status === "已撤销" ? row.reward : 0),
    0
  );
  const availableCredits =
    scenario === "empty" || converted ? 0 : initialAvailableCredits;
  const frozenCredits = scenario === "empty" ? 0 : initialFrozenCredits;
  const convertedCredits =
    scenario === "empty"
      ? 0
      : initialConvertedCredits + (converted ? initialAvailableCredits : 0);
  const totalCredits =
    scenario === "empty"
      ? 0
      : initialAvailableCredits +
        initialFrozenCredits +
        initialConvertedCredits +
        canceledCredits;
  const inviteLink = `https://gpt2image.example/${locale}/sign-up?aff=ZS8N2K`;

  /**
   * 复制原型邀请链接并提供短暂结果反馈。
   *
   * @sideEffects 使用浏览器剪贴板；失败会记录警告并保留可见链接供手动复制。
   */
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch (error) {
      console.warn("原型邀请链接复制失败", error);
    }
  };

  /**
   * 完成全部可用奖励的本地转换模拟。
   *
   * @sideEffects 增加原型总积分并切换到成功结果，不调用真实财务操作。
   */
  const completeConversion = () => {
    if (converted || availableCredits <= 0) return;
    onConvert(availableCredits);
    setConversionStep("success");
  };

  return (
    <section>
      <PageHeading
        eyebrow="资金与权益"
        title="邀请返利"
        description="核对奖励状态，并将全部可用奖励手动转为站内积分。"
        action={
          <fieldset className={styles.simulationSwitch}>
            <legend className={styles.srOnly}>返利模拟状态</legend>
            <span>模拟</span>
            {(
              [
                ["active", "正常"],
                ["empty", "空记录"],
                ["paused", "已暂停"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                data-active={scenario === id}
                onClick={() => setScenario(id)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        }
      />

      {scenario === "paused" && (
        <div className={styles.warningBanner} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>邀请计划已暂停</strong>
            <p>不再产生新邀请和奖励，已有冻结奖励仍按原规则处理。</p>
          </div>
        </div>
      )}

      <div className={styles.referralLinkBand}>
        <div>
          <span className={styles.sectionLabel}>你的邀请链接</span>
          <strong>{inviteLink}</strong>
          <small>邀请码 ZS8N2K · 当前返佣比例 12%</small>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={scenario === "paused"}
          onClick={copyInviteLink}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied ? "已复制" : "复制链接"}
        </button>
      </div>

      <div className={styles.metricsStrip}>
        {[
          ["可用奖励", formatCredits(availableCredits), "可立即转换"],
          ["冻结奖励", formatCredits(frozenCredits), "等待冻结期结束"],
          ["已转换奖励", formatCredits(convertedCredits), "已进入积分流水"],
          [
            "累计奖励",
            formatCredits(totalCredits),
            `含已撤销 ${formatCredits(canceledCredits)}`,
          ],
        ].map(([label, value, detail]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>

      <div className={styles.referralCommandRow}>
        <p>可用奖励只支持一次全部转换。冻结奖励不会进入本次转换。</p>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={availableCredits <= 0}
          onClick={() => setConversionStep("confirm")}
        >
          <Coins size={14} aria-hidden="true" />
          全部转为积分
        </button>
      </div>

      {scenario === "empty" ? (
        <EmptyState
          icon={Gift}
          title="还没有奖励记录"
          description="分享邀请链接后，符合规则的奖励会按状态记录在这里。"
        />
      ) : (
        <>
          <SegmentedTabs
            value={tab}
            items={[
              { id: "ledger", label: "奖励流水" },
              { id: "transfers", label: "转换记录" },
            ]}
            onChange={setTab}
          />
          {tab === "ledger" ? (
            <ReferralLedger converted={converted} />
          ) : (
            <ReferralTransfers converted={converted} />
          )}
        </>
      )}

      <section className={styles.rulesBand}>
        <div>
          <CircleHelp size={16} aria-hidden="true" />
          <strong>奖励规则</strong>
        </div>
        <p>奖励按有效交易与当前比例计算，进入可用状态前会经过冻结期。</p>
        <p>退款或拒付会撤销关联奖励，扣回结果会保留在奖励流水中。</p>
        <p>奖励只能转换为站内积分，不支持部分转换或现金提现。</p>
      </section>

      {conversionStep !== "idle" && (
        <ReferralConversionDialog
          step={conversionStep}
          availableCredits={initialAvailableCredits}
          currentBalance={creditBalance}
          onClose={() => setConversionStep("idle")}
          onConfirm={completeConversion}
        />
      )}
    </section>
  );
}

/**
 * 渲染邀请奖励流水，并在模拟转换后插入可追踪记录。
 *
 * @param props.converted 是否已在当前会话完成奖励转换。
 * @returns 不含用户身份、订单号或消费金额的奖励事实表。
 * @sideEffects 无。
 */
function ReferralLedger({ converted }: { converted: boolean }) {
  const rows = converted
    ? referralLedger.map((row) =>
        row.status === "可转换"
          ? { ...row, status: "已转换" as const, note: "已转入积分流水" }
          : row
      )
    : referralLedger;

  return (
    <DataRegion
      title="奖励流水"
      description="仅展示奖励事实，不展示受邀用户信息"
    >
      <div className={styles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>记录</th>
              <th>产生时间</th>
              <th>比例</th>
              <th>状态</th>
              <th>解冻或转换时间</th>
              <th className={styles.numericCell}>奖励积分</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.id}</strong>
                  <small>{row.note}</small>
                </td>
                <td>{row.occurredAt}</td>
                <td>{row.rate}</td>
                <td>
                  <StatusText status={row.status} />
                </td>
                <td>{row.availableAt}</td>
                <td className={styles.numericCell}>
                  {formatCredits(row.reward)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.recordList}>
        {rows.map((row) => (
          <article className={styles.recordItem} key={row.id}>
            <div className={styles.recordItemHeader}>
              <strong>{formatCredits(row.reward)} 积分</strong>
              <StatusText status={row.status} />
            </div>
            <p>{row.note}</p>
            <dl>
              <div>
                <dt>比例</dt>
                <dd>{row.rate}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{row.availableAt}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </DataRegion>
  );
}

/**
 * 渲染奖励转换与积分流水的关联记录。
 *
 * @param props.converted 是否加入本次模拟转换结果。
 * @returns 可追踪幂等转换批次的双端列表。
 * @sideEffects 无。
 */
function ReferralTransfers({ converted }: { converted: boolean }) {
  const rows = converted
    ? [
        {
          id: "RFT-PREVIEW",
          occurredAt: "刚刚",
          credits: 286.5,
          status: "已完成" as const,
          ledgerReference: "模拟积分流水 CRD-PREVIEW",
        },
        ...referralTransfers,
      ]
    : referralTransfers;

  return (
    <DataRegion title="转换记录" description="转换批次与积分流水可相互追踪">
      <div className={styles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>转换记录</th>
              <th>完成时间</th>
              <th>状态</th>
              <th>关联流水</th>
              <th className={styles.numericCell}>到账积分</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.monoText}>{row.id}</td>
                <td>{row.occurredAt}</td>
                <td>
                  <StatusText status={row.status} />
                </td>
                <td>{row.ledgerReference}</td>
                <td className={styles.numericCell}>
                  +{formatCredits(row.credits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.recordList}>
        {rows.map((row) => (
          <article className={styles.recordItem} key={row.id}>
            <div className={styles.recordItemHeader}>
              <strong>+{formatCredits(row.credits)} 积分</strong>
              <StatusText status={row.status} />
            </div>
            <p>{row.ledgerReference}</p>
            <time>{row.occurredAt}</time>
          </article>
        ))}
      </div>
    </DataRegion>
  );
}

/**
 * 渲染奖励全部转换的确认或成功结果。
 *
 * @param props 转换步骤、金额和控制回调。
 * @returns 明确展示到账积分、转换后余额与模拟边界的对话框。
 * @sideEffects 确认回调只改变父组件本地状态。
 */
function ReferralConversionDialog({
  step,
  availableCredits,
  currentBalance,
  onClose,
  onConfirm,
}: {
  step: "confirm" | "success";
  availableCredits: number;
  currentBalance: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (step === "success") {
    return (
      <DialogShell
        title="转换已完成"
        description="原型已建立模拟转换记录与积分流水关联。"
        onClose={onClose}
      >
        <div className={styles.successResult}>
          <CheckCircle2 size={28} aria-hidden="true" />
          <strong>+{formatCredits(availableCredits)} 积分</strong>
          <span>模拟积分余额 {formatCredits(currentBalance)}</span>
          <small>幂等结果：首次完成 · RFT-PREVIEW</small>
        </div>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onClose}
          >
            查看账本
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="全部转为积分"
      description="冻结奖励不会参与，本次转换不支持输入部分金额。"
      onClose={onClose}
    >
      <dl className={styles.confirmationFacts}>
        <div>
          <dt>当前可用奖励</dt>
          <dd>{formatCredits(availableCredits)}</dd>
        </div>
        <div>
          <dt>预计到账积分</dt>
          <dd>+{formatCredits(availableCredits)}</dd>
        </div>
        <div>
          <dt>转换后总积分</dt>
          <dd>{formatCredits(currentBalance + availableCredits)}</dd>
        </div>
      </dl>
      <p className={styles.simulatedCallout}>
        这是高保真模拟，不会调用真实积分或返利操作。
      </p>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onConfirm}
        >
          确认模拟转换
        </button>
      </div>
    </DialogShell>
  );
}
