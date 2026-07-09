"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Progress } from "@repo/ui/components/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Switch } from "@repo/ui/components/switch";
import { TabsContent } from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  CircleAlert,
  Database,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  TimerReset,
  Trash2,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export type TokenSyncMode = "web" | "responses" | "both";
export type Sub2ApiPlanFilter = "all" | "free" | "plus" | "pro" | "non_free";

export type Sub2ApiSourceGroupOption = {
  id: string;
  name: string;
  accountCount: number;
};

export type Sub2ApiAutoSyncTaskView = {
  id: string;
  enabled: boolean;
  sourceGroupId: string | null;
  sourceGroupName: string | null;
  webGroupId: string | null;
  responsesGroupId: string | null;
  syncMode: TokenSyncMode;
  allowMobileRtImport: boolean;
  planFilter: Sub2ApiPlanFilter;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState: boolean;
  intervalMinutes: number | null;
  lastRunAt: Date | string | null;
  managedAccountCount: number;
  lastResult?: {
    sourceCount: number;
    totalSourceCount: number;
    syncedCount: number;
    failed: number;
    deletedCount: number;
  } | null;
};

export type SyncProgressState = {
  status: "idle" | "running" | "success" | "error";
  value: number;
  message: string;
};

export type ImportFormState = {
  sourceGroupId: string;
  webGroupId: string;
  responsesGroupId: string;
  syncMode: TokenSyncMode;
  allowMobileRtImport: boolean;
  planFilter: Sub2ApiPlanFilter;
  createSyncTask: boolean;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState: boolean;
  intervalMinutes: number;
  limit: number;
};

export type ManualImportFormState = {
  refreshTokensText: string;
  webGroupId: string;
  responsesGroupId: string;
  syncMode: TokenSyncMode;
  useMobileRt: boolean;
  namePrefix: string;
  model: string;
  contentSafetyEnabled: boolean;
  priority: number;
  concurrency: number;
};

export type WebAtImportFormState = {
  accessTokensText: string;
  webGroupId: string;
  namePrefix: string;
  model: string;
  contentSafetyEnabled: boolean;
  priority: number;
  concurrency: number;
};

export type SyncTaskFormState = {
  taskId: string;
  enabled: boolean;
  webGroupId: string;
  responsesGroupId: string;
  syncMode: TokenSyncMode;
  allowMobileRtImport: boolean;
  planFilter: Sub2ApiPlanFilter;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState: boolean;
  intervalMinutes: number;
};

export type GroupOption = {
  id: string;
  name: string;
};

interface Sub2ApiImportSectionProps {
  importForm: ImportFormState;
  setImportForm: Dispatch<SetStateAction<ImportFormState>>;
  manualImportForm: ManualImportFormState;
  setManualImportForm: Dispatch<SetStateAction<ManualImportFormState>>;
  webAtImportForm: WebAtImportFormState;
  setWebAtImportForm: Dispatch<SetStateAction<WebAtImportFormState>>;
  syncTaskForm: SyncTaskFormState;
  setSyncTaskForm: Dispatch<SetStateAction<SyncTaskFormState>>;
  editingSyncTask: Sub2ApiAutoSyncTaskView | null;
  setEditingSyncTask: Dispatch<SetStateAction<Sub2ApiAutoSyncTaskView | null>>;
  sub2ApiSourceGroups: Sub2ApiSourceGroupOption[];
  sub2ApiSyncTasks: Sub2ApiAutoSyncTaskView[];
  syncProgress: SyncProgressState;
  manualImportProgress: SyncProgressState;
  effectiveImportSyncMode: TokenSyncMode;
  effectiveManualImportSyncMode: TokenSyncMode;
  isSub2ApiSyncUnavailable: boolean;
  sub2ApiUnavailableMessage: string;
  isLoadingSourceGroups: boolean;
  isLoadingSyncTasks: boolean;
  isSyncingSub2Api: boolean;
  isImportingManualRefreshTokens: boolean;
  isImportingWebAccessTokens: boolean;
  isUpdatingSyncTask: boolean;
  isUpdatingSyncTaskOverwrite: boolean;
  isRunningSub2ApiSyncTask: boolean;
  isSavingSyncTask: boolean;
  isManualImportOpen: boolean;
  setIsManualImportOpen: Dispatch<SetStateAction<boolean>>;
  isWebAtImportOpen: boolean;
  setIsWebAtImportOpen: Dispatch<SetStateAction<boolean>>;
  runningSub2ApiSyncTaskId: string | null;
  authSessionUrl: string;
  groupOptions: GroupOption[];
  manualTokenImportLimit: number;
  manualRtImportBatchSize: number;
  loadSub2ApiSourceGroups: () => void;
  loadSub2ApiSyncTasks: () => void;
  runSub2ApiSync: () => void;
  runManualRefreshTokenImport: () => void;
  importWebAccessTokens: (form: WebAtImportFormState) => void;
  updateSub2ApiSyncTask: (form: SyncTaskFormState) => void;
  openSyncTaskEditor: (task: Sub2ApiAutoSyncTaskView) => void;
  runDeleteSub2ApiSyncTask: (task: Sub2ApiAutoSyncTaskView) => void;
  runSub2ApiSyncTaskNow: (task: Sub2ApiAutoSyncTaskView) => void;
  setSub2ApiTaskEnabled: (input: { taskId: string; enabled: boolean }) => void;
  setSub2ApiTaskOverwriteLocalUnavailableState: (input: {
    taskId: string;
    overwriteLocalUnavailableState: boolean;
  }) => void;
  tokenSyncModeLabel: (value: TokenSyncMode) => string;
  sub2ApiPlanFilterLabel: (value: Sub2ApiPlanFilter) => string;
  groupName: (groups: GroupOption[], groupId: string | null) => string;
  formatOptionalDate: (value: Date | string | null) => string;
}

export function Sub2ApiImportSection({
  importForm,
  setImportForm,
  manualImportForm,
  setManualImportForm,
  webAtImportForm,
  setWebAtImportForm,
  syncTaskForm,
  setSyncTaskForm,
  editingSyncTask,
  setEditingSyncTask,
  sub2ApiSourceGroups,
  sub2ApiSyncTasks,
  syncProgress,
  manualImportProgress,
  effectiveImportSyncMode,
  effectiveManualImportSyncMode,
  isSub2ApiSyncUnavailable,
  sub2ApiUnavailableMessage,
  isLoadingSourceGroups,
  isLoadingSyncTasks,
  isSyncingSub2Api,
  isImportingManualRefreshTokens,
  isImportingWebAccessTokens,
  isUpdatingSyncTask,
  isUpdatingSyncTaskOverwrite,
  isRunningSub2ApiSyncTask,
  isSavingSyncTask,
  isManualImportOpen,
  setIsManualImportOpen,
  isWebAtImportOpen,
  setIsWebAtImportOpen,
  runningSub2ApiSyncTaskId,
  authSessionUrl,
  groupOptions,
  manualTokenImportLimit,
  manualRtImportBatchSize,
  loadSub2ApiSourceGroups,
  loadSub2ApiSyncTasks,
  runSub2ApiSync,
  runManualRefreshTokenImport,
  importWebAccessTokens,
  updateSub2ApiSyncTask,
  openSyncTaskEditor,
  runDeleteSub2ApiSyncTask,
  runSub2ApiSyncTaskNow,
  setSub2ApiTaskEnabled,
  setSub2ApiTaskOverwriteLocalUnavailableState,
  tokenSyncModeLabel,
  sub2ApiPlanFilterLabel,
  groupName,
  formatOptionalDate,
}: Sub2ApiImportSectionProps) {
  return (
    <>
      <TabsContent value="import" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              同步 Sub2API 账号
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              连接 Sub2API Postgres，只同步 OpenAI OAuth 账号。默认排除 free
              套餐并只同步 Codex/Responses，复用 Sub2API 当前 access_token；勾选
              Mobile RT 后才会把 Sub 中 mobile client 的当前 AT 同步为
              Web/同时账号，不刷新也不回写 Sub2API 的 RT。
            </p>
            {isSub2ApiSyncUnavailable && (
              <div className="flex gap-2 rounded-md border border-dashed border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{sub2ApiUnavailableMessage}</span>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Select
                value={importForm.sourceGroupId}
                onValueChange={(value) =>
                  setImportForm((current) => ({
                    ...current,
                    sourceGroupId: value,
                  }))
                }
                disabled={isSub2ApiSyncUnavailable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sub2API 来源分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    全部 Sub2API OpenAI 账号
                  </SelectItem>
                  {sub2ApiSourceGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name} · {group.accountCount} 个账号
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={loadSub2ApiSourceGroups}
                disabled={isSub2ApiSyncUnavailable || isLoadingSourceGroups}
              >
                {isLoadingSourceGroups ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                刷新来源
              </Button>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label>Mobile RT 同步</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  仅用于 Sub 中由 Mobile RT client 同步的账号。关闭时强制只同步
                  Codex/Responses，避免误用普通 Codex RT。
                </p>
              </div>
              <Switch
                checked={importForm.allowMobileRtImport}
                disabled={isSub2ApiSyncUnavailable}
                onCheckedChange={(checked) =>
                  setImportForm((current) => ({
                    ...current,
                    allowMobileRtImport: checked,
                    syncMode: checked ? current.syncMode : "responses",
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={importForm.planFilter}
                onValueChange={(value) =>
                  setImportForm((current) => ({
                    ...current,
                    planFilter: value as Sub2ApiPlanFilter,
                  }))
                }
                disabled={isSub2ApiSyncUnavailable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="套餐筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="non_free">排除 free</SelectItem>
                  <SelectItem value="plus">只导入 plus</SelectItem>
                  <SelectItem value="pro">只导入 pro</SelectItem>
                  <SelectItem value="free">只导入 free</SelectItem>
                  <SelectItem value="all">全部套餐</SelectItem>
                </SelectContent>
              </Select>
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                默认排除 Sub2API 中 plan_type=free 的账号，避免将 team 分组里的
                free 账号再次导入生图站。
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={effectiveImportSyncMode}
                onValueChange={(value) =>
                  setImportForm((current) => ({
                    ...current,
                    syncMode: value as TokenSyncMode,
                  }))
                }
                disabled={
                  isSub2ApiSyncUnavailable || !importForm.allowMobileRtImport
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">同时同步 Web 和 Codex AT</SelectItem>
                  <SelectItem value="web">只同步 Web AT</SelectItem>
                  <SelectItem value="responses">
                    只同步 Codex/Responses AT
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between rounded-md border px-3">
                <Label>接入内容安全审核</Label>
                <Switch
                  checked={importForm.contentSafetyEnabled}
                  disabled={isSub2ApiSyncUnavailable}
                  onCheckedChange={(checked) =>
                    setImportForm((current) => ({
                      ...current,
                      contentSafetyEnabled: checked,
                    }))
                  }
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label>覆盖本站异常状态</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    同步时以 Sub2API
                    当前状态为准，覆盖本站账号池里的错误、限流和冷却状态。
                  </p>
                </div>
                <Switch
                  checked={importForm.overwriteLocalUnavailableState}
                  disabled={isSub2ApiSyncUnavailable}
                  onCheckedChange={(checked) =>
                    setImportForm((current) => ({
                      ...current,
                      overwriteLocalUnavailableState: checked,
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label>创建自动同步任务</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  开启后，本次手动同步会先创建或更新任务，再按任务 runner
                  全量执行；Cron
                  和“立即运行”使用同一配置同步新增、状态变化、移出分组或删除的账号。
                </p>
              </div>
              <Switch
                checked={importForm.createSyncTask}
                disabled={isSub2ApiSyncUnavailable}
                onCheckedChange={(checked) =>
                  setImportForm((current) => ({
                    ...current,
                    createSyncTask: checked,
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={importForm.webGroupId}
                onValueChange={(value) =>
                  setImportForm((current) => ({
                    ...current,
                    webGroupId: value,
                  }))
                }
                disabled={
                  isSub2ApiSyncUnavailable ||
                  effectiveImportSyncMode === "responses"
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Web 账号分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Web：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={importForm.responsesGroupId}
                onValueChange={(value) =>
                  setImportForm((current) => ({
                    ...current,
                    responsesGroupId: value,
                  }))
                }
                disabled={
                  isSub2ApiSyncUnavailable || effectiveImportSyncMode === "web"
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Codex/Responses 账号分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Codex：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>每批扫描数量</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={importForm.limit}
                  disabled={isSub2ApiSyncUnavailable}
                  onChange={(event) =>
                    setImportForm((current) => ({
                      ...current,
                      limit: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  服务端分页批大小，不是同步总数上限。
                </p>
              </div>
              <div className="space-y-1">
                <Label>自动同步间隔（分钟）</Label>
                <Input
                  type="number"
                  min={1}
                  value={importForm.intervalMinutes}
                  disabled={
                    isSub2ApiSyncUnavailable || !importForm.createSyncTask
                  }
                  onChange={(event) =>
                    setImportForm((current) => ({
                      ...current,
                      intervalMinutes: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  仅创建任务时保存；内置调度器到点后按任务间隔判断是否运行。
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <Button
                onClick={runSub2ApiSync}
                disabled={isSub2ApiSyncUnavailable || isSyncingSub2Api}
              >
                {isSyncingSub2Api && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                同步账号
              </Button>
              {(isSyncingSub2Api || syncProgress.status !== "idle") && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{syncProgress.message}</span>
                    <span className="text-muted-foreground">
                      {isSyncingSub2Api ? "同步中" : "已结束"}
                    </span>
                  </div>
                  <Progress
                    value={isSyncingSub2Api ? syncProgress.value : 100}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span className="flex items-center gap-2">
                <TimerReset className="h-4 w-4" />
                自动同步任务
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadSub2ApiSyncTasks}
                disabled={isLoadingSyncTasks}
              >
                {isLoadingSyncTasks ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                刷新
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              任务由上方同步时创建。Cron
              会按任务保存的来源分组和筛选条件同步新增、状态变化和删除；删除任务只停止后续管理，不会删除已导入账号。
            </p>
            {!sub2ApiSyncTasks.length ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                暂无自动同步任务。
              </div>
            ) : (
              <div className="space-y-3">
                {sub2ApiSyncTasks.map((task) => {
                  const sourceLabel =
                    task.sourceGroupName ||
                    task.sourceGroupId ||
                    "全部 Sub2API OpenAI 账号";
                  const isTaskRunning =
                    runningSub2ApiSyncTaskId === task.id &&
                    isRunningSub2ApiSyncTask;
                  return (
                    <div key={task.id} className="rounded-md border p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-all font-medium">
                              {sourceLabel}
                            </span>
                            <Badge
                              variant={task.enabled ? "default" : "secondary"}
                            >
                              {task.enabled ? "启用" : "停用"}
                            </Badge>
                            <Badge variant="outline">
                              {tokenSyncModeLabel(task.syncMode)}
                            </Badge>
                            <Badge variant="outline">
                              {sub2ApiPlanFilterLabel(task.planFilter)}
                            </Badge>
                          </div>
                          <p className="break-all text-xs text-muted-foreground">
                            任务 {task.id} · 目标 Codex{" "}
                            {groupName(
                              groupOptions,
                              task.responsesGroupId || null
                            )}{" "}
                            · 目标 Web{" "}
                            {groupName(groupOptions, task.webGroupId || null)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            管理账号 {task.managedAccountCount} · Mobile RT{" "}
                            {task.allowMobileRtImport ? "允许" : "关闭"} · 审核{" "}
                            {task.contentSafetyEnabled ? "开启" : "关闭"} ·
                            覆盖异常{" "}
                            {task.overwriteLocalUnavailableState
                              ? "开启"
                              : "关闭"}{" "}
                            · 间隔 {task.intervalMinutes || 720} 分钟 · 上次运行{" "}
                            {formatOptionalDate(task.lastRunAt || null)}
                          </p>
                          {task.lastResult && (
                            <p className="text-xs text-muted-foreground">
                              上次结果：来源 {task.lastResult.sourceCount}/
                              {task.lastResult.totalSourceCount} · 写入{" "}
                              {task.lastResult.syncedCount} · 失败{" "}
                              {task.lastResult.failed} · 删除{" "}
                              {task.lastResult.deletedCount}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 text-xs text-muted-foreground">
                          <Label className="flex items-center justify-between gap-3">
                            启用
                            <Switch
                              checked={task.enabled}
                              disabled={isUpdatingSyncTask}
                              onCheckedChange={(checked) =>
                                setSub2ApiTaskEnabled({
                                  taskId: task.id,
                                  enabled: checked,
                                })
                              }
                            />
                          </Label>
                          <Label className="flex items-center justify-between gap-3">
                            覆盖异常
                            <Switch
                              checked={task.overwriteLocalUnavailableState}
                              disabled={isUpdatingSyncTaskOverwrite}
                              onCheckedChange={(checked) =>
                                setSub2ApiTaskOverwriteLocalUnavailableState({
                                  taskId: task.id,
                                  overwriteLocalUnavailableState: checked,
                                })
                              }
                            />
                          </Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              isSub2ApiSyncUnavailable ||
                              isRunningSub2ApiSyncTask
                            }
                            onClick={() => runSub2ApiSyncTaskNow(task)}
                          >
                            {isTaskRunning ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            立即运行
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openSyncTaskEditor(task)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => runDeleteSub2ApiSyncTask(task)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={isManualImportOpen} onOpenChange={setIsManualImportOpen}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6">批量导入 RT</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
            <p className="break-words text-sm text-muted-foreground">
              支持直接粘贴 RT 列表，每行一个；也可以粘贴包含
              refresh_token/refreshToken 的 Auth Session JSON。只有 accessToken
              的 Auth Session 不会在这里导入，请使用“导入 Web AT”。默认按 Codex
              CLI RT 导入；勾选 Mobile RT 后由本站使用 mobile client_id 换取
              AT，并保存刷新后的 RT。这里导入的账号可在本站继续更新 RT，不会写入
              Sub2API。最多处理前 {manualTokenImportLimit.toLocaleString()}{" "}
              条，会按 {manualRtImportBatchSize} 条一批导入，避免大批量 RT 换取
              AT 时单次请求超时。
            </p>
            <p className="break-words text-sm text-muted-foreground">
              获取 Auth Session 可打开{" "}
              <a
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                href={authSessionUrl}
                rel="noreferrer"
                target="_blank"
              >
                Auth Session 接口
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              并粘贴页面返回的整段内容。
            </p>
            <Textarea
              className="h-44 min-h-44 max-w-full resize-y overflow-x-hidden whitespace-pre-wrap break-all font-mono text-xs"
              wrap="soft"
              placeholder={`rt_...
或粘贴包含 "refresh_token" / "refreshToken" 的 Auth Session JSON`}
              value={manualImportForm.refreshTokensText}
              onChange={(event) =>
                setManualImportForm((current) => ({
                  ...current,
                  refreshTokensText: event.target.value,
                }))
              }
            />
            {(isImportingManualRefreshTokens ||
              manualImportProgress.status !== "idle") && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{manualImportProgress.message}</span>
                  <span className="text-muted-foreground">
                    {isImportingManualRefreshTokens ? "导入中" : "已结束"}
                  </span>
                </div>
                <Progress
                  value={
                    isImportingManualRefreshTokens
                      ? manualImportProgress.value
                      : 100
                  }
                />
              </div>
            )}
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label>Mobile RT 导入</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  使用 mobile client_id 获取 AT。关闭时强制只导入
                  Codex/Responses，避免普通 Codex RT 被误用于 Web。
                </p>
              </div>
              <Switch
                checked={manualImportForm.useMobileRt}
                onCheckedChange={(checked) =>
                  setManualImportForm((current) => ({
                    ...current,
                    useMobileRt: checked,
                    syncMode: checked ? current.syncMode : "responses",
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={effectiveManualImportSyncMode}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    syncMode: value as TokenSyncMode,
                  }))
                }
                disabled={!manualImportForm.useMobileRt}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="responses">
                    只导入 Codex/Responses
                  </SelectItem>
                  <SelectItem value="web">只导入 Web</SelectItem>
                  <SelectItem value="both">同时导入 Web 和 Codex</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="名称前缀"
                value={manualImportForm.namePrefix}
                onChange={(event) =>
                  setManualImportForm((current) => ({
                    ...current,
                    namePrefix: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={manualImportForm.webGroupId}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    webGroupId: value,
                  }))
                }
                disabled={effectiveManualImportSyncMode === "responses"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Web 账号分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Web：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={manualImportForm.responsesGroupId}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    responsesGroupId: value,
                  }))
                }
                disabled={effectiveManualImportSyncMode === "web"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Codex/Responses 账号分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Codex：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>模型</Label>
                <Input
                  placeholder="可选"
                  value={manualImportForm.model}
                  onChange={(event) =>
                    setManualImportForm((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Input
                  type="number"
                  min={0}
                  value={manualImportForm.priority}
                  onChange={(event) =>
                    setManualImportForm((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  数字越小越先调度。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>最大并发数</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={manualImportForm.concurrency}
                  onChange={(event) =>
                    setManualImportForm((current) => ({
                      ...current,
                      concurrency: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  作为负载分母，值越大越能分摊请求。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>接入内容安全审核</Label>
              <Switch
                checked={manualImportForm.contentSafetyEnabled}
                onCheckedChange={(checked) =>
                  setManualImportForm((current) => ({
                    ...current,
                    contentSafetyEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsManualImportOpen(false)}
                disabled={isImportingManualRefreshTokens}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={runManualRefreshTokenImport}
                disabled={
                  isImportingManualRefreshTokens ||
                  !manualImportForm.refreshTokensText.trim()
                }
              >
                {isImportingManualRefreshTokens && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                导入并获取 AT
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isWebAtImportOpen} onOpenChange={setIsWebAtImportOpen}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6">批量导入 Web AT</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
            <p className="break-words text-sm text-muted-foreground">
              支持粘贴 Web accessToken、Bearer token，或打开{" "}
              <a
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                href={authSessionUrl}
                rel="noreferrer"
                target="_blank"
              >
                Auth Session 接口
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              后粘贴完整 JSON。Web AT 没有对应
              RT，过期后需要重新导入；该入口只创建 Web 账号，不会创建
              Codex/Responses 账号。
            </p>
            <Textarea
              className="h-44 min-h-44 max-w-full resize-y overflow-x-hidden whitespace-pre-wrap break-all font-mono text-xs"
              wrap="soft"
              placeholder={`Bearer eyJ...
或粘贴 https://chatgpt.com/api/auth/session 返回的完整 JSON`}
              value={webAtImportForm.accessTokensText}
              onChange={(event) =>
                setWebAtImportForm((current) => ({
                  ...current,
                  accessTokensText: event.target.value,
                }))
              }
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={webAtImportForm.webGroupId}
                onValueChange={(value) =>
                  setWebAtImportForm((current) => ({
                    ...current,
                    webGroupId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Web 账号分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Web：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="名称前缀"
                value={webAtImportForm.namePrefix}
                onChange={(event) =>
                  setWebAtImportForm((current) => ({
                    ...current,
                    namePrefix: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>模型</Label>
                <Input
                  placeholder="可选"
                  value={webAtImportForm.model}
                  onChange={(event) =>
                    setWebAtImportForm((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Input
                  type="number"
                  min={0}
                  value={webAtImportForm.priority}
                  onChange={(event) =>
                    setWebAtImportForm((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  数字越小越先调度。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>最大并发数</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={webAtImportForm.concurrency}
                  onChange={(event) =>
                    setWebAtImportForm((current) => ({
                      ...current,
                      concurrency: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  作为负载分母，值越大越能分摊请求。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>接入内容安全审核</Label>
              <Switch
                checked={webAtImportForm.contentSafetyEnabled}
                onCheckedChange={(checked) =>
                  setWebAtImportForm((current) => ({
                    ...current,
                    contentSafetyEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsWebAtImportOpen(false)}
                disabled={isImportingWebAccessTokens}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => importWebAccessTokens(webAtImportForm)}
                disabled={
                  isImportingWebAccessTokens ||
                  !webAtImportForm.accessTokensText.trim()
                }
              >
                {isImportingWebAccessTokens && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                导入 Web AT
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingSyncTask)}
        onOpenChange={(open) => {
          if (!open) setEditingSyncTask(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑自动同步任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              来源范围：
              {editingSyncTask?.sourceGroupName ||
                editingSyncTask?.sourceGroupId ||
                "全部 Sub2API OpenAI 账号"}
              。来源分组变化会影响托管账号清理范围，如需更换来源，请删除后重新创建任务。
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>启用任务</Label>
                <Switch
                  checked={syncTaskForm.enabled}
                  onCheckedChange={(checked) =>
                    setSyncTaskForm((current) => ({
                      ...current,
                      enabled: checked,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>Mobile RT 同步</Label>
                <Switch
                  checked={syncTaskForm.allowMobileRtImport}
                  onCheckedChange={(checked) =>
                    setSyncTaskForm((current) => ({
                      ...current,
                      allowMobileRtImport: checked,
                      syncMode: checked ? current.syncMode : "responses",
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={syncTaskForm.planFilter}
                onValueChange={(value) =>
                  setSyncTaskForm((current) => ({
                    ...current,
                    planFilter: value as Sub2ApiPlanFilter,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="non_free">排除 free</SelectItem>
                  <SelectItem value="all">全部套餐</SelectItem>
                  <SelectItem value="plus">只同步 plus</SelectItem>
                  <SelectItem value="pro">只同步 pro</SelectItem>
                  <SelectItem value="free">只同步 free</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={syncTaskForm.syncMode}
                onValueChange={(value) =>
                  setSyncTaskForm((current) => ({
                    ...current,
                    syncMode: value as TokenSyncMode,
                  }))
                }
                disabled={!syncTaskForm.allowMobileRtImport}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">同时同步 Web 和 Codex</SelectItem>
                  <SelectItem value="web">只同步 Web</SelectItem>
                  <SelectItem value="responses">
                    只同步 Codex/Responses
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>自动同步间隔（分钟）</Label>
              <Input
                type="number"
                min={1}
                value={syncTaskForm.intervalMinutes}
                onChange={(event) =>
                  setSyncTaskForm((current) => ({
                    ...current,
                    intervalMinutes: Number(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                内置调度器会定期检查任务；每个任务只在距离上次运行达到该间隔后执行。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={syncTaskForm.webGroupId}
                onValueChange={(value) =>
                  setSyncTaskForm((current) => ({
                    ...current,
                    webGroupId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Web 目标分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Web：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={syncTaskForm.responsesGroupId}
                onValueChange={(value) =>
                  setSyncTaskForm((current) => ({
                    ...current,
                    responsesGroupId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Codex 目标分组" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      Codex：{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>接入内容安全审核</Label>
                <Switch
                  checked={syncTaskForm.contentSafetyEnabled}
                  onCheckedChange={(checked) =>
                    setSyncTaskForm((current) => ({
                      ...current,
                      contentSafetyEnabled: checked,
                    }))
                  }
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label>覆盖本站异常状态</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    同步时使用 Sub2API 当前状态覆盖本站错误、限流和冷却。
                  </p>
                </div>
                <Switch
                  checked={syncTaskForm.overwriteLocalUnavailableState}
                  onCheckedChange={(checked) =>
                    setSyncTaskForm((current) => ({
                      ...current,
                      overwriteLocalUnavailableState: checked,
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingSyncTask(null)}
                disabled={isSavingSyncTask}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => updateSub2ApiSyncTask(syncTaskForm)}
                disabled={isSavingSyncTask}
              >
                {isSavingSyncTask && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                保存任务
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
