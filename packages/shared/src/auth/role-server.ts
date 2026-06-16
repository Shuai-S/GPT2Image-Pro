import { db, user } from "@repo/database";
import { eq } from "drizzle-orm";

import { normalizeUserRole, type AppUserRole } from "./roles";
import {
  LOCAL_SUPER_ADMIN_EMAIL,
  isSelfUseModeEnabled,
} from "./self-use-mode";

/**
 * 按 userId 解析当前角色。授权链根：adminAction/superAdminAction/checkAdmin
 * 与多数 dashboard 页面渲染都经此取角色。
 *
 * 副作用（WHY，审计 M-L8/M-L12/P3-23）：当 isSelfUseModeEnabled() 为 true、
 * role==='admin' 且 email 恰为 LOCAL_SUPER_ADMIN_EMAIL（自用模式 bootstrap
 * 创建的 admin@gpt2image.local，.local TLD 收不到真实邮件、非任意提权向量）
 * 时，惰性把该账号提升为 super_admin 并落库。命名虽似纯读，实则在该唯一
 * 条件下隐含一次 update；只读副本上会失败。提权条件须严格（自用模式 +
 * admin + 精确邮箱、大小写无关），任何放宽都会成提权后门，已由
 * role-server.test.ts 守护。
 */
export async function getUserRoleById(userId: string): Promise<AppUserRole> {
  const [record] = await db
    .select({ email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const role = normalizeUserRole(record?.role);
  // 自动提权仅在自用模式启用时执行，防止多用户部署下意外提权。
  // 条件：自用模式开启 + 当前角色为 admin + 邮箱精确匹配 LOCAL_SUPER_ADMIN_EMAIL。
  if (
    role === "admin" &&
    record?.email?.toLowerCase() === LOCAL_SUPER_ADMIN_EMAIL &&
    (await isSelfUseModeEnabled())
  ) {
    await db
      .update(user)
      .set({ role: "super_admin", updatedAt: new Date() })
      .where(eq(user.id, userId));
    return "super_admin";
  }

  return role;
}
