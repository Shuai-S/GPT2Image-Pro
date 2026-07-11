// 管理控制台原型的指标趋势、高频错误排行与失败样本检查器。

import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  DatabaseZap,
  ExternalLink,
  GitCompareArrows,
  type LucideIcon,
  Sparkles,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type AdminCustomRange,
  type AdminErrorGroup,
  type AdminMetricSnapshot,
  type AdminRange,
  type AdminTrendSeriesPoint,
  adminErrorGroups,
  adminMetricSnapshots,
  adminTrendData,
  buildAdminTrendSeries,
  buildCustomMetricSnapshot,
  buildCustomTrendData,
} from "./admin-mock-data";
import styles from "./admin-preview.module.css";
import {
  copy,
  formatCny,
  formatCompactNumber,
  StatusBadge,
} from "./admin-preview-shared";

const CHART_INITIAL_DIMENSION = { width: 480, height: 270 };

/**
 * 校验自定义范围的日期格式、顺序和最大跨度。
 *
 * @param range 用户正在编辑的日期闭区间。
 * @param locale 当前语言。
 * @returns null 表示可应用，否则返回面向管理员的错误文本。
 */
function validateCustomRange(range: AdminCustomRange, locale: string) {
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const end = Date.parse(`${range.end}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return copy(
      locale,
      "Select both start and end dates.",
      "请选择开始和结束日期。"
    );
  }
  if (start > end) {
    return copy(
      locale,
      "The start date cannot be after the end date.",
      "开始日期不能晚于结束日期。"
    );
  }
  if (end - start > 365 * 86_400_000) {
    return copy(
      locale,
      "The prototype supports a maximum range of 366 days.",
      "原型最多支持 366 天的自定义范围。"
    );
  }
  return null;
}

/**
 * 渲染管理总览的范围控制、指标、趋势与高频错误。
 *
 * @param props 总览筛选状态和错误检查器回调。
 * @returns 默认 24 小时且不包含待办队列的管理总览。
 */
export function OverviewPage({
  comparePrevious,
  customRange,
  locale,
  range,
  onComparePreviousChange,
  onCustomRangeApply,
  onOpenError,
  onRangeChange,
}: {
  comparePrevious: boolean;
  customRange: AdminCustomRange;
  locale: string;
  range: AdminRange;
  onComparePreviousChange: (value: boolean) => void;
  onCustomRangeApply: (range: AdminCustomRange) => void;
  onOpenError: (id: string) => void;
  onRangeChange: (range: AdminRange) => void;
}) {
  const [customDraft, setCustomDraft] = useState<AdminCustomRange>(customRange);
  const [customRangeNotice, setCustomRangeNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => setCustomDraft(customRange), [customRange]);

  const snapshot =
    range === "custom"
      ? buildCustomMetricSnapshot(customRange)
      : adminMetricSnapshots[range];
  const baseData =
    range === "custom"
      ? buildCustomTrendData(customRange)
      : adminTrendData[range];
  const data = buildAdminTrendSeries(baseData);

  /** 校验并应用本地自定义范围，使指标和图表立即重新计算。 */
  const applyCustomRange = () => {
    const validationError = validateCustomRange(customDraft, locale);
    if (validationError) {
      setCustomRangeNotice({ tone: "error", message: validationError });
      return;
    }
    onCustomRangeApply(customDraft);
    setCustomRangeNotice({
      tone: "success",
      message: copy(
        locale,
        `Applied ${customDraft.start} to ${customDraft.end}`,
        `已应用 ${customDraft.start} 至 ${customDraft.end}`
      ),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageIntroRow}>
        <div>
          <p className={styles.eyebrow}>
            {copy(locale, "Platform telemetry", "平台运行遥测")}
          </p>
          <p className={styles.pageDescription}>
            {copy(
              locale,
              "Aggregated platform, finance, user, and backend signals.",
              "聚合展示生成、资金、用户与后端运行信号，不包含待办队列。"
            )}
          </p>
        </div>
        <div className={styles.rangeToolbar}>
          <div className={styles.segmentedControl}>
            {(["24h", "7d", "30d", "custom"] as const).map((item) => (
              <button
                type="button"
                data-active={range === item}
                key={item}
                onClick={() => onRangeChange(item)}
              >
                {item === "custom" ? (
                  <>
                    <CalendarDays size={13} aria-hidden="true" />
                    {copy(locale, "Custom", "自定义")}
                  </>
                ) : (
                  item
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.compareToggle}
            role="switch"
            aria-checked={comparePrevious}
            data-active={comparePrevious}
            onClick={() => onComparePreviousChange(!comparePrevious)}
          >
            <GitCompareArrows size={14} aria-hidden="true" />
            {copy(locale, "Previous period", "对比上一周期")}
          </button>
        </div>
      </div>

      {range === "custom" && (
        <div className={styles.customRange}>
          <label>
            <span>{copy(locale, "Start", "开始")}</span>
            <input
              type="date"
              value={customDraft.start}
              onChange={(event) => {
                setCustomDraft((current) => ({
                  ...current,
                  start: event.target.value,
                }));
                setCustomRangeNotice(null);
              }}
            />
          </label>
          <ArrowRight size={14} aria-hidden="true" />
          <label>
            <span>{copy(locale, "End", "结束")}</span>
            <input
              type="date"
              value={customDraft.end}
              onChange={(event) => {
                setCustomDraft((current) => ({
                  ...current,
                  end: event.target.value,
                }));
                setCustomRangeNotice(null);
              }}
            />
          </label>
          <button type="button" onClick={applyCustomRange}>
            {copy(locale, "Apply range", "应用范围")}
          </button>
          {customRangeNotice && (
            <span
              className={styles.customRangeNotice}
              data-tone={customRangeNotice.tone}
              aria-live="polite"
            >
              {customRangeNotice.message}
            </span>
          )}
        </div>
      )}

      <MetricBand
        comparePrevious={comparePrevious}
        locale={locale}
        snapshot={snapshot}
      />
      <OverviewCharts
        comparePrevious={comparePrevious}
        data={data}
        locale={locale}
      />
      <ErrorRanking locale={locale} onOpenError={onOpenError} />
    </div>
  );
}

/**
 * 把六项核心指标组织为一条连续数据带，避免卡片墙。
 *
 * @param props 指标快照、语言与是否显示环比。
 * @returns 固定六列且由分隔线组织的数据带。
 */
function MetricBand({
  comparePrevious,
  locale,
  snapshot,
}: {
  comparePrevious: boolean;
  locale: string;
  snapshot: AdminMetricSnapshot;
}) {
  const metrics = [
    {
      label: copy(locale, "Generated images", "生成图片数"),
      value: formatCompactNumber(snapshot.generatedImages, locale),
      comparison: snapshot.comparison.generatedImages,
      inverse: false,
    },
    {
      label: copy(locale, "Platform success", "平台成功率"),
      value: `${snapshot.successRate.toFixed(2)}%`,
      comparison: snapshot.comparison.successRate,
      inverse: false,
    },
    {
      label: copy(locale, "P95 latency", "P95 耗时"),
      value: `${snapshot.p95Seconds.toFixed(1)}s`,
      comparison: snapshot.comparison.p95Seconds,
      inverse: true,
    },
    {
      label: copy(locale, "Payments", "支付金额"),
      value: formatCny(snapshot.paymentsCny, locale),
      comparison: snapshot.comparison.paymentsCny,
      inverse: false,
    },
    {
      label: copy(locale, "Credits consumed", "积分消耗"),
      value: formatCompactNumber(snapshot.creditsConsumed, locale),
      comparison: snapshot.comparison.creditsConsumed,
      inverse: false,
    },
    {
      label: copy(locale, "New users", "新增用户"),
      value: formatCompactNumber(snapshot.newUsers, locale),
      comparison: snapshot.comparison.newUsers,
      inverse: false,
    },
  ];

  return (
    <section className={styles.metricBand} aria-label="Key metrics">
      {metrics.map((metric) => {
        const direction =
          metric.comparison > 0
            ? "up"
            : metric.comparison < 0
              ? "down"
              : "flat";
        const isPositive = metric.inverse
          ? metric.comparison <= 0
          : metric.comparison >= 0;
        return (
          <div className={styles.metricItem} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {comparePrevious && (
              <small data-tone={isPositive ? "positive" : "negative"}>
                {direction === "up" ? (
                  <ArrowUp size={11} aria-hidden="true" />
                ) : direction === "down" ? (
                  <ArrowDown size={11} aria-hidden="true" />
                ) : (
                  <Activity size={11} aria-hidden="true" />
                )}
                {Math.abs(metric.comparison).toFixed(1)}%
              </small>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * 使用 Recharts 渲染四组非空真实图表，覆盖管理总览的趋势层级。
 *
 * @param props.data 当前范围的采样数据。
 * @param props.locale 当前语言。
 * @returns 生成、资金、用户和平台趋势图。
 */
function OverviewCharts({
  comparePrevious,
  data,
  locale,
}: {
  comparePrevious: boolean;
  data: AdminTrendSeriesPoint[];
  locale: string;
}) {
  const tooltipStyle = {
    background: "var(--admin-surface-raised)",
    border: "1px solid var(--admin-border-strong)",
    borderRadius: "6px",
    boxShadow: "var(--admin-shadow)",
    color: "var(--admin-text)",
    fontSize: "12px",
  };

  return (
    <div className={styles.chartGrid}>
      <section className={styles.chartSection}>
        <ChartHeading
          icon={Sparkles}
          title={copy(locale, "Generation trend", "生成趋势")}
          description={copy(
            locale,
            "Requests, completions, failure classes, and P95",
            "请求量、完成量、失败分类与 P95 耗时"
          )}
        />
        <div className={styles.chartCanvas}>
          <ResponsiveContainer
            height="100%"
            initialDimension={CHART_INITIAL_DIMENSION}
            minWidth={0}
            width="100%"
          >
            <LineChart data={data} margin={{ left: -14, right: 8, top: 12 }}>
              <CartesianGrid
                stroke="var(--admin-chart-grid)"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                stroke="var(--admin-text-faint)"
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="left"
              />
              <YAxis
                axisLine={false}
                orientation="right"
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={42}
                yAxisId="right"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="plainline" />
              <Line
                dataKey="requests"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Requests", "请求")}
                stroke="var(--admin-chart-info)"
                strokeWidth={2}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="completed"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Completed", "完成")}
                stroke="var(--admin-chart-success)"
                strokeWidth={2}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="failureUpstream"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Upstream failures", "上游失败")}
                stroke="var(--admin-chart-danger)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="failurePlatform"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Platform failures", "平台失败")}
                stroke="var(--admin-chart-warning)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="failureModeration"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Moderation stops", "审核停止")}
                stroke="var(--admin-text-muted)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="p95Seconds"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "P95 seconds", "P95 秒")}
                stroke="var(--admin-chart-warning)"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              {comparePrevious && (
                <Line
                  dataKey="previousRequests"
                  dot={false}
                  isAnimationActive={false}
                  name={copy(locale, "Previous requests", "上一周期请求")}
                  stroke="var(--admin-chart-previous)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  type="monotone"
                  yAxisId="left"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className={styles.chartSection}>
        <ChartHeading
          icon={WalletCards}
          title={copy(locale, "Finance trend", "资金趋势")}
          description={copy(
            locale,
            "Orders, fulfillment, issuance, use, refunds, and expiry",
            "订单、履约、积分发放、消费、退款与过期"
          )}
        />
        <div className={styles.chartCanvas}>
          <ResponsiveContainer
            height="100%"
            initialDimension={CHART_INITIAL_DIMENSION}
            minWidth={0}
            width="100%"
          >
            <LineChart data={data} margin={{ left: -14, right: -8, top: 12 }}>
              <CartesianGrid
                stroke="var(--admin-chart-grid)"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                stroke="var(--admin-text-faint)"
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="left"
              />
              <YAxis
                axisLine={false}
                orientation="right"
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="right"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="plainline" />
              <Line
                dataKey="paymentOrders"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Paid orders", "支付订单")}
                stroke="var(--admin-chart-warning)"
                strokeWidth={2}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="fulfilledOrders"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Fulfilled orders", "已履约订单")}
                stroke="var(--admin-chart-success)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="creditsIssued"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Credits issued", "积分发放")}
                stroke="var(--admin-chart-success)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="creditsConsumed"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Credits consumed", "积分消耗")}
                stroke="var(--admin-chart-info)"
                strokeWidth={2}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="creditsRefunded"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Credits refunded", "积分退款")}
                stroke="var(--admin-chart-warning)"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="creditsExpired"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Credits expired", "积分过期")}
                stroke="var(--admin-chart-danger)"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              {comparePrevious && (
                <Line
                  dataKey="previousPaymentOrders"
                  dot={false}
                  isAnimationActive={false}
                  name={copy(
                    locale,
                    "Previous paid orders",
                    "上一周期支付订单"
                  )}
                  stroke="var(--admin-chart-previous)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  type="monotone"
                  yAxisId="left"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className={styles.chartSection}>
        <ChartHeading
          icon={Users}
          title={copy(locale, "User trend", "用户趋势")}
          description={copy(
            locale,
            "New, active, paid users, and tickets",
            "新增、活跃、付费用户与工单量"
          )}
        />
        <div className={styles.chartCanvas}>
          <ResponsiveContainer
            height="100%"
            initialDimension={CHART_INITIAL_DIMENSION}
            minWidth={0}
            width="100%"
          >
            <LineChart data={data} margin={{ left: -14, right: -8, top: 12 }}>
              <CartesianGrid
                stroke="var(--admin-chart-grid)"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                stroke="var(--admin-text-faint)"
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="left"
              />
              <YAxis
                axisLine={false}
                orientation="right"
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="right"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="plainline" />
              <Line
                dataKey="newUsers"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "New users", "新增用户")}
                stroke="var(--admin-chart-info)"
                strokeWidth={2}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="activeUsers"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Active users", "活跃用户")}
                stroke="var(--admin-chart-success)"
                strokeWidth={2}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="paidUsers"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Paid users", "付费用户")}
                stroke="var(--admin-chart-warning)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="tickets"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Tickets", "工单量")}
                stroke="var(--admin-chart-danger)"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="left"
              />
              {comparePrevious && (
                <Line
                  dataKey="previousActiveUsers"
                  dot={false}
                  isAnimationActive={false}
                  name={copy(
                    locale,
                    "Previous active users",
                    "上一周期活跃用户"
                  )}
                  stroke="var(--admin-chart-previous)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  type="monotone"
                  yAxisId="right"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className={styles.chartSection}>
        <ChartHeading
          icon={DatabaseZap}
          title={copy(locale, "Platform trend", "平台趋势")}
          description={copy(
            locale,
            "Availability, switches, rate limits, and cooldowns",
            "后端可用率、调度切换、限流与冷却"
          )}
        />
        <div className={styles.chartCanvas}>
          <ResponsiveContainer
            height="100%"
            initialDimension={CHART_INITIAL_DIMENSION}
            minWidth={0}
            width="100%"
          >
            <LineChart data={data} margin={{ left: -14, right: -8, top: 12 }}>
              <CartesianGrid
                stroke="var(--admin-chart-grid)"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                stroke="var(--admin-text-faint)"
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={[98, 100]}
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="left"
              />
              <YAxis
                axisLine={false}
                orientation="right"
                stroke="var(--admin-text-faint)"
                tickLine={false}
                width={52}
                yAxisId="right"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="plainline" />
              <Line
                dataKey="availability"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Availability (%)", "可用率（%）")}
                stroke="var(--admin-chart-success)"
                strokeWidth={2}
                type="monotone"
                yAxisId="left"
              />
              <Line
                dataKey="schedulerSwitches"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Scheduler switches", "调度切换")}
                stroke="var(--admin-chart-warning)"
                strokeWidth={2}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="rateLimits"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Rate limits", "限流")}
                stroke="var(--admin-chart-danger)"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              <Line
                dataKey="cooldowns"
                dot={false}
                isAnimationActive={false}
                name={copy(locale, "Cooldowns", "冷却")}
                stroke="var(--admin-chart-info)"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                type="monotone"
                yAxisId="right"
              />
              {comparePrevious && (
                <Line
                  dataKey="previousAvailability"
                  dot={false}
                  isAnimationActive={false}
                  name={copy(locale, "Previous availability", "上一周期可用率")}
                  stroke="var(--admin-chart-previous)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  type="monotone"
                  yAxisId="left"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

/**
 * 渲染趋势区块标题，统一图标、标题与辅助说明。
 *
 * @param props.icon Lucide 图标组件。
 * @param props.title 图表标题。
 * @param props.description 图表范围说明。
 * @returns 紧凑图表标题行。
 */
function ChartHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.chartHeading}>
      <div>
        <Icon size={15} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      <span>{description}</span>
    </div>
  );
}

/**
 * 渲染按原因聚合的高频错误排行，不在主表暴露用户和提示词。
 *
 * @param props.locale 当前语言。
 * @param props.onOpenError 打开失败样本检查器的回调。
 * @returns 可进入错误检查器的紧凑表格。
 */
function ErrorRanking({
  locale,
  onOpenError,
}: {
  locale: string;
  onOpenError: (id: string) => void;
}) {
  return (
    <section className={styles.tableSection}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{copy(locale, "Frequent errors", "高频错误")}</h2>
          <p>
            {copy(
              locale,
              "Grouped by reason. Open an inspector for users and prompts.",
              "主表按原因聚合，具体用户、提示词和原始错误进入检查器。"
            )}
          </p>
        </div>
        <span className={styles.updatedAt}>
          <Activity size={13} aria-hidden="true" />
          {copy(locale, "Updated just now", "刚刚更新")}
        </span>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>{copy(locale, "Error reason", "错误原因")}</th>
              <th>{copy(locale, "Category", "分类")}</th>
              <th>{copy(locale, "Count", "次数")}</th>
              <th>{copy(locale, "Share", "占比")}</th>
              <th>{copy(locale, "Last seen", "最近发生")}</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {adminErrorGroups.map((error, index) => (
              <tr key={error.id}>
                <td className={styles.monoCell}>{index + 1}</td>
                <td>
                  <button
                    type="button"
                    className={styles.tablePrimaryButton}
                    onClick={() => onOpenError(error.id)}
                  >
                    {error.reason}
                  </button>
                </td>
                <td>
                  <StatusBadge tone={error.category}>
                    {error.category}
                  </StatusBadge>
                </td>
                <td className={styles.monoCell}>{error.count}</td>
                <td className={styles.monoCell}>{error.share.toFixed(1)}%</td>
                <td>{error.lastSeen}</td>
                <td className={styles.actionCell}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={copy(locale, "Inspect error", "检查错误")}
                    title={copy(locale, "Inspect error", "检查错误")}
                    onClick={() => onOpenError(error.id)}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * 展示具体失败样本、用户、提示词和原始错误上下文。
 *
 * @param props.error 已选中的聚合错误。
 * @param props.locale 当前语言。
 * @param props.onClose 关闭检查器。
 * @param props.onOpenUser 跨页定位相关用户。
 * @returns 固定宽度、可由 Escape 关闭的右侧检查器。
 */
export function ErrorInspector({
  error,
  locale,
  onClose,
  onOpenUser,
}: {
  error: AdminErrorGroup;
  locale: string;
  onClose: () => void;
  onOpenUser: (id: string) => void;
}) {
  return (
    <aside className={styles.inspector} aria-label="Error inspector">
      <div className={styles.inspectorHeader}>
        <div>
          <span className={styles.eyebrow}>
            {copy(locale, "Failure samples", "失败样本")}
          </span>
          <h2>{error.reason}</h2>
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
      <div className={styles.inspectorSummary}>
        <div>
          <span>{copy(locale, "Occurrences", "发生次数")}</span>
          <strong>{error.count}</strong>
        </div>
        <div>
          <span>{copy(locale, "Failure share", "失败占比")}</span>
          <strong>{error.share.toFixed(1)}%</strong>
        </div>
        <div>
          <span>{copy(locale, "Last seen", "最近发生")}</span>
          <strong>{error.lastSeen}</strong>
        </div>
      </div>
      <div className={styles.inspectorBody}>
        {error.samples.map((sample) => (
          <article className={styles.sampleBlock} key={sample.id}>
            <div className={styles.sampleHeader}>
              <span className={styles.monoCell}>{sample.id}</span>
              <span>{sample.occurredAt}</span>
            </div>
            <dl className={styles.detailList}>
              <div>
                <dt>{copy(locale, "User", "用户")}</dt>
                <dd>
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={() => onOpenUser(sample.userId)}
                  >
                    {sample.userEmail}
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                </dd>
              </div>
              <div>
                <dt>{copy(locale, "Model", "模型")}</dt>
                <dd>{sample.model}</dd>
              </div>
              <div>
                <dt>{copy(locale, "Channel", "通道")}</dt>
                <dd>{sample.channel}</dd>
              </div>
            </dl>
            <div className={styles.promptBlock}>
              <span>{copy(locale, "Full prompt", "完整提示词")}</span>
              <p>{sample.prompt}</p>
            </div>
            <div className={styles.errorBlock}>
              <span>{copy(locale, "Raw error", "原始错误")}</span>
              <code>{sample.rawError}</code>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
