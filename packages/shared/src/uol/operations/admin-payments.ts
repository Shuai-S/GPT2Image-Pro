/**
 * UOL 操作注册 - 管理端支付订单域。
 *
 * 使用方：管理后台支付订单页、管理员 MCP 与未来内置 Agent。
 * 关键依赖：epay_order、credits_batch、credits_transaction、subscription 与 UOL 网关鉴权。
 */

import { db } from "@repo/database";
import {
  creditsBatch,
  creditsTransaction,
  epayOrder,
  subscription,
  user,
} from "@repo/database/schema";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { z } from "zod";

import { ADMIN_PAYMENTS_CACHE_TAG } from "../../payment/admin-payments-cache";
import { OperationError } from "../errors";
import type { Principal } from "../principal";
import { defineOperation } from "../registry";

const localOrderStatusValues = [
  "pending",
  "processing",
  "success",
  "failed",
] as const;
const localBusinessTypeValues = ["credit_purchase", "subscription"] as const;
const providerValues = ["epay", "alipay", "creem"] as const;
const billingTransactionTypeValues = ["purchase", "monthly_grant"] as const;

const filterStatusSchema = z.enum(["all", ...localOrderStatusValues]);
const filterBusinessTypeSchema = z.enum(["all", ...localBusinessTypeValues]);
const filterProviderSchema = z.enum(["all", ...providerValues]);
const metadataSchema = z.record(z.string(), z.unknown());
const batchSchema = z
  .object({
    id: z.string(),
    sourceType: z.string(),
    amount: z.number(),
    remaining: z.number(),
    status: z.string(),
    issuedAt: z.date(),
  })
  .nullable();
const transactionSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    amount: z.number(),
    createdAt: z.date(),
  })
  .nullable();

export const adminPaymentsDashboardInputSchema = z.object({
  q: z.string().default(""),
  status: filterStatusSchema.default("all"),
  type: filterBusinessTypeSchema.default("all"),
  provider: filterProviderSchema.default("all"),
  from: z.date().nullable().default(null),
  to: z.date().nullable().default(null),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  ledgerLimit: z.number().int().min(1).max(100).default(40),
  subscriptionLimit: z.number().int().min(1).max(100).default(30),
});

const localOrderSchema = z.object({
  outTradeNo: z.string(),
  userId: z.string(),
  businessType: z.string(),
  amount: z.number(),
  status: z.string(),
  metadata: metadataSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  provider: z.enum(["epay", "alipay"]).nullable(),
  sourceRef: z.string().nullable(),
  batch: batchSchema,
  transaction: transactionSchema,
  fulfillmentStatus: z.enum([
    "not_paid",
    "processing",
    "fulfilled",
    "missing",
    "failed",
  ]),
});
const ledgerRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  type: z.string(),
  amount: z.number(),
  sourceRef: z.string().nullable(),
  description: z.string().nullable(),
  metadata: metadataSchema.nullable(),
  createdAt: z.date(),
});
const subscriptionRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  subscriptionId: z.string(),
  priceId: z.string(),
  status: z.string(),
  currentPeriodStart: z.date().nullable(),
  currentPeriodEnd: z.date().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  updatedAt: z.date(),
});

export const adminPaymentsDashboardOutputSchema = z.object({
  localOrders: z.object({
    orders: z.array(localOrderSchema),
    total: z.number(),
    summary: z.object({
      total: z.number(),
      amount: z.number(),
      success: z.number(),
      pending: z.number(),
      processing: z.number(),
      failed: z.number(),
    }),
  }),
  ledgerRows: z.array(ledgerRowSchema),
  subscriptionRows: z.array(subscriptionRowSchema),
});

type AdminPaymentsDashboardInput = z.infer<
  typeof adminPaymentsDashboardInputSchema
>;
type PaymentDateColumn =
  | typeof epayOrder.createdAt
  | typeof creditsTransaction.createdAt
  | typeof subscription.updatedAt;
type LocalPaymentProvider = "epay" | "alipay";
type FulfillmentStatus =
  | "not_paid"
  | "processing"
  | "fulfilled"
  | "missing"
  | "failed";
type LocalOrderRow = {
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
type LocalStatusSummary = {
  total: number;
  amount: number;
  success: number;
  pending: number;
  processing: number;
  failed: number;
};

/**
 * 获取管理端支付订单看板。
 *
 * @returns 本地订单、到账流水与订阅记录。
 * @sideEffects 无写入；只读取支付与积分账本。
 */
export const getAdminPaymentsDashboard = defineOperation({
  name: "admin.payments.getDashboard",
  domain: "payment",
  title: "Get Admin Payments Dashboard",
  description:
    "管理员查询本地支付订单、到账批次、积分流水与订阅记录，用于核对用户是否完成支付和是否到账。",
  input: adminPaymentsDashboardInputSchema,
  output: adminPaymentsDashboardOutputSchema,
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (input, principal) => {
    assertPaymentAdmin(principal);
    const [localOrders, ledgerRows, subscriptionRows] = await Promise.all([
      loadLocalOrders(input),
      loadBillingLedger(input),
      loadSubscriptions(input),
    ]);
    return { localOrders, ledgerRows, subscriptionRows };
  },
});

/**
 * 限制支付数据只允许普通管理员和超管查看。
 *
 * @param principal - UOL 调用者身份。
 * @returns 无返回值。
 * @throws OperationError 当 observer_admin 或非用户身份访问时抛出。
 */
function assertPaymentAdmin(principal: Principal) {
  if (principal.type === "system") return;
  if (
    principal.type !== "user" ||
    (principal.role !== "admin" && principal.role !== "super_admin")
  ) {
    throw new OperationError("forbidden", "Payment admin access required");
  }
}

/**
 * 状态分组聚合行(与 DB groupBy 输出同构,可被 Next data cache 序列化)。
 */
type LocalOrderStatusRow = {
  status: string;
  total: number;
  amount: number;
};

/**
 * 实际扫描 epay_order 做状态分组聚合的查询(无缓存)。
 *
 * @param type - 业务类型过滤("all" 不过滤)。
 * @param provider - 支付通道过滤("all" 不过滤)。
 * @returns 按状态分组的笔数与金额汇总。
 * @sideEffects 全表分组扫描 epay_order;调用方应经缓存包装器访问。
 */
async function queryLocalOrderStatusRows(
  type: AdminPaymentsDashboardInput["type"],
  provider: AdminPaymentsDashboardInput["provider"]
): Promise<LocalOrderStatusRow[]> {
  const where = buildLocalOrderWhere(
    {
      q: "",
      status: "all",
      type,
      provider,
      from: null,
      to: null,
      page: 1,
      pageSize: 1,
      ledgerLimit: 1,
      subscriptionLimit: 1,
    },
    false
  );
  return await db
    .select({
      status: epayOrder.status,
      total: count(),
      amount: sql<number>`coalesce(sum(${epayOrder.amount}), 0)`.mapWith(
        Number
      ),
    })
    .from(epayOrder)
    .where(where)
    .groupBy(epayOrder.status);
}

/**
 * 带缓存的状态分组聚合(C-P1-3)。
 *
 * WHY: 顶部统计卡每次进页都全表 groupBy epay_order,聚合结果与个人明细无关、
 * 全体 admin 共享同一视图,适合走 Next data cache。缓存键只含 type/provider
 * 两个低基数枚举——q 是自由文本、from/to 是精确时间戳,进键会造成键基数爆炸
 * 且几乎不可命中,带这些过滤的请求直接穿透查 DB(见 loadLocalOrders)。
 * 订单状态变化时经 ADMIN_PAYMENTS_CACHE_TAG 失效;300s TTL 兜底防失效遗漏。
 */
const getCachedLocalOrderStatusRows = unstable_cache(
  async (
    type: AdminPaymentsDashboardInput["type"],
    provider: AdminPaymentsDashboardInput["provider"]
  ): Promise<LocalOrderStatusRow[]> =>
    queryLocalOrderStatusRows(type, provider),
  ["admin-payments-status-rows"],
  { revalidate: 300, tags: [ADMIN_PAYMENTS_CACHE_TAG] }
);

/**
 * 加载本地订单及到账匹配结果。
 *
 * @param filters - UOL 输入筛选条件。
 * @returns 本地订单列表、总数与状态统计。
 * @sideEffects 读取 epay_order、credits_batch 与 credits_transaction;
 *              无 q/日期过滤时聚合统计走缓存,明细列表始终实时查询。
 */
async function loadLocalOrders(filters: AdminPaymentsDashboardInput) {
  const statusNeutralWhere = buildLocalOrderWhere(filters, false);
  const where = buildLocalOrderWhere(filters, true);
  const offset = (filters.page - 1) * filters.pageSize;

  // 缓存资格:q 是自由文本、from/to 是精确时间戳,含它们的聚合几乎不可复用,
  // 直接穿透;仅"无搜索、无自定义日期"的常规视图命中缓存(admin 默认打开姿势)。
  const aggregateCacheable = !filters.q && !filters.from && !filters.to;

  const orderRowsQuery = db
    .select({
      outTradeNo: epayOrder.outTradeNo,
      userId: epayOrder.userId,
      businessType: epayOrder.businessType,
      amount: epayOrder.amount,
      status: epayOrder.status,
      metadata: epayOrder.metadata,
      createdAt: epayOrder.createdAt,
      updatedAt: epayOrder.updatedAt,
      userEmail: user.email,
      userName: user.name,
    })
    .from(epayOrder)
    .leftJoin(user, eq(user.id, epayOrder.userId))
    .where(where)
    .orderBy(desc(epayOrder.createdAt))
    .limit(filters.pageSize)
    .offset(offset);

  let orderRows: Awaited<typeof orderRowsQuery>;
  let totalCount: number;
  let statusRows: LocalOrderStatusRow[];

  if (aggregateCacheable) {
    // 聚合走缓存;总数从状态分组派生(status="all" 时求和,否则取对应分组),
    // 避免为 count 单独再建一个缓存条目。明细分页始终实时。
    const [rows, cachedStatusRows] = await Promise.all([
      orderRowsQuery,
      getCachedLocalOrderStatusRows(filters.type, filters.provider),
    ]);
    orderRows = rows;
    statusRows = cachedStatusRows;
    totalCount =
      filters.status === "all"
        ? cachedStatusRows.reduce((sum, row) => sum + row.total, 0)
        : (cachedStatusRows.find((row) => row.status === filters.status)
            ?.total ?? 0);
  } else {
    const [rows, countRows, freshStatusRows] = await Promise.all([
      orderRowsQuery,
      db
        .select({ total: count() })
        .from(epayOrder)
        .leftJoin(user, eq(user.id, epayOrder.userId))
        .where(where),
      db
        .select({
          status: epayOrder.status,
          total: count(),
          amount: sql<number>`coalesce(sum(${epayOrder.amount}), 0)`.mapWith(
            Number
          ),
        })
        .from(epayOrder)
        .leftJoin(user, eq(user.id, epayOrder.userId))
        .where(statusNeutralWhere)
        .groupBy(epayOrder.status),
    ]);
    orderRows = rows;
    totalCount = countRows[0]?.total ?? 0;
    statusRows = freshStatusRows;
  }

  const orders = orderRows.map((row) => ({
    ...row,
    metadata: row.metadata ?? {},
  }));
  const sourceRefs = Array.from(
    new Set(orders.map(buildLocalOrderSourceRef).filter(isNonEmptyString))
  );
  const [batchRows, transactionRows] =
    sourceRefs.length > 0
      ? await Promise.all([
          db
            .select({
              id: creditsBatch.id,
              sourceRef: creditsBatch.sourceRef,
              sourceType: creditsBatch.sourceType,
              amount: creditsBatch.amount,
              remaining: creditsBatch.remaining,
              status: creditsBatch.status,
              issuedAt: creditsBatch.issuedAt,
            })
            .from(creditsBatch)
            .where(inArray(creditsBatch.sourceRef, sourceRefs)),
          db
            .select({
              id: creditsTransaction.id,
              sourceRef: creditsTransaction.sourceRef,
              type: creditsTransaction.type,
              amount: creditsTransaction.amount,
              createdAt: creditsTransaction.createdAt,
            })
            .from(creditsTransaction)
            .where(inArray(creditsTransaction.sourceRef, sourceRefs)),
        ])
      : [[], []];

  const batchBySourceRef = new Map(
    batchRows.flatMap((batch) =>
      batch.sourceRef
        ? [
            [
              batch.sourceRef,
              {
                id: batch.id,
                sourceType: batch.sourceType,
                amount: batch.amount,
                remaining: batch.remaining,
                status: batch.status,
                issuedAt: batch.issuedAt,
              },
            ],
          ]
        : []
    )
  );
  const transactionBySourceRef = new Map(
    transactionRows.flatMap((tx) =>
      tx.sourceRef
        ? [
            [
              tx.sourceRef,
              {
                id: tx.id,
                type: tx.type,
                amount: tx.amount,
                createdAt: tx.createdAt,
              },
            ],
          ]
        : []
    )
  );

  return {
    orders: orders.map((order) => {
      const sourceRef = buildLocalOrderSourceRef(order);
      const batch = sourceRef
        ? (batchBySourceRef.get(sourceRef) ?? null)
        : null;
      const transaction = sourceRef
        ? (transactionBySourceRef.get(sourceRef) ?? null)
        : null;
      return {
        ...order,
        provider: getLocalPaymentProvider(order.metadata),
        sourceRef,
        batch,
        transaction,
        fulfillmentStatus: resolveFulfillmentStatus(
          order.status,
          batch,
          transaction
        ),
      };
    }),
    total: totalCount,
    summary: buildLocalStatusSummary(statusRows),
  };
}

/**
 * 加载到账流水。
 *
 * @param filters - UOL 输入筛选条件。
 * @returns 最近到账流水。
 * @sideEffects 读取 credits_transaction。
 */
async function loadBillingLedger(filters: AdminPaymentsDashboardInput) {
  const clauses: SQL[] = [
    inArray(creditsTransaction.type, [...billingTransactionTypeValues]),
  ];
  clauses.push(
    ...buildDateClauses(creditsTransaction.createdAt, filters.from, filters.to)
  );

  const providerClause = buildLedgerProviderClause(filters.provider);
  if (providerClause) clauses.push(providerClause);

  if (filters.type === "credit_purchase") {
    clauses.push(eq(creditsTransaction.type, "purchase"));
  } else if (filters.type === "subscription") {
    clauses.push(eq(creditsTransaction.type, "monthly_grant"));
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const searchClause = or(
      ilike(user.email, pattern),
      ilike(user.name, pattern),
      ilike(creditsTransaction.userId, pattern),
      ilike(creditsTransaction.sourceRef, pattern),
      ilike(creditsTransaction.description, pattern),
      sql`${creditsTransaction.metadata}::text ilike ${pattern}`
    );
    if (searchClause) clauses.push(searchClause);
  }

  return await db
    .select({
      id: creditsTransaction.id,
      userId: creditsTransaction.userId,
      userEmail: user.email,
      userName: user.name,
      type: creditsTransaction.type,
      amount: creditsTransaction.amount,
      sourceRef: creditsTransaction.sourceRef,
      description: creditsTransaction.description,
      metadata: creditsTransaction.metadata,
      createdAt: creditsTransaction.createdAt,
    })
    .from(creditsTransaction)
    .leftJoin(user, eq(user.id, creditsTransaction.userId))
    .where(and(...clauses))
    .orderBy(desc(creditsTransaction.createdAt))
    .limit(filters.ledgerLimit);
}

/**
 * 加载订阅记录。
 *
 * @param filters - UOL 输入筛选条件。
 * @returns 最近订阅记录。
 * @sideEffects 读取 subscription。
 */
async function loadSubscriptions(filters: AdminPaymentsDashboardInput) {
  const clauses: SQL[] = [];
  clauses.push(
    ...buildDateClauses(subscription.updatedAt, filters.from, filters.to)
  );

  if (filters.provider !== "all") {
    const providerClause = buildSubscriptionProviderClause(filters.provider);
    if (providerClause) clauses.push(providerClause);
  }

  if (filters.type === "credit_purchase") {
    return [];
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const searchClause = or(
      ilike(user.email, pattern),
      ilike(user.name, pattern),
      ilike(subscription.userId, pattern),
      ilike(subscription.subscriptionId, pattern),
      ilike(subscription.priceId, pattern),
      ilike(subscription.status, pattern)
    );
    if (searchClause) clauses.push(searchClause);
  }

  return await db
    .select({
      id: subscription.id,
      userId: subscription.userId,
      userEmail: user.email,
      userName: user.name,
      subscriptionId: subscription.subscriptionId,
      priceId: subscription.priceId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      updatedAt: subscription.updatedAt,
    })
    .from(subscription)
    .leftJoin(user, eq(user.id, subscription.userId))
    .where(clauses.length > 0 ? and(...clauses) : undefined)
    .orderBy(desc(subscription.updatedAt))
    .limit(filters.subscriptionLimit);
}

/**
 * 构造本地订单查询条件。
 *
 * @param filters - UOL 输入筛选条件。
 * @param includeStatus - 是否包含订单状态条件。
 * @returns Drizzle SQL 条件；无条件时为 undefined。
 */
function buildLocalOrderWhere(
  filters: AdminPaymentsDashboardInput,
  includeStatus: boolean
) {
  const clauses: SQL[] = [];
  if (includeStatus && filters.status !== "all") {
    clauses.push(eq(epayOrder.status, filters.status));
  }
  if (filters.type !== "all") {
    clauses.push(eq(epayOrder.businessType, filters.type));
  }
  if (filters.provider === "creem") {
    clauses.push(sql`false`);
  } else if (filters.provider !== "all") {
    clauses.push(sql`${epayOrder.metadata}->>'provider' = ${filters.provider}`);
  }
  clauses.push(
    ...buildDateClauses(epayOrder.createdAt, filters.from, filters.to)
  );

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const searchClause = or(
      ilike(user.email, pattern),
      ilike(user.name, pattern),
      ilike(epayOrder.userId, pattern),
      ilike(epayOrder.outTradeNo, pattern),
      ilike(epayOrder.businessType, pattern),
      sql`${epayOrder.metadata}::text ilike ${pattern}`
    );
    if (searchClause) clauses.push(searchClause);
  }

  return clauses.length > 0 ? and(...clauses) : undefined;
}

/**
 * 构造日期筛选条件。
 *
 * @param column - 要筛选的时间列。
 * @param from - 开始时间。
 * @param to - 结束时间。
 * @returns SQL 条件数组。
 */
function buildDateClauses(
  column: PaymentDateColumn,
  from: Date | null,
  to: Date | null
) {
  const clauses: SQL[] = [];
  if (from) clauses.push(sql`${column} >= ${from}`);
  if (to) clauses.push(sql`${column} <= ${to}`);
  return clauses;
}

/**
 * 构造到账流水支付通道条件。
 *
 * @param provider - 支付通道。
 * @returns SQL 条件；全部通道时返回 null。
 */
function buildLedgerProviderClause(
  provider: AdminPaymentsDashboardInput["provider"]
) {
  if (provider === "all") return null;
  if (provider === "epay") {
    return or(
      ilike(creditsTransaction.sourceRef, "epay:%"),
      ilike(creditsTransaction.sourceRef, "epay_subscription:%"),
      sql`${creditsTransaction.metadata}->>'provider' = 'epay'`
    );
  }
  if (provider === "alipay") {
    return or(
      ilike(creditsTransaction.sourceRef, "alipay:%"),
      ilike(creditsTransaction.sourceRef, "alipay_subscription:%"),
      sql`${creditsTransaction.metadata}->>'provider' = 'alipay'`
    );
  }
  return or(
    ilike(creditsTransaction.sourceRef, "credit_purchase:%"),
    and(
      eq(creditsTransaction.type, "monthly_grant"),
      sql`coalesce(${creditsTransaction.sourceRef}, '') not like 'epay_subscription:%'`,
      sql`coalesce(${creditsTransaction.sourceRef}, '') not like 'alipay_subscription:%'`
    )
  );
}

/**
 * 构造订阅支付通道条件。
 *
 * @param provider - 支付通道。
 * @returns SQL 条件。
 */
function buildSubscriptionProviderClause(
  provider: AdminPaymentsDashboardInput["provider"]
) {
  if (provider === "epay") return ilike(subscription.subscriptionId, "epay_%");
  if (provider === "alipay") {
    return ilike(subscription.subscriptionId, "alipay_%");
  }
  if (provider === "creem") {
    return sql`${subscription.subscriptionId} not like 'epay_%' and ${subscription.subscriptionId} not like 'alipay_%'`;
  }
  return sql`true`;
}

/**
 * 构造本地订单到账 sourceRef。
 *
 * @param order - 本地订单。
 * @returns 对应 credits_batch.source_ref；无法判断时返回 null。
 */
function buildLocalOrderSourceRef(order: LocalOrderRow) {
  const provider = getLocalPaymentProvider(order.metadata);
  const businessType = normalizeBusinessTypeValue(order.businessType);
  if (!provider || !businessType) return null;
  if (businessType === "credit_purchase")
    return `${provider}:${order.outTradeNo}`;
  return `${provider}_subscription:${order.outTradeNo}`;
}

/**
 * 读取本地支付通道。
 *
 * @param metadata - epay_order.metadata。
 * @returns epay/alipay 或 null。
 */
function getLocalPaymentProvider(
  metadata: Record<string, unknown>
): LocalPaymentProvider | null {
  const value = readString(metadata, "provider");
  if (value === "epay" || value === "alipay") return value;
  return null;
}

/**
 * 归一化业务类型。
 *
 * @param value - 数据库业务类型。
 * @returns 合法业务类型或 null。
 */
function normalizeBusinessTypeValue(value: string) {
  return localBusinessTypeValues.includes(
    value as (typeof localBusinessTypeValues)[number]
  )
    ? (value as (typeof localBusinessTypeValues)[number])
    : null;
}

/**
 * 解析订单到账状态。
 *
 * @param orderStatus - 本地订单状态。
 * @param batch - 匹配的积分批次。
 * @param transaction - 匹配的记账流水。
 * @returns 管理端到账状态。
 */
function resolveFulfillmentStatus(
  orderStatus: string,
  batch: unknown,
  transaction: unknown
): FulfillmentStatus {
  if (orderStatus === "failed") return "failed";
  if (orderStatus === "processing") return "processing";
  if (orderStatus !== "success") return "not_paid";
  return batch && transaction ? "fulfilled" : "missing";
}

/**
 * 聚合本地订单状态统计。
 *
 * @param rows - 状态分组结果。
 * @returns 汇总统计。
 */
function buildLocalStatusSummary(
  rows: Array<{ status: string; total: number; amount: number }>
): LocalStatusSummary {
  const summary: LocalStatusSummary = {
    total: 0,
    amount: 0,
    success: 0,
    pending: 0,
    processing: 0,
    failed: 0,
  };
  for (const row of rows) {
    summary.total += row.total;
    summary.amount += row.amount;
    if (row.status === "success") summary.success += row.total;
    if (row.status === "pending") summary.pending += row.total;
    if (row.status === "processing") summary.processing += row.total;
    if (row.status === "failed") summary.failed += row.total;
  }
  return summary;
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
 * 判断非空字符串。
 *
 * @param value - 待判断值。
 * @returns 是否为非空字符串。
 */
function isNonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}
