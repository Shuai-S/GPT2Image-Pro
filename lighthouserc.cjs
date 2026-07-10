/**
 * 公开页与真实登录 Dashboard 的 Lighthouse CI 预算。
 *
 * 默认本地运行只测公开首页、Docs 和登录页；CI 提供 PostgreSQL 与一次性本地超管后，
 * Puppeteer 通过真实表单登录并追加创作页、画布和管理页。INP 不是实验室指标，由
 * instrumentation-client 的官方 web-vitals 采集；此处用 TBT 约束交互阻塞风险。
 */

const authenticated = process.env.LHCI_AUTHENTICATED === "true";
const publicUrls = [
  "http://127.0.0.1:3000/en",
  "http://127.0.0.1:3000/en/docs",
  "http://127.0.0.1:3000/en/sign-in",
];
const protectedUrls = [
  "http://127.0.0.1:3000/en/dashboard/create",
  "http://127.0.0.1:3000/en/dashboard/canvas",
  "http://127.0.0.1:3000/en/dashboard/admin/settings",
];

/** 返回公开页面或 Dashboard 页面共用的 Lighthouse 断言。 */
function assertions(input) {
  return {
    "categories:performance": ["error", { minScore: input.minScore }],
    "first-contentful-paint": [
      "error",
      { maxNumericValue: input.maxFcpMs },
    ],
    "largest-contentful-paint": [
      "error",
      { maxNumericValue: input.maxLcpMs },
    ],
    "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
    "total-blocking-time": [
      "error",
      { maxNumericValue: input.maxTbtMs },
    ],
    "speed-index": ["error", { maxNumericValue: input.maxSpeedIndexMs }],
  };
}

module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm --filter @repo/web start --port 3000",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60_000,
      numberOfRuns: 2,
      url: authenticated ? [...publicUrls, ...protectedUrls] : publicUrls,
      ...(authenticated
        ? {
            puppeteerScript: "./scripts/lighthouse-auth.cjs",
            puppeteerLaunchOptions: {
              args: ["--no-sandbox", "--disable-dev-shm-usage"],
            },
          }
        : {}),
      settings: {
        ...(!authenticated
          ? {
              chromeFlags:
                "--headless --no-sandbox --disable-dev-shm-usage",
            }
          : { disableStorageReset: true }),
        preset: "desktop",
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: "^(?!.*\\/dashboard(?:\\/|$)).*$",
          assertions: assertions({
            minScore: 0.8,
            maxFcpMs: 2_000,
            maxLcpMs: 3_000,
            maxTbtMs: 300,
            maxSpeedIndexMs: 3_500,
          }),
        },
        {
          matchingUrlPattern: ".*\\/dashboard(?:\\/|$).*",
          assertions: assertions({
            minScore: 0.75,
            maxFcpMs: 2_500,
            maxLcpMs: 3_500,
            maxTbtMs: 400,
            maxSpeedIndexMs: 4_000,
          }),
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
