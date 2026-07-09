"use client";

/**
 * 管理员用户管理的共享类型与展示工具
 *
 * 职责：存放 AdminUsersManagement 主组件与 UserDetailSheet 详情抽屉共用的
 * 行/详情类型、日期格式化与套餐徽章，避免两组件互相 import 造成循环依赖
 * （父组件经 next/dynamic 懒加载子组件，子组件若反向 import 父模块会让
 * 依赖图成环）。
 *
 * 使用方：admin-users-management.tsx、admin-user-detail-sheet.tsx。
 * 关键依赖：auth/roles 的用户角色类型、time-zone 格式化。
 */

import { Badge } from "@repo/ui/components/badge";
import type { AppUserRole } from "../../../auth/roles";
import { formatDateInTimeZone } from "../../../time-zone";

export type PlanFilter =
  | "all"
  | "free"
  | "starter"
  | "pro"
  | "ultra"
  | "enterprise";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: AppUserRole;
  banned: boolean;
  bannedReason: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  creditsBalance: number;
  creditsTotalEarned: number;
  creditsTotalSpent: number;
  creditsStatus: "active" | "frozen";
  subscriptionStatus: string | null;
  subscriptionPriceId: string | null;
  subscriptionCurrentPeriodEnd: Date | null;
  plan: PlanFilter;
  generationCount: number;
  failedGenerationCount: number;
  apiKeyCount: number;
  activeApiKeyCount: number;
};

export type UserDetail = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: AppUserRole;
    banned: boolean;
    bannedReason: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  creditsBalance: {
    balance: number;
    totalEarned: number;
    totalSpent: number;
    status: "active" | "frozen";
    createdAt: Date;
    updatedAt: Date;
  } | null;
  subscription: {
    status: string;
    priceId: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  plan: PlanFilter;
  activeBatches: Array<{
    id: string;
    amount: number;
    remaining: number;
    expiresAt: Date | null;
    sourceType: string;
    sourceRef: string | null;
    issuedAt: Date;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    description: string | null;
    createdAt: Date;
  }>;
  generations: Array<{
    id: string;
    prompt: string;
    model: string;
    size: string;
    status: "pending" | "completed" | "failed";
    creditsConsumed: number;
    error: string | null;
    imageUrl: string | null;
    createdAt: Date;
  }>;
  apiKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastFour: string;
    creditLimit: number | null;
    creditsUsed: number;
    lastUsedAt: Date | null;
    isActive: boolean;
    createdAt: Date;
  }>;
  auditLogs: Array<{
    id: string;
    adminUserId: string | null;
    action: string;
    reason: string | null;
    createdAt: Date;
  }>;
  generationSummary: {
    total: number;
    completed: number;
    failed: number;
    creditsConsumed: number;
  };
};

/**
 * 格式化日期时间为中文时区展示。
 *
 * @param value Date、ISO 字符串或空值。
 * @returns 格式化文本；无效值返回 "-"。
 */
export function formatDateTime(value?: Date | string | null) {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return formatDateInTimeZone(date, "zh", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 返回套餐徽章。
 *
 * @param plan 套餐标识。
 * @returns 徽章元素。
 */
export function planBadge(plan: PlanFilter) {
  const label = plan === "all" ? "Unknown" : plan.toUpperCase();
  const className =
    plan === "enterprise"
      ? "bg-foreground text-background"
      : plan === "ultra"
        ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
        : plan === "pro"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : plan === "starter"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  );
}