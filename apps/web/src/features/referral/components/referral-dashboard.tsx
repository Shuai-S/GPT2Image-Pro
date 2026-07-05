"use client";

/**
 * 邀请返利 Dashboard
 *
 * 使用方：/dashboard/referral 页面。
 * 关键依赖：referral Server Actions、剪贴板 API、next-safe-action。
 */

import { formatCredits } from "@repo/shared/credits/format";
import type { ReferralOverview } from "@repo/shared/referral";
import { convertMyReferralCommissionToCreditsAction } from "@repo/shared/referral/actions";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Check, Copy, Gift, LinkIcon, RefreshCw, Wallet } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

interface ReferralDashboardProps {
  overview: ReferralOverview;
  inviteLink: string;
  locale: string;
}

function formatPercentFromBps(bps: number) {
  const percent = bps / 100;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(percent)}%`;
}

function formatDate(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/**
 * 将积分数格式化为带单位的页面展示文本。
 *
 * @param value - 返佣积分数量。
 * @param isZh - 当前页面是否为中文。
 * @returns 带积分单位的展示文本。
 * @sideEffects 无。
 */
function formatCreditAmount(value: number, isZh: boolean) {
  const amount = formatCredits(value);
  return isZh ? `${amount} 积分` : `${amount} credits`;
}

/**
 * 将人民币分格式化为页面展示金额。
 *
 * @param cents - 已按人民币归一的金额分。
 * @param locale - 当前页面语言，用于本地化货币格式。
 * @returns 带人民币币种符号的金额文本。
 * @sideEffects 无。
 */
function formatCnyFromCents(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * 展示邀请链接、返佣汇总和转积分操作。
 *
 * @param overview - 服务端读取的当前用户返佣概览。
 * @param inviteLink - 可分享邀请链接。
 * @param locale - 当前页面语言。
 * @returns 邀请返利操作界面。
 * @sideEffects 复制邀请链接、调用转积分 Server Action、刷新页面数据。
 */
export function ReferralDashboard({
  overview,
  inviteLink,
  locale,
}: ReferralDashboardProps) {
  const [copied, setCopied] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const isZh = locale === "zh";
  const copy = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );
  const hasAvailableCredits = overview.availableCredits > 0;
  const stats = useMemo(
    () => [
      {
        label: copy("Available credits", "可转积分"),
        value: formatCreditAmount(overview.availableCredits, isZh),
        icon: Wallet,
      },
      {
        label: copy("Frozen credits", "冻结积分"),
        value: formatCreditAmount(overview.frozenCredits, isZh),
        icon: RefreshCw,
      },
      {
        label: copy("Converted credits", "已转积分"),
        value: formatCreditAmount(overview.convertedCredits, isZh),
        icon: Check,
      },
      {
        label: copy("Invitees", "邀请人数"),
        value: String(overview.invitedCount),
        icon: Gift,
      },
    ],
    [copy, isZh, overview]
  );

  const { execute: convert, isPending } = useAction(
    convertMyReferralCommissionToCreditsAction,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        toast.success(
          copy(
            `Converted ${formatCredits(data.creditsAmount)} credits`,
            `已转为 ${formatCredits(data.creditsAmount)} 积分`
          )
        );
        startRefresh(() => window.location.reload());
      },
      onError: ({ error }) => {
        toast.error(
          error.serverError ||
            copy("Failed to convert referral credits", "返佣转积分失败")
        );
      },
    }
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success(copy("Invite link copied", "邀请链接已复制"));
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleConvert = () => {
    convert({ requestId: crypto.randomUUID() });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium">
            {copy("Referral", "邀请返利")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {copy(
              "Share your link and convert eligible referral rewards into credits.",
              "分享邀请链接，将符合条件的返利额度转为站内积分。"
            )}
          </p>
        </div>
        <Button
          type="button"
          onClick={handleConvert}
          disabled={!hasAvailableCredits || isPending || isRefreshing}
        >
          <Wallet className="h-4 w-4" />
          {copy("Convert to credits", "转为积分")}
        </Button>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              {copy("Invite Link", "邀请链接")}
            </CardTitle>
            <Badge variant="secondary">
              {formatPercentFromBps(overview.effectiveCommissionRateBps)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input readOnly value={inviteLink} className="pl-9" />
          </div>
          <Button type="button" variant="outline" onClick={handleCopy}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copy("Copy", "复制")}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{item.value}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {copy("Invitees", "被邀请用户")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {overview.invitees.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {copy(
                "Invitees will appear here after they sign up with your link.",
                "通过你的链接注册的用户会显示在这里。"
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">
                      {copy("User", "用户")}
                    </th>
                    <th className="py-3 pr-4 font-medium">
                      {copy("Joined", "绑定时间")}
                    </th>
                    <th className="py-3 pr-4 text-right font-medium">
                      {copy("Total Recharge", "累计充值")}
                    </th>
                    <th className="py-3 text-right font-medium">
                      {copy("Reward Credits", "返利积分")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.invitees.map((invitee) => (
                    <tr key={invitee.userId} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">
                          {invitee.name || copy("User", "用户")}
                        </div>
                        <div className="text-muted-foreground">
                          {invitee.email}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {formatDate(invitee.joinedAt, locale)}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium">
                        {formatCnyFromCents(
                          invitee.totalOrderAmountCents,
                          locale
                        )}
                      </td>
                      <td className="py-3 text-right font-medium">
                        {formatCreditAmount(
                          invitee.totalCommissionCredits,
                          isZh
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
