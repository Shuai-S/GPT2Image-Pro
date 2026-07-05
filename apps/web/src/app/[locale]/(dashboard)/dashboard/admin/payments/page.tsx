/**
 * 支付订单管理页。
 *
 * 使用方：管理员在 dashboard/admin/payments 查看本地支付订单、到账流水与订阅记录。
 * 关键依赖：admin.payments.getDashboard UOL 操作与管理员鉴权。
 */
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { formatCredits } from "@repo/shared/credits/format";
import type {
  EpayBusinessType,
  EpayOrderStatus,
} from "@repo/shared/payment/epay";
import {
  formatDateInTimeZone,
  parseDateInputInTimeZone,
} from "@repo/shared/time-zone";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { invokeOperation } from "@repo/shared/uol";
import "@repo/shared/uol/operations";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  CreditCard,
  ReceiptText,
  Search,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type * as React from "react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const LEDGER_LIMIT = 40;
const SUBSCRIPTION_LIMIT = 30;
const LOCAL_ORDER_STATUSES = [
  "pending",
  "processing",
  "success",
  "failed",
] as const satisfies readonly EpayOrderStatus[];
const LOCAL_BUSINESS_TYPES = [
  "credit_purchase",
  "subscription",
] as const satisfies readonly EpayBusinessType[];
const PROVIDERS = ["epay", "alipay", "creem"] as const;

type LocalOrderStatusFilter = "all" | EpayOrderStatus;
type BusinessTypeFilter = "all" | EpayBusinessType;
type ProviderFilter = "all" | (typeof PROVIDERS)[number];
type PaymentSearchParams = {
  q?: string;
  status?: string;
  type?: string;
  provider?: string;
  from?: string;
  to?: string;
  page?: string;
};

type PaymentFilters = {
  q: string;
  status: LocalOrderStatusFilter;
  type: BusinessTypeFilter;
  provider: ProviderFilter;
  from: Date | null;
  to: Date | null;
  fromInput: string;
  toInput: string;
  page: number;
};

type LocalPaymentProvider = "epay" | "alipay";
type FulfillmentStatus =
  | "not_paid"
  | "processing"
  | "fulfilled"
  | "missing"
  | "failed";
type LocalOrderBase = {
  outTradeNo: string;
  userId: string;
  businessType: string;
  amount: number;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  userEmail: string | null;
  userName: string | null;
};
type LocalOrderView = LocalOrderBase & {
  provider: LocalPaymentProvider | null;
  sourceRef: string | null;
  batch: {
    id: string;
    sourceType: string;
    amount: number;
    remaining: number;
    status: string;
    issuedAt: Date;
  } | null;
  transaction: {
    id: string;
    type: string;
    amount: number;
    createdAt: Date;
  } | null;
  fulfillmentStatus: FulfillmentStatus;
};
type BillingLedgerRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  type: string;
  amount: number;
  sourceRef: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};
type SubscriptionRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  subscriptionId: string;
  priceId: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: Date;
};
type LocalStatusSummary = {
  total: number;
  amount: number;
  success: number;
  pending: number;
  processing: number;
  failed: number;
};
type AdminPaymentsDashboardResult = {
  localOrders: {
    orders: LocalOrderView[];
    total: number;
    summary: LocalStatusSummary;
  };
  ledgerRows: BillingLedgerRow[];
  subscriptionRows: SubscriptionRow[];
};

interface AdminPaymentsPageProps {
  searchParams: Promise<PaymentSearchParams>;
}

/**
 * 生成支付管理页 metadata。
 *
 * @returns 带运行时品牌名的页面标题与描述。
 * @sideEffects 读取 system_setting 表中的品牌配置。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `Payment Admin | ${branding.name}`,
    description: `Review local payment orders and fulfillment ledger in ${branding.name}`,
  };
}

/**
 * 支付订单管理页。
 *
 * @param props - Next.js 路由传入的查询参数 Promise。
 * @returns 管理员可筛选的本地订单、到账流水和订阅记录。
 * @sideEffects 未登录或无管理员权限时重定向；读取支付与积分账本数据。
 */
export default async function AdminPaymentsPage({
  searchParams,
}: AdminPaymentsPageProps) {
  const [session, locale, timeZone, rawSearchParams] = await Promise.all([
    getServerSession(),
    getLocale(),
    getAppTimeZone(),
    searchParams,
  ]);

  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    redirect(`/${locale}/dashboard`);
  }

  const filters = normalizeFilters(rawSearchParams, timeZone);
  const principal = { type: "user" as const, userId: session.user.id, role };
  const dashboard = await invokeOperation<AdminPaymentsDashboardResult>(
    "admin.payments.getDashboard",
    {
      q: filters.q,
      status: filters.status,
      type: filters.type,
      provider: filters.provider,
      from: filters.from,
      to: filters.to,
      page: filters.page,
      pageSize: PAGE_SIZE,
      ledgerLimit: LEDGER_LIMIT,
      subscriptionLimit: SUBSCRIPTION_LIMIT,
    },
    principal
  );
  const localResult = dashboard.localOrders;
  const ledgerRows = dashboard.ledgerRows;
  const subscriptionRows = dashboard.subscriptionRows;
  const totalPages = Math.max(1, Math.ceil(localResult.total / PAGE_SIZE));
  const currentPage = Math.min(filters.page, totalPages);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy(locale, "Payment Orders", "支付订单")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {copy(
              locale,
              "Review local checkout orders, payment status, fulfillment batches, and subscription records in one place.",
              "集中查看本地支付订单、支付状态、到账批次与订阅记录，方便排查用户是否完成支付和是否到账。"
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${locale}/dashboard/admin/users`}>
            {copy(locale, "Open User Management", "打开用户管理")}
          </Link>
        </Button>
      </div>

      <PaymentStatsCards summary={localResult.summary} locale={locale} />
      <PaymentFiltersForm filters={filters} locale={locale} />

      <LocalOrdersTable
        currentPage={currentPage}
        filters={filters}
        locale={locale}
        orders={localResult.orders}
        timeZone={timeZone}
        total={localResult.total}
        totalPages={totalPages}
      />

      <BillingLedgerTable
        ledgerRows={ledgerRows}
        locale={locale}
        timeZone={timeZone}
      />

      <SubscriptionsTable
        locale={locale}
        subscriptionRows={subscriptionRows}
        timeZone={timeZone}
      />
    </div>
  );
}

/**
 * 渲染本地订单聚合卡片。
 *
 * @param props - 聚合统计与语言。
 * @returns 支付状态统计卡片。
 */
function PaymentStatsCards({
  summary,
  locale,
}: {
  summary: LocalStatusSummary;
  locale: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-5">
      <MetricCard
        icon={<ReceiptText className="h-4 w-4 text-muted-foreground" />}
        label={copy(locale, "Local Orders", "本地订单")}
        value={formatNumber(summary.total, locale)}
      />
      <MetricCard
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        label={copy(locale, "Success", "已完成")}
        value={formatNumber(summary.success, locale)}
      />
      <MetricCard
        icon={<Clock3 className="h-4 w-4 text-amber-600" />}
        label={copy(locale, "Pending", "待支付")}
        value={formatNumber(summary.pending, locale)}
      />
      <MetricCard
        icon={<AlertTriangle className="h-4 w-4 text-sky-600" />}
        label={copy(locale, "Processing", "履约中")}
        value={formatNumber(summary.processing, locale)}
      />
      <MetricCard
        icon={<Coins className="h-4 w-4 text-muted-foreground" />}
        label={copy(locale, "Amount", "订单金额")}
        value={formatMoney(summary.amount, locale)}
      />
    </div>
  );
}

/**
 * 渲染单个统计卡。
 *
 * @param props - 图标、标题与数值。
 * @returns 统计卡片。
 */
function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

/**
 * 渲染支付筛选表单。
 *
 * @param props - 当前筛选条件与语言。
 * @returns GET 表单。
 */
function PaymentFiltersForm({
  filters,
  locale,
}: {
  filters: PaymentFilters;
  locale: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          {copy(locale, "Filters", "筛选")}
        </CardTitle>
        <CardDescription>
          {copy(
            locale,
            "Search by user email, user ID, order number, sourceRef, or subscription ID.",
            "可按用户邮箱、用户 ID、订单号、sourceRef 或订阅 ID 搜索。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_150px_150px_150px_150px_150px_auto] md:items-end">
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "Keyword", "关键词")}
            </span>
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={copy(
                locale,
                "email / user ID / order",
                "邮箱 / 用户 ID / 订单号"
              )}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "Status", "订单状态")}
            </span>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="all">{copy(locale, "All", "全部")}</option>
              {LOCAL_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getLocalOrderStatusLabel(status, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "Type", "业务类型")}
            </span>
            <select
              name="type"
              defaultValue={filters.type}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="all">{copy(locale, "All", "全部")}</option>
              {LOCAL_BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getBusinessTypeLabel(type, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "Provider", "支付通道")}
            </span>
            <select
              name="provider"
              defaultValue={filters.provider}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="all">{copy(locale, "All", "全部")}</option>
              <option value="creem">Creem</option>
              <option value="epay">{copy(locale, "Epay", "易支付")}</option>
              <option value="alipay">{copy(locale, "Alipay", "支付宝")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "From", "开始日期")}
            </span>
            <input
              type="date"
              name="from"
              defaultValue={filters.fromInput}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {copy(locale, "To", "结束日期")}
            </span>
            <input
              type="date"
              name="to"
              defaultValue={filters.toInput}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
          <Button type="submit" className="md:w-fit">
            {copy(locale, "Filter", "筛选")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * 渲染本地订单表。
 *
 * @param props - 订单数据、分页与语言。
 * @returns 本地订单表格。
 */
function LocalOrdersTable({
  orders,
  total,
  currentPage,
  totalPages,
  filters,
  locale,
  timeZone,
}: {
  orders: LocalOrderView[];
  total: number;
  currentPage: number;
  totalPages: number;
  filters: PaymentFilters;
  locale: string;
  timeZone: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          {copy(locale, "Local Checkout Orders", "本地支付订单")}
        </CardTitle>
        <CardDescription>
          {copy(
            locale,
            "Epay and Alipay orders have local status. Fulfillment is verified against credits_batch and credits_transaction.",
            "易支付与支付宝订单有本地状态；到账以 credits_batch 与 credits_transaction 的匹配记录为准。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div>
            {copy(locale, "Total", "共")} {formatNumber(total, locale)}{" "}
            {copy(locale, "orders", "笔订单")}
          </div>
          <div>
            {copy(locale, "Page", "第")} {formatNumber(currentPage, locale)} /{" "}
            {formatNumber(totalPages, locale)} {copy(locale, "page", "页")}
          </div>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            text={copy(
              locale,
              "No local payment orders match the filters.",
              "没有匹配筛选条件的本地支付订单。"
            )}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-[170px] px-3 py-2 font-medium">
                    {copy(locale, "Created", "创建时间")}
                  </th>
                  <th className="w-[220px] px-3 py-2 font-medium">
                    {copy(locale, "Order", "订单")}
                  </th>
                  <th className="w-[230px] px-3 py-2 font-medium">
                    {copy(locale, "User", "用户")}
                  </th>
                  <th className="w-[120px] px-3 py-2 font-medium">
                    {copy(locale, "Amount", "金额")}
                  </th>
                  <th className="w-[130px] px-3 py-2 font-medium">
                    {copy(locale, "Payment", "支付")}
                  </th>
                  <th className="w-[150px] px-3 py-2 font-medium">
                    {copy(locale, "Fulfillment", "到账")}
                  </th>
                  <th className="px-3 py-2 font-medium">sourceRef</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((order) => (
                  <tr key={order.outTradeNo} className="align-top">
                    <td className="px-3 py-3 text-muted-foreground">
                      <div>
                        {formatDateTime(order.createdAt, locale, timeZone)}
                      </div>
                      <div className="mt-1 text-xs">
                        {copy(locale, "Updated", "更新")}{" "}
                        {formatDateTime(order.updatedAt, locale, timeZone)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{order.outTradeNo}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {getProviderLabel(order.provider, locale)}
                        </Badge>
                        <Badge variant="secondary">
                          {getBusinessTypeLabel(order.businessType, locale)}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">
                        {order.userEmail ?? order.userName ?? order.userId}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {order.userId}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium">
                      {formatMoney(order.amount, locale)}
                    </td>
                    <td className="px-3 py-3">
                      <LocalOrderStatusBadge
                        locale={locale}
                        status={order.status}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <FulfillmentBadge
                        locale={locale}
                        status={order.fulfillmentStatus}
                      />
                      {order.batch || order.transaction ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {order.batch
                            ? `${copy(locale, "Batch", "批次")} ${shortId(
                                order.batch.id
                              )}`
                            : `${copy(locale, "Transaction", "流水")} ${shortId(
                                order.transaction?.id
                              )}`}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="break-all font-mono text-xs">
                        {order.sourceRef ?? "-"}
                      </div>
                      {order.transaction ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {order.transaction.type} ·{" "}
                          {formatCredits(order.transaction.amount)} credits
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={currentPage}
          filters={filters}
          locale={locale}
          totalPages={totalPages}
        />
      </CardContent>
    </Card>
  );
}

/**
 * 渲染最近到账流水表。
 *
 * @param props - 流水数据与语言。
 * @returns 到账流水表格。
 */
function BillingLedgerTable({
  ledgerRows,
  locale,
  timeZone,
}: {
  ledgerRows: BillingLedgerRow[];
  locale: string;
  timeZone: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {copy(locale, "Recent Fulfillment Ledger", "最近到账流水")}
        </CardTitle>
        <CardDescription>
          {copy(
            locale,
            "These rows are the financial truth for credited purchases and subscription grants, including Creem webhooks.",
            "这些记录是积分购买与订阅发放的财务真相，也覆盖 Creem webhook 到账记录。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ledgerRows.length === 0 ? (
          <EmptyState
            text={copy(
              locale,
              "No fulfillment ledger rows match the filters.",
              "没有匹配筛选条件的到账流水。"
            )}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-[170px] px-3 py-2 font-medium">
                    {copy(locale, "Time", "时间")}
                  </th>
                  <th className="w-[130px] px-3 py-2 font-medium">
                    {copy(locale, "Provider", "通道")}
                  </th>
                  <th className="w-[220px] px-3 py-2 font-medium">
                    {copy(locale, "User", "用户")}
                  </th>
                  <th className="w-[130px] px-3 py-2 font-medium">
                    {copy(locale, "Credits", "积分")}
                  </th>
                  <th className="px-3 py-2 font-medium">sourceRef</th>
                  <th className="w-[220px] px-3 py-2 font-medium">
                    {copy(locale, "Description", "说明")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ledgerRows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDateTime(row.createdAt, locale, timeZone)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline">
                        {getProviderLabel(inferLedgerProvider(row), locale)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">
                        {row.userEmail ?? row.userName ?? row.userId}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {row.userId}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">
                        {formatCredits(row.amount)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.type}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="break-all font-mono text-xs">
                        {row.sourceRef ?? "-"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getReceiptReference(row.metadata)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.description ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 渲染最近订阅记录。
 *
 * @param props - 订阅数据与语言。
 * @returns 订阅记录表格。
 */
function SubscriptionsTable({
  subscriptionRows,
  locale,
  timeZone,
}: {
  subscriptionRows: SubscriptionRow[];
  locale: string;
  timeZone: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4" />
          {copy(locale, "Recent Subscriptions", "最近订阅记录")}
        </CardTitle>
        <CardDescription>
          {copy(
            locale,
            "Subscription status shows the user's current entitlement record. Credits for each paid cycle are verified in the ledger above.",
            "订阅状态展示用户当前权益记录；每个付费周期的积分到账请以上方流水为准。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subscriptionRows.length === 0 ? (
          <EmptyState
            text={copy(
              locale,
              "No subscription records match the filters.",
              "没有匹配筛选条件的订阅记录。"
            )}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-[170px] px-3 py-2 font-medium">
                    {copy(locale, "Updated", "更新时间")}
                  </th>
                  <th className="w-[220px] px-3 py-2 font-medium">
                    {copy(locale, "User", "用户")}
                  </th>
                  <th className="w-[150px] px-3 py-2 font-medium">
                    {copy(locale, "Status", "状态")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {copy(locale, "Subscription", "订阅")}
                  </th>
                  <th className="w-[230px] px-3 py-2 font-medium">
                    {copy(locale, "Period", "周期")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {subscriptionRows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDateTime(row.updatedAt, locale, timeZone)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">
                        {row.userEmail ?? row.userName ?? row.userId}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {row.userId}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <SubscriptionStatusBadge
                        locale={locale}
                        status={row.status}
                      />
                      {row.cancelAtPeriodEnd ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {copy(locale, "Cancel at period end", "到期取消")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="break-all font-mono text-xs">
                        {row.subscriptionId}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {getProviderLabel(
                            inferSubscriptionProvider(row.subscriptionId),
                            locale
                          )}
                        </Badge>
                        <Badge variant="secondary">{row.priceId}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <div>
                        {formatDateTime(
                          row.currentPeriodStart,
                          locale,
                          timeZone
                        ) || "-"}
                      </div>
                      <div className="mt-1">
                        {formatDateTime(
                          row.currentPeriodEnd,
                          locale,
                          timeZone
                        ) || "-"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 渲染分页按钮。
 *
 * @param props - 当前页、总页数、筛选条件与语言。
 * @returns 分页控件。
 */
function Pagination({
  currentPage,
  totalPages,
  filters,
  locale,
}: {
  currentPage: number;
  totalPages: number;
  filters: PaymentFilters;
  locale: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        asChild
        variant="outline"
        size="sm"
        aria-disabled={currentPage <= 1}
        className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
      >
        <Link href={buildPageHref(filters, currentPage - 1)}>
          {copy(locale, "Previous", "上一页")}
        </Link>
      </Button>
      <Button
        asChild
        variant="outline"
        size="sm"
        aria-disabled={currentPage >= totalPages}
        className={
          currentPage >= totalPages ? "pointer-events-none opacity-50" : ""
        }
      >
        <Link href={buildPageHref(filters, currentPage + 1)}>
          {copy(locale, "Next", "下一页")}
        </Link>
      </Button>
    </div>
  );
}

/**
 * 渲染空状态。
 *
 * @param props - 展示文案。
 * @returns 空状态区域。
 */
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

/**
 * 渲染本地支付状态徽标。
 *
 * @param props - 状态与语言。
 * @returns 状态徽标。
 */
function LocalOrderStatusBadge({
  status,
  locale,
}: {
  status: string;
  locale: string;
}) {
  if (status === "success") {
    return (
      <Badge className="bg-emerald-600 text-white">
        <CheckCircle2 className="h-3 w-3" />
        {getLocalOrderStatusLabel(status, locale)}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3" />
        {getLocalOrderStatusLabel(status, locale)}
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary">
        <Clock3 className="h-3 w-3" />
        {getLocalOrderStatusLabel(status, locale)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Clock3 className="h-3 w-3" />
      {getLocalOrderStatusLabel(status, locale)}
    </Badge>
  );
}

/**
 * 渲染到账状态徽标。
 *
 * @param props - 到账状态与语言。
 * @returns 状态徽标。
 */
function FulfillmentBadge({
  status,
  locale,
}: {
  status: FulfillmentStatus;
  locale: string;
}) {
  if (status === "fulfilled") {
    return (
      <Badge className="bg-emerald-600 text-white">
        <CheckCircle2 className="h-3 w-3" />
        {copy(locale, "Fulfilled", "已到账")}
      </Badge>
    );
  }
  if (status === "missing") {
    return (
      <Badge variant="destructive">
        <AlertTriangle className="h-3 w-3" />
        {copy(locale, "Missing", "待排查")}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3" />
        {copy(locale, "Failed", "失败")}
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary">
        <Clock3 className="h-3 w-3" />
        {copy(locale, "Processing", "履约中")}
      </Badge>
    );
  }
  return <Badge variant="outline">{copy(locale, "Not paid", "未支付")}</Badge>;
}

/**
 * 渲染订阅状态徽标。
 *
 * @param props - 状态与语言。
 * @returns 状态徽标。
 */
function SubscriptionStatusBadge({
  status,
  locale,
}: {
  status: string;
  locale: string;
}) {
  if (status === "active" || status === "lifetime" || status === "trialing") {
    return (
      <Badge className="bg-emerald-600 text-white">
        {getSubscriptionStatusLabel(status, locale)}
      </Badge>
    );
  }
  if (status === "past_due" || status === "incomplete") {
    return (
      <Badge variant="secondary">
        {getSubscriptionStatusLabel(status, locale)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      {getSubscriptionStatusLabel(status, locale)}
    </Badge>
  );
}

/**
 * 归一化查询参数。
 *
 * @param params - URL searchParams。
 * @param timeZone - 应用时区，用于把日期输入转换为准确的 UTC 边界。
 * @returns 类型安全的筛选条件。
 */
function normalizeFilters(
  params: PaymentSearchParams,
  timeZone: string
): PaymentFilters {
  const q = params.q?.trim() ?? "";
  const fromInput = params.from?.trim() ?? "";
  const toInput = params.to?.trim() ?? "";
  return {
    q,
    status: normalizeStatus(params.status),
    type: normalizeBusinessTypeFilter(params.type),
    provider: normalizeProvider(params.provider),
    from: parseDateInput(fromInput, false, timeZone),
    to: parseDateInput(toInput, true, timeZone),
    fromInput,
    toInput,
    page: parsePositiveInteger(params.page, 1),
  };
}

/**
 * 解析订单状态筛选。
 *
 * @param value - URL 中的状态值。
 * @returns 合法状态或 all。
 */
function normalizeStatus(value?: string): LocalOrderStatusFilter {
  return LOCAL_ORDER_STATUSES.includes(value as EpayOrderStatus)
    ? (value as EpayOrderStatus)
    : "all";
}

/**
 * 解析业务类型筛选。
 *
 * @param value - URL 中的业务类型。
 * @returns 合法业务类型或 all。
 */
function normalizeBusinessTypeFilter(value?: string): BusinessTypeFilter {
  return LOCAL_BUSINESS_TYPES.includes(value as EpayBusinessType)
    ? (value as EpayBusinessType)
    : "all";
}

/**
 * 解析支付通道筛选。
 *
 * @param value - URL 中的通道。
 * @returns 合法通道或 all。
 */
function normalizeProvider(value?: string): ProviderFilter {
  return PROVIDERS.includes(value as (typeof PROVIDERS)[number])
    ? (value as (typeof PROVIDERS)[number])
    : "all";
}

/**
 * 解析正整数。
 *
 * @param value - 待解析字符串。
 * @param fallback - 解析失败时的默认值。
 * @returns 正整数。
 */
function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * 解析日期输入。
 *
 * @param value - yyyy-mm-dd 日期。
 * @param endOfDay - 是否取当天末尾。
 * @param timeZone - 应用时区。
 * @returns Date 或 null。
 */
function parseDateInput(value: string, endOfDay: boolean, timeZone: string) {
  return parseDateInputInTimeZone(value, { endOfDay, timeZone });
}

/**
 * 从到账流水推断支付通道。
 *
 * @param row - 到账流水。
 * @returns 支付通道。
 */
function inferLedgerProvider(
  row: BillingLedgerRow
): Exclude<ProviderFilter, "all"> {
  const metadataProvider = row.metadata
    ? readString(row.metadata, "provider")
    : null;
  if (metadataProvider === "epay" || metadataProvider === "alipay") {
    return metadataProvider;
  }
  const sourceRef = row.sourceRef ?? "";
  if (
    sourceRef.startsWith("epay:") ||
    sourceRef.startsWith("epay_subscription:")
  ) {
    return "epay";
  }
  if (
    sourceRef.startsWith("alipay:") ||
    sourceRef.startsWith("alipay_subscription:")
  ) {
    return "alipay";
  }
  return "creem";
}

/**
 * 从订阅 ID 推断支付通道。
 *
 * @param subscriptionId - 支付提供商订阅 ID。
 * @returns 支付通道。
 */
function inferSubscriptionProvider(subscriptionId: string): ProviderFilter {
  if (subscriptionId.startsWith("epay_")) return "epay";
  if (subscriptionId.startsWith("alipay_")) return "alipay";
  return "creem";
}

/**
 * 获取流水收据引用。
 *
 * @param metadata - 流水 metadata。
 * @returns 可读的订单或订阅引用。
 */
function getReceiptReference(metadata: Record<string, unknown> | null) {
  if (!metadata) return "-";
  const value =
    readString(metadata, "outTradeNo") ??
    readString(metadata, "tradeNo") ??
    readString(metadata, "orderId") ??
    readString(metadata, "subscriptionId");
  return value ? shortId(value) : "-";
}

/**
 * 读取字符串 metadata 字段。
 *
 * @param metadata - 结构化 metadata。
 * @param key - 字段名。
 * @returns 字符串值或 null。
 */
function readString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 生成分页链接。
 *
 * @param filters - 当前筛选条件。
 * @param page - 目标页码。
 * @returns 当前路由相对查询串。
 */
function buildPageHref(filters: PaymentFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.provider !== "all") params.set("provider", filters.provider);
  if (filters.fromInput) params.set("from", filters.fromInput);
  if (filters.toInput) params.set("to", filters.toInput);
  params.set("page", String(page));
  return `?${params.toString()}`;
}

/**
 * 格式化日期时间。
 *
 * @param value - 日期值。
 * @param locale - 当前语言。
 * @param timeZone - 应用时区。
 * @returns 本地化日期时间字符串。
 */
function formatDateTime(
  value: Date | string | number | null | undefined,
  locale: string,
  timeZone: string
) {
  return formatDateInTimeZone(
    value,
    locale,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
    timeZone
  );
}

/**
 * 格式化金额。
 *
 * @param value - 金额。
 * @param locale - 当前语言。
 * @returns 带两位小数的金额字符串。
 */
function formatMoney(value: number | string, locale: string) {
  const amount = Number(value);
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * 格式化普通数字。
 *
 * @param value - 数字。
 * @param locale - 当前语言。
 * @returns 本地化数字。
 */
function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(
    value
  );
}

/**
 * 缩短长 ID。
 *
 * @param value - ID 或空值。
 * @returns 便于列表显示的短 ID。
 */
function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length <= 12
    ? value
    : `${value.slice(0, 6)}...${value.slice(-6)}`;
}

/**
 * 选择中英文文案。
 *
 * @param locale - 当前语言。
 * @param en - 英文文案。
 * @param zh - 中文文案。
 * @returns 对应语言文案。
 */
function copy(locale: string, en: string, zh: string) {
  return locale === "zh" ? zh : en;
}

/**
 * 获取订单状态文案。
 *
 * @param status - 订单状态。
 * @param locale - 当前语言。
 * @returns 本地化状态文案。
 */
function getLocalOrderStatusLabel(status: string, locale: string) {
  const labels: Record<string, { en: string; zh: string }> = {
    pending: { en: "Pending", zh: "待支付" },
    processing: { en: "Processing", zh: "履约中" },
    success: { en: "Success", zh: "已完成" },
    failed: { en: "Failed", zh: "失败" },
  };
  const label = labels[status] ?? { en: status, zh: status };
  return copy(locale, label.en, label.zh);
}

/**
 * 获取业务类型文案。
 *
 * @param type - 业务类型。
 * @param locale - 当前语言。
 * @returns 本地化业务文案。
 */
function getBusinessTypeLabel(type: string, locale: string) {
  const labels: Record<string, { en: string; zh: string }> = {
    credit_purchase: { en: "Credit Pack", zh: "积分包" },
    subscription: { en: "Subscription", zh: "订阅" },
  };
  const label = labels[type] ?? { en: type, zh: type };
  return copy(locale, label.en, label.zh);
}

/**
 * 获取支付通道文案。
 *
 * @param provider - 支付通道。
 * @param locale - 当前语言。
 * @returns 本地化通道文案。
 */
function getProviderLabel(
  provider: ProviderFilter | LocalPaymentProvider | null,
  locale: string
) {
  if (provider === "epay") return copy(locale, "Epay", "易支付");
  if (provider === "alipay") return copy(locale, "Alipay", "支付宝");
  if (provider === "creem") return "Creem";
  return copy(locale, "Unknown", "未知");
}

/**
 * 获取订阅状态文案。
 *
 * @param status - 订阅状态。
 * @param locale - 当前语言。
 * @returns 本地化状态文案。
 */
function getSubscriptionStatusLabel(status: string, locale: string) {
  const labels: Record<string, { en: string; zh: string }> = {
    active: { en: "Active", zh: "有效" },
    trialing: { en: "Trialing", zh: "试用中" },
    lifetime: { en: "Lifetime", zh: "终身" },
    canceled: { en: "Canceled", zh: "已取消" },
    past_due: { en: "Past due", zh: "逾期" },
    paused: { en: "Paused", zh: "已暂停" },
    incomplete: { en: "Incomplete", zh: "未完成" },
  };
  const label = labels[status] ?? { en: status, zh: status };
  return copy(locale, label.en, label.zh);
}
