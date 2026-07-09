"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/avatar";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
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
import {
  Ban,
  Coins,
  CreditCard,
  Eye,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Search,
  Shield,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  APP_USER_ROLES,
  type AppUserRole,
  getUserRoleLabel,
} from "../../../auth/roles";
import { formatCredits } from "../../../credits/format";
import {
  adminAdjustCreditsAction,
  adminGrantCreditsAction,
  banUserAction,
  createUserAction,
  getAllUsersAction,
  getUserDetailAction,
  setExternalApiKeyStatusAction,
  setUserCreditsStatusAction,
  setUserPasswordAction,
  setUserPlanAction,
  updateUserProfileAction,
  updateUserRoleAction,
} from "../../actions/admin-users";
import {
  formatDateTime,
  planBadge,
  type PlanFilter,
  type UserDetail,
  type UserRow,
} from "./admin-users-shared";

// 懒加载:用户详情 Sheet 仅在管理员点开某用户时挂载,改 next/dynamic 后把详情
// 抽屉(4 个辅助组件 + 5 Tab 渲染)从 admin/users 首屏 client bundle 移出为独立
// chunk,降低首屏 JS。loading 返回 null(Radix Sheet 未 open 时本就不渲染内容)。
const UserDetailSheet = dynamic(
  () => import("./admin-user-detail-sheet").then((m) => m.UserDetailSheet),
  { ssr: false, loading: () => null }
);

type UserStatusFilter = "all" | "active" | "banned" | "unverified";
type SubscriptionStatusFilter =
  | "all"
  | "none"
  | "active"
  | "canceled"
  | "past_due"
  | "incomplete";
type CreditsStatusFilter = "all" | "active" | "frozen";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const PLAN_OPTIONS: Array<{ value: PlanFilter; label: string }> = [
  { value: "all", label: "全部套餐" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "ultra", label: "Ultra" },
  { value: "enterprise", label: "Enterprise" },
];

const ROLE_OPTIONS: Array<{ value: AppUserRole; label: string }> =
  APP_USER_ROLES.map((role) => ({
    value: role,
    label: getUserRoleLabel(role),
  }));

const EDITABLE_PLAN_OPTIONS = PLAN_OPTIONS.filter(
  (item): item is { value: Exclude<PlanFilter, "all">; label: string } =>
    item.value !== "all"
);


function getInitials(name: string) {
  return name
    .split(" ")
    .map((item) => item[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function subscriptionBadge(status: string | null) {
  if (!status) {
    return <Badge variant="secondary">无订阅</Badge>;
  }
  const className =
    status === "active"
      ? "bg-foreground text-background"
      : status === "past_due"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={className}>
      {status}
    </Badge>
  );
}

function userRoleBadge(role: AppUserRole) {
  if (role === "super_admin") {
    return <Badge className="bg-red-100 text-red-700">超管</Badge>;
  }
  if (role === "admin") {
    return <Badge variant="secondary">管理员</Badge>;
  }
  if (role === "observer_admin") {
    return <Badge variant="outline">观察管理员</Badge>;
  }
  return null;
}

export function AdminUsersManagement({
  canManageRoles = false,
}: {
  canManageRoles?: boolean;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    admins: 0,
    banned: 0,
    activeSubscriptions: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatusFilter>("all");
  const [creditsStatus, setCreditsStatus] =
    useState<CreditsStatusFilter>("all");
  const [plan, setPlan] = useState<PlanFilter>("all");

  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  // 详情 Sheet 惰性挂载:首屏 detailOpen=false 时不渲染 UserDetailSheet(将其 chunk 移出
  // 首屏 bundle),首次打开后置 true 并永不复位,保留 Sheet 关闭动画与连续打开的 state。
  const [detailMounted, setDetailMounted] = useState(false);
  useEffect(() => {
    if (detailOpen) setDetailMounted(true);
  }, [detailOpen]);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [isGranting, setIsGranting] = useState(false);

  const [creditAdjustOpen, setCreditAdjustOpen] = useState(false);
  const [creditAdjustAmount, setCreditAdjustAmount] = useState("");
  const [creditAdjustReason, setCreditAdjustReason] = useState("");
  const [isAdjustingCredits, setIsAdjustingCredits] = useState(false);

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [targetPlan, setTargetPlan] =
    useState<Exclude<PlanFilter, "all">>("free");
  const [planReason, setPlanReason] = useState("");
  const [isSettingPlan, setIsSettingPlan] = useState(false);

  const [banOpen, setBanOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [isBanning, setIsBanning] = useState(false);

  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [creditsReason, setCreditsReason] = useState("");
  const [targetCreditsStatus, setTargetCreditsStatus] =
    useState<CreditsStatusFilter>("frozen");
  const [isSettingCreditsStatus, setIsSettingCreditsStatus] = useState(false);

  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<
    UserDetail["apiKeys"][number] | null
  >(null);
  const [targetKeyStatus, setTargetKeyStatus] = useState(false);
  const [keyReason, setKeyReason] = useState("");
  const [isSettingKeyStatus, setIsSettingKeyStatus] = useState(false);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [targetRole, setTargetRole] = useState<AppUserRole>("user");
  const [roleReason, setRoleReason] = useState("");
  const [isSettingRole, setIsSettingRole] = useState(false);

  // 新增用户 Dialog 状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<AppUserRole>("user");
  const [createReason, setCreateReason] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // 编辑资料 Dialog 状态
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileReason, setProfileReason] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // 重设密码 Dialog 状态
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordReason, setPasswordReason] = useState("");
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  const totalPages = Math.max(
    1,
    Math.ceil(pagination.total / pagination.pageSize)
  );
  const startIndex =
    pagination.total === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1;
  const endIndex = Math.min(
    pagination.page * pagination.pageSize,
    pagination.total
  );

  const loadUsers = useCallback(
    async (nextPage: number) => {
      setIsLoading(true);
      try {
        const result = await getAllUsersAction({
          query,
          page: nextPage,
          pageSize: pagination.pageSize,
          status,
          subscriptionStatus,
          creditsStatus,
          plan,
        });
        if (result?.data) {
          setUsers(result.data.users as UserRow[]);
          setStats(result.data.stats);
          setPagination(result.data.pagination);
        } else if (result?.serverError) {
          toast.error(result.serverError);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "加载用户列表失败"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      creditsStatus,
      pagination.pageSize,
      plan,
      query,
      status,
      subscriptionStatus,
    ]
  );

  useEffect(() => {
    void loadUsers(1);
  }, [loadUsers]);

  const reloadCurrent = async () => {
    await loadUsers(pagination.page);
    if (selectedUser && detailOpen) {
      await loadDetail(selectedUser.id, false);
    }
  };

  const loadDetail = async (userId: string, open = true) => {
    if (open) {
      setDetailOpen(true);
    }
    setIsDetailLoading(true);
    try {
      const result = await getUserDetailAction({ userId });
      if (result?.data) {
        setDetail(result.data as UserDetail);
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户详情失败");
    } finally {
      setIsDetailLoading(false);
    }
  };

  const openDetail = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setDetail(null);
    void loadDetail(userRow.id);
  };

  const openGrantDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setGrantAmount("");
    setGrantReason("");
    setGrantOpen(true);
  };

  const openCreditAdjustDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setCreditAdjustAmount("");
    setCreditAdjustReason("");
    setCreditAdjustOpen(true);
  };

  const openPlanDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setTargetPlan(userRow.plan === "all" ? "free" : userRow.plan);
    setPlanReason("");
    setPlanDialogOpen(true);
  };

  const openBanDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setBanReason("");
    setBanOpen(true);
  };

  const openCreditsDialog = (
    userRow: UserRow,
    nextStatus: "active" | "frozen"
  ) => {
    setSelectedUser(userRow);
    setTargetCreditsStatus(nextStatus);
    setCreditsReason("");
    setCreditsDialogOpen(true);
  };

  const openKeyDialog = (
    key: UserDetail["apiKeys"][number],
    isActive: boolean
  ) => {
    setSelectedKey(key);
    setTargetKeyStatus(isActive);
    setKeyReason("");
    setKeyDialogOpen(true);
  };

  const openRoleDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setTargetRole(userRow.role);
    setRoleReason("");
    setRoleDialogOpen(true);
  };

  const openCreateDialog = () => {
    setCreateName("");
    setCreateEmail("");
    setCreatePassword("");
    setCreateRole("user");
    setCreateReason("");
    setCreateOpen(true);
  };

  const openProfileDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setProfileName(userRow.name);
    setProfileEmail(userRow.email);
    setProfileReason("");
    setProfileOpen(true);
  };

  const openPasswordDialog = (userRow: UserRow) => {
    setSelectedUser(userRow);
    setNewPassword("");
    setPasswordReason("");
    setPasswordOpen(true);
  };

  const handleCreateUser = async () => {
    if (!canManageRoles) {
      toast.error("只有超管可以创建用户");
      return;
    }
    if (!createName.trim() || !createEmail.trim()) {
      toast.error("请填写用户名和邮箱");
      return;
    }
    if (createPassword.length < 8) {
      toast.error("密码至少 8 位");
      return;
    }
    if (!createReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsCreating(true);
    try {
      const result = await createUserAction({
        name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
        emailVerified: true,
        reason: createReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setCreateOpen(false);
        await loadUsers(1);
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建用户失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedUser) {
      return;
    }
    if (!canManageRoles) {
      toast.error("只有超管可以编辑用户资料");
      return;
    }
    if (!profileName.trim() || !profileEmail.trim()) {
      toast.error("用户名和邮箱不能为空");
      return;
    }
    if (!profileReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSavingProfile(true);
    try {
      const result = await updateUserProfileAction({
        userId: selectedUser.id,
        name: profileName.trim(),
        email: profileEmail.trim(),
        reason: profileReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setProfileOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存资料失败");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSetPassword = async () => {
    if (!selectedUser) {
      return;
    }
    if (!canManageRoles) {
      toast.error("只有超管可以重设密码");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("密码至少 8 位");
      return;
    }
    if (!passwordReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSettingPassword(true);
    try {
      const result = await setUserPasswordAction({
        userId: selectedUser.id,
        password: newPassword,
        reason: passwordReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setPasswordOpen(false);
        setNewPassword("");
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重设密码失败");
    } finally {
      setIsSettingPassword(false);
    }
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(queryInput.trim());
  };

  const clearFilters = () => {
    setQueryInput("");
    setQuery("");
    setStatus("all");
    setSubscriptionStatus("all");
    setCreditsStatus("all");
    setPlan("all");
  };

  const handleGrant = async () => {
    if (!selectedUser) {
      return;
    }
    const amount = Number.parseFloat(grantAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("请输入有效的积分数量");
      return;
    }
    if (!grantReason.trim()) {
      toast.error("请填写充值原因");
      return;
    }
    setIsGranting(true);
    try {
      const result = await adminGrantCreditsAction({
        userId: selectedUser.id,
        amount,
        reason: grantReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setGrantOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "充值失败");
    } finally {
      setIsGranting(false);
    }
  };

  const handleCreditAdjust = async () => {
    if (!selectedUser) {
      return;
    }
    if (!canManageRoles) {
      toast.error("只有超管可以调整用户积分");
      return;
    }
    const amount = Number.parseFloat(creditAdjustAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("请输入有效的积分数量");
      return;
    }
    if (amount <= 0) {
      toast.error("扣减积分必须大于 0");
      return;
    }
    if (!creditAdjustReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsAdjustingCredits(true);
    try {
      const result = await adminAdjustCreditsAction({
        userId: selectedUser.id,
        amount,
        reason: creditAdjustReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setCreditAdjustOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "积分调整失败");
    } finally {
      setIsAdjustingCredits(false);
    }
  };

  const handlePlanChange = async () => {
    if (!selectedUser) {
      return;
    }
    if (!canManageRoles) {
      toast.error("只有超管可以修改用户套餐");
      return;
    }
    if (!planReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSettingPlan(true);
    try {
      const result = await setUserPlanAction({
        userId: selectedUser.id,
        plan: targetPlan,
        reason: planReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setPlanDialogOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "套餐修改失败");
    } finally {
      setIsSettingPlan(false);
    }
  };

  const handleBan = async () => {
    if (!selectedUser) {
      return;
    }
    setIsBanning(true);
    try {
      const result = await banUserAction({
        userId: selectedUser.id,
        banned: !selectedUser.banned,
        reason: banReason.trim() || undefined,
      });
      if (result?.data) {
        toast.success(result.data.message);
        setBanOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsBanning(false);
    }
  };

  const handleCreditsStatus = async () => {
    if (!selectedUser || targetCreditsStatus === "all") {
      return;
    }
    if (!creditsReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSettingCreditsStatus(true);
    try {
      const result = await setUserCreditsStatusAction({
        userId: selectedUser.id,
        status: targetCreditsStatus,
        reason: creditsReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setCreditsDialogOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSettingCreditsStatus(false);
    }
  };

  const handleKeyStatus = async () => {
    if (!selectedKey) {
      return;
    }
    if (!keyReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSettingKeyStatus(true);
    try {
      const result = await setExternalApiKeyStatusAction({
        keyId: selectedKey.id,
        isActive: targetKeyStatus,
        reason: keyReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setKeyDialogOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSettingKeyStatus(false);
    }
  };

  const handleRoleChange = async () => {
    if (!selectedUser) {
      return;
    }
    if (!canManageRoles) {
      toast.error("只有超管可以修改用户角色");
      return;
    }
    if (targetRole === selectedUser.role) {
      setRoleDialogOpen(false);
      return;
    }
    if (!roleReason.trim()) {
      toast.error("请填写操作原因");
      return;
    }
    setIsSettingRole(true);
    try {
      const result = await updateUserRoleAction({
        userId: selectedUser.id,
        role: targetRole,
        reason: roleReason.trim(),
      });
      if (result?.data) {
        toast.success(result.data.message);
        setRoleDialogOpen(false);
        await reloadCurrent();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSettingRole(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight">
            用户管理
          </h2>
          <p className="text-muted-foreground">
            查询用户、排查积分和生图问题，并记录关键后台操作。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageRoles ? (
            <Button onClick={openCreateDialog}>
              <UserPlus className="mr-2 h-4 w-4" />
              新增用户
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void reloadCurrent()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">总用户</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">管理员</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.admins}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">活跃订阅</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.activeSubscriptions}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">已封禁</CardTitle>
            <Ban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.banned}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form
            onSubmit={handleSearch}
            className="flex flex-col gap-3 lg:flex-row"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="搜索邮箱、用户名或用户 ID"
                className="pl-10"
              />
            </div>
            <Button type="submit" disabled={isLoading}>
              搜索
            </Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              清除
            </Button>
          </form>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as UserStatusFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">正常用户</SelectItem>
                <SelectItem value="banned">已封禁</SelectItem>
                <SelectItem value="unverified">邮箱未验证</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={plan}
              onValueChange={(value) => setPlan(value as PlanFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={subscriptionStatus}
              onValueChange={(value) =>
                setSubscriptionStatus(value as SubscriptionStatusFilter)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部订阅</SelectItem>
                <SelectItem value="none">无订阅</SelectItem>
                <SelectItem value="active">订阅中</SelectItem>
                <SelectItem value="canceled">已取消</SelectItem>
                <SelectItem value="past_due">逾期</SelectItem>
                <SelectItem value="incomplete">未完成</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={creditsStatus}
              onValueChange={(value) =>
                setCreditsStatus(value as CreditsStatusFilter)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部积分账户</SelectItem>
                <SelectItem value="active">积分正常</SelectItem>
                <SelectItem value="frozen">积分冻结</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) =>
                setPagination((current) => ({
                  ...current,
                  page: 1,
                  pageSize: Number(value),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    每页 {size} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>用户列表</CardTitle>
          <p className="text-sm text-muted-foreground">
            {pagination.total > 0
              ? `显示 ${startIndex}-${endIndex} / 共 ${pagination.total} 位`
              : "没有匹配用户"}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              没有找到匹配的用户
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">套餐</th>
                    <th className="px-4 py-3">积分</th>
                    <th className="px-4 py-3">生图</th>
                    <th className="px-4 py-3">API Key</th>
                    <th className="px-4 py-3">注册时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => {
                    const failureRate =
                      item.generationCount > 0
                        ? Math.round(
                            (item.failedGenerationCount /
                              item.generationCount) *
                              100
                          )
                        : 0;
                    return (
                      <tr key={item.id} className="border-b">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={item.image || undefined}
                                alt={item.name}
                              />
                              <AvatarFallback className="bg-foreground text-xs text-background">
                                {getInitials(item.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">
                                  {item.name}
                                </span>
                                {userRoleBadge(item.role)}
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {item.email}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {item.id}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {item.banned ? (
                              <Badge className="w-fit bg-destructive/10 text-destructive">
                                已封禁
                              </Badge>
                            ) : item.emailVerified ? (
                              <Badge className="w-fit bg-emerald-100 text-emerald-700">
                                已验证
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="w-fit">
                                未验证
                              </Badge>
                            )}
                            {item.creditsStatus === "frozen" ? (
                              <Badge className="w-fit bg-amber-100 text-amber-700">
                                积分冻结
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {planBadge(item.plan)}
                            {subscriptionBadge(item.subscriptionStatus)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {formatCredits(item.creditsBalance)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            消耗 {formatCredits(item.creditsTotalSpent)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {item.generationCount} 次
                          </div>
                          <div className="text-xs text-muted-foreground">
                            失败 {item.failedGenerationCount} · {failureRate}%
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {item.activeApiKeyCount}/{item.apiKeyCount}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            启用 / 总数
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDateTime(item.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDetail(item)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              详情
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="outline">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => openGrantDialog(item)}
                                >
                                  <Coins className="h-4 w-4" />
                                  加积分
                                </DropdownMenuItem>
                                {canManageRoles && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        openCreditAdjustDialog(item)
                                      }
                                    >
                                      <CreditCard className="h-4 w-4" />
                                      减积分
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => openPlanDialog(item)}
                                    >
                                      <Shield className="h-4 w-4" />
                                      修改套餐
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuItem
                                  onClick={() => openBanDialog(item)}
                                >
                                  {item.banned ? (
                                    <UserCheck className="h-4 w-4" />
                                  ) : (
                                    <Ban className="h-4 w-4" />
                                  )}
                                  {item.banned ? "解除封禁" : "封禁用户"}
                                </DropdownMenuItem>
                                {canManageRoles && (
                                  <DropdownMenuItem
                                    onClick={() => openRoleDialog(item)}
                                  >
                                    <Shield className="h-4 w-4" />
                                    修改角色
                                  </DropdownMenuItem>
                                )}
                                {canManageRoles && (
                                  <DropdownMenuItem
                                    onClick={() => openProfileDialog(item)}
                                  >
                                    <UserCheck className="h-4 w-4" />
                                    编辑资料
                                  </DropdownMenuItem>
                                )}
                                {canManageRoles && (
                                  <DropdownMenuItem
                                    onClick={() => openPasswordDialog(item)}
                                  >
                                    <KeyRound className="h-4 w-4" />
                                    重设密码
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    openCreditsDialog(
                                      item,
                                      item.creditsStatus === "frozen"
                                        ? "active"
                                        : "frozen"
                                    )
                                  }
                                >
                                  {item.creditsStatus === "frozen" ? (
                                    <Unlock className="h-4 w-4" />
                                  ) : (
                                    <Lock className="h-4 w-4" />
                                  )}
                                  {item.creditsStatus === "frozen"
                                    ? "解冻积分"
                                    : "冻结积分"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              第 {pagination.page} / {totalPages} 页
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isLoading || pagination.page <= 1}
                onClick={() => void loadUsers(pagination.page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={isLoading || pagination.page >= totalPages}
                onClick={() => void loadUsers(pagination.page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {(detailMounted || detailOpen) && (
        <UserDetailSheet
          open={detailOpen}
          onOpenChange={setDetailOpen}
          selectedUser={selectedUser}
          detail={detail}
          isDetailLoading={isDetailLoading}
          canManageRoles={canManageRoles}
          onGrant={(user) => openGrantDialog(user)}
          onCreditAdjust={(user) => openCreditAdjustDialog(user)}
          onPlanChange={(user) => openPlanDialog(user)}
          onKeyStatus={(key, isActive) => openKeyDialog(key, isActive)}
        />
      )}

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动充值积分</DialogTitle>
            <DialogDescription>
              为 {selectedUser?.email ?? "用户"} 增加奖励积分，会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="grantAmount">积分数量</Label>
              <Input
                id="grantAmount"
                type="number"
                min={0.01}
                max={100000}
                step={0.01}
                value={grantAmount}
                onChange={(event) => setGrantAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grantReason">充值原因</Label>
              <Textarea
                id="grantReason"
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
                placeholder="例如：客服补偿、活动奖励、退款补偿"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button onClick={handleGrant} disabled={isGranting}>
              {isGranting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认充值
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creditAdjustOpen} onOpenChange={setCreditAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>扣减积分</DialogTitle>
            <DialogDescription>
              目标用户：{selectedUser?.email ?? "-"}。
              将按有效积分批次(最快到期优先)扣减，并写入消费流水。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              当前余额：{formatCredits(selectedUser?.creditsBalance ?? 0)}。
              如需额外赠送积分，请使用加积分。
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditAdjustAmount">扣减数量</Label>
              <Input
                id="creditAdjustAmount"
                type="number"
                min={0.01}
                max={1000000}
                step={0.01}
                value={creditAdjustAmount}
                onChange={(event) => setCreditAdjustAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditAdjustReason">操作原因</Label>
              <Textarea
                id="creditAdjustReason"
                value={creditAdjustReason}
                onChange={(event) => setCreditAdjustReason(event.target.value)}
                placeholder="例如：风控扣减、人工校准余额、误充值修正"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreditAdjustOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleCreditAdjust} disabled={isAdjustingCredits}>
              {isAdjustingCredits ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改用户套餐</DialogTitle>
            <DialogDescription>
              目标用户：{selectedUser?.email ?? "-"}
              。只修改套餐权限，不发放套餐积分。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>目标套餐</Label>
              <Select
                value={targetPlan}
                onValueChange={(value) =>
                  setTargetPlan(value as Exclude<PlanFilter, "all">)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_PLAN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              非 Free 套餐会写入 active 订阅记录并使用月付 Price ID；Free
              会立即结束当前订阅权益。该操作不会创建积分批次，也不会触发套餐月度积分。
            </div>
            <div className="space-y-2">
              <Label htmlFor="planReason">操作原因</Label>
              <Textarea
                id="planReason"
                value={planReason}
                onChange={(event) => setPlanReason(event.target.value)}
                placeholder="例如：客服补偿、人工升级、套餐纠错"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handlePlanChange} disabled={isSettingPlan}>
              {isSettingPlan ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={banOpen} onOpenChange={setBanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.banned ? "解除封禁" : "封禁用户"}
            </DialogTitle>
            <DialogDescription>
              目标用户：{selectedUser?.email ?? "-"}。操作会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          {!selectedUser?.banned ? (
            <div className="space-y-2">
              <Label htmlFor="banReason">封禁原因</Label>
              <Textarea
                id="banReason"
                value={banReason}
                onChange={(event) => setBanReason(event.target.value)}
                placeholder="请输入封禁原因"
                maxLength={300}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanOpen(false)}>
              取消
            </Button>
            <Button onClick={handleBan} disabled={isBanning}>
              {isBanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {selectedUser?.banned ? "解除封禁" : "确认封禁"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creditsDialogOpen} onOpenChange={setCreditsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {targetCreditsStatus === "frozen"
                ? "冻结积分账户"
                : "解冻积分账户"}
            </DialogTitle>
            <DialogDescription>
              目标用户：{selectedUser?.email ?? "-"}
              。冻结后用户不能继续消费或获得积分。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="creditsReason">操作原因</Label>
            <Textarea
              id="creditsReason"
              value={creditsReason}
              onChange={(event) => setCreditsReason(event.target.value)}
              placeholder="请填写冻结或解冻原因"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreditsDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleCreditsStatus}
              disabled={isSettingCreditsStatus}
            >
              {isSettingCreditsStatus ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {targetKeyStatus ? "启用 API Key" : "禁用 API Key"}
            </DialogTitle>
            <DialogDescription>
              目标 Key：{selectedKey?.name ?? "-"}。不会展示或记录完整密钥。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="keyReason">操作原因</Label>
            <Textarea
              id="keyReason"
              value={keyReason}
              onChange={(event) => setKeyReason(event.target.value)}
              placeholder="请填写启用或禁用原因"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleKeyStatus} disabled={isSettingKeyStatus}>
              {isSettingKeyStatus ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改用户角色</DialogTitle>
            <DialogDescription>
              目标用户：{selectedUser?.email ?? "-"}。角色变更会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>目标角色</Label>
            <Select
              value={targetRole}
              onValueChange={(value) => setTargetRole(value as AppUserRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="roleReason">操作原因</Label>
            <Textarea
              id="roleReason"
              value={roleReason}
              onChange={(event) => setRoleReason(event.target.value)}
              placeholder="请填写角色变更原因"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRoleChange} disabled={isSettingRole}>
              {isSettingRole ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
            <DialogDescription>
              手动创建账号并设置初始密码，会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="createName">用户名</Label>
              <Input
                id="createName"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="createEmail">绑定邮箱</Label>
              <Input
                id="createEmail"
                type="email"
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="createPassword">初始密码</Label>
              <Input
                id="createPassword"
                type="password"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                placeholder="至少 8 位"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="createRole">角色</Label>
              <Select
                value={createRole}
                onValueChange={(value) => setCreateRole(value as AppUserRole)}
              >
                <SelectTrigger id="createRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="createReason">操作原因</Label>
              <Textarea
                id="createReason"
                value={createReason}
                onChange={(event) => setCreateReason(event.target.value)}
                placeholder="例如：为客户代开账号"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateUser} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户资料</DialogTitle>
            <DialogDescription>
              修改 {selectedUser?.email ?? "用户"}{" "}
              的用户名或绑定邮箱，会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profileName">用户名</Label>
              <Input
                id="profileName"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profileEmail">绑定邮箱</Label>
              <Input
                id="profileEmail"
                type="email"
                value={profileEmail}
                onChange={(event) => setProfileEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profileReason">操作原因</Label>
              <Textarea
                id="profileReason"
                value={profileReason}
                onChange={(event) => setProfileReason(event.target.value)}
                placeholder="请填写资料修改原因"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveProfile} disabled={isSavingProfile}>
              {isSavingProfile ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重设密码</DialogTitle>
            <DialogDescription>
              为 {selectedUser?.email ?? "用户"}{" "}
              设置新登录密码，会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 8 位"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passwordReason">操作原因</Label>
              <Textarea
                id="passwordReason"
                value={passwordReason}
                onChange={(event) => setPasswordReason(event.target.value)}
                placeholder="请填写密码重设原因"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSetPassword} disabled={isSettingPassword}>
              {isSettingPassword ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认重设
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
