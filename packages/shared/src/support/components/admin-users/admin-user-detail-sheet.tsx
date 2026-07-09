"use client";

/**
 * 管理员用户详情抽屉
 *
 * 职责：渲染单个用户的详情 Sheet（概览/积分/生图/API Key/审计 5 个 Tab）与
 * 超管快捷操作栏。纯展示组件：数据由父组件 AdminUsersManagement 的
 * getUserDetailAction 拉取后经 props 注入，本组件不直接调 server action，
 * 操作按钮仅回调父级打开对应 Dialog。
 *
 * 使用方：admin-users-management.tsx 经 next/dynamic 懒加载（detailMounted 门控），
 * 使详情渲染代码不进 admin/users 首屏 client bundle。
 * 关键依赖：Shadcn Sheet/Tabs、buildStorageThumbnailUrl 缩略图、formatCredits。
 */

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { KeyRound, Loader2, XCircle } from "lucide-react";
import Image from "next/image";
import { useMemo } from "react";
import { getUserRoleLabel } from "../../../auth/roles";
import { formatCredits } from "../../../credits/format";
import { buildStorageThumbnailUrl } from "../../../storage/image-url";
import {
  formatDateTime,
  planBadge,
  type UserDetail,
  type UserRow,
} from "./admin-users-shared";

/**
 * 用户详情 Sheet 的 props。
 *
 * 回调均把"打开哪个 Dialog"的决定权交回父组件，保持 Dialog 单实例被主列表与
 * 详情共享触发的既有结构不变。
 */
export type UserDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUser: UserRow | null;
  detail: UserDetail | null;
  isDetailLoading: boolean;
  canManageRoles: boolean;
  onGrant: (user: UserRow) => void;
  onCreditAdjust: (user: UserRow) => void;
  onPlanChange: (user: UserRow) => void;
  onKeyStatus: (key: UserDetail["apiKeys"][number], isActive: boolean) => void;
};

/**
 * 返回生成记录状态徽章。
 *
 * @param status 生成状态。
 * @returns 徽章元素。
 */
function generationStatusBadge(status: string) {
  if (status === "completed") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
        成功
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="secondary" className="bg-destructive/10 text-destructive">
        失败
      </Badge>
    );
  }
  return <Badge variant="secondary">处理中</Badge>;
}

/**
 * 渲染管理员用户详情抽屉。
 *
 * @param props 详情数据、打开状态与各操作回调。
 * @returns 详情 Sheet 元素。
 * @sideEffects 无；操作全部经回调交由父组件处理。
 */
export function UserDetailSheet({
  open,
  onOpenChange,
  selectedUser,
  detail,
  isDetailLoading,
  canManageRoles,
  onGrant,
  onCreditAdjust,
  onPlanChange,
  onKeyStatus,
}: UserDetailSheetProps) {
  const detailBalance = detail?.creditsBalance;
  const detailGenerationRate = useMemo(() => {
    if (!detail?.generationSummary.total) {
      return "0%";
    }
    return `${Math.round(
      (detail.generationSummary.completed / detail.generationSummary.total) *
        100
    )}%`;
  }, [detail]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col overflow-hidden p-0 sm:max-w-4xl xl:max-w-5xl"
        style={{
          top: 12,
          right: 12,
          bottom: 12,
          height: "calc(100dvh - 24px)",
          maxHeight: "calc(100dvh - 24px)",
        }}
      >
        <SheetHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <SheetTitle>用户详情</SheetTitle>
          <SheetDescription>
            {selectedUser
              ? `${selectedUser.name} · ${selectedUser.email}`
              : "查看用户账户、积分、生图和 API Key。"}
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-ui min-h-0 flex-1 overflow-y-scroll px-6 py-5">
          {isDetailLoading || !detail ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">套餐</div>
                    <div className="mt-2">{planBadge(detail.plan)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">余额</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatCredits(detailBalance?.balance ?? 0)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      生成成功率
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {detailGenerationRate}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      API Key
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {detail.apiKeys.filter((item) => item.isActive).length}/
                      {detail.apiKeys.length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {canManageRoles && selectedUser ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
                  <span className="mr-1 text-sm text-muted-foreground">
                    超管操作
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onGrant(selectedUser)}
                  >
                    加积分
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCreditAdjust(selectedUser)}
                  >
                    减积分
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPlanChange(selectedUser)}
                  >
                    修改套餐
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    修改套餐只变更权限，不发放套餐积分。
                  </span>
                </div>
              ) : null}

              <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="border bg-muted/40">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="credits">积分</TabsTrigger>
                  <TabsTrigger value="generations">生图</TabsTrigger>
                  <TabsTrigger value="api">API Key</TabsTrigger>
                  <TabsTrigger value="audit">审计</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <InfoBlock
                      title="账户"
                      rows={[
                        ["用户 ID", detail.user.id],
                        ["邮箱", detail.user.email],
                        [
                          "邮箱验证",
                          detail.user.emailVerified ? "已验证" : "未验证",
                        ],
                        ["角色", getUserRoleLabel(detail.user.role)],
                        ["注册时间", formatDateTime(detail.user.createdAt)],
                        ["更新时间", formatDateTime(detail.user.updatedAt)],
                      ]}
                    />
                    <InfoBlock
                      title="订阅"
                      rows={[
                        ["状态", detail.subscription?.status ?? "无订阅"],
                        ["Price ID", detail.subscription?.priceId ?? "-"],
                        [
                          "周期开始",
                          formatDateTime(
                            detail.subscription?.currentPeriodStart
                          ),
                        ],
                        [
                          "周期结束",
                          formatDateTime(detail.subscription?.currentPeriodEnd),
                        ],
                        [
                          "到期取消",
                          detail.subscription?.cancelAtPeriodEnd ? "是" : "否",
                        ],
                      ]}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="credits" className="space-y-4">
                  <InfoBlock
                    title="积分账户"
                    rows={[
                      ["状态", detailBalance?.status ?? "未创建"],
                      ["余额", formatCredits(detailBalance?.balance ?? 0)],
                      [
                        "累计获得",
                        formatCredits(detailBalance?.totalEarned ?? 0),
                      ],
                      [
                        "累计消费",
                        formatCredits(detailBalance?.totalSpent ?? 0),
                      ],
                    ]}
                  />
                  <Panel title="有效积分批次">
                    {detail.activeBatches.length === 0 ? (
                      <EmptyText>暂无有效批次</EmptyText>
                    ) : (
                      <div className="space-y-2">
                        {detail.activeBatches.map((batch) => (
                          <div
                            key={batch.id}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">
                                {formatCredits(batch.remaining)} /{" "}
                                {formatCredits(batch.amount)}
                              </span>
                              <Badge variant="secondary">
                                {batch.sourceType}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              发放 {formatDateTime(batch.issuedAt)} · 过期{" "}
                              {formatDateTime(batch.expiresAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                  <Panel title="最近积分流水">
                    {detail.transactions.length === 0 ? (
                      <EmptyText>暂无流水</EmptyText>
                    ) : (
                      <div className="space-y-2">
                        {detail.transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
                          >
                            <div>
                              <div className="font-medium">{tx.type}</div>
                              <div className="text-xs text-muted-foreground">
                                {tx.description || "-"} ·{" "}
                                {formatDateTime(tx.createdAt)}
                              </div>
                            </div>
                            <span className="font-medium">
                              {formatCredits(tx.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </TabsContent>

                <TabsContent value="generations" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric
                      label="总生成"
                      value={detail.generationSummary.total}
                    />
                    <Metric
                      label="成功"
                      value={detail.generationSummary.completed}
                    />
                    <Metric
                      label="失败"
                      value={detail.generationSummary.failed}
                    />
                    <Metric
                      label="消耗积分"
                      value={formatCredits(
                        detail.generationSummary.creditsConsumed
                      )}
                    />
                  </div>
                  <Panel title="最近生图记录">
                    {detail.generations.length === 0 ? (
                      <EmptyText>暂无生图记录</EmptyText>
                    ) : (
                      <div className="scrollbar-ui max-h-[55vh] space-y-3 overflow-y-scroll pr-2">
                        {detail.generations.map((item) => (
                          <div
                            key={item.id}
                            className="grid gap-3 rounded-md border bg-background p-3 text-sm md:grid-cols-[84px_minmax(0,1fr)]"
                          >
                            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md bg-muted">
                              {item.imageUrl ? (
                                <Image
                                  // 走 /w/ 路径段缩略图 + unoptimized 直连。
                                  // 不能用 Next 图片优化器:它对带 ?sig= 的本地图会
                                  // 返回 400("url parameter is not allowed",需配
                                  // images.localPatterns);且优化器会拉 5~7MB 原图来
                                  // 生成 80px 缩略图。改直连 /w160/ 小 webp。
                                  src={
                                    buildStorageThumbnailUrl(
                                      item.imageUrl,
                                      160
                                    ) ?? item.imageUrl
                                  }
                                  alt={item.prompt}
                                  width={80}
                                  height={80}
                                  sizes="80px"
                                  className="h-full w-full object-cover"
                                  unoptimized
                                />
                              ) : item.status === "failed" ? (
                                <XCircle className="h-5 w-5 text-destructive" />
                              ) : (
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                {generationStatusBadge(item.status)}
                                <Badge
                                  variant="secondary"
                                  className="max-w-[180px] truncate font-mono font-normal"
                                  title={item.model}
                                >
                                  {item.model}
                                </Badge>
                                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                                  {item.size}
                                </span>
                                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                                  {formatCredits(item.creditsConsumed)}
                                </span>
                              </div>
                              <p
                                className="line-clamp-2 break-words leading-snug"
                                title={item.prompt}
                              >
                                {item.prompt}
                              </p>
                              {item.error ? (
                                <p
                                  className="line-clamp-2 break-words text-xs leading-snug text-destructive"
                                  title={item.error}
                                >
                                  {item.error}
                                </p>
                              ) : null}
                              <p className="text-xs text-muted-foreground">
                                {formatDateTime(item.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </TabsContent>

                <TabsContent value="api" className="space-y-4">
                  <Panel title="外接 API Key">
                    {detail.apiKeys.length === 0 ? (
                      <EmptyText>暂无 API Key</EmptyText>
                    ) : (
                      <div className="space-y-2">
                        {detail.apiKeys.map((key) => (
                          <div
                            key={key.id}
                            className="flex flex-col gap-3 rounded-md border p-3 text-sm md:flex-row md:items-center md:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <KeyRound className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{key.name}</span>
                                <Badge
                                  variant="secondary"
                                  className={
                                    key.isActive
                                      ? "bg-emerald-100 text-emerald-700"
                                      : ""
                                  }
                                >
                                  {key.isActive ? "启用" : "禁用"}
                                </Badge>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {key.keyPrefix}...{key.lastFour} · 最近使用{" "}
                                {formatDateTime(key.lastUsedAt)} · 创建{" "}
                                {formatDateTime(key.createdAt)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                已用 {formatCredits(key.creditsUsed)} ·{" "}
                                {key.creditLimit === null
                                  ? "不限额"
                                  : `剩余 ${formatCredits(
                                      Math.max(
                                        0,
                                        key.creditLimit - key.creditsUsed
                                      )
                                    )} / ${formatCredits(key.creditLimit)}`}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onKeyStatus(key, !key.isActive)}
                            >
                              {key.isActive ? "禁用" : "启用"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </TabsContent>

                <TabsContent value="audit" className="space-y-4">
                  <Panel title="最近管理员操作">
                    {detail.auditLogs.length === 0 ? (
                      <EmptyText>暂无审计记录</EmptyText>
                    ) : (
                      <div className="space-y-2">
                        {detail.auditLogs.map((log) => (
                          <div
                            key={log.id}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">{log.action}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatDateTime(log.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {log.reason || "未填写原因"} · 管理员{" "}
                              {log.adminUserId || "-"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * 详情面板通用卡片容器。
 */
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

/**
 * 标签-值成对信息块。
 */
function InfoBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Panel title={title}>
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[92px_1fr] gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/**
 * 单指标卡。
 */
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

/**
 * 空态文案。
 */
function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}