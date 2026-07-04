"use client";

/**
 * 邀请返佣管理 Dashboard
 *
 * 使用方：/dashboard/admin/referral 页面。
 * 关键依赖：referral 管理端 Server Actions、shadcn/ui 表单与表格结构。
 */

import type {
  ReferralAdminBindingRow,
  ReferralAdminCommissionRow,
  ReferralAdminListResult,
  ReferralAdminProfileRow,
  ReferralAdminTransferRow,
} from "@repo/shared/referral";
import {
  adminCancelReferralCommissionForOrderAction,
  adminListReferralBindingsAction,
  adminListReferralCommissionLedgerAction,
  adminListReferralProfilesAction,
  adminListReferralTransfersAction,
  adminSetReferralCommissionRateAction,
  adminUpdateReferralCodeAction,
} from "@repo/shared/referral/admin-actions";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Edit3,
  Gauge,
  Loader2,
  OctagonX,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type AdminReferralTab = "profiles" | "bindings" | "ledger" | "transfers";
type CommissionStatus =
  | "all"
  | "frozen"
  | "available"
  | "converting"
  | "converted"
  | "canceled";
type TransferStatus = "all" | "pending" | "completed" | "failed";

interface AdminReferralDashboardProps {
  profiles: ReferralAdminListResult<ReferralAdminProfileRow>;
  bindings: ReferralAdminListResult<ReferralAdminBindingRow>;
  ledger: ReferralAdminListResult<ReferralAdminCommissionRow>;
  transfers: ReferralAdminListResult<ReferralAdminTransferRow>;
  locale: string;
}

interface EditDialogState {
  mode: "code" | "rate";
  profile: ReferralAdminProfileRow;
}

interface CancelDialogState {
  provider: "creem" | "epay" | "alipay";
  orderId: string;
}

interface CancelCommissionActionResult {
  errors: Array<{
    commissionId: string;
    message: string;
  }>;
}

const PAGE_SIZE = 20;
const COMMISSION_STATUS_OPTIONS: CommissionStatus[] = [
  "all",
  "frozen",
  "available",
  "converting",
  "converted",
  "canceled",
];
const TRANSFER_STATUS_OPTIONS: TransferStatus[] = [
  "all",
  "pending",
  "completed",
  "failed",
];

function formatDateTime(value: Date | string | null, locale: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoneyCents(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function formatPercentFromBps(value: number | null) {
  if (value === null) return "全局";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "available":
    case "completed":
    case "converted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
    case "frozen":
    case "pending":
    case "converting":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
    case "failed":
    case "canceled":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
    default:
      return "";
  }
}

function PaginationControls({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        第 {page} / {pageCount} 页，共 {total} 条
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/**
 * 渲染管理端邀请返佣页面。
 *
 * @param props - 服务端首屏数据与当前语言。
 * @returns 可搜索、可审计并可编辑邀请码和比例的管理界面。
 * @sideEffects 用户交互会触发 Server Actions 并刷新当前 tab 数据。
 */
export function AdminReferralDashboard({
  profiles: initialProfiles,
  bindings: initialBindings,
  ledger: initialLedger,
  transfers: initialTransfers,
  locale,
}: AdminReferralDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminReferralTab>("profiles");
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState(initialProfiles);
  const [bindings, setBindings] = useState(initialBindings);
  const [ledger, setLedger] = useState(initialLedger);
  const [transfers, setTransfers] = useState(initialTransfers);
  const [commissionStatus, setCommissionStatus] =
    useState<CommissionStatus>("all");
  const [transferStatus, setTransferStatus] = useState<TransferStatus>("all");
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const [cancelDialog, setCancelDialog] = useState<CancelDialogState | null>(
    null
  );
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const { executeAsync: listProfiles } = useAction(
    adminListReferralProfilesAction
  );
  const { executeAsync: listBindings } = useAction(
    adminListReferralBindingsAction
  );
  const { executeAsync: listLedger } = useAction(
    adminListReferralCommissionLedgerAction
  );
  const { executeAsync: listTransfers } = useAction(
    adminListReferralTransfersAction
  );
  const { executeAsync: updateCode, isExecuting: isUpdatingCode } = useAction(
    adminUpdateReferralCodeAction
  );
  const { executeAsync: setRate, isExecuting: isUpdatingRate } = useAction(
    adminSetReferralCommissionRateAction
  );
  const { executeAsync: cancelCommission, isExecuting: isCancelingCommission } =
    useAction(adminCancelReferralCommissionForOrderAction);

  const loadTab = (
    tab: AdminReferralTab,
    page = 1,
    overrides?: {
      commissionStatus?: CommissionStatus;
      transferStatus?: TransferStatus;
    }
  ) => {
    startTransition(async () => {
      const base = { page, pageSize: PAGE_SIZE, query };
      if (tab === "profiles") {
        const result = await listProfiles(base);
        if (result?.data) setProfiles(result.data);
      } else if (tab === "bindings") {
        const result = await listBindings(base);
        if (result?.data) setBindings(result.data);
      } else if (tab === "ledger") {
        const result = await listLedger({
          ...base,
          status: overrides?.commissionStatus ?? commissionStatus,
        });
        if (result?.data) setLedger(result.data);
      } else {
        const result = await listTransfers({
          ...base,
          status: overrides?.transferStatus ?? transferStatus,
        });
        if (result?.data) setTransfers(result.data);
      }
    });
  };

  const openEditDialog = (
    mode: EditDialogState["mode"],
    profile: ReferralAdminProfileRow
  ) => {
    setEditDialog({ mode, profile });
    setEditValue(
      mode === "code"
        ? profile.referralCode
        : String(profile.commissionRateBps ?? "")
    );
    setEditReason("");
  };

  const submitEdit = async () => {
    if (!editDialog) return;
    if (!editReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }

    if (editDialog.mode === "code") {
      const result = await updateCode({
        userId: editDialog.profile.userId,
        code: editValue,
        reason: editReason,
      });
      if (result?.serverError) {
        toast.error(result.serverError);
        return;
      }
      toast.success("邀请码已更新");
    } else {
      const trimmed = editValue.trim();
      const parsedRate = trimmed === "" ? null : Number(trimmed);
      if (parsedRate !== null && !Number.isInteger(parsedRate)) {
        toast.error("返佣比例必须是整数 bps");
        return;
      }
      const result = await setRate({
        userId: editDialog.profile.userId,
        commissionRateBps: parsedRate,
        reason: editReason,
      });
      if (result?.serverError) {
        toast.error(result.serverError);
        return;
      }
      toast.success("专属返佣比例已更新");
    }

    setEditDialog(null);
    loadTab("profiles", profiles.page);
  };

  const openCancelDialog = (item: ReferralAdminCommissionRow) => {
    if (
      item.provider !== "creem" &&
      item.provider !== "epay" &&
      item.provider !== "alipay"
    ) {
      toast.error("不支持该支付提供商");
      return;
    }
    setCancelDialog({ provider: item.provider, orderId: item.orderId });
    setCancelReason("");
  };

  const submitCancelCommission = async () => {
    if (!cancelDialog) return;
    if (!cancelReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }

    const result = await cancelCommission({
      provider: cancelDialog.provider,
      orderId: cancelDialog.orderId,
      reason: cancelReason,
    });
    if (result?.serverError) {
      toast.error(result.serverError);
      return;
    }

    const data = result?.data as CancelCommissionActionResult | undefined;
    if (data?.errors && data.errors.length > 0) {
      toast.error(`取消完成但有 ${data.errors.length} 条冲正失败`);
    } else {
      toast.success("返佣已取消");
    }
    setCancelDialog(null);
    loadTab("ledger", ledger.page);
    loadTab("transfers", transfers.page);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">邀请返佣</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            审计邀请关系、返佣账本和转积分记录，并配置用户专属邀请码与比例。
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadTab(activeTab, 1);
              }}
              placeholder="搜索邮箱、用户 ID、订单或邀请码"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => loadTab(activeTab, 1)}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            刷新
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AdminReferralTab)}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="profiles">档案</TabsTrigger>
            <TabsTrigger value="bindings">绑定</TabsTrigger>
            <TabsTrigger value="ledger">账本</TabsTrigger>
            <TabsTrigger value="transfers">转积分</TabsTrigger>
          </TabsList>

          {activeTab === "ledger" && (
            <Select
              value={commissionStatus}
              onValueChange={(value) => {
                const nextStatus = value as CommissionStatus;
                setCommissionStatus(nextStatus);
                loadTab("ledger", 1, { commissionStatus: nextStatus });
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {activeTab === "transfers" && (
            <Select
              value={transferStatus}
              onValueChange={(value) => {
                const nextStatus = value as TransferStatus;
                setTransferStatus(nextStatus);
                loadTab("transfers", 1, { transferStatus: nextStatus });
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFER_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <TabsContent value="profiles">
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">邀请码</th>
                    <th className="px-4 py-3">比例</th>
                    <th className="px-4 py-3">邀请数</th>
                    <th className="px-4 py-3">可用</th>
                    <th className="px-4 py-3">冻结</th>
                    <th className="px-4 py-3">已转</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.items.map((profile) => (
                    <tr key={profile.userId} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{profile.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {profile.email}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono">{profile.referralCode}</div>
                        {profile.referralCodeCustom && (
                          <Badge variant="outline" className="mt-1">
                            自定义
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatPercentFromBps(profile.commissionRateBps)}
                      </td>
                      <td className="px-4 py-3">{profile.invitedCount}</td>
                      <td className="px-4 py-3">
                        {formatCredits(profile.availableCredits)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCredits(profile.frozenCredits)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCredits(profile.convertedCredits)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog("code", profile)}
                          >
                            <Edit3 className="h-4 w-4" />
                            邀请码
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog("rate", profile)}
                          >
                            <Gauge className="h-4 w-4" />
                            比例
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={profiles.page}
              total={profiles.total}
              onPageChange={(page) => loadTab("profiles", page)}
            />
          </div>
        </TabsContent>

        <TabsContent value="bindings">
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">邀请人</th>
                    <th className="px-4 py-3">被邀请人</th>
                    <th className="px-4 py-3">邀请码</th>
                    <th className="px-4 py-3">绑定时间</th>
                  </tr>
                </thead>
                <tbody>
                  {bindings.items.map((binding) => (
                    <tr key={binding.id} className="border-t">
                      <td className="px-4 py-3">
                        <div>{binding.inviterEmail}</div>
                        <div className="text-xs text-muted-foreground">
                          {binding.inviterUserId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{binding.inviteeEmail}</div>
                        <div className="text-xs text-muted-foreground">
                          {binding.inviteeUserId}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {binding.referralCode}
                      </td>
                      <td className="px-4 py-3">
                        {formatDateTime(binding.createdAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={bindings.page}
              total={bindings.total}
              onPageChange={(page) => loadTab("bindings", page)}
            />
          </div>
        </TabsContent>

        <TabsContent value="ledger">
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">订单</th>
                    <th className="px-4 py-3">邀请人</th>
                    <th className="px-4 py-3">被邀请人</th>
                    <th className="px-4 py-3">订单金额</th>
                    <th className="px-4 py-3">返佣</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">创建时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.orderId}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.provider} / {item.orderKind}
                        </div>
                      </td>
                      <td className="px-4 py-3">{item.inviterEmail}</td>
                      <td className="px-4 py-3">{item.inviteeEmail}</td>
                      <td className="px-4 py-3">
                        {formatMoneyCents(item.orderAmountCents, item.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          {formatCredits(item.commissionCredits)} credits
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatPercentFromBps(item.commissionRateBps)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={statusBadgeClass(item.status)}
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {formatDateTime(item.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={item.status === "canceled"}
                            onClick={() => openCancelDialog(item)}
                          >
                            <OctagonX className="h-4 w-4" />
                            取消
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={ledger.page}
              total={ledger.total}
              onPageChange={(page) => loadTab("ledger", page)}
            />
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">积分</th>
                    <th className="px-4 py-3">账本数</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">幂等键</th>
                    <th className="px-4 py-3">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-4 py-3">
                        <div>{item.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.userId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {formatCredits(item.creditsAmount)}
                      </td>
                      <td className="px-4 py-3">{item.commissionCount}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={statusBadgeClass(item.status)}
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-3 font-mono text-xs">
                        {item.sourceRef}
                      </td>
                      <td className="px-4 py-3">
                        {formatDateTime(item.createdAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={transfers.page}
              total={transfers.total}
              onPageChange={(page) => loadTab("transfers", page)}
            />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(editDialog)}
        onOpenChange={() => setEditDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editDialog?.mode === "code" ? "修改邀请码" : "修改专属比例"}
            </DialogTitle>
            <DialogDescription>
              该操作会写入管理员审计日志，原因会用于后续追溯。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="referral-edit-value">
                {editDialog?.mode === "code" ? "邀请码" : "专属返佣比例 bps"}
              </Label>
              <div className="relative">
                {editDialog?.mode === "rate" && (
                  <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                )}
                <Input
                  id="referral-edit-value"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  placeholder={
                    editDialog?.mode === "code"
                      ? "例如 GPT2IMAGE"
                      : "留空表示使用全局比例"
                  }
                  className={editDialog?.mode === "rate" ? "pl-8" : undefined}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="referral-edit-reason">操作原因</Label>
              <Textarea
                id="referral-edit-reason"
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
                placeholder="填写本次修改原因"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={submitEdit}
              disabled={isUpdatingCode || isUpdatingRate}
            >
              {isUpdatingCode || isUpdatingRate ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelDialog)}
        onOpenChange={() => setCancelDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消订单返佣</DialogTitle>
            <DialogDescription>
              该操作会取消同一订单下的返佣；已转积分的返佣会尝试扣回对应积分。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">支付提供商</span>
                <span className="font-mono">{cancelDialog?.provider}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">订单号</span>
                <span className="break-all font-mono">
                  {cancelDialog?.orderId}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="referral-cancel-reason">操作原因</Label>
              <Textarea
                id="referral-cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="填写取消返佣原因，例如退款、拒付或人工对账"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={submitCancelCommission}
              disabled={isCancelingCommission}
            >
              {isCancelingCommission ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <OctagonX className="h-4 w-4" />
              )}
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
