/**
 * 安全响应头（CSP 等）
 *
 * 纯 API 应用：CSP 策略最小化，仅允许 'self' 和必要的连接来源；
 * 不加载脚本、样式、字体、图片等前端资源。
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'none'",
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
  // 纯 API 应用，standalone 输出用于 Docker 部署
  output: "standalone",
  transpilePackages: [
    "@repo/database",
    "@repo/shared",
    "@repo/image-generation",
  ],
  serverExternalPackages: [
    "sharp",
    "ag-psd",
    "onnxruntime-node",
    "pino",
    "pino-pretty",
    "@axiomhq/pino",
  ],
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./models/isnet.onnx",
    ],
  },
};

export default nextConfig;
