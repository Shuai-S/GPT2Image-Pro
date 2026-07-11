"use client";

// 文件职责：按管理路由编排后端池与系统设置子原型，不承载具体工具实现。
// 使用方：非创作界面管理壳层；具体本地交互分别由两个独立组件维护。

import { BackendPoolPreview } from "./admin-backends-preview";
import { SettingsPreview } from "./admin-settings-preview";

/**
 * 按管理路由选择生图后端池或系统设置子原型。
 *
 * @param props.view 管理壳层传入的工具视图标识。
 * @returns 可直接嵌入管理控制台内容区的本地交互原型。
 */
export function AdminToolsPreview({ view }: { view: "backends" | "settings" }) {
  return view === "backends" ? <BackendPoolPreview /> : <SettingsPreview />;
}
