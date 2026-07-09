"use client";

// 文件职责：生图后端池管理面板「Adobe 后端」Tab 的内容组件。
// 使用方：admin-panel.tsx 通过 next/dynamic 懒加载本组件，并把父组件的
// 表单 state、useAction handler、倍率草稿 state 等以 props 注入；TabsContent
// 外壳保留在父文件，本组件只渲染 Tab 内部内容。
// 关键依赖：共享类型/常量/纯函数（Adobe、ADOBE_*_MULTIPLIER_FAMILIES、
// draftToMultipliers 等）从 admin-panel.tsx 导出后在此 import。
// 注意：倍率草稿的初始化回填 useEffect 留在父组件；本组件 lazy mount 时
// 草稿已就绪，不承担任何数据加载副作用。

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/utils";
import { Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  ADOBE_IMAGE_MULTIPLIER_FAMILIES,
  ADOBE_VIDEO_MULTIPLIER_FAMILIES,
  type Adobe,
  type AdobeAccountRow,
  type AdobeFormState,
  draftToMultipliers,
  type Group,
} from "./admin-panel";

/** AdminAdobeTab 的注入 props：全部来自父组件 ImageBackendPoolAdminPanel 的闭包。 */
export interface AdminAdobeTabProps {
  /** 只读观察管理员：隐藏新增/编辑表单与全部操作按钮。 */
  readOnly: boolean;
  /** Adobe 后端新增/编辑表单的受控状态。 */
  adobeForm: AdobeFormState;
  setAdobeForm: Dispatch<SetStateAction<AdobeFormState>>;
  /** 当前后端池的全部 Adobe 后端列表。 */
  adobes: Adobe[];
  /** 全部分组（用于所属分组多选）。 */
  groups: Group[];
  /** 勾选/取消表单中某个分组。 */
  toggleAdobeFormGroup: (groupId: string, checked: boolean) => void;
  /** 重置表单到新增态（取消编辑）。 */
  resetAdobeForm: () => void;
  /** 把某个 Adobe 后端回填进表单并滚动到表单卡片。 */
  editAdobe: (adobe: Adobe) => void;
  /** 保存 Adobe 后端（server action execute）；成功后父组件负责重置与刷新。 */
  saveAdobe: (
    input: Omit<AdobeFormState, "enabledModels"> & { enabledModels: string[] }
  ) => void;
  isSavingAdobe: boolean;
  /** 启用/停用某个 Adobe 后端。 */
  setAdobeEnabled: (input: { id: string; isEnabled: boolean }) => void;
  isSettingAdobeEnabled: boolean;
  /** 切换「遇错常驻」。 */
  setAdobeAlwaysActive: (input: { id: string; alwaysActive: boolean }) => void;
  isSettingAdobeAlwaysActive: boolean;
  /** 删除后端池成员（此 Tab 内 type 固定传 "adobe"）。 */
  deleteMember: (input: { type: "adobe"; id: string }) => void;
  isDeletingMember: boolean;
  /** 直连模式下当前编辑后端的 Adobe cookie 账号列表（父组件 useEffect 加载）。 */
  adobeAccounts: AdobeAccountRow[];
  /** cookie 导入输入框内容（单条 cookie / 每行一个 / JSON 数组）。 */
  adobeCookieInput: string;
  setAdobeCookieInput: Dispatch<SetStateAction<string>>;
  /** 账号备注名（单条）/ 名称前缀（批量）。 */
  adobeAccountName: string;
  setAdobeAccountName: Dispatch<SetStateAction<string>>;
  /** 最近一次批量导入的结果摘要文本。 */
  adobeBatchSummary: string;
  /** 导入并验证单个 Adobe cookie 账号。 */
  importAdobeAccountExec: (input: {
    adobeId: string;
    name?: string;
    cookie: string;
  }) => void;
  isImportingAdobeAccount: boolean;
  /** 批量导入 Adobe cookie 账号（逐条验证、按身份去重）。 */
  importAdobeAccountsExec: (input: {
    adobeId: string;
    cookiesText: string;
    namePrefix?: string;
  }) => void;
  isImportingAdobeAccounts: boolean;
  /** 删除单个 Adobe cookie 账号。 */
  deleteAdobeAccountExec: (input: { id: string }) => void;
  /** 启用/停用单个 Adobe cookie 账号。 */
  setAdobeAccountEnabledExec: (input: {
    id: string;
    isEnabled: boolean;
  }) => void;
  /** 图像模型倍率草稿（family -> 输入框字符串）；初始化回填由父组件完成。 */
  imageMultiplierDraft: Record<string, string>;
  setImageMultiplierDraft: Dispatch<SetStateAction<Record<string, string>>>;
  /** 视频模型倍率草稿（family -> 输入框字符串）。 */
  videoMultiplierDraft: Record<string, string>;
  setVideoMultiplierDraft: Dispatch<SetStateAction<Record<string, string>>>;
  /** 保存图像/视频模型计费倍率。 */
  saveModelMultipliers: (input: {
    image: Record<string, number>;
    video: Record<string, number>;
  }) => void;
  isSavingMultipliers: boolean;
}

/**
 * 生图后端池「Adobe 后端」Tab 内容：左侧新增/编辑表单（含直连账号导入）+
 * 右侧后端卡片列表与模型计费倍率卡片。
 *
 * @param props 见 AdminAdobeTabProps；全部 state 与 handler 由父组件注入，
 * 本组件自身无内部 state、无 useEffect（倍率草稿回填留在父组件）。
 * @returns Tab 内容 JSX；外层 TabsContent 由父组件渲染。
 * @sideEffects 仅通过注入的 handler 触发父组件的 server action 与刷新。
 */
export function AdminAdobeTab({
  readOnly,
  adobeForm,
  setAdobeForm,
  adobes,
  groups,
  toggleAdobeFormGroup,
  resetAdobeForm,
  editAdobe,
  saveAdobe,
  isSavingAdobe,
  setAdobeEnabled,
  isSettingAdobeEnabled,
  setAdobeAlwaysActive,
  isSettingAdobeAlwaysActive,
  deleteMember,
  isDeletingMember,
  adobeAccounts,
  adobeCookieInput,
  setAdobeCookieInput,
  adobeAccountName,
  setAdobeAccountName,
  adobeBatchSummary,
  importAdobeAccountExec,
  isImportingAdobeAccount,
  importAdobeAccountsExec,
  isImportingAdobeAccounts,
  deleteAdobeAccountExec,
  setAdobeAccountEnabledExec,
  imageMultiplierDraft,
  setImageMultiplierDraft,
  videoMultiplierDraft,
  setVideoMultiplierDraft,
  saveModelMultipliers,
  isSavingMultipliers,
}: AdminAdobeTabProps) {
  return (
    <>
      {!readOnly && (
        <Card
          id="adobe-backend-form"
          className={
            adobeForm.id
              ? "ring-2 ring-primary transition-shadow"
              : "transition-shadow"
          }
        >
          <CardHeader>
            <CardTitle className="text-base">
              {adobeForm.id ? "正在编辑 Adobe 后端" : "新增 Adobe 后端"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="名称"
              value={adobeForm.name}
              onChange={(event) =>
                setAdobeForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">接入模式</Label>
              <Select
                value={adobeForm.mode}
                onValueChange={(value) =>
                  setAdobeForm((current) => ({
                    ...current,
                    mode: value === "direct" ? "direct" : "gateway",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gateway">
                    网关（外部 adobe2api）
                  </SelectItem>
                  <SelectItem value="direct">
                    直连（本仓库逆向 + Adobe 账号）
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                直连模式凭据为下方导入的 Adobe cookie 账号，经 TLS 旁路直连
                Firefly，无需外部 adobe2api。
              </p>
            </div>
            {adobeForm.mode === "gateway" && (
              <>
                <Input
                  placeholder="adobe2api 地址，如 http://127.0.0.1:6001"
                  value={adobeForm.baseUrl}
                  onChange={(event) =>
                    setAdobeForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                />
                <Input
                  type="password"
                  placeholder={
                    adobeForm.id
                      ? "Service API Key，留空不修改"
                      : "Service API Key"
                  }
                  value={adobeForm.apiKey}
                  onChange={(event) =>
                    setAdobeForm((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                />
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                启用模型家族（逗号分隔，留空不限制）
              </Label>
              <Input
                placeholder="gpt-image,nano-banana-pro"
                value={adobeForm.enabledModels}
                onChange={(event) =>
                  setAdobeForm((current) => ({
                    ...current,
                    enabledModels: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  默认宽高比
                </Label>
                <Select
                  value={adobeForm.defaultRatio}
                  onValueChange={(value) =>
                    setAdobeForm((current) => ({
                      ...current,
                      defaultRatio: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1x1">1x1</SelectItem>
                    <SelectItem value="16x9">16x9</SelectItem>
                    <SelectItem value="9x16">9x16</SelectItem>
                    <SelectItem value="4x3">4x3</SelectItem>
                    <SelectItem value="3x4">3x4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  默认分辨率
                </Label>
                <Select
                  value={adobeForm.defaultResolution}
                  onValueChange={(value) =>
                    setAdobeForm((current) => ({
                      ...current,
                      defaultResolution: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1k">1k</SelectItem>
                    <SelectItem value="2k">2k</SelectItem>
                    <SelectItem value="4k">4k</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                GPT Image 质量（auto 映射）
              </Label>
              <Select
                value={adobeForm.gptImageQuality}
                onValueChange={(value) =>
                  setAdobeForm((current) => ({
                    ...current,
                    gptImageQuality: value as "low" | "medium" | "high",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                用户选 auto 时映射到此质量；显式选 low/medium/high
                则按用户的来。
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                计费倍率（整个 Adobe 后端，图像+视频）
              </Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={adobeForm.billingMultiplier}
                onChange={(event) =>
                  setAdobeForm((current) => ({
                    ...current,
                    billingMultiplier: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                对 adobe 图像与视频积分成本统一乘以此倍率;与分组倍率叠加。
              </p>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label>所属分组</Label>
                <span className="text-xs text-muted-foreground">可多选</span>
              </div>
              <div className="grid max-h-40 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {groups.map((group) => (
                  <Label
                    key={group.id}
                    className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-sm"
                  >
                    <Checkbox
                      checked={adobeForm.groupIds.includes(group.id)}
                      onCheckedChange={(checked) =>
                        toggleAdobeFormGroup(group.id, Boolean(checked))
                      }
                    />
                    <span className="truncate">{group.name}</span>
                  </Label>
                ))}
                {!groups.length && (
                  <p className="text-xs text-muted-foreground">
                    还没有可选分组。
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">优先级</Label>
                <Input
                  type="number"
                  value={adobeForm.priority}
                  onChange={(event) =>
                    setAdobeForm((current) => ({
                      ...current,
                      priority: Number(event.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">并发</Label>
                <Input
                  type="number"
                  value={adobeForm.concurrency}
                  onChange={(event) =>
                    setAdobeForm((current) => ({
                      ...current,
                      concurrency: Number(event.target.value) || 1,
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label>启用</Label>
              <Switch
                checked={adobeForm.isEnabled}
                onCheckedChange={(checked) =>
                  setAdobeForm((current) => ({
                    ...current,
                    isEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label>遇错仍可用（常驻）</Label>
                <p className="text-xs text-muted-foreground">
                  无视冷却/临时故障始终入选；终态错误（鉴权失效等）仍下线。
                </p>
              </div>
              <Switch
                checked={adobeForm.alwaysActive}
                onCheckedChange={(checked) =>
                  setAdobeForm((current) => ({
                    ...current,
                    alwaysActive: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label>失败进入冷却</Label>
              <Switch
                checked={adobeForm.failureCooldownEnabled}
                onCheckedChange={(checked) =>
                  setAdobeForm((current) => ({
                    ...current,
                    failureCooldownEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label>内容审核</Label>
              <Switch
                checked={adobeForm.contentSafetyEnabled}
                onCheckedChange={(checked) =>
                  setAdobeForm((current) => ({
                    ...current,
                    contentSafetyEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label>允许视频模型</Label>
                <p className="text-xs text-muted-foreground">
                  Phase 1 仅图像；视频后续支持。
                </p>
              </div>
              <Switch
                checked={adobeForm.supportsVideo}
                onCheckedChange={(checked) =>
                  setAdobeForm((current) => ({
                    ...current,
                    supportsVideo: checked,
                  }))
                }
              />
            </div>
            <Button
              className="w-full"
              onClick={() =>
                saveAdobe({
                  ...adobeForm,
                  groupId: adobeForm.groupIds[0] || "default",
                  groupIds: adobeForm.groupIds,
                  enabledModels: adobeForm.enabledModels
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
              disabled={
                isSavingAdobe ||
                !adobeForm.name ||
                (adobeForm.mode === "gateway" &&
                  (!adobeForm.baseUrl || (!adobeForm.id && !adobeForm.apiKey)))
              }
            >
              {isSavingAdobe && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              保存 Adobe 后端
            </Button>
            {adobeForm.mode === "direct" && (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <Label>Adobe 账号（cookie）</Label>
                  <p className="text-xs text-muted-foreground">
                    {adobeForm.id
                      ? "粘贴 Adobe 浏览器 cookie 或插件导出的 JSON；导入时会刷新一次以验证。批量导入支持每行一个 cookie 或 JSON 数组，逐条验证、按 Adobe 账号身份去重。可用仓库 tools/adobe-cookie-exporter/ 浏览器扩展导出（含 HttpOnly cookie）。"
                      : "请先保存后端，再导入 Adobe 账号。"}
                  </p>
                </div>
                {adobeForm.id && (
                  <>
                    <Input
                      placeholder="账号备注名（单条）/ 名称前缀（批量，自动加序号）"
                      value={adobeAccountName}
                      onChange={(event) =>
                        setAdobeAccountName(event.target.value)
                      }
                    />
                    <Textarea
                      placeholder="单条：粘贴一个 cookie 或 JSON；批量：每行一个 cookie，或粘贴 JSON 数组"
                      value={adobeCookieInput}
                      rows={4}
                      onChange={(event) =>
                        setAdobeCookieInput(event.target.value)
                      }
                    />
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={
                        isImportingAdobeAccount || !adobeCookieInput.trim()
                      }
                      onClick={() =>
                        importAdobeAccountExec({
                          adobeId: adobeForm.id,
                          name: adobeAccountName.trim() || undefined,
                          cookie: adobeCookieInput.trim(),
                        })
                      }
                    >
                      {isImportingAdobeAccount && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      导入并验证账号
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={
                        isImportingAdobeAccounts || !adobeCookieInput.trim()
                      }
                      onClick={() =>
                        importAdobeAccountsExec({
                          adobeId: adobeForm.id,
                          cookiesText: adobeCookieInput,
                          namePrefix: adobeAccountName.trim() || undefined,
                        })
                      }
                    >
                      {isImportingAdobeAccounts && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      批量导入（每行一个 cookie / JSON 数组）
                    </Button>
                    {adobeBatchSummary && (
                      <p className="text-xs text-muted-foreground">
                        {adobeBatchSummary}
                      </p>
                    )}
                    <div className="space-y-2">
                      {!adobeAccounts.length && (
                        <p className="text-xs text-muted-foreground">
                          还没有账号。
                        </p>
                      )}
                      {adobeAccounts.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm">
                              {account.displayName ||
                                account.email ||
                                account.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {account.status}
                              {account.lastRefreshError
                                ? ` · ${account.lastRefreshError}`
                                : ""}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {account.creditsError
                                ? `余额读取失败: ${account.creditsError}`
                                : account.creditsAvailable !== null ||
                                    account.creditsTotal !== null
                                  ? `Firefly 余额 ${account.creditsAvailable ?? "?"} / ${account.creditsTotal ?? "?"}`
                                  : "余额未知（刷新后获取）"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Switch
                              checked={account.isEnabled}
                              onCheckedChange={(checked) =>
                                setAdobeAccountEnabledExec({
                                  id: account.id,
                                  isEnabled: checked,
                                })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                deleteAdobeAccountExec({ id: account.id })
                              }
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {adobeForm.id && (
              <Button
                variant="outline"
                className="w-full"
                onClick={resetAdobeForm}
              >
                取消编辑
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {!adobes.length && (
          <p className="text-sm text-muted-foreground">
            还没有 Adobe 后端。新增一个 adobe2api 实例即可被调度。
          </p>
        )}
        {adobes.map((adobe) => (
          <Card key={adobe.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{adobe.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {adobe.mode === "direct"
                      ? "直连模式（Adobe 账号）"
                      : adobe.baseUrl}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded px-2 py-0.5 text-xs",
                    adobe.status === "error"
                      ? "bg-destructive/10 text-destructive"
                      : adobe.isEnabled
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {adobe.isEnabled ? adobe.status : "已停用"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                模型：
                {adobe.enabledModels?.length
                  ? adobe.enabledModels.join(", ")
                  : "不限"}
                {" · 默认 "}
                {adobe.defaultResolution}/{adobe.defaultRatio}
                {" · 优先级 "}
                {adobe.priority}
                {" · 并发 "}
                {adobe.concurrency}
                {" · 成功 "}
                {adobe.successCount}
                {" / 失败 "}
                {adobe.failCount}
              </p>
              {adobe.lastError && (
                <p className="truncate text-xs text-destructive">
                  最近错误：{adobe.lastError}
                </p>
              )}
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => editAdobe(adobe)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSettingAdobeEnabled}
                    onClick={() =>
                      setAdobeEnabled({
                        id: adobe.id,
                        isEnabled: !adobe.isEnabled,
                      })
                    }
                  >
                    {adobe.isEnabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSettingAdobeAlwaysActive}
                    onClick={() =>
                      setAdobeAlwaysActive({
                        id: adobe.id,
                        alwaysActive: !adobe.alwaysActive,
                      })
                    }
                  >
                    {adobe.alwaysActive ? "取消常驻" : "设为常驻"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isDeletingMember}
                    onClick={() =>
                      deleteMember({ type: "adobe", id: adobe.id })
                    }
                  >
                    删除
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模型计费倍率</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                最终积分 = 基础(图像按尺寸/视频按秒) × 模型倍率 × 整个 Adobe
                倍率 × 分组倍率。留空表示该模型不加倍率（默认 1）。
              </p>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  图像模型倍率
                </Label>
                <div className="space-y-2">
                  {ADOBE_IMAGE_MULTIPLIER_FAMILIES.map((family) => (
                    <div
                      key={family}
                      className="grid grid-cols-[1fr_120px] items-center gap-2"
                    >
                      <span className="truncate text-sm">{family}</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="1"
                        value={imageMultiplierDraft[family] ?? ""}
                        onChange={(event) =>
                          setImageMultiplierDraft((current) => ({
                            ...current,
                            [family]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  视频模型倍率
                </Label>
                <div className="space-y-2">
                  {ADOBE_VIDEO_MULTIPLIER_FAMILIES.map((family) => (
                    <div
                      key={family}
                      className="grid grid-cols-[1fr_120px] items-center gap-2"
                    >
                      <span className="truncate text-sm">{family}</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="1"
                        value={videoMultiplierDraft[family] ?? ""}
                        onChange={(event) =>
                          setVideoMultiplierDraft((current) => ({
                            ...current,
                            [family]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Button
                size="sm"
                disabled={isSavingMultipliers}
                onClick={() =>
                  saveModelMultipliers({
                    image: draftToMultipliers(imageMultiplierDraft),
                    video: draftToMultipliers(videoMultiplierDraft),
                  })
                }
              >
                {isSavingMultipliers ? "保存中…" : "保存模型倍率"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
