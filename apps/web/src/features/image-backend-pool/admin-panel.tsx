"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Database,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deleteImageBackendGroupAction,
  deleteImageBackendMemberAction,
  getAdminImageBackendPoolAction,
  importImageBackendAccountsAction,
  saveImageBackendAccountAction,
  saveImageBackendApiAction,
  saveImageBackendGroupAction,
} from "./actions";

type Group = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  contentSafetyEnabled: boolean | null;
  priority: number;
  apiCount: number;
  accountCount: number;
};

type Account = {
  id: string;
  groupId: string | null;
  name: string;
  email: string | null;
  implementationMode: string;
  model: string | null;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  concurrency: number;
  status: string;
  lastUsedAt: Date | string | null;
};

type Api = {
  id: string;
  groupId: string | null;
  name: string;
  baseUrl: string;
  model: string | null;
  useStream: boolean;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  status: string;
  lastUsedAt: Date | string | null;
};

type ContentSafetyFormValue = "inherit" | "enabled" | "disabled";
type AccountBackendFormValue = "web" | "responses";

function groupName(groups: Group[], groupId: string | null) {
  return groups.find((group) => group.id === groupId)?.name || "未分组";
}

function formatDate(value: Date | string | null) {
  if (!value) return "从未使用";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function safetyValue(value: boolean | null): ContentSafetyFormValue {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "inherit";
}

function normalizeBackendFormValue(value: string): AccountBackendFormValue {
  return value === "responses" ? "responses" : "web";
}

export function ImageBackendPoolAdminPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [apis, setApis] = useState<Api[]>([]);
  const [groupForm, setGroupForm] = useState({
    id: "",
    name: "",
    description: "",
    isEnabled: true,
    isDefault: false,
    isUserSelectable: true,
    contentSafety: "inherit" as ContentSafetyFormValue,
    priority: 50,
  });
  const [accountForm, setAccountForm] = useState({
    id: "",
    groupId: "default",
    name: "",
    email: "",
    accessToken: "",
    refreshToken: "",
    implementationMode: "web" as AccountBackendFormValue,
    model: "",
    contentSafetyEnabled: true,
    isEnabled: true,
    priority: 50,
    concurrency: 1,
  });
  const [apiForm, setApiForm] = useState({
    id: "",
    groupId: "default",
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    useStream: false,
    contentSafetyEnabled: true,
    isEnabled: true,
    priority: 50,
  });
  const [importForm, setImportForm] = useState({
    groupId: "default",
    implementationMode: "web" as AccountBackendFormValue,
    contentSafetyEnabled: true,
    json: "",
  });

  const groupOptions = useMemo(
    () => [
      { id: "default", name: "未分组" },
      ...groups.map((group) => ({ id: group.id, name: group.name })),
    ],
    [groups]
  );

  const resetGroupForm = () =>
    setGroupForm({
      id: "",
      name: "",
      description: "",
      isEnabled: true,
      isDefault: false,
      isUserSelectable: true,
      contentSafety: "inherit" as ContentSafetyFormValue,
      priority: 50,
    });

  const resetAccountForm = () =>
    setAccountForm({
      id: "",
      groupId: "default",
      name: "",
      email: "",
      accessToken: "",
      refreshToken: "",
      implementationMode: "web" as AccountBackendFormValue,
      model: "",
      contentSafetyEnabled: true,
      isEnabled: true,
      priority: 50,
      concurrency: 1,
    });

  const resetApiForm = () =>
    setApiForm({
      id: "",
      groupId: "default",
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      useStream: false,
      contentSafetyEnabled: true,
      isEnabled: true,
      priority: 50,
    });

  const editGroup = (group: Group) => {
    setGroupForm({
      id: group.id,
      name: group.name,
      description: group.description || "",
      isEnabled: group.isEnabled,
      isDefault: group.isDefault,
      isUserSelectable: group.isUserSelectable,
      contentSafety: safetyValue(group.contentSafetyEnabled),
      priority: group.priority,
    });
  };

  const editAccount = (account: Account) => {
    setAccountForm({
      id: account.id,
      groupId: account.groupId || "default",
      name: account.name,
      email: account.email || "",
      accessToken: "",
      refreshToken: "",
      implementationMode: normalizeBackendFormValue(account.implementationMode),
      model: account.model || "",
      contentSafetyEnabled: account.contentSafetyEnabled,
      isEnabled: account.isEnabled,
      priority: account.priority,
      concurrency: account.concurrency,
    });
  };

  const editApi = (api: Api) => {
    setApiForm({
      id: api.id,
      groupId: api.groupId || "default",
      name: api.name,
      baseUrl: api.baseUrl,
      apiKey: "",
      model: api.model || "",
      useStream: api.useStream,
      contentSafetyEnabled: api.contentSafetyEnabled,
      isEnabled: api.isEnabled,
      priority: api.priority,
    });
  };

  const { execute: loadPool, isPending: isLoading } = useAction(
    getAdminImageBackendPoolAction,
    {
      onSuccess: ({ data }) => {
        setGroups((data?.groups || []) as Group[]);
        setAccounts((data?.accounts || []) as Account[]);
        setApis((data?.apis || []) as Api[]);
      },
      onError: ({ error }) => toast.error(error.serverError || "加载生图后端池失败"),
    }
  );

  const reload = () => loadPool();

  const { execute: saveGroup, isPending: isSavingGroup } = useAction(
    saveImageBackendGroupAction,
    {
      onSuccess: () => {
        toast.success("分组已保存");
        resetGroupForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存分组失败"),
    }
  );

  const { execute: saveAccount, isPending: isSavingAccount } = useAction(
    saveImageBackendAccountAction,
    {
      onSuccess: () => {
        toast.success("账号已保存");
        resetAccountForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存账号失败"),
    }
  );

  const { execute: saveApi, isPending: isSavingApi } = useAction(
    saveImageBackendApiAction,
    {
      onSuccess: () => {
        toast.success("API 后端已保存");
        resetApiForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存 API 后端失败"),
    }
  );

  const { execute: importAccounts, isPending: isImporting } = useAction(
    importImageBackendAccountsAction,
    {
      onSuccess: ({ data }) => {
        toast.success(`已导入 ${data?.count || 0} 个账号`);
        setImportForm((current) => ({ ...current, json: "" }));
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "导入账号失败"),
    }
  );

  const { execute: deleteGroup, isPending: isDeletingGroup } = useAction(
    deleteImageBackendGroupAction,
    {
      onSuccess: () => {
        toast.success("分组已删除");
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "删除分组失败"),
    }
  );

  const { execute: deleteMember, isPending: isDeletingMember } = useAction(
    deleteImageBackendMemberAction,
    {
      onSuccess: () => {
        toast.success("后端已删除");
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "删除后端失败"),
    }
  );

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">生图后端池</h2>
          <p className="text-sm text-muted-foreground">
            管理自有账号池和系统后端 API。API 直连不转协议；Web 账号仅支持图片生成/编辑；Responses 账号支持 /responses，并可承接 images 到 responses 的转换。
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </div>

      <Tabs defaultValue="groups" className="w-full">
        <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
          <TabsTrigger value="groups">分组</TabsTrigger>
          <TabsTrigger value="accounts">账号池</TabsTrigger>
          <TabsTrigger value="apis">API 后端</TabsTrigger>
          <TabsTrigger value="import">Sub2API 导入</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
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
                  setGroupForm((current) => ({ ...current, name: event.target.value }))
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
              <Input
                type="number"
                value={groupForm.priority}
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <Button
                className="w-full"
                onClick={() => saveGroup(groupForm)}
                disabled={isSavingGroup || !groupForm.name}
              >
                {isSavingGroup && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存分组
              </Button>
              {groupForm.id && (
                <Button variant="outline" className="w-full" onClick={resetGroupForm}>
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {groups.map((group) => (
              <Card key={group.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{group.name}</span>
                      {group.isDefault && <Badge>默认</Badge>}
                      {!group.isEnabled && <Badge variant="secondary">停用</Badge>}
                      {group.isUserSelectable && (
                        <Badge variant="outline">用户可选</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {group.description || "无说明"} · 优先级 {group.priority} · 账号 {group.accountCount} · API {group.apiCount}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => editGroup(group)}>
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="accounts" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {accountForm.id ? "编辑账号" : "新增账号"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="名称"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Input
                placeholder="邮箱"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, email: event.target.value }))
                }
              />
              <Textarea
                placeholder={
                  accountForm.id ? "Access Token，留空不修改" : "Access Token"
                }
                value={accountForm.accessToken}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    accessToken: event.target.value,
                  }))
                }
              />
              <Select
                value={accountForm.groupId}
                onValueChange={(value) =>
                  setAccountForm((current) => ({ ...current, groupId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={accountForm.implementationMode}
                onValueChange={(value) =>
                  setAccountForm((current) => ({
                    ...current,
                    implementationMode: value as AccountBackendFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">Web 账号</SelectItem>
                  <SelectItem value="responses">Codex/Responses 账号</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="模型，可选"
                value={accountForm.model}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, model: event.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  value={accountForm.priority}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="number"
                  value={accountForm.concurrency}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      concurrency: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>接入内容安全审核</Label>
                <Switch
                  checked={accountForm.contentSafetyEnabled}
                  onCheckedChange={(checked) =>
                    setAccountForm((current) => ({
                      ...current,
                      contentSafetyEnabled: checked,
                    }))
                  }
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveAccount(accountForm)}
                disabled={
                  isSavingAccount ||
                  !accountForm.name ||
                  (!accountForm.id && !accountForm.accessToken)
                }
              >
                {isSavingAccount && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存账号
              </Button>
              {accountForm.id && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={resetAccountForm}
                >
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{account.name}</span>
                      <Badge variant="outline">
                        {account.implementationMode === "responses"
                          ? "Codex/Responses"
                          : "Web"}
                      </Badge>
                      {!account.isEnabled && <Badge variant="secondary">停用</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {account.email || "无邮箱"} · {groupName(groups, account.groupId)} · 优先级 {account.priority} · {formatDate(account.lastUsedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editAccount(account)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingMember}
                      onClick={() =>
                        deleteMember({ type: "account", id: account.id })
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="apis" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
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
                  setApiForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Input
                placeholder="https://api.openai.com/v1"
                value={apiForm.baseUrl}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, baseUrl: event.target.value }))
                }
              />
              <Input
                type="password"
                placeholder={apiForm.id ? "API Key，留空不修改" : "API Key"}
                value={apiForm.apiKey}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, apiKey: event.target.value }))
                }
              />
              <Select
                value={apiForm.groupId}
                onValueChange={(value) =>
                  setApiForm((current) => ({ ...current, groupId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="默认模型，可选"
                value={apiForm.model}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, model: event.target.value }))
                }
              />
              <Input
                type="number"
                value={apiForm.priority}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>流式调用</Label>
                <Switch
                  checked={apiForm.useStream}
                  onCheckedChange={(checked) =>
                    setApiForm((current) => ({ ...current, useStream: checked }))
                  }
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveApi(apiForm)}
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
                <Button variant="outline" className="w-full" onClick={resetApiForm}>
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {apis.map((api) => (
              <Card key={api.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Plug className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{api.name}</span>
                      <Badge variant="outline">API 直透</Badge>
                      {!api.isEnabled && <Badge variant="secondary">停用</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {api.baseUrl} · {groupName(groups, api.groupId)} · 优先级 {api.priority} · {formatDate(api.lastUsedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => editApi(api)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingMember}
                      onClick={() => deleteMember({ type: "api", id: api.id })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="import" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                从 Sub2API 导出格式导入账号
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Select
                  value={importForm.groupId}
                  onValueChange={(value) =>
                    setImportForm((current) => ({ ...current, groupId: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={importForm.implementationMode}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      implementationMode: value as AccountBackendFormValue,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="web">Web 账号</SelectItem>
                    <SelectItem value="responses">Codex/Responses 账号</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between rounded-md border px-3">
                  <Label>接入内容安全审核</Label>
                  <Switch
                    checked={importForm.contentSafetyEnabled}
                    onCheckedChange={(checked) =>
                      setImportForm((current) => ({
                        ...current,
                        contentSafetyEnabled: checked,
                      }))
                    }
                  />
                </div>
              </div>
              <Textarea
                className="min-h-56 font-mono text-xs"
                placeholder='[{"email":"a@example.com","access_token":"..."}]'
                value={importForm.json}
                onChange={(event) =>
                  setImportForm((current) => ({
                    ...current,
                    json: event.target.value,
                  }))
                }
              />
              <Button
                onClick={() => importAccounts(importForm)}
                disabled={isImporting || !importForm.json}
              >
                {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                导入账号
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
