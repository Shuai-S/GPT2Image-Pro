/**
 * 使用记录页面
 *
 * 职责：展示图像生成使用记录。普通用户仅能查看自己的记录；超管可查看所有用户记录，
 * 并按用户、模型、状态、提示词和创建日期筛选。
 *
 * 使用方：Dashboard 侧边栏的 Usage Records 入口。
 * 关键依赖：generation/user 表、Better Auth 当前用户、客户端时区、HistoryClient。
 */
import { db } from "@repo/database";
import { generation, user as userTable } from "@repo/database/schema";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isSuperAdminRole } from "@repo/shared/auth/roles";
import { getCurrentUser } from "@repo/shared/auth/server";
import { formatCredits } from "@repo/shared/credits/format";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { DateRangeTimestampFields } from "@/components/date-range-timestamp-fields";
import { HistoryClient } from "@/features/image-generation/components/history-client";
import { extractGenerationCreditDetails } from "@/features/image-generation/credit-calculation-details";
import {
  extractGenerationReferenceImages,
  extractPromptRepairNotice,
} from "@/features/image-generation/generation-metadata";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ["pending", "completed", "failed"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number] | "all";

interface HistoryPageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    model?: string;
    user?: string;
    prompt?: string;
    start?: string;
    end?: string;
  }>;
}

/**
 * 清理查询参数中的短文本筛选值。
 *
 * @param value 原始 query 参数。
 * @returns 去除首尾空白且限制长度后的值；空值返回空字符串。
 * @sideEffects 无。
 * @failureMode 非字符串输入会被视为空值，避免把不可信 query 直接拼入条件。
 */
function cleanFilterText(value: string | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

/**
 * 解析页码参数。
 *
 * @param value 原始 page query。
 * @returns 大于等于 1 的整数页码；非法时返回 1。
 * @sideEffects 无。
 * @failureMode 小数、负数和非数字都回退到第一页。
 */
function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * 解析记录状态筛选。
 *
 * @param value 原始 status query。
 * @returns 可用于数据库过滤的状态；非法或 all 返回 all。
 * @sideEffects 无。
 * @failureMode 未知状态不参与过滤，防止构造非法 enum 查询。
 */
function parseStatus(value: string | undefined): StatusFilter {
  return STATUS_OPTIONS.includes(value as (typeof STATUS_OPTIONS)[number])
    ? (value as StatusFilter)
    : "all";
}

/**
 * 解析毫秒时间戳筛选边界。
 *
 * @param value query 中的毫秒时间戳。
 * @returns 对应 Date；非法时返回 null。
 * @sideEffects 无。
 * @failureMode 非法时间戳不参与过滤，服务端不推断时区。
 */
function parseTimestampBoundary(value: string | undefined) {
  if (!value) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 构建使用记录查询条件。
 *
 * @param filters 已清理的筛选条件。
 * @param scope 当前用户可见范围。
 * @returns Drizzle SQL 条件；始终包含 true 占位，便于统一 where 调用。
 * @sideEffects 无。
 * @failureMode 普通用户范围始终强制追加 userId 条件，忽略 query 中的用户筛选越权尝试。
 */
function buildUsageRecordsWhere(
  filters: {
    status: StatusFilter;
    model: string;
    prompt: string;
    user: string;
    startDate: Date | null;
    endDate: Date | null;
  },
  scope: { userId: string; canViewAll: boolean }
) {
  const conditions: SQL[] = [sql`true`];

  if (!scope.canViewAll) {
    conditions.push(eq(generation.userId, scope.userId));
  } else if (filters.user) {
    const userPattern = `%${filters.user}%`;
    const userFilter = or(
      ilike(userTable.email, userPattern),
      ilike(userTable.name, userPattern),
      eq(generation.userId, filters.user)
    );
    if (userFilter) conditions.push(userFilter);
  }

  if (filters.status !== "all") {
    conditions.push(eq(generation.status, filters.status));
  }

  if (filters.model) {
    conditions.push(ilike(generation.model, `%${filters.model}%`));
  }

  if (filters.prompt) {
    conditions.push(ilike(generation.prompt, `%${filters.prompt}%`));
  }

  if (filters.startDate) {
    conditions.push(gte(generation.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(generation.createdAt, filters.endDate));
  }

  return and(...conditions);
}

/**
 * 构建分页链接保留的筛选 query。
 *
 * @param filters 页面当前筛选值。
 * @param canViewAll 当前用户是否可使用用户筛选。
 * @returns 不含 page 的 URLSearchParams 字符串。
 * @sideEffects 无。
 * @failureMode 空筛选会被省略，避免生成噪声 URL。
 */
function buildFilterQuery(
  filters: {
    status: StatusFilter;
    model: string;
    prompt: string;
    user: string;
    start: string;
    end: string;
  },
  canViewAll: boolean
) {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.model) params.set("model", filters.model);
  if (filters.prompt) params.set("prompt", filters.prompt);
  if (canViewAll && filters.user) params.set("user", filters.user);
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  return params.toString();
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const currentUser = await getCurrentUser();
  const locale = await getLocale();
  if (!currentUser) redirect(`/${locale}/sign-in`);
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  const params = await searchParams;
  const role = await getUserRoleById(currentUser.id);
  const canViewAll = isSuperAdminRole(role);
  const status = parseStatus(params.status);
  const filters = {
    status,
    model: cleanFilterText(params.model),
    prompt: cleanFilterText(params.prompt),
    user: cleanFilterText(params.user),
    start: cleanFilterText(params.start),
    end: cleanFilterText(params.end),
  };
  const where = buildUsageRecordsWhere(
    {
      ...filters,
      startDate: parseTimestampBoundary(filters.start),
      endDate: parseTimestampBoundary(filters.end),
    },
    { userId: currentUser.id, canViewAll }
  );
  const page = parsePage(params.page);
  const offset = (page - 1) * PAGE_SIZE;
  const filterQuery = buildFilterQuery(filters, canViewAll);
  const hasActiveFilters = filterQuery.length > 0;
  const resetHref = `/${locale}/dashboard/history`;

  const [generations, totalResult, creditsResult] = await Promise.all([
    db
      .select({
        id: generation.id,
        userId: generation.userId,
        userName: userTable.name,
        userEmail: userTable.email,
        prompt: generation.prompt,
        revisedPrompt: generation.revisedPrompt,
        model: generation.model,
        size: generation.size,
        status: generation.status,
        creditsConsumed: generation.creditsConsumed,
        error: generation.error,
        storageKey: generation.storageKey,
        storageBucket: generation.storageBucket,
        metadata: generation.metadata,
        createdAt: generation.createdAt,
      })
      .from(generation)
      .leftJoin(userTable, eq(userTable.id, generation.userId))
      .where(where)
      .orderBy(desc(generation.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: count() })
      .from(generation)
      .leftJoin(userTable, eq(userTable.id, generation.userId))
      .where(where),
    db
      .select({
        total:
          sql<number>`coalesce(sum(${generation.creditsConsumed}), 0)`.mapWith(
            Number
          ),
      })
      .from(generation)
      .leftJoin(userTable, eq(userTable.id, generation.userId))
      .where(where),
  ]);

  const withUrls = generations.map((g) => ({
    id: g.id,
    userId: g.userId,
    userName: g.userName,
    userEmail: g.userEmail,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    promptRepairNotice: extractPromptRepairNotice(g.metadata),
    model: g.model,
    size: g.size,
    status: g.status,
    creditsConsumed: g.creditsConsumed,
    creditDetails: extractGenerationCreditDetails(
      g.metadata,
      g.creditsConsumed
    ),
    error: g.error,
    storageKey: g.storageKey,
    storageBucket: g.storageBucket,
    imageUrl: buildSignedStorageImageUrl(g.storageKey, g.storageBucket),
    referenceImages: extractGenerationReferenceImages(g.metadata),
    isLayered: hasLayeredMeta(g.metadata),
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("Usage Records", "使用记录")}
        </h1>
        <p className="text-muted-foreground">
          {canViewAll
            ? copy(
                "All users' generation usage records with server-side filters",
                "所有用户的生成使用记录，支持按条件过滤"
              )
            : copy(
                "Your generation usage records, including failed and pending tasks",
                "你的生成使用记录，包括失败和处理中的任务"
              )}
        </p>
      </div>

      <form
        action={`/${locale}/dashboard/history`}
        className="rounded-lg border border-border bg-background p-4"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {canViewAll && (
            <div className="space-y-1.5">
              <Label htmlFor="usage-user">{copy("User", "用户")}</Label>
              <Input
                id="usage-user"
                name="user"
                defaultValue={filters.user}
                placeholder={copy("Email, name or ID", "邮箱、名称或 ID")}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="usage-status">{copy("Status", "状态")}</Label>
            <select
              id="usage-status"
              name="status"
              defaultValue={filters.status}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="all">{copy("All statuses", "全部状态")}</option>
              <option value="completed">{copy("Completed", "已完成")}</option>
              <option value="pending">{copy("Pending", "处理中")}</option>
              <option value="failed">{copy("Failed", "失败")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usage-model">{copy("Model", "模型")}</Label>
            <Input
              id="usage-model"
              name="model"
              defaultValue={filters.model}
              placeholder={copy("Model contains", "模型包含")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usage-prompt">{copy("Prompt", "提示词")}</Label>
            <Input
              id="usage-prompt"
              name="prompt"
              defaultValue={filters.prompt}
              placeholder={copy("Prompt contains", "提示词包含")}
            />
          </div>
          <DateRangeTimestampFields
            fromName="start"
            toName="end"
            fromInputId="usage-start"
            toInputId="usage-end"
            fromLabel={copy("From", "开始日期")}
            toLabel={copy("To", "结束日期")}
            fromValue={filters.start}
            toValue={filters.end}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto text-sm text-muted-foreground">
            {copy(
              `${totalResult[0]?.count ?? 0} records · ${formatCredits(
                creditsResult[0]?.total
              )} credits`,
              `共 ${totalResult[0]?.count ?? 0} 条 · ${formatCredits(
                creditsResult[0]?.total
              )} 积分`
            )}
          </div>
          <Button
            asChild
            variant="outline"
            className={hasActiveFilters ? "" : "pointer-events-none opacity-50"}
          >
            <Link href={resetHref}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {copy("Reset", "重置")}
            </Link>
          </Button>
          <Button type="submit">
            <Search className="mr-2 h-4 w-4" />
            {copy("Filter", "过滤")}
          </Button>
        </div>
      </form>

      <HistoryClient
        key={`${page}:${filterQuery}`}
        initialGenerations={withUrls}
        totalCount={totalResult[0]?.count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        canViewAll={canViewAll}
        currentUserId={currentUser.id}
        filterQuery={filterQuery}
        hasActiveFilters={hasActiveFilters}
      />
    </div>
  );
}
