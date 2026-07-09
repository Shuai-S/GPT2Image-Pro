"use client";

// 文件职责：生图后端池管理面板「API 后端」Tab 的内容组件。
// 使用方：admin-panel.tsx 通过 next/dynamic 懒加载本组件，并把父组件的
// 表单 state、useAction handler、pending 标志等以 props 注入；TabsContent
// 外壳保留在父文件，本组件只渲染 Tab 内部内容。
// 关键依赖：共享类型/常量/纯函数（Api、API_PROTOCOL_OPTIONS、formatCooldown 等）
// 从 admin-panel.tsx 导出后在此 import，不复制实现。

import { Badge } from "@repo/ui/components/badge";
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
import {
  Activity,
  Ban,
  CheckCircle2,
  Infinity as InfinityIcon,
  Loader2,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import type { Dispatch, SetStateAction } from "react";

import {
  API_INTERFACE_MODE_OPTIONS,
  API_PROTOCOL_OPTIONS,
  type Api,
  type ApiFormState,
  type ApiHealthCheckView,
  type ApiInterfaceModeFormValue,
  type ApiProtocolFormValue,
  apiGroupIds,
  apiHealthStatusLabel,
  apiInterfaceModeLabel,
  CHAT_COMPLETIONS_UPSTREAM_MODE_OPTIONS,
  type ChatCompletionsUpstreamModeFormValue,
  COMMON_FIREFLY_MODELS,
  COMMON_GOOGLE_IMAGE_MODELS,
  COMMON_IMAGE_API_MODELS,
  formatCooldown,
  formatDate,
  formatModelList,
  formatOptionalDate,
  type Group,
  groupNames,
  IMAGES_UPSTREAM_MODE_OPTIONS,
  type ImagesUpstreamModeFormValue,
  isCoolingDown,
  parseModelList,
} from "./admin-panel";

/** AdminApisTab 的注入 props：全部来自父组件 ImageBackendPoolAdminPanel 的闭包。 */
export interface AdminApisTabProps {
  /** 只读观察管理员：隐藏新增/编辑表单与全部操作按钮。 */
  readOnly: boolean;
  /** API 后端新增/编辑表单的受控状态。 */
  apiForm: ApiFormState;
  setApiForm: Dispatch<SetStateAction<ApiFormState>>;
  /** 当前后端池的全部 API 后端列表。 */
  apis: Api[];
  /** 全部分组（用于所属分组多选与名称展示）。 */
  groups: Group[];
  /** 勾选/取消表单中某个分组。 */
  toggleApiFormGroup: (groupId: string, checked: boolean) => void;
  /** 重置表单到新增态（取消编辑）。 */
  resetApiForm: () => void;
  /** 把某个 API 后端回填进表单进入编辑态。 */
  editApi: (api: Api) => void;
  /** 保存 API 后端（server action execute）；成功后父组件负责重置与刷新。 */
  saveApi: (
    input: Omit<ApiFormState, "enabledModels" | "retrySwitchLimit"> & {
      enabledModels: string[];
      retrySwitchLimit: number | null;
    }
  ) => void;
  isSavingApi: boolean;
  /** 启用/停用某个 API 后端。 */
  setApiEnabled: (input: { id: string; isEnabled: boolean }) => void;
  isSettingApiEnabled: boolean;
  /** 切换「遇错常驻」。 */
  setApiAlwaysActive: (input: { id: string; alwaysActive: boolean }) => void;
  isSettingApiAlwaysActive: boolean;
  /** 删除后端池成员（此 Tab 内 type 固定传 "api"）。 */
  deleteMember: (input: { type: "api"; id: string }) => void;
  isDeletingMember: boolean;
  /** 对单个 API 发起真实测活；副作用见父组件实现（消耗一次出图额度）。 */
  runApiHealthCheck: (apiId: string) => Promise<void>;
  /** 手动终止进行中的测活。 */
  abortApiHealthCheck: (apiId: string) => void;
  /** 正在测活中的 API id 列表。 */
  testingApiIds: string[];
  /** 各 API 最近一次测活结果（按 id 索引）。 */
  apiHealthChecks: Record<string, ApiHealthCheckView>;
}

/**
 * 生图后端池「API 后端」Tab 内容：左侧新增/编辑表单 + 右侧后端卡片列表。
 *
 * @param props 见 AdminApisTabProps；全部 state 与 handler 由父组件注入，
 * 本组件自身无内部 state、无 useEffect。
 * @returns Tab 内容 JSX；外层 TabsContent 由父组件渲染。
 * @sideEffects 仅通过注入的 handler 触发父组件的 server action 与刷新。
 */
export function AdminApisTab({
  readOnly,
  apiForm,
  setApiForm,
  apis,
  groups,
  toggleApiFormGroup,
  resetApiForm,
  editApi,
  saveApi,
  isSavingApi,
  setApiEnabled,
  isSettingApiEnabled,
  setApiAlwaysActive,
  isSettingApiAlwaysActive,
  deleteMember,
  isDeletingMember,
  runApiHealthCheck,
  abortApiHealthCheck,
  testingApiIds,
  apiHealthChecks,
}: AdminApisTabProps) {
  return (
    <>
      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {apiForm.id ? "编辑 API 后端" : "新增 API 后端"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="名称"
              value={apiForm.name}
              onChange={(event) =>
                setApiForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Input
              placeholder="https://api.openai.com/v1"
              value={apiForm.baseUrl}
              onChange={(event) =>
                setApiForm((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
            />
            <Input
              type="password"
              placeholder={apiForm.id ? "API Key，留空不修改" : "API Key"}
              value={apiForm.apiKey}
              onChange={(event) =>
                setApiForm((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
            />
            <div className="space-y-2">
              <Label>协议类型</Label>
              <Select
                value={apiForm.apiProtocol}
                onValueChange={(value) =>
                  setApiForm((current) => ({
                    ...current,
                    apiProtocol: value as ApiProtocolFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_PROTOCOL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  API_PROTOCOL_OPTIONS.find(
                    (option) => option.value === apiForm.apiProtocol
                  )?.detail
                }
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
                      checked={apiForm.groupIds.includes(group.id)}
                      onCheckedChange={(checked) =>
                        toggleApiFormGroup(group.id, Boolean(checked))
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
              <p className="text-xs text-muted-foreground">
                取消全部分组即为未分组；同一 API 可同时被多个分组调度。
              </p>
            </div>
            <Input
              placeholder="默认模型，可选"
              value={apiForm.model}
              onChange={(event) =>
                setApiForm((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
            />
            <div className="space-y-2">
              <Label>可用模型</Label>
              <Textarea
                placeholder="每行或逗号分隔；留空表示不限制"
                value={apiForm.enabledModels}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    enabledModels: event.target.value,
                  }))
                }
              />
              <div className="flex flex-wrap gap-2">
                {[
                  ...COMMON_IMAGE_API_MODELS,
                  ...COMMON_GOOGLE_IMAGE_MODELS,
                  ...COMMON_FIREFLY_MODELS,
                ].map((model) => (
                  <Button
                    key={model}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setApiForm((current) => ({
                        ...current,
                        enabledModels: parseModelList(
                          `${current.enabledModels}\n${model}`
                        ).join(","),
                      }))
                    }
                  >
                    {model}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                参考渠道设计：每个 API
                后端声明可服务模型；调度时请求模型不在列表内会跳过该后端。
              </p>
            </div>
            <div className="space-y-2">
              <Label>接口类型</Label>
              <Select
                value={apiForm.interfaceMode}
                onValueChange={(value) =>
                  setApiForm((current) => ({
                    ...current,
                    interfaceMode: value as ApiInterfaceModeFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_INTERFACE_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  API_INTERFACE_MODE_OPTIONS.find(
                    (option) => option.value === apiForm.interfaceMode
                  )?.detail
                }
              </p>
            </div>
            <div className="space-y-2">
              <Label>Images 上游</Label>
              <Select
                value={apiForm.imagesUpstreamMode}
                onValueChange={(value) =>
                  setApiForm((current) => ({
                    ...current,
                    imagesUpstreamMode: value as ImagesUpstreamModeFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGES_UPSTREAM_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  IMAGES_UPSTREAM_MODE_OPTIONS.find(
                    (option) => option.value === apiForm.imagesUpstreamMode
                  )?.detail
                }
              </p>
            </div>
            <div className="space-y-2">
              <Label>Chat Completions 上游</Label>
              <Select
                value={apiForm.chatCompletionsUpstreamMode}
                onValueChange={(value) =>
                  setApiForm((current) => ({
                    ...current,
                    chatCompletionsUpstreamMode:
                      value as ChatCompletionsUpstreamModeFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_COMPLETIONS_UPSTREAM_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  CHAT_COMPLETIONS_UPSTREAM_MODE_OPTIONS.find(
                    (option) =>
                      option.value === apiForm.chatCompletionsUpstreamMode
                  )?.detail
                }
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>优先级</Label>
              <Input
                type="number"
                min={0}
                value={apiForm.priority}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                数字越小越先调度；同优先级下再按最大并发数（负载权重）比较负载。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>最大并发数</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={apiForm.concurrency}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    concurrency: Number(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                单后端最大同时在飞请求数（1-100）。同时也是同优先级下的负载权重：
                值越大越能分到更多请求。整池可并发 =
                各后端最大并发数之和；后端少时
                务必调大，否则高并发会被挡成「无可用账号或 API」。
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>流式调用</Label>
              <Switch
                checked={apiForm.useStream}
                onCheckedChange={(checked) =>
                  setApiForm((current) => ({
                    ...current,
                    useStream: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>是否启用</Label>
              <Switch
                checked={apiForm.isEnabled}
                onCheckedChange={(checked) =>
                  setApiForm((current) => ({
                    ...current,
                    isEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label>遇错仍保持可用（永不冷却）</Label>
                <p className="text-xs text-muted-foreground">
                  开启后该 API
                  不会因失败被自动下线或冷却，始终参与调度；失败仍会
                  记录并切换到其他后端。需与「是否启用」同时开启才生效。
                </p>
              </div>
              <Switch
                checked={apiForm.alwaysActive}
                onCheckedChange={(checked) =>
                  setApiForm((current) => ({
                    ...current,
                    alwaysActive: checked,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label>失败进入冷却</Label>
                <p className="text-xs text-muted-foreground">
                  开启后该 API 的瞬时/可恢复失败（5xx、超时、限流等）会进入定时
                  冷却、暂时下线，到点自动恢复。关闭（默认）则不冷却，只有确定性
                  错误（凭证废、缺图像工具、中转坏）会被踢出。常驻开启时本项无效。
                </p>
              </div>
              <Switch
                checked={apiForm.failureCooldownEnabled}
                onCheckedChange={(checked) =>
                  setApiForm((current) => ({
                    ...current,
                    failureCooldownEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5 rounded-md border p-3">
              <Label>API 后端失败切换次数上限</Label>
              <Input
                type="number"
                min={0}
                max={1000}
                placeholder="留空表示不限制"
                value={apiForm.retrySwitchLimit}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    retrySwitchLimit: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                该 API 作为首个命中渠道时，失败后最多切换多少个其它后端。
                留空沿用旧行为；0 表示该渠道失败即返回，不再换后端。
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label>Adobe 来源（按 Adobe 计费 + 进 firefly 调度）</Label>
                <p className="text-xs text-muted-foreground">
                  上游实为 Adobe 的 gpt 格式 api。开启后：计费吃下方成员倍率
                  （命中组倍率 × 成员倍率，与 Adobe 伪账号同口径）；调度上参与
                  firefly 候选，firefly-* 请求自动反向转换成 gpt
                  请求后由本后端处理。
                </p>
              </div>
              <Switch
                checked={apiForm.adobeSourced}
                onCheckedChange={(checked) =>
                  setApiForm((current) => ({
                    ...current,
                    adobeSourced: checked,
                  }))
                }
              />
            </div>
            {apiForm.adobeSourced && (
              <div className="space-y-1.5">
                <Label>计费倍率（成员）</Label>
                <Input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={apiForm.billingMultiplier}
                  onChange={(event) =>
                    setApiForm((current) => ({
                      ...current,
                      billingMultiplier: event.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  仅「Adobe 来源」开启时生效。最终扣费 =
                  向上保留两位(向上保留两位 (基础价 + 审核附加) × 模型倍率 ×
                  命中组倍率 × 本成员倍率)。
                </p>
                {(() => {
                  // 实时算例：以 nano-banana-pro · 1024×1024 为例，套上方输入的成员
                  // 倍率，与"含分组倍率示例"同口径（基础价 6 + 审核附加 0.04 + 嵌套
                  // ceil2），再叠模型倍率（线上 IMAGE_MODEL_MULTIPLIERS：
                  // nano-banana-pro x1.5）与示例组倍率。香蕉 pro 是"多一些乘数"的典型。
                  const member = Number(apiForm.billingMultiplier) || 1;
                  const sampleGroup = 1.2;
                  const modelMultiplier = 1.5;
                  const ceil2 = (v: number) => Math.ceil(v * 100 - 1e-9) / 100;
                  const final = ceil2(
                    ceil2(6.04) * modelMultiplier * sampleGroup * member
                  );
                  return (
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                      <div className="font-medium">
                        算例：nano-banana-pro · 1024×1024
                      </div>
                      <div className="text-muted-foreground">
                        模型 x{modelMultiplier} · 组 x{sampleGroup}（示例） ·
                        成员 x{member}
                      </div>
                      <div className="text-muted-foreground">
                        向上保留两位(向上保留两位(6 基础价 + 0.04 审核附加) x{" "}
                        {modelMultiplier} x {sampleGroup} x {member})
                      </div>
                      <div className="font-medium text-foreground">
                        = {final} 积分/张
                      </div>
                      <p className="text-muted-foreground">
                        模型倍率（如 nano-banana-pro x1.5）按
                        IMAGE_MODEL_MULTIPLIERS
                        配置、与本成员倍率叠乘；关闭「Adobe 来源」则成员
                        x1（同普通 api）。
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
            <Button
              className="w-full"
              onClick={() =>
                saveApi({
                  ...apiForm,
                  groupId: apiForm.groupIds[0] || "default",
                  groupIds: apiForm.groupIds,
                  enabledModels: parseModelList(apiForm.enabledModels),
                  retrySwitchLimit:
                    apiForm.retrySwitchLimit === ""
                      ? null
                      : Number(apiForm.retrySwitchLimit),
                })
              }
              disabled={
                isSavingApi ||
                !apiForm.name ||
                !apiForm.baseUrl ||
                (!apiForm.id && !apiForm.apiKey)
              }
            >
              {isSavingApi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存 API 后端
            </Button>
            {apiForm.id && (
              <Button
                variant="outline"
                className="w-full"
                onClick={resetApiForm}
              >
                取消编辑
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {apis.map((api) => {
          const healthCheck = apiHealthChecks[api.id];

          return (
            <Card key={api.id}>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Plug className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{api.name}</span>
                    <Badge variant="outline">
                      {apiInterfaceModeLabel(api.interfaceMode)}
                    </Badge>
                    <Badge variant="outline">
                      {api.apiProtocol === "google" ? "Google" : "OpenAI"}
                    </Badge>
                    <Badge variant="outline">
                      Chat:{" "}
                      {api.chatCompletionsUpstreamMode === "chat_completions"
                        ? "原生"
                        : "Responses"}
                    </Badge>
                    <Badge variant="outline">
                      Images:{" "}
                      {api.interfaceMode === "task"
                        ? "Task"
                        : api.imagesUpstreamMode === "responses"
                          ? "Responses"
                          : "原生"}
                    </Badge>
                    <Badge variant="secondary">{api.status}</Badge>
                    {isCoolingDown(api.cooldownUntil) && (
                      <Badge variant="secondary">冷却中</Badge>
                    )}
                    {!api.isEnabled && <Badge variant="secondary">停用</Badge>}
                    {api.alwaysActive && (
                      <Badge variant="outline">遇错常驻</Badge>
                    )}
                    <Badge variant="outline">
                      失败切换{" "}
                      {api.retrySwitchLimit === null ||
                      api.retrySwitchLimit === undefined
                        ? "不限"
                        : api.retrySwitchLimit}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {api.baseUrl} · {groupNames(groups, apiGroupIds(api))} ·{" "}
                    优先级 {api.priority} · 最大并发数 {api.concurrency} ·{" "}
                    {formatDate(api.lastUsedAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    可用模型：{formatModelList(api.enabledModels)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {api.interfaceMode === "mixed"
                      ? `混合接口；文生图/图生图走 ${api.imagesUpstreamMode === "responses" ? "Responses" : "Images"}，Chat 按独立开关调度。`
                      : api.interfaceMode === "task"
                        ? "Task 任务接口；文生图/图生图先提交任务，再轮询任务结果，不参与 Chat/Agent/Responses 调度。"
                        : api.interfaceMode === "responses"
                          ? `仅 Responses；${api.imagesUpstreamMode === "responses" ? "可承接文生图/图生图转换" : "默认不承接文生图/图生图"}。`
                          : "仅 Images；只用于文生图/图生图，不参与 Chat/Agent/Responses 调度。"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    成功 {api.successCount} · 失败 {api.failCount} · 冷却至{" "}
                    {formatCooldown(api.cooldownUntil)}
                  </p>
                  {api.lastError && (
                    <p className="mt-1 line-clamp-2 text-xs text-destructive">
                      {formatOptionalDate(api.lastErrorAt)} · {api.lastError}
                    </p>
                  )}
                  {healthCheck && (
                    <div
                      className={cn(
                        "mt-4 max-w-3xl rounded-md border p-3",
                        healthCheck.result.ok
                          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
                          : "border-destructive/30 bg-destructive/5"
                      )}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <Badge
                          variant={
                            healthCheck.result.ok ? "outline" : "secondary"
                          }
                        >
                          最近测活：
                          {apiHealthStatusLabel(healthCheck.result.status)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatOptionalDate(healthCheck.checkedAt)}
                        </span>
                        <span className="text-muted-foreground">
                          {healthCheck.result.latencyMs}ms
                        </span>
                      </div>
                      {healthCheck.result.ok &&
                      healthCheck.result.previewImageUrl ? (
                        <Image
                          src={healthCheck.result.previewImageUrl}
                          alt={`${api.name} 测活返回图片`}
                          width={320}
                          height={320}
                          unoptimized
                          className="h-auto max-h-72 w-full max-w-sm rounded-md border bg-background object-contain"
                        />
                      ) : (
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs text-foreground">
                          {healthCheck.result.diagnosticText ||
                            healthCheck.result.message}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!readOnly && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingApiIds.includes(api.id)}
                        onClick={() => {
                          void runApiHealthCheck(api.id);
                        }}
                      >
                        {testingApiIds.includes(api.id) ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Activity className="mr-2 h-4 w-4" />
                        )}
                        测活
                      </Button>
                      {testingApiIds.includes(api.id) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => abortApiHealthCheck(api.id)}
                          title="手动终止测活"
                        >
                          <Ban className="mr-2 h-4 w-4" />
                          终止
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSettingApiEnabled}
                        onClick={() =>
                          setApiEnabled({
                            id: api.id,
                            isEnabled: !api.isEnabled,
                          })
                        }
                      >
                        {api.isEnabled ? (
                          <>
                            <Ban className="mr-2 h-4 w-4" />
                            停用
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            启用
                          </>
                        )}
                      </Button>
                      <Button
                        variant={api.alwaysActive ? "secondary" : "outline"}
                        size="sm"
                        disabled={isSettingApiAlwaysActive}
                        onClick={() =>
                          setApiAlwaysActive({
                            id: api.id,
                            alwaysActive: !api.alwaysActive,
                          })
                        }
                        title="开启后该 API 遇错也不下线、永不冷却，始终参与调度"
                      >
                        <InfinityIcon className="mr-2 h-4 w-4" />
                        {api.alwaysActive ? "取消常驻" : "遇错常驻"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => editApi(api)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        编辑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isDeletingMember}
                        onClick={() =>
                          deleteMember({ type: "api", id: api.id })
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
