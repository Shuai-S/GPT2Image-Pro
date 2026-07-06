// 营销布局:组合全站 Header/Footer 与营销内容区。
// 不要在本布局或营销子页再次引入 fumadocs-ui/style.css。它会生成第二套
// Tailwind utilities;作为后加载样式表时会压过 md:flex/md:grid 等响应式类。
// Fumadocs 样式已在根布局先于应用样式加载一次。
import { getRuntimeBrandingConfig } from "@repo/shared/config/branding";
import { getRuntimeOperationFeatureFlags } from "@repo/shared/system-settings";
import { Footer, Header } from "@/features/marketing/components";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [branding, operationFlags] = await Promise.all([
    getRuntimeBrandingConfig(),
    getRuntimeOperationFeatureFlags(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header branding={branding} operationFlags={operationFlags} />
      <main className="flex-1">{children}</main>
      <Footer branding={branding} />
    </div>
  );
}
