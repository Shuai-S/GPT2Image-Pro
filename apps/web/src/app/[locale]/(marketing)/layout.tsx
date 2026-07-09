// 营销布局:组合全站 Header/Footer 与营销内容区。
// 不要在本布局或营销子页再次引入 fumadocs-ui/style.css。它会生成第二套
// Tailwind utilities;作为后加载样式表时会压过 md:flex/md:grid 等响应式类。
// Fumadocs 样式已在根布局先于应用样式加载一次。
import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeOperationFeatureFlags } from "@repo/shared/system-settings";
import type { CurrentSession } from "@/features/auth/hooks/use-current-session";
import { Footer, Header } from "@/features/marketing/components";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // B-P0-2：营销页多为匿名访问，但即便 session 为 null 也显式预取并下发，
  // 避免 header 客户端 hook 因缺 initialData 再发一次 POST /api/session/current。
  // getServerSession 由 React cache() 包裹，同一 RSC 请求内复用结果。
  const [serverSession, branding, operationFlags] = await Promise.all([
    getServerSession(),
    getRuntimeBrandingConfig(),
    getRuntimeOperationFeatureFlags(),
  ]);
  const initialSession: CurrentSession = serverSession?.user?.id
    ? {
        user: {
          id: serverSession.user.id,
          name: serverSession.user.name || "",
          email: serverSession.user.email || "",
          image: serverSession.user.image,
        },
      }
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        branding={branding}
        operationFlags={operationFlags}
        initialSession={initialSession}
      />
      <main className="flex-1">{children}</main>
      <Footer branding={branding} />
    </div>
  );
}
