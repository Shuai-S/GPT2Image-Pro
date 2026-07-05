"use client";

/*
 * 职责：渲染管理后台设置区的一级菜单，隔离系统设置、模型定价与生图后端池。
 * 使用方：dashboard/admin/settings/page.tsx。
 * 关键依赖：shared 系统设置面板与本应用的生图后端池管理面板。
 */

import {
  ModelPricingSettingsPanel,
  SystemSettingsPanel,
} from "@repo/shared/system-settings/components";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { useState } from "react";

import { ImageBackendPoolAdminPanel } from "@/features/image-backend-pool";

type AdminSettingsTabsProps = {
  timeZone: string;
  // 是否允许管理系统设置（含 BETTER_AUTH_SECRET 等密钥）。仅超管为 true；
  // 普通 admin 仅能管理生图后端池，不应看到/进入系统设置 tab（见审计 S-C1）。
  canManageSystemSettings: boolean;
};

type AdminSettingsTab = "system" | "model-pricing" | "image-backends";

export function AdminSettingsTabs({
  timeZone,
  canManageSystemSettings,
}: AdminSettingsTabsProps) {
  const defaultTab: AdminSettingsTab = canManageSystemSettings
    ? "system"
    : "image-backends";
  const [activeTab, setActiveTab] = useState<AdminSettingsTab>(defaultTab);
  const [mountedTabs, setMountedTabs] = useState<Set<AdminSettingsTab>>(
    () => new Set([defaultTab])
  );

  /**
   * 切换一级设置菜单。
   *
   * @param value Tabs 传入的目标菜单值。
   * @returns 无返回值。
   * @sideEffects 更新当前 tab，并按需记录已挂载的懒加载面板。
   */
  const handleTabChange = (value: string) => {
    // 非超管禁止进入敏感配置入口，强制回落到后端池。
    const requestedTab =
      value === "system" || value === "model-pricing"
        ? value
        : "image-backends";
    const nextTab: AdminSettingsTab =
      requestedTab !== "image-backends" && canManageSystemSettings
        ? requestedTab
        : "image-backends";
    setActiveTab(nextTab);
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
        {canManageSystemSettings ? (
          <TabsTrigger
            value="system"
            className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            系统设置
          </TabsTrigger>
        ) : null}
        {canManageSystemSettings ? (
          <TabsTrigger
            value="model-pricing"
            className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            模型定价
          </TabsTrigger>
        ) : null}
        <TabsTrigger
          value="image-backends"
          className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          生图后端池
        </TabsTrigger>
      </TabsList>
      {canManageSystemSettings ? (
        <TabsContent value="system" className="mt-6">
          {mountedTabs.has("system") ? <SystemSettingsPanel /> : null}
        </TabsContent>
      ) : null}
      {canManageSystemSettings ? (
        <TabsContent value="model-pricing" className="mt-6">
          {mountedTabs.has("model-pricing") ? (
            <ModelPricingSettingsPanel />
          ) : null}
        </TabsContent>
      ) : null}
      <TabsContent value="image-backends" className="mt-6">
        {mountedTabs.has("image-backends") ? (
          <ImageBackendPoolAdminPanel timeZone={timeZone} />
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
