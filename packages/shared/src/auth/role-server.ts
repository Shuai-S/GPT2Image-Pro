import { db, user } from "@repo/database";
import { eq } from "drizzle-orm";

import { normalizeUserRole, type AppUserRole } from "./roles";

const LOCAL_SUPER_ADMIN_EMAIL = "admin@gpt2image.local";

export async function getUserRoleById(userId: string): Promise<AppUserRole> {
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
