import { createMDX } from "fumadocs-mdx/next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * 创建 Fumadocs MDX 插件
 */
const withMDX = createMDX();

/**
 * 创建 next-intl 插件
 * 指定国际化请求配置文件路径
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * 安全响应头（CSP 等）
 *
 * Content-Security-Policy：限制资源加载来源，缓解 XSS / 数据注入攻击。
 * - script-src 保留 'unsafe-inline' 和 'unsafe-eval' 以兼容 Next.js 运行时。
 * - img-src 允许 data: / blob: / https: 用于图像预览与远程图片加载。
 * - frame-ancestors 'none' 禁止被嵌入 iframe，防止点击劫持。
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX || "",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    minimumCacheTTL: 2_592_000,
  },
  // Enable standalone output for Docker deployment
  output: "standalone",
  // Next 只 trace onnxruntime-node 的 .node 绑定,不 trace 它运行时 dlopen 的
  // libonnxruntime.so.1(37MB)。standalone 缺它时不只 ISNet 抠图坏:凡 action
  // chunk 引到抠图模块的路由(dashboard/创作页),模块求值即抛错,该路由全部
  // server action 500(2026-06-11 事故:前端积分/套餐被静默回退成 0/免费版)。
  // 此处显式 trace 进 standalone,Docker 与裸机部署都不再需要手工补拷;
  // ISNet 模型同理显式声明,不依赖隐式 trace。版本号用通配,升级 onnxruntime
  // 后无需改这里。
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./models/isnet.onnx",
    ],
  },
  experimental: {
    // 大文件上传走预签名 URL（presigned URL），Server Action 无需承载原始文件；
    // 50MB 足以覆盖 base64 编码后的常规请求体，同时降低滥用风险。
    proxyClientMaxBodySize: "50mb",
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Transpile monorepo packages
  transpilePackages: [
    "@repo/ui",
    "@repo/database",
    "@repo/shared",
    "@repo/image-generation",
  ],
  // Exclude packages with webpack-specific syntax from server bundling
  serverExternalPackages: [
    "anki-apkg-export",
    "sql.js",
    "pino",
    "pino-pretty",
    "@axiomhq/pino",
    // 原生模块（存储路由的按需缩略图缩放）：保持外置，避免被打进 server bundle。
    "sharp",
    // PSD 导出组装库:仅被 server action 经 use server 引用,Next 默认未把它 trace 进
    // standalone(运行时会 Cannot find module 'ag-psd')。外置后 Next 会把它及其依赖
    // (base64-js/pako)一并拷入 standalone node_modules。
    "ag-psd",
    // PSD 导出抠图引擎(原生模块,自带各平台预编译 .node):同理外置,避免被打进
    // server bundle;Next 会把它拷入 standalone node_modules。
    "onnxruntime-node",
  ],
};

// 组合插件: MDX -> NextIntl -> NextConfig
export default withMDX(withNextIntl(nextConfig));
