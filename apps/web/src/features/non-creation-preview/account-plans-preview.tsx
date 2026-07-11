"use client";

// 账户中心套餐与积分原型。覆盖免费、付费、升级和积分包购买的本地模拟状态。

import { ArrowRight, Check, CheckCircle2, Coins } from "lucide-react";
import { useState } from "react";
import {
  creditPackages,
  type PlanId,
  type PlanTerm,
  planOptions,
} from "./account-mock-data";
import styles from "./account-preview.module.css";
import {
  DialogShell,
  formatCredits,
  PageHeading,
} from "./account-preview-shared";

/**
 * 从静态套餐列表中读取指定套餐。
 *
 * @param planId 套餐标识。
 * @returns 匹配套餐；静态数据缺少套餐时抛出可定位错误。
 * @sideEffects 无。
 */
export function getPlan(planId: PlanId) {
  const plan = planOptions.find((item) => item.id === planId);
  if (!plan) throw new Error(`原型套餐不存在：${planId}`);
  return plan;
}

/**
 * 渲染套餐、固定期限权益与总积分页面。
 *
 * @param props 当前套餐状态和本地购买入口。
 * @returns 免费与付费状态均可评审的账户默认页。
 * @sideEffects 模拟状态和购买按钮只通知父组件更新本地状态。
 */
export function PlanAndCreditsPage({
  currentPlanId,
  currentTerm,
  creditBalance,
  onAccountScenarioChange,
  onBuyCredits,
  onBuyPlan,
}: {
  currentPlanId: PlanId;
  currentTerm: PlanTerm;
  creditBalance: number;
  onAccountScenarioChange: (mode: "free" | "paid-month" | "paid-year") => void;
  onBuyCredits: () => void;
  onBuyPlan: () => void;
}) {
  const plan = getPlan(currentPlanId);
  const isFree = currentPlanId === "free";

  return (
    <section>
      <PageHeading
        eyebrow="资金与权益"
        title="套餐与积分"
        description="查看固定期限套餐与总积分，并在账户中心直接完成购买。"
        action={
          <fieldset className={styles.simulationSwitch}>
            <legend className={styles.srOnly}>账户模拟状态</legend>
            <span>模拟</span>
            <button
              type="button"
              data-active={isFree}
              onClick={() => onAccountScenarioChange("free")}
            >
              免费
            </button>
            <button
              type="button"
              data-active={!isFree && currentTerm === "month"}
              onClick={() => onAccountScenarioChange("paid-month")}
            >
              付费 1 月
            </button>
            <button
              type="button"
              data-active={!isFree && currentTerm === "year"}
              onClick={() => onAccountScenarioChange("paid-year")}
            >
              付费 1 年
            </button>
          </fieldset>
        }
      />

      <div className={styles.entitlementBand}>
        <div className={styles.planIdentity}>
          <span className={styles.sectionLabel}>当前套餐</span>
          <strong>{plan.name}</strong>
          <span className={styles.statusInline} data-tone="success">
            <Check size={12} aria-hidden="true" />
            {isFree ? "基础权益" : "权益生效中"}
          </span>
        </div>
        <div className={styles.entitlementMetric}>
          <span>权益期限</span>
          <strong>
            {isFree ? "长期有效" : currentTerm === "month" ? "1 个月" : "1 年"}
          </strong>
          <small>
            {isFree
              ? "无到期时间"
              : currentTerm === "month"
                ? "2026-07-01 至 2026-08-01"
                : "2026-07-01 至 2027-07-01"}
          </small>
        </div>
        <div className={styles.entitlementMetric}>
          <span>总积分</span>
          <strong>{formatCredits(creditBalance)}</strong>
          <small>以积分流水的当前余额为准</small>
        </div>
        <div className={styles.entitlementActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onBuyPlan}
          >
            {isFree
              ? "选择套餐"
              : currentPlanId === "enterprise"
                ? "查看套餐"
                : "升级套餐"}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onBuyCredits}
          >
            <Coins size={14} aria-hidden="true" />
            购买积分
          </button>
        </div>
      </div>

      <div className={styles.sectionDivider} />

      <div className={styles.twoColumnContent}>
        <section className={styles.plainSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionLabel}>当前权益</span>
              <h2>{plan.summary}</h2>
            </div>
          </div>
          <ul className={styles.featureList}>
            {plan.features.map((feature) => (
              <li key={feature}>
                <CheckCircle2 size={15} aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.plainSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionLabel}>期限说明</span>
              <h2>购买后立即生效</h2>
            </div>
          </div>
          <div className={styles.explanationList}>
            <p>所有付费套餐均为固定期限权益，不会自动续费。</p>
            <p>有效期内只能补差升级到更高档套餐，不能叠加同档套餐。</p>
            <p>套餐到期后可重新选择任意套餐，未购买时回到 Free。</p>
          </div>
        </section>
      </div>
    </section>
  );
}

/**
 * 渲染套餐购买选择器。
 *
 * @param props 当前套餐、期限及确认回调。
 * @returns 固定期限选择、升级限制和价格摘要对话框。
 * @sideEffects 仅提交本地选择；不可选套餐不会触发确认。
 */
export function PlanPurchaseDialog({
  currentPlanId,
  currentTerm,
  onClose,
  onConfirm,
}: {
  currentPlanId: PlanId;
  currentTerm: PlanTerm;
  onClose: () => void;
  onConfirm: (planId: PlanId, term: PlanTerm) => void;
}) {
  const [term, setTerm] = useState<PlanTerm>(currentTerm);
  const currentIndex = planOptions.findIndex(
    (plan) => plan.id === currentPlanId
  );
  const initialPlan =
    planOptions[Math.min(currentIndex + 1, planOptions.length - 1)];
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>(
    initialPlan?.id ?? "starter"
  );
  const selectedPlan = getPlan(selectedPlanId);
  const selectedIndex = planOptions.findIndex(
    (plan) => plan.id === selectedPlanId
  );
  const hasUpgrade = currentIndex < planOptions.length - 1;
  const canPurchase = selectedIndex > currentIndex;
  const price =
    term === "month" ? selectedPlan.monthlyPrice : selectedPlan.yearlyPrice;

  return (
    <DialogShell
      title={
        currentPlanId === "free"
          ? "选择固定期限套餐"
          : hasUpgrade
            ? "升级套餐"
            : "查看套餐"
      }
      description="这是本地购买模拟，不会发起支付或修改真实权益。"
      onClose={onClose}
      wide
    >
      <div className={styles.purchaseHeader}>
        <fieldset className={styles.segmentedControl}>
          <legend className={styles.srOnly}>套餐期限</legend>
          <button
            type="button"
            data-active={term === "month"}
            disabled={currentPlanId !== "free" && currentTerm !== "month"}
            onClick={() => setTerm("month")}
          >
            1 个月
          </button>
          <button
            type="button"
            data-active={term === "year"}
            disabled={currentPlanId !== "free" && currentTerm !== "year"}
            onClick={() => setTerm("year")}
          >
            1 年
          </button>
        </fieldset>
        {currentPlanId !== "free" && (
          <span className={styles.inlineHint}>升级必须与当前期限一致</span>
        )}
      </div>
      <div className={styles.planPicker}>
        {planOptions
          .filter((plan) => plan.id !== "free")
          .map((plan) => {
            const planIndex = planOptions.findIndex(
              (item) => item.id === plan.id
            );
            const disabled = planIndex <= currentIndex;
            const planPrice =
              term === "month" ? plan.monthlyPrice : plan.yearlyPrice;
            return (
              <button
                type="button"
                key={plan.id}
                data-active={selectedPlanId === plan.id}
                disabled={disabled}
                onClick={() => setSelectedPlanId(plan.id)}
              >
                <span>
                  <strong>{plan.name}</strong>
                  {plan.id === currentPlanId && <small>当前套餐</small>}
                </span>
                <span>{plan.summary}</span>
                <strong>¥{planPrice}</strong>
                <small>
                  {formatCredits(plan.credits)} 积分 ·{" "}
                  {term === "month" ? "1 个月" : "1 年"}
                </small>
              </button>
            );
          })}
      </div>
      <div className={styles.purchaseSummary}>
        <div>
          <span>
            {currentPlanId === "free" ? "应付金额" : "模拟补差后应付"}
          </span>
          <strong>
            ¥{currentPlanId === "free" ? price : Math.max(1, price - 23)}
          </strong>
          {currentPlanId !== "free" && <small>示例抵扣 ¥23.00</small>}
        </div>
        <div>
          <span>权益生效</span>
          <strong>支付成功后立即生效</strong>
          <small>原套餐剩余积分作废，新套餐发放完整积分</small>
        </div>
      </div>
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
          disabled={!canPurchase}
          onClick={() => onConfirm(selectedPlanId, term)}
        >
          完成模拟购买
        </button>
      </div>
    </DialogShell>
  );
}

/**
 * 渲染积分包购买选择器。
 *
 * @param props 当前余额、关闭和确认回调。
 * @returns 积分包选项与到账后余额摘要。
 * @sideEffects 确认时只通知父组件更新本地余额。
 */
export function CreditPurchaseDialog({
  balance,
  onClose,
  onConfirm,
}: {
  balance: number;
  onClose: () => void;
  onConfirm: (credits: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(creditPackages[1].id);
  const selected =
    creditPackages.find((item) => item.id === selectedId) ?? creditPackages[0];

  return (
    <DialogShell
      title="购买积分"
      description="积分包独立于固定期限套餐，本原型不会发起真实支付。"
      onClose={onClose}
    >
      <div className={styles.creditPicker}>
        {creditPackages.map((item) => (
          <button
            type="button"
            key={item.id}
            data-active={selected.id === item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <Coins size={16} aria-hidden="true" />
            <span>
              <strong>{formatCredits(item.credits)} 积分</strong>
              <small>一次性积分包</small>
            </span>
            <strong>¥{item.price}</strong>
          </button>
        ))}
      </div>
      <div className={styles.balancePreview}>
        <span>当前总积分</span>
        <strong>{formatCredits(balance)}</strong>
        <ArrowRight size={15} aria-hidden="true" />
        <span>模拟到账后</span>
        <strong>{formatCredits(balance + selected.credits)}</strong>
      </div>
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
          onClick={() => onConfirm(selected.credits)}
        >
          完成模拟购买 · ¥{selected.price}
        </button>
      </div>
    </DialogShell>
  );
}
