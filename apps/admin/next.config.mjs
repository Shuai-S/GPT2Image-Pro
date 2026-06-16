import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * 安全响应头（CSP 等）
 *
 * 管理后台额外收紧策略：frame-ancestors 'none' 禁止被嵌入 iframe。
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
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // standalone 输出用于 Docker 多 app 部署
  output: "standalone",
  transpilePackages: [
    "@repo/ui",
    "@repo/database",
    "@repo/shared",
    "@repo/image-generation",
  ],
  serverExternalPackages: ["pino", "pino-pretty", "@axiomhq/pino"],
};

export default withNextIntl(nextConfig);
