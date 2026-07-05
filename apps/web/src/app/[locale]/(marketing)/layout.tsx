// 注意:不要在本布局引入 fumadocs-ui/style.css。它自带一套 @layer utilities(含
// .hidden{display:none}),作为第二个样式表加载时会按层叠顺序压过本 app 的 .md:flex/
// .md:inline-flex,导致整个营销组(含首页)Header 的 `hidden md:flex` 导航与按钮在所有
// 宽度被永久 display:none。fumadocs CSS 只有 blog/[slug]、legal/[slug] 的 .prose 需要,
// 故下沉到这两个页面各自引入,避免污染首页等无关页面。
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
