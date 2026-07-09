import { db, user } from "@repo/database";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { normalizeUserRole, type AppUserRole } from "./roles";
import { LOCAL_SUPER_ADMIN_EMAIL } from "./self-use-mode";

/**
 * 按 userId 解析当前角色。授权链根：adminAction/superAdminAction/checkAdmin
 * 与多数 dashboard 页面渲染都经此取角色。
 *
 * 副作用（WHY，审计 M-L8/M-L12）：当 role==='admin' 且 email 恰为
 * LOCAL_SUPER_ADMIN_EMAIL（自用模式 bootstrap 创建的 admin@gpt2image.local，
 * .local TLD 收不到真实邮件、非任意提权向量）时，惰性把该账号提升为
 * super_admin 并落库。命名虽似纯读，实则在该唯一条件下隐含一次 update；
 * 只读副本上会失败。提权条件须严格（admin + 精确邮箱、大小写无关），
 * 任何放宽都会成提权后门，已由 role-server.test.ts 守护。
 *
 * cache() 包装说明（A-P0-1）：同一请求内 layout 与各 page 共享同一 userId
 * 的 role 查询结果，消除每次导航 2~3 次冗余 role DB 往返。惰性提权写路径
 * 保持原行为不变——首次调用执行 select+（条件满足时）update，后续命中
 * 缓存直接返回，不再重复写（提权本就幂等，首次落库后 role 已为 super_admin）。
 */
export const getUserRoleById = cache(
  async (userId: string): Promise<AppUserRole> => {
    const [record] = await db
      .select({ email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const role = normalizeUserRole(record?.role);
    if (
      role === "admin" &&
      record?.email?.toLowerCase() === LOCAL_SUPER_ADMIN_EMAIL
    ) {
      await db
        .update(user)
        .set({ role: "super_admin", updatedAt: new Date() })
        .where(eq(user.id, userId));
      return "super_admin";
    }

    return role;
  }
);
