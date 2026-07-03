import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { SettingsProfileView } from "@/features/settings/components";
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { db, user } from "@repo/database";
import { eq } from "drizzle-orm";

/**
 * 生成设置页面 metadata。
 *
 * @returns 带管理员应用名称的页面标题。
 * @sideEffects 读取 system_settings 表。
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getRuntimeBrandingConfig();

  return {
    title: `Settings | ${branding.name}`,
    description: "Manage your account settings and preferences",
  };
}

/**
 * 用户设置页面
 *
 * Server Component - 在服务端获取用户数据
 * 将数据传递给客户端 SettingsProfileView 组件
 */
export default async function SettingsPage() {
  // 获取当前用户会话
  const session = await getServerSession();
  const locale = await getLocale();

  // 如果用户未登录，重定向到登录页
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const [profile] = await db
    .select({ moderationBlockRiskLevel: user.moderationBlockRiskLevel })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  return (
    <SettingsProfileView
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        image: session.user.image,
        moderationBlockRiskLevel:
          profile?.moderationBlockRiskLevel === "medium" ||
          profile?.moderationBlockRiskLevel === "high"
            ? profile.moderationBlockRiskLevel
            : "low",
      }}
    />
  );
}
