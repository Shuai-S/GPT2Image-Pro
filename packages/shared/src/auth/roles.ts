export const APP_USER_ROLES = [
  "user",
  "observer_admin",
  "admin",
  "super_admin",
] as const;

export type AppUserRole = (typeof APP_USER_ROLES)[number];

export const ADMIN_MANAGEMENT_ROLES = ["admin", "super_admin"] as const;
export const IMAGE_BACKEND_POOL_VIEWER_ROLES = [
  "observer_admin",
  "admin",
  "super_admin",
] as const;

export function normalizeUserRole(role?: string | null): AppUserRole {
  return APP_USER_ROLES.includes(role as AppUserRole)
    ? (role as AppUserRole)
    : "user";
}

export function isSuperAdminRole(role?: string | null) {
  return normalizeUserRole(role) === "super_admin";
}

export function isObserverAdminRole(role?: string | null) {
  return normalizeUserRole(role) === "observer_admin";
}

export function isAdminRole(role?: string | null) {
  const normalized = normalizeUserRole(role);
  return normalized === "admin" || normalized === "super_admin";
}

export function canAccessAdminArea(role?: string | null) {
  return isAdminRole(role);
}

export function canViewImageBackendPool(role?: string | null) {
  return IMAGE_BACKEND_POOL_VIEWER_ROLES.includes(
    normalizeUserRole(role) as (typeof IMAGE_BACKEND_POOL_VIEWER_ROLES)[number]
  );
}

export function canManageUserPermissions(role?: string | null) {
  return isSuperAdminRole(role);
}

export function getUserRoleLabel(role?: string | null) {
  switch (normalizeUserRole(role)) {
    case "super_admin":
      return "超管";
    case "admin":
      return "管理员";
    case "observer_admin":
      return "观察管理员";
    case "user":
    default:
      return "普通用户";
  }
}
