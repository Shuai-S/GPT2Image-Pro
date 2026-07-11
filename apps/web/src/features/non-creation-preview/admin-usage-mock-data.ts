// 管理“使用记录”高保真原型的虚构生成记录，仅用于本地筛选与检查器验证。

/** 使用记录支持的生成终态。 */
export type AdminUsageStatus = "pending" | "completed" | "failed";

/** 生成记录中的虚构用户身份。 */
export type AdminUsageUser = {
  id: string;
  name: string;
  email: string;
};

/** 实际执行生成请求的后端渠道摘要。 */
export type AdminUsageChannel = {
  kind: "api" | "account" | "adobe" | "platform" | "user-api";
  provider: string;
  detail: string;
  group: string | null;
  requestKind: string;
};

/** 双重记账口径下的积分消费明细。 */
export type AdminUsageCreditDetails = {
  total: number;
  image: number;
  moderation: number;
  conversation: number;
  multiplier: number;
  transactionId: string;
  sourceRef: string;
};

/** 失败记录的安全错误上下文。 */
export type AdminUsageError = {
  code: string;
  message: string;
  raw: string;
};

/** 管理端使用记录表和右侧检查器共享的完整生成记录。 */
export type AdminUsageRecord = {
  id: string;
  requestId: string;
  source: "基础创作" | "无限画布" | "外部 API" | "对话创作";
  user: AdminUsageUser;
  channel: AdminUsageChannel;
  prompt: string;
  revisedPrompt: string | null;
  promptRepairNotice: string | null;
  model: string;
  size: string;
  status: AdminUsageStatus;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  thumbnail: string | null;
  resultImages: string[];
  referenceImages: string[];
  credits: AdminUsageCreditDetails;
  error: AdminUsageError | null;
};

/** 原型筛选器允许选择的模型白名单。 */
export const adminUsageModels = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1-mini",
  "firefly-gpt-image-2",
] as const;

const users: AdminUsageUser[] = [
  { id: "usr_mock_001", name: "林言", email: "lin.yan@example.test" },
  { id: "usr_mock_002", name: "陈默", email: "chen.mo@example.test" },
  { id: "usr_mock_003", name: "王启", email: "wang.qi@example.test" },
  { id: "usr_mock_004", name: "赵宁", email: "zhao.ning@example.test" },
  { id: "usr_mock_005", name: "孙禾", email: "sun.he@example.test" },
  { id: "usr_mock_006", name: "Mira Cole", email: "mira@example.test" },
];

const channels: AdminUsageChannel[] = [
  {
    kind: "api",
    provider: "API 后端",
    detail: "api-primary-cn · OpenAI Images",
    group: "production-primary",
    requestKind: "images.generate",
  },
  {
    kind: "account",
    provider: "账号池",
    detail: "account-pool-07 · ChatGPT Web",
    group: "production-fallback",
    requestKind: "account.generate",
  },
  {
    kind: "adobe",
    provider: "Adobe",
    detail: "firefly-enterprise-02",
    group: "commercial-safe",
    requestKind: "firefly.generate",
  },
  {
    kind: "platform",
    provider: "平台通道",
    detail: "responses-image-primary",
    group: null,
    requestKind: "responses.create",
  },
  {
    kind: "user-api",
    provider: "用户 API",
    detail: "custom-endpoint · key hidden",
    group: null,
    requestKind: "images.generate",
  },
];

const prompts = [
  "雨后的香港街道，行人撑着透明雨伞，电影感长焦构图，霓虹反射清晰",
  "一组白色陶瓷香氛瓶的棚拍，柔和侧光，清洁背景，商业产品摄影",
  "现代美术馆入口的产品发布现场，黑白导视系统，宽幅建筑摄影",
  "极简网格系统的音乐节海报，红黑两色，粗体中文标题，保留票务信息区域",
  "海边独立书店的品牌主视觉，阴天自然光，编辑摄影风格",
  "漂浮在云海上方的古老观测站，黄昏，宽幅概念艺术，精细环境叙事",
  "透明亚克力椅置于白色展厅，硬质日光形成几何阴影，建筑杂志摄影",
  "为精品咖啡包装制作俯拍静物，深绿色纸张、银色压印与自然材质",
  "舞台灯光下的戏剧人物半身像，强烈明暗对比，胶片颗粒",
  "未来城市公共交通站点，雨天傍晚，可信的工业设计与人流尺度",
  "冬季山谷中的小型木屋，室内暖光，远处积雪与低云，安静克制",
  "编辑风格人物肖像，灰色无缝背景，柔和顶光，保留真实皮肤纹理",
] as const;

const revisedPrompts = [
  "Cinematic telephoto view of a rain-soaked Hong Kong street with clear neon reflections and pedestrians carrying transparent umbrellas.",
  "Studio product photograph of white ceramic fragrance bottles with soft side lighting on a clean neutral background.",
  "Wide architectural photograph of a contemporary museum entrance prepared for a product launch with monochrome wayfinding.",
] as const;

const errors: AdminUsageError[] = [
  {
    code: "UPSTREAM_TIMEOUT",
    message: "上游在 60 秒内没有返回可用响应。",
    raw: "UPSTREAM_TIMEOUT: no response body after 60000ms; retryable=true",
  },
  {
    code: "UPSTREAM_RATE_LIMITED",
    message: "所选渠道触发供应商速率限制。",
    raw: "UPSTREAM_RATE_LIMITED: provider returned HTTP 429; retryAfter=18",
  },
  {
    code: "STORAGE_WRITE_FAILED",
    message: "生成完成，但结果写入对象存储失败。",
    raw: "STORAGE_WRITE_FAILED: object store returned 503; persisted=false",
  },
  {
    code: "MODERATION_UNAVAILABLE",
    message: "内容审核未得到可信结论，按 fail-closed 终止。",
    raw: "MODERATION_UNAVAILABLE: fail-closed policy applied; provider=mock",
  },
];

/**
 * 为索引选择确定性的本地图库图片。
 *
 * @param index 生成记录序号。
 * @returns `public/gallery-examples` 下存在的图片路径。
 */
function imagePath(index: number) {
  const imageNumber = (index % 12) + 1;
  return `/gallery-examples/prototype-${String(imageNumber).padStart(2, "0")}.jpg`;
}

/**
 * 从固定种子生成一条内部一致的虚构使用记录。
 *
 * @param index 零基记录序号。
 * @returns 可用于全站管理列表的只读记录。
 */
function buildUsageRecord(index: number): AdminUsageRecord {
  const user = users[index % users.length];
  const channel = channels[index % channels.length];
  const prompt = prompts[index % prompts.length];
  const model = adminUsageModels[index % adminUsageModels.length];
  if (!user || !channel || !prompt || !model) {
    throw new Error("Admin usage mock seed is incomplete");
  }

  const status: AdminUsageStatus =
    index % 9 === 4 ? "pending" : index % 5 === 3 ? "failed" : "completed";
  const createdAt = new Date(
    Date.UTC(2026, 6, 11, 18, 40) - index * 5.5 * 3_600_000
  );
  const durationMs = status === "pending" ? null : 7_800 + (index % 8) * 2_950;
  const completedAt =
    durationMs === null ? null : new Date(createdAt.getTime() + durationMs);
  const error =
    status === "failed" ? (errors[index % errors.length] ?? null) : null;
  const source = (["基础创作", "无限画布", "外部 API", "对话创作"] as const)[
    index % 4
  ];
  if (!source) throw new Error("Admin usage source seed is incomplete");
  const baseCredits = Number((1.5 + (index % 6) * 0.75).toFixed(2));
  const moderationCredits = index % 3 === 0 ? 0.12 : 0;
  const conversationCredits = source === "对话创作" ? 0.5 : 0;
  const multiplier = channel.kind === "adobe" ? 1.2 : index % 7 === 0 ? 0.9 : 1;
  const totalCredits =
    status === "failed"
      ? 0
      : Number(
          (
            (baseCredits + moderationCredits + conversationCredits) *
            multiplier
          ).toFixed(2)
        );
  const resultImage = status === "completed" ? imagePath(index) : null;

  return {
    id: `gen_admin_mock_${String(index + 1).padStart(4, "0")}`,
    requestId: `req_admin_mock_${String(index + 701).padStart(4, "0")}`,
    source,
    user,
    channel,
    prompt,
    revisedPrompt:
      index % 4 === 0
        ? (revisedPrompts[index % revisedPrompts.length] ?? null)
        : null,
    promptRepairNotice:
      index % 6 === 0 ? "已补充镜头、光线与材质约束，未改变主体语义。" : null,
    model,
    size:
      ["1024x1024", "1536x1024", "1024x1536", "2048x2048"][index % 4] ??
      "1024x1024",
    status,
    durationMs,
    createdAt: createdAt.toISOString(),
    completedAt: completedAt?.toISOString() ?? null,
    thumbnail: resultImage,
    resultImages: resultImage ? [resultImage] : [],
    referenceImages:
      index % 4 === 0 ? [imagePath(index + 5), imagePath(index + 8)] : [],
    credits: {
      total: totalCredits,
      image: status === "failed" ? 0 : baseCredits,
      moderation: status === "failed" ? 0 : moderationCredits,
      conversation: status === "failed" ? 0 : conversationCredits,
      multiplier,
      transactionId: `tx_admin_mock_${String(index + 301).padStart(4, "0")}`,
      sourceRef: `gen_admin_mock_${String(index + 1).padStart(4, "0")}`,
    },
    error,
  };
}

/** 36 条跨用户、模型、渠道和状态的确定性使用记录。 */
export const adminUsageRecords: AdminUsageRecord[] = Array.from(
  { length: 36 },
  (_, index) => buildUsageRecord(index)
);
