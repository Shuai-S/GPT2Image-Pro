/**
 * 公开关键页 Lighthouse CI 预算。
 *
 * Dashboard 的登录态页面由 check-next-client-budgets.mjs 做静态资源门禁；真实用户 INP
 * 由 instrumentation-client 上报。此处使用稳定的实验室指标约束公开首页、Docs 和登录页。
 */

module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm --filter @repo/web start --port 3000",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60_000,
      numberOfRuns: 2,
      url: [
        "http://127.0.0.1:3000/en",
        "http://127.0.0.1:3000/en/docs",
        "http://127.0.0.1:3000/en/sign-in",
      ],
      settings: {
        chromeFlags: "--headless --no-sandbox --disable-dev-shm-usage",
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.8 }],
        "first-contentful-paint": ["error", { maxNumericValue: 2_000 }],
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 3_000 },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: 0.1 },
        ],
        "total-blocking-time": ["error", { maxNumericValue: 300 }],
        "speed-index": ["error", { maxNumericValue: 3_500 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
