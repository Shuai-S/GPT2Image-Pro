"use client";

// 文件职责：生图后端池管理面板「分组」Tab 的内容组件。
// 使用方：admin-panel.tsx 通过 next/dynamic 懒加载本组件，并把父组件的
//   表单 state、useAction handler、pending 标志等以 props 注入；TabsContent
//   外壳保留在父文件，本组件只渲染 Tab 内部内容。
// 关键依赖：共享类型/常量/纯函数（Group、PLAN_OPTIONS、planLabel 等）从
//   admin-panel.tsx 导出后在此 import，不复制实现。

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
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/utils";
import { FolderTree, Loader2, Pencil, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  childGroupNames,
  compactModelList,
  type ContentSafetyFormValue,
  formatModelList,
  GROUP_BACKEND_TYPE_OPTIONS,
  type Group,
  type GroupBackendTypeFormValue,
  type GroupFormState,
  groupBackendTypeLabel,
  PLAN_OPTIONS,
  planLabel,
  safetyLabel,
} from "./admin-panel";
import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";

/** AdminGroupsTab 的注入 props：全部来自父组件 ImageBackendPoolAdminPanel 的闭包。 */
export interface AdminGroupsTabProps {
  /** 只读观察管理员：隐藏新增/编辑表单与行内操作按钮。 */
  readOnly: boolean;
  /** 分组新增/编辑表单的受控状态。 */
  groupForm: GroupFormState;
  setGroupForm: Dispatch<SetStateAction<GroupFormState>>;
  /** 当前后端池的全部分组（右侧列表 + 嵌套子分组下拉）。 */
  groups: Group[];
  /** mixed 父分组可选的子分组候选（仅非 mixed 分组），由父组件 useMemo 派生。 */
  childGroupOptions: Group[];
  /** 重置表单到新增态（取消编辑）。 */
  resetGroupForm: () => void;
  /** 把某个分组回填进表单进入编辑态。 */
  editGroup: (group: Group) => void;
  /** 保存分组（server action execute）；成功后父组件负责重置与刷新。 */
  saveGroup: (input: GroupFormState) => void;
  /** 是否正在保存分组。 */
  isSavingGroup: boolean;
  /** 删除分组（server action execute, 入参 { id }）。 */
  deleteGroup: (input: { id: string }) => void;
  /** 是否正在删除分组。 */
  isDeletingGroup: boolean;
}

/**
 * 生图后端池「分组」Tab 内容：左侧新增/编辑表单 + 右侧分组卡片列表。
 *
 * @param props 见 AdminGroupsTabProps；全部 state 与 handler 由父组件注入,
 *   本组件本身无内部 state、无 useEffect、无 useMemo。
 * @returns Tab 内容 JSX；外层 TabsContent 由父组件渲染。
 * @sideEffects 仅通过注入的 handler 触发父组件的 server action 与刷新。
 */
export function AdminGroupsTab({
  readOnly,
  groupForm,
  setGroupForm,
  groups,
  childGroupOptions,
  resetGroupForm,
  editGroup,
  saveGroup,
  isSavingGroup,
  isDeletingGroup,
}: AdminGroupsTabProps) {
  return (
    <>
          {!readOnly && (
            <Card>
              <CardHeader>
            <CardTitle className="text-base">
              {groupForm.id ? "编辑分组" : "新增分组"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="分组名称"
              value={groupForm.name}
              onChange={(event) =>
                setGroupForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Textarea
              placeholder="说明"
              value={groupForm.description}
              onChange={(event) =>
                setGroupForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={groupForm.isEnabled}
                  onCheckedChange={(checked) =>
                    setGroupForm((current) => ({
                      ...current,
                      isEnabled: Boolean(checked),
                    }))
                  }
                />
                启用
              </Label>
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={groupForm.isDefault}
                  onCheckedChange={(checked) =>
                    setGroupForm((current) => ({
                      ...current,
                      isDefault: Boolean(checked),
                    }))
                  }
                />
                默认
              </Label>
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={groupForm.isUserSelectable}
                  onCheckedChange={(checked) =>
                    setGroupForm((current) => ({
                      ...current,
                      isUserSelectable: Boolean(checked),
                    }))
                  }
                />
                用户可选
              </Label>
            </div>
            <div className="space-y-2">
              <Label>内容安全</Label>
              <Select
                value={groupForm.contentSafety}
                onValueChange={(value) =>
                  setGroupForm((current) => ({
                    ...current,
                    contentSafety: value as ContentSafetyFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">继承成员</SelectItem>
                  <SelectItem value="enabled">强制开启</SelectItem>
                  <SelectItem value="disabled">强制关闭</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>分组类型</Label>
              <Select
                value={groupForm.backendType}
                onValueChange={(value) =>
                  setGroupForm((current) => ({
                    ...current,
                    backendType: value as GroupBackendTypeFormValue,
                    childGroupIds:
                      value === "mixed" ? current.childGroupIds : [],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BACKEND_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  GROUP_BACKEND_TYPE_OPTIONS.find(
                    (option) => option.value === groupForm.backendType
                  )?.detail
                }
              </p>
            </div>
            <div
              className={cn(
                "space-y-2 rounded-md border p-3",
                groupForm.backendType !== "mixed" &&
                  "bg-muted/30 text-muted-foreground"
              )}
            >
              <div className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-muted-foreground" />
                <Label>嵌套子分组</Label>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                仅 mixed 分组可嵌套一层子分组，子分组必须是仅 Web 或仅
                Codex/Responses。调度时会先进入 mixed
                父组，再按请求类型筛选父组和子组内的可用成员。
              </p>
              {groupForm.backendType === "mixed" ? (
                childGroupOptions.length ? (
                  <div className="grid max-h-52 gap-2 overflow-y-auto pr-1">
                    {childGroupOptions.map((group) => (
                      <Label
                        key={group.id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">
                            {group.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {groupBackendTypeLabel(group.backendType)} ·
                            账号 {group.accountCount} · API {group.apiCount}
                            · Adobe {group.adobeCount}
                          </span>
                        </span>
                        <Checkbox
                          checked={groupForm.childGroupIds.includes(
                            group.id
                          )}
                          onCheckedChange={(checked) =>
                            setGroupForm((current) => ({
                              ...current,
                              childGroupIds: checked
                                ? Array.from(
                                    new Set([
                                      ...current.childGroupIds,
                                      group.id,
                                    ])
                                  )
                                : current.childGroupIds.filter(
                                    (childGroupId) =>
                                      childGroupId !== group.id
                                  ),
                            }))
                          }
                        />
                      </Label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    暂无可嵌套的非 mixed 分组。
                  </div>
                )
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs">
                  当前分组类型不能嵌套子分组。
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>最低套餐</Label>
              <Select
                value={groupForm.minPlan}
                onValueChange={(value) =>
                  setGroupForm((current) => ({
                    ...current,
                    minPlan: value as SubscriptionPlan,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                用户套餐低于该档位时不可选择此后端分组，外接 API Key
                也不能绑定。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>计费倍率</Label>
              <Input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={groupForm.billingMultiplier}
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    billingMultiplier: Number(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                该分组被用户选中或设为默认时，本站积分按此倍率结算；mixed
                父分组调度到子分组成员时，父分组倍率和实际命中的子分组倍率会相乘生效。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>分组优先级</Label>
              <Input
                type="number"
                min={0}
                value={groupForm.priority}
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                数字越小，默认分组候选和分组列表越靠前；账号调度仍会继续比较账号优先级和负载。
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => saveGroup(groupForm)}
              disabled={isSavingGroup || !groupForm.name}
            >
              {isSavingGroup && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              保存分组
            </Button>
            {groupForm.id && (
              <Button
                variant="outline"
                className="w-full"
                onClick={resetGroupForm}
              >
                取消编辑
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {groups.map((group) => (
          <Card key={group.id}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{group.name}</span>
                  {group.isDefault && <Badge>默认</Badge>}
                  {!group.isEnabled && (
                    <Badge variant="secondary">停用</Badge>
                  )}
                  {group.isUserSelectable && (
                    <Badge variant="outline">用户可选</Badge>
                  )}
                  <Badge variant="outline">
                    最低 {planLabel(group.minPlan)}
                  </Badge>
                  <Badge variant="outline">
                    {groupBackendTypeLabel(group.backendType)}
                  </Badge>
                  {group.billingMultiplier !== 1 && (
                    <Badge variant="secondary">
                      计费 x{group.billingMultiplier}
                    </Badge>
                  )}
                  {group.childGroupIds.length > 0 && (
                    <Badge variant="secondary">
                      子分组 {group.childGroupIds.length}
                    </Badge>
                  )}
                  {group.availableModels.length > 0 && (
                    <Badge variant="secondary">
                      模型 {group.availableModels.length}
                    </Badge>
                  )}
                  <Badge
                    variant={
                      group.contentSafetyEnabled === false
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {safetyLabel(group.contentSafetyEnabled)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {group.description || "无说明"} · 优先级 {group.priority}{" "}
                  · 计费倍率 x{group.billingMultiplier} · 账号{" "}
                  {group.accountCount} · API {group.apiCount} · Adobe{" "}
                  {group.adobeCount}
                </p>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  title={formatModelList(group.availableModels)}
                >
                  可用模型：{compactModelList(group.availableModels)}
                </p>
                {group.childGroupIds.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    嵌套：{childGroupNames(groups, group.childGroupIds)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {!readOnly && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editGroup(group)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingGroup}
                      onClick={() => deleteGroup({ id: group.id })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
