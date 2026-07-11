// 文件职责：为管理工具高保真原型提供后端池与系统设置的虚构数据和类型。
// 使用方：admin-backends-preview.tsx 与 admin-settings-preview.tsx。
// 数据边界：不读取数据库，也不包含真实密钥或用户数据。

export type BackendView = "groups" | "accounts" | "api" | "adobe" | "tools";

export type BackendHealth = "healthy" | "warning" | "offline";

export type ApiBackend = {
  id: string;
  name: string;
  endpoint: string;
  protocol: string;
  models: string;
  health: BackendHealth;
  healthLabel: string;
  quota: string;
  concurrency: string;
  cooldown: string;
  latency: string;
  lastError: string;
  groups: readonly string[];
  updatedAt: string;
};

export type BackendResource = {
  id: string;
  name: string;
  detail: string;
  metricLabel: string;
  metricValue: string;
  status: BackendHealth;
  statusLabel: string;
  secondaryLabel: string;
  secondaryValue: string;
};

export type SettingSource = "database" | "environment" | "default";

export type SettingEffect = "immediate" | "restart" | "rebuild";

export type SettingInput = "text" | "number" | "select" | "toggle" | "secret";

export type SettingOption = {
  value: string;
  label: string;
};

export type SettingField = {
  key: string;
  label: string;
  description: string;
  value: string;
  source: SettingSource;
  effect: SettingEffect;
  input: SettingInput;
  unit?: string;
  options?: readonly SettingOption[];
  readOnly?: boolean;
  configured?: boolean;
  sensitive?: boolean;
};

export type SettingCategory = {
  id: string;
  label: string;
  description: string;
  fields: readonly SettingField[];
};

export const backendTabs: ReadonlyArray<{
  id: BackendView;
  label: string;
}> = [
  { id: "groups", label: "分组" },
  { id: "accounts", label: "账号池" },
  { id: "api", label: "API 后端" },
  { id: "adobe", label: "Adobe 后端" },
  { id: "tools", label: "接入工具" },
];

export const apiBackends: readonly ApiBackend[] = [
  {
    id: "api-atlas",
    name: "Atlas OpenAI",
    endpoint: "https://api.atlas.example/v1",
    protocol: "OpenAI Images",
    models: "gpt-image-2, gpt-image-1.5",
    health: "healthy",
    healthLabel: "正常",
    quota: "84%",
    concurrency: "3 / 12",
    cooldown: "无",
    latency: "2.8 秒",
    lastError: "无",
    groups: ["默认", "高质量"],
    updatedAt: "今天 14:32",
  },
  {
    id: "api-firefly",
    name: "Firefly Gateway",
    endpoint: "https://firefly-gateway.example/v3",
    protocol: "Adobe Firefly",
    models: "firefly-image-4-ultra",
    health: "healthy",
    healthLabel: "正常",
    quota: "61%",
    concurrency: "1 / 6",
    cooldown: "无",
    latency: "4.1 秒",
    lastError: "无",
    groups: ["商业视觉"],
    updatedAt: "今天 14:28",
  },
  {
    id: "api-gemini",
    name: "Gemini Image Relay",
    endpoint: "https://gemini-relay.example/v1beta",
    protocol: "Google Generative Language",
    models: "gemini-2.5-flash-image",
    health: "warning",
    healthLabel: "冷却中",
    quota: "37%",
    concurrency: "0 / 8",
    cooldown: "04:18",
    latency: "6.7 秒",
    lastError: "上游触发 429 限流",
    groups: ["快速", "备用"],
    updatedAt: "今天 14:19",
  },
  {
    id: "api-reserve",
    name: "Reserve Images",
    endpoint: "https://reserve-images.example/v1",
    protocol: "OpenAI Images",
    models: "gpt-image-1-mini",
    health: "offline",
    healthLabel: "不可用",
    quota: "未知",
    concurrency: "0 / 4",
    cooldown: "无",
    latency: "--",
    lastError: "鉴权失败，凭据已失效",
    groups: ["备用"],
    updatedAt: "今天 13:52",
  },
];

export const backendResources: Readonly<
  Record<Exclude<BackendView, "api" | "tools">, readonly BackendResource[]>
> = {
  groups: [
    {
      id: "group-default",
      name: "默认调度组",
      detail: "承接未指定分组的图像请求",
      metricLabel: "成员",
      metricValue: "8 个后端",
      status: "healthy",
      statusLabel: "可调度",
      secondaryLabel: "成功率",
      secondaryValue: "98.7%",
    },
    {
      id: "group-quality",
      name: "高质量",
      detail: "优先质量与较长处理时间",
      metricLabel: "成员",
      metricValue: "4 个后端",
      status: "healthy",
      statusLabel: "可调度",
      secondaryLabel: "成功率",
      secondaryValue: "99.1%",
    },
    {
      id: "group-fallback",
      name: "备用通道",
      detail: "主通道不可用时接管请求",
      metricLabel: "成员",
      metricValue: "3 个后端",
      status: "warning",
      statusLabel: "容量偏低",
      secondaryLabel: "成功率",
      secondaryValue: "94.3%",
    },
  ],
  accounts: [
    {
      id: "account-01",
      name: "pool-01@example.test",
      detail: "ChatGPT Web · 默认调度组",
      metricLabel: "额度",
      metricValue: "72%",
      status: "healthy",
      statusLabel: "正常",
      secondaryLabel: "并发",
      secondaryValue: "1 / 3",
    },
    {
      id: "account-02",
      name: "pool-02@example.test",
      detail: "ChatGPT Web · 高质量",
      metricLabel: "额度",
      metricValue: "45%",
      status: "warning",
      statusLabel: "冷却中",
      secondaryLabel: "剩余",
      secondaryValue: "03:42",
    },
    {
      id: "account-03",
      name: "pool-03@example.test",
      detail: "ChatGPT Web · 备用通道",
      metricLabel: "额度",
      metricValue: "未知",
      status: "offline",
      statusLabel: "凭据失效",
      secondaryLabel: "并发",
      secondaryValue: "0 / 2",
    },
  ],
  adobe: [
    {
      id: "adobe-01",
      name: "Adobe Direct Primary",
      detail: "Firefly Image 4 · 美西区域",
      metricLabel: "额度",
      metricValue: "1,284",
      status: "healthy",
      statusLabel: "正常",
      secondaryLabel: "并发",
      secondaryValue: "2 / 10",
    },
    {
      id: "adobe-02",
      name: "Adobe Direct Reserve",
      detail: "Firefly Image 4 · 新加坡区域",
      metricLabel: "额度",
      metricValue: "640",
      status: "warning",
      statusLabel: "高延迟",
      secondaryLabel: "P95",
      secondaryValue: "11.2 秒",
    },
  ],
};

export const settingCategories: readonly SettingCategory[] = [
  {
    id: "general",
    label: "基础与品牌",
    description: "站点身份、公开地址与默认语言",
    fields: [
      {
        key: "SITE_NAME",
        label: "站点名称",
        description: "用于账户中心、邮件标题和公开页面。",
        value: "GPT2Image Pro",
        source: "database",
        effect: "immediate",
        input: "text",
      },
      {
        key: "SUPPORT_EMAIL",
        label: "支持邮箱",
        description: "在支持页面展示的第一方联系邮箱。",
        value: "support@example.test",
        source: "database",
        effect: "immediate",
        input: "text",
      },
      {
        key: "NEXT_PUBLIC_SITE_URL",
        label: "公开站点地址",
        description: "构建时写入客户端资源，由部署环境覆盖。",
        value: "https://image.example.test",
        source: "environment",
        effect: "rebuild",
        input: "text",
        readOnly: true,
      },
    ],
  },
  {
    id: "generation",
    label: "生成与队列",
    description: "全局并发、超时和失败重试",
    fields: [
      {
        key: "IMAGE_GENERATION_GLOBAL_CONCURRENCY",
        label: "全局生图并发",
        description: "限制所有实例共同持有的生图执行槽。",
        value: "48",
        source: "database",
        effect: "immediate",
        input: "number",
        unit: "任务",
      },
      {
        key: "IMAGE_HEALTH_CHECK_TIMEOUT_MS",
        label: "后端检查超时",
        description: "单次后端健康检查等待上游响应的最长时间。",
        value: "15000",
        source: "default",
        effect: "immediate",
        input: "number",
        unit: "毫秒",
      },
      {
        key: "IMAGE_MAX_RETRIES",
        label: "失败重试次数",
        description: "仅对可重试错误生效，不包含首次请求。",
        value: "2",
        source: "database",
        effect: "immediate",
        input: "number",
        unit: "次",
      },
    ],
  },
  {
    id: "storage",
    label: "存储",
    description: "对象存储驱动与公开资源地址",
    fields: [
      {
        key: "STORAGE_PROVIDER",
        label: "存储驱动",
        description: "由部署环境选择，管理界面不能覆盖。",
        value: "s3",
        source: "environment",
        effect: "restart",
        input: "select",
        readOnly: true,
        options: [
          { value: "s3", label: "S3 兼容存储" },
          { value: "local", label: "本地文件系统" },
        ],
      },
      {
        key: "STORAGE_PUBLIC_URL",
        label: "资源公开地址",
        description: "生成资源对外访问使用的绝对地址前缀。",
        value: "https://cdn.example.test",
        source: "database",
        effect: "immediate",
        input: "text",
      },
    ],
  },
  {
    id: "payments",
    label: "支付",
    description: "结算币种、支付通道与服务端凭据",
    fields: [
      {
        key: "CHECKOUT_CURRENCY",
        label: "默认结算币种",
        description: "用于没有显式币种的价格与结算页面。",
        value: "CNY",
        source: "default",
        effect: "immediate",
        input: "select",
        options: [
          { value: "CNY", label: "人民币 CNY" },
          { value: "USD", label: "美元 USD" },
        ],
      },
      {
        key: "CREEM_API_KEY",
        label: "Creem API 密钥",
        description: "仅支持替换；现有值永不回显。",
        value: "",
        source: "database",
        effect: "restart",
        input: "secret",
        configured: true,
        sensitive: true,
      },
    ],
  },
  {
    id: "security",
    label: "安全与认证",
    description: "认证地址、会话和管理接口密钥",
    fields: [
      {
        key: "BETTER_AUTH_URL",
        label: "认证服务地址",
        description: "由部署环境注入，修改环境变量后需要重启。",
        value: "https://image.example.test",
        source: "environment",
        effect: "restart",
        input: "text",
        readOnly: true,
      },
      {
        key: "MCP_ADMIN_API_KEY",
        label: "MCP 管理密钥",
        description: "仅支持替换；替换会使旧管理密钥立即失效。",
        value: "",
        source: "database",
        effect: "immediate",
        input: "secret",
        configured: true,
        sensitive: true,
      },
      {
        key: "SESSION_MAX_AGE_DAYS",
        label: "会话最长有效期",
        description: "新会话立即使用新的最长有效期。",
        value: "30",
        source: "default",
        effect: "immediate",
        input: "number",
        unit: "天",
      },
    ],
  },
  {
    id: "notifications",
    label: "通知",
    description: "公告横幅与站内未读提示",
    fields: [
      {
        key: "CRITICAL_BANNER_ENABLED",
        label: "严重公告横幅",
        description: "允许生效中的严重公告显示为全站横幅。",
        value: "true",
        source: "database",
        effect: "immediate",
        input: "toggle",
      },
      {
        key: "ANNOUNCEMENT_READ_BADGE",
        label: "公告未读数量",
        description: "在账户入口显示当前用户的未读公告数量。",
        value: "true",
        source: "default",
        effect: "immediate",
        input: "toggle",
      },
    ],
  },
  {
    id: "pricing",
    label: "模型与定价",
    description: "积分兑换口径和固定期限套餐价格",
    fields: [
      {
        key: "CREDITS_PER_CNY",
        label: "每元对应积分",
        description: "用于积分包展示，不改写既有订单。",
        value: "100",
        source: "database",
        effect: "immediate",
        input: "number",
        unit: "积分",
      },
      {
        key: "STARTER_1_MONTH_PRICE",
        label: "Starter 1 个月价格",
        description: "以最小货币单位存储并参与服务端报价。",
        value: "3900",
        source: "database",
        effect: "immediate",
        input: "number",
        unit: "分",
      },
    ],
  },
];
