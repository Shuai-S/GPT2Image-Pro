// 管理控制台高保真原型的静态数据与领域类型。仅供本地视觉验证使用。

/** 管理总览可选择的时间范围。 */
export type AdminRange = "24h" | "7d" | "30d" | "custom";

/** 总览趋势图中的单个时间采样点。 */
export type AdminTrendPoint = {
  label: string;
  requests: number;
  completed: number;
  failed: number;
  p95Seconds: number;
  paymentsCny: number;
  creditsConsumed: number;
  newUsers: number;
  activeUsers: number;
  availability: number;
};

/** 管理总览自定义时间范围使用的闭区间日期。 */
export type AdminCustomRange = {
  start: string;
  end: string;
};

/**
 * 决策稿要求的完整趋势系列，以及用于上一等长周期对比的派生值。
 *
 * 原始模拟采样只保存稳定业务基数，本类型承载可视化所需的细分类，避免在
 * 每一组静态数据中重复手工维护相互矛盾的总数和分项。
 */
export type AdminTrendSeriesPoint = AdminTrendPoint & {
  failureUpstream: number;
  failurePlatform: number;
  failureModeration: number;
  paymentOrders: number;
  fulfilledOrders: number;
  creditsIssued: number;
  creditsRefunded: number;
  creditsExpired: number;
  paidUsers: number;
  tickets: number;
  schedulerSwitches: number;
  rateLimits: number;
  cooldowns: number;
  previousRequests: number;
  previousPaymentOrders: number;
  previousActiveUsers: number;
  previousAvailability: number;
};

/** 顶部连续指标带中的聚合值与环比。 */
export type AdminMetricSnapshot = {
  generatedImages: number;
  successRate: number;
  p95Seconds: number;
  paymentsCny: number;
  creditsConsumed: number;
  newUsers: number;
  comparison: {
    generatedImages: number;
    successRate: number;
    p95Seconds: number;
    paymentsCny: number;
    creditsConsumed: number;
    newUsers: number;
  };
};

/** 高频错误检查器中的单次失败样本。 */
export type AdminErrorSample = {
  id: string;
  userId: string;
  userEmail: string;
  occurredAt: string;
  model: string;
  channel: string;
  prompt: string;
  rawError: string;
};

/** 总览高频错误表中的聚合错误。 */
export type AdminErrorGroup = {
  id: string;
  reason: string;
  category: "upstream" | "platform" | "moderation" | "request";
  count: number;
  share: number;
  lastSeen: string;
  samples: AdminErrorSample[];
};

/** 用户账号在管理列表中的状态。 */
export type AdminUserStatus = "active" | "frozen" | "disabled";

/** 用户积分检查器中的账本记录。 */
export type AdminCreditLedgerItem = {
  id: string;
  occurredAt: string;
  label: string;
  change: number;
  balance: number;
  sourceRef: string;
};

/** 用户订单检查器中的支付与履约记录。 */
export type AdminOrderItem = {
  id: string;
  occurredAt: string;
  product: string;
  amountCny: number;
  paymentStatus: "paid" | "pending" | "refunded";
  fulfillmentStatus: "fulfilled" | "pending" | "reversed";
};

/** 用户生成检查器中的请求上下文。 */
export type AdminGenerationItem = {
  id: string;
  occurredAt: string;
  model: string;
  prompt: string;
  status: "completed" | "failed";
  credits: number;
  error?: string;
};

/** 用户 API 检查器中的密钥摘要，不包含可回显的密钥内容。 */
export type AdminApiSummary = {
  status: "enabled" | "disabled";
  quota: number;
  used: number;
  lastUsedAt: string | null;
  keyCount: number;
};

/** 用户支持检查器中的工单摘要。 */
export type AdminTicketItem = {
  id: string;
  subject: string;
  status: "open" | "processing" | "closed";
  lastReplyAt: string;
};

/** 用户审计检查器中的资源级审计片段。 */
export type AdminAuditItem = {
  id: string;
  occurredAt: string;
  action: string;
  actor: string;
  reason: string;
  result: "success" | "failed";
};

/** 用户列表与右侧检查器共同使用的完整模拟用户。 */
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
  plan: "Free" | "Starter" | "Pro" | "Ultra";
  credits: number;
  registeredAt: string;
  lastActiveAt: string;
  totalGenerations: number;
  currentSessions: number;
  locale: string;
  creditsLedger: AdminCreditLedgerItem[];
  orders: AdminOrderItem[];
  generations: AdminGenerationItem[];
  api: AdminApiSummary;
  tickets: AdminTicketItem[];
  audits: AdminAuditItem[];
};

/** 不同时间范围的顶部指标快照。 */
export const adminMetricSnapshots: Record<AdminRange, AdminMetricSnapshot> = {
  "24h": {
    generatedImages: 18_426,
    successRate: 97.84,
    p95Seconds: 18.7,
    paymentsCny: 28_640,
    creditsConsumed: 64_382,
    newUsers: 284,
    comparison: {
      generatedImages: 8.4,
      successRate: 0.42,
      p95Seconds: -6.8,
      paymentsCny: 12.6,
      creditsConsumed: 7.9,
      newUsers: 4.3,
    },
  },
  "7d": {
    generatedImages: 118_932,
    successRate: 97.51,
    p95Seconds: 19.4,
    paymentsCny: 186_240,
    creditsConsumed: 421_860,
    newUsers: 1_846,
    comparison: {
      generatedImages: 6.1,
      successRate: -0.18,
      p95Seconds: 3.2,
      paymentsCny: 9.7,
      creditsConsumed: 5.8,
      newUsers: -1.4,
    },
  },
  "30d": {
    generatedImages: 486_721,
    successRate: 97.69,
    p95Seconds: 18.9,
    paymentsCny: 762_800,
    creditsConsumed: 1_738_420,
    newUsers: 7_936,
    comparison: {
      generatedImages: 14.2,
      successRate: 0.27,
      p95Seconds: -4.1,
      paymentsCny: 18.5,
      creditsConsumed: 13.8,
      newUsers: 9.2,
    },
  },
  custom: {
    generatedImages: 236_940,
    successRate: 97.63,
    p95Seconds: 19.1,
    paymentsCny: 372_460,
    creditsConsumed: 846_210,
    newUsers: 3_824,
    comparison: {
      generatedImages: 9.8,
      successRate: 0.11,
      p95Seconds: -2.3,
      paymentsCny: 11.4,
      creditsConsumed: 8.6,
      newUsers: 2.7,
    },
  },
};

/** 24 小时总览的两小时采样趋势。 */
const trend24Hours: AdminTrendPoint[] = [
  {
    label: "00:00",
    requests: 1110,
    completed: 1074,
    failed: 36,
    p95Seconds: 18.2,
    paymentsCny: 1420,
    creditsConsumed: 3820,
    newUsers: 18,
    activeUsers: 486,
    availability: 99.72,
  },
  {
    label: "02:00",
    requests: 870,
    completed: 846,
    failed: 24,
    p95Seconds: 17.4,
    paymentsCny: 980,
    creditsConsumed: 2940,
    newUsers: 12,
    activeUsers: 348,
    availability: 99.84,
  },
  {
    label: "04:00",
    requests: 690,
    completed: 672,
    failed: 18,
    p95Seconds: 16.9,
    paymentsCny: 760,
    creditsConsumed: 2310,
    newUsers: 9,
    activeUsers: 281,
    availability: 99.88,
  },
  {
    label: "06:00",
    requests: 930,
    completed: 902,
    failed: 28,
    p95Seconds: 18.6,
    paymentsCny: 1340,
    creditsConsumed: 3220,
    newUsers: 14,
    activeUsers: 392,
    availability: 99.61,
  },
  {
    label: "08:00",
    requests: 1490,
    completed: 1453,
    failed: 37,
    p95Seconds: 19.1,
    paymentsCny: 2480,
    creditsConsumed: 5180,
    newUsers: 24,
    activeUsers: 714,
    availability: 99.44,
  },
  {
    label: "10:00",
    requests: 1880,
    completed: 1834,
    failed: 46,
    p95Seconds: 19.7,
    paymentsCny: 3320,
    creditsConsumed: 6640,
    newUsers: 31,
    activeUsers: 986,
    availability: 99.32,
  },
  {
    label: "12:00",
    requests: 2040,
    completed: 1991,
    failed: 49,
    p95Seconds: 20.2,
    paymentsCny: 3760,
    creditsConsumed: 7280,
    newUsers: 36,
    activeUsers: 1108,
    availability: 99.27,
  },
  {
    label: "14:00",
    requests: 1980,
    completed: 1938,
    failed: 42,
    p95Seconds: 18.9,
    paymentsCny: 3140,
    creditsConsumed: 7010,
    newUsers: 33,
    activeUsers: 1044,
    availability: 99.53,
  },
  {
    label: "16:00",
    requests: 2170,
    completed: 2121,
    failed: 49,
    p95Seconds: 18.4,
    paymentsCny: 3680,
    creditsConsumed: 7710,
    newUsers: 30,
    activeUsers: 1162,
    availability: 99.48,
  },
  {
    label: "18:00",
    requests: 2360,
    completed: 2302,
    failed: 58,
    p95Seconds: 20.8,
    paymentsCny: 4260,
    creditsConsumed: 8420,
    newUsers: 29,
    activeUsers: 1284,
    availability: 99.11,
  },
  {
    label: "20:00",
    requests: 2540,
    completed: 2476,
    failed: 64,
    p95Seconds: 21.3,
    paymentsCny: 4820,
    creditsConsumed: 9130,
    newUsers: 27,
    activeUsers: 1372,
    availability: 98.96,
  },
  {
    label: "22:00",
    requests: 1840,
    completed: 1796,
    failed: 44,
    p95Seconds: 18.5,
    paymentsCny: 2680,
    creditsConsumed: 6722,
    newUsers: 21,
    activeUsers: 914,
    availability: 99.58,
  },
];

/** 7 天总览的逐日趋势。 */
const trend7Days: AdminTrendPoint[] = [
  {
    label: "周六",
    requests: 15_820,
    completed: 15_426,
    failed: 394,
    p95Seconds: 19.8,
    paymentsCny: 24_680,
    creditsConsumed: 56_240,
    newUsers: 248,
    activeUsers: 4820,
    availability: 99.42,
  },
  {
    label: "周日",
    requests: 16_430,
    completed: 16_043,
    failed: 387,
    p95Seconds: 19.1,
    paymentsCny: 26_120,
    creditsConsumed: 58_930,
    newUsers: 264,
    activeUsers: 5014,
    availability: 99.51,
  },
  {
    label: "周一",
    requests: 17_210,
    completed: 16_776,
    failed: 434,
    p95Seconds: 20.4,
    paymentsCny: 27_860,
    creditsConsumed: 61_880,
    newUsers: 278,
    activeUsers: 5290,
    availability: 99.26,
  },
  {
    label: "周二",
    requests: 16_980,
    completed: 16_573,
    failed: 407,
    p95Seconds: 18.7,
    paymentsCny: 25_940,
    creditsConsumed: 60_740,
    newUsers: 251,
    activeUsers: 5184,
    availability: 99.58,
  },
  {
    label: "周三",
    requests: 17_840,
    completed: 17_435,
    failed: 405,
    p95Seconds: 19.4,
    paymentsCny: 28_420,
    creditsConsumed: 63_410,
    newUsers: 289,
    activeUsers: 5468,
    availability: 99.47,
  },
  {
    label: "周四",
    requests: 18_120,
    completed: 17_701,
    failed: 419,
    p95Seconds: 18.9,
    paymentsCny: 25_380,
    creditsConsumed: 64_280,
    newUsers: 232,
    activeUsers: 5510,
    availability: 99.62,
  },
  {
    label: "周五",
    requests: 18_426,
    completed: 18_028,
    failed: 398,
    p95Seconds: 18.7,
    paymentsCny: 27_840,
    creditsConsumed: 64_382,
    newUsers: 284,
    activeUsers: 5642,
    availability: 99.56,
  },
];

/** 30 天总览的三日采样趋势。 */
const trend30Days: AdminTrendPoint[] = [
  {
    label: "06/13",
    requests: 42_160,
    completed: 41_112,
    failed: 1048,
    p95Seconds: 20.1,
    paymentsCny: 61_420,
    creditsConsumed: 148_240,
    newUsers: 682,
    activeUsers: 12_840,
    availability: 99.28,
  },
  {
    label: "06/16",
    requests: 44_820,
    completed: 43_758,
    failed: 1062,
    p95Seconds: 19.6,
    paymentsCny: 66_840,
    creditsConsumed: 156_710,
    newUsers: 731,
    activeUsers: 13_620,
    availability: 99.41,
  },
  {
    label: "06/19",
    requests: 45_690,
    completed: 44_645,
    failed: 1045,
    p95Seconds: 19.2,
    paymentsCny: 68_240,
    creditsConsumed: 161_380,
    newUsers: 748,
    activeUsers: 13_980,
    availability: 99.53,
  },
  {
    label: "06/22",
    requests: 47_340,
    completed: 46_201,
    failed: 1139,
    p95Seconds: 20.5,
    paymentsCny: 71_620,
    creditsConsumed: 168_420,
    newUsers: 764,
    activeUsers: 14_410,
    availability: 99.16,
  },
  {
    label: "06/25",
    requests: 46_880,
    completed: 45_806,
    failed: 1074,
    p95Seconds: 19.4,
    paymentsCny: 70_180,
    creditsConsumed: 165_940,
    newUsers: 752,
    activeUsers: 14_205,
    availability: 99.46,
  },
  {
    label: "06/28",
    requests: 49_220,
    completed: 48_148,
    failed: 1072,
    p95Seconds: 18.8,
    paymentsCny: 75_360,
    creditsConsumed: 174_680,
    newUsers: 806,
    activeUsers: 14_960,
    availability: 99.61,
  },
  {
    label: "07/01",
    requests: 50_140,
    completed: 49_008,
    failed: 1132,
    p95Seconds: 19.3,
    paymentsCny: 77_240,
    creditsConsumed: 178_340,
    newUsers: 824,
    activeUsers: 15_340,
    availability: 99.38,
  },
  {
    label: "07/04",
    requests: 51_620,
    completed: 50_516,
    failed: 1104,
    p95Seconds: 18.6,
    paymentsCny: 79_880,
    creditsConsumed: 183_760,
    newUsers: 851,
    activeUsers: 15_820,
    availability: 99.68,
  },
  {
    label: "07/07",
    requests: 52_480,
    completed: 51_298,
    failed: 1182,
    p95Seconds: 19.1,
    paymentsCny: 82_160,
    creditsConsumed: 186_520,
    newUsers: 868,
    activeUsers: 16_240,
    availability: 99.44,
  },
  {
    label: "07/10",
    requests: 56_371,
    completed: 55_234,
    failed: 1137,
    p95Seconds: 18.9,
    paymentsCny: 89_840,
    creditsConsumed: 214_430,
    newUsers: 910,
    activeUsers: 17_120,
    availability: 99.57,
  },
];

/** 不同范围对应的非空图表数据，custom 使用独立截取语义。 */
export const adminTrendData: Record<AdminRange, AdminTrendPoint[]> = {
  "24h": trend24Hours,
  "7d": trend7Days,
  "30d": trend30Days,
  custom: trend30Days.slice(2, 9),
};

/**
 * 把 ISO 日期解析为 UTC 零点，避免本地时区导致范围天数偏移。
 *
 * @param value ISO `YYYY-MM-DD` 日期。
 * @returns 合法日期的毫秒时间戳；非法输入返回 null。
 */
function parseIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * 计算自定义闭区间的天数，并为异常输入返回安全默认值。
 *
 * @param range 自定义日期范围。
 * @returns 1 至 366 之间的模拟统计天数。
 */
function getCustomRangeDays(range: AdminCustomRange): number {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (start === null || end === null || end < start) return 1;
  return Math.min(366, Math.floor((end - start) / 86_400_000) + 1);
}

/**
 * 根据自定义日期范围生成非空、带真实日期标签的本地趋势样本。
 *
 * WHY：原型不能请求真实遥测数据，但“应用范围”必须真实改变图表语义。本函数从
 * 30 天基线等距取样并重写日期标签，使任意合法范围都能产生稳定可复现的结果。
 *
 * @param range 已确认的自定义日期范围。
 * @returns 2 至 12 个非空趋势点；失败时退回现有 custom 基线。
 */
export function buildCustomTrendData(
  range: AdminCustomRange
): AdminTrendPoint[] {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  const fallback = adminTrendData.custom;
  const base = adminTrendData["30d"];
  const firstBasePoint = base[0];
  if (
    start === null ||
    end === null ||
    end < start ||
    !firstBasePoint ||
    base.length === 0
  ) {
    return fallback;
  }

  const days = getCustomRangeDays(range);
  const pointCount = Math.min(12, Math.max(2, days));
  return Array.from({ length: pointCount }, (_, index) => {
    const progress = pointCount === 1 ? 0 : index / (pointCount - 1);
    const sourceIndex = Math.round(progress * (base.length - 1));
    const source = base[sourceIndex] ?? firstBasePoint;
    const timestamp = start + Math.round(progress * (end - start));
    const date = new Date(timestamp);
    const label = `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
      date.getUTCDate()
    ).padStart(2, "0")}`;
    const rangeScale = 0.88 + Math.min(days, 90) / 750;

    return {
      ...source,
      label,
      requests: Math.round(source.requests * rangeScale),
      completed: Math.round(source.completed * rangeScale),
      failed: Math.round(source.failed * rangeScale),
      paymentsCny: Math.round(source.paymentsCny * rangeScale),
      creditsConsumed: Math.round(source.creditsConsumed * rangeScale),
      newUsers: Math.round(source.newUsers * rangeScale),
      activeUsers: Math.round(source.activeUsers * rangeScale),
    };
  });
}

/**
 * 根据自定义范围缩放顶部累计指标，比例类指标保持稳定业务含义。
 *
 * @param range 已确认的自定义日期范围。
 * @returns 与自定义图表范围一致的指标快照。
 */
export function buildCustomMetricSnapshot(
  range: AdminCustomRange
): AdminMetricSnapshot {
  const days = getCustomRangeDays(range);
  const base = adminMetricSnapshots["30d"];
  const scale = Math.max(1 / 30, days / 30);
  return {
    generatedImages: Math.round(base.generatedImages * scale),
    successRate: base.successRate,
    p95Seconds: base.p95Seconds,
    paymentsCny: Math.round(base.paymentsCny * scale),
    creditsConsumed: Math.round(base.creditsConsumed * scale),
    newUsers: Math.round(base.newUsers * scale),
    comparison: { ...base.comparison },
  };
}

/**
 * 从聚合基数派生决策稿中的完整趋势分项和上一周期比较线。
 *
 * WHY：各分项必须与聚合总数保持一致。失败分类以 `failed` 拆分，财务与平台事件
 * 按固定可解释比例生成；上一周期使用轻微周期波动，保证比较线不与当前线重叠。
 *
 * @param points 当前选择范围的原始趋势数据。
 * @returns 可直接交给 Recharts 的完整趋势系列。
 */
export function buildAdminTrendSeries(
  points: AdminTrendPoint[]
): AdminTrendSeriesPoint[] {
  return points.map((point, index) => {
    const failureUpstream = Math.round(point.failed * 0.56);
    const failurePlatform = Math.round(point.failed * 0.27);
    const failureModeration = Math.max(
      0,
      point.failed - failureUpstream - failurePlatform
    );
    const paymentOrders = Math.max(1, Math.round(point.paymentsCny / 168));
    const periodWave = 0.93 + ((index % 5) - 2) * 0.012;

    return {
      ...point,
      failureUpstream,
      failurePlatform,
      failureModeration,
      paymentOrders,
      fulfilledOrders: Math.max(0, Math.round(paymentOrders * 0.96)),
      creditsIssued: Math.round(point.creditsConsumed * 1.18),
      creditsRefunded: Math.round(point.creditsConsumed * 0.026),
      creditsExpired: Math.round(point.creditsConsumed * 0.014),
      paidUsers: Math.max(1, Math.round(point.newUsers * 0.18)),
      tickets: Math.max(0, Math.round(point.newUsers * 0.075)),
      schedulerSwitches: Math.max(0, Math.round(point.failed * 0.08)),
      rateLimits: Math.max(0, Math.round(point.failed * 0.21)),
      cooldowns: Math.max(0, Math.round(point.failed * 0.13)),
      previousRequests: Math.round(point.requests * periodWave),
      previousPaymentOrders: Math.max(
        1,
        Math.round(paymentOrders * periodWave)
      ),
      previousActiveUsers: Math.round(point.activeUsers * periodWave),
      previousAvailability: Number(
        Math.max(98, point.availability - 0.12 + (index % 3) * 0.04).toFixed(2)
      ),
    };
  });
}

/** 管理总览的高频错误聚合与可追踪失败样本。 */
export const adminErrorGroups: AdminErrorGroup[] = [
  {
    id: "err-upstream-timeout",
    reason: "上游响应超时",
    category: "upstream",
    count: 126,
    share: 31.7,
    lastSeen: "2 分钟前",
    samples: [
      {
        id: "gen_mock_01",
        userId: "usr_mock_001",
        userEmail: "lin.yan@example.test",
        occurredAt: "2026-07-12 22:41:08",
        model: "gpt-image-2",
        channel: "api-primary-cn",
        prompt:
          "雨后的香港街道，行人撑着透明雨伞，电影感长焦构图，霓虹反射清晰",
        rawError: "UPSTREAM_TIMEOUT: no response after 60,000 ms",
      },
      {
        id: "gen_mock_02",
        userId: "usr_mock_004",
        userEmail: "zhao.ning@example.test",
        occurredAt: "2026-07-12 22:38:26",
        model: "gpt-image-1.5",
        channel: "api-primary-cn",
        prompt: "现代美术馆入口的产品发布现场，黑白导视系统，宽幅建筑摄影",
        rawError: "UPSTREAM_TIMEOUT: socket closed before response body",
      },
    ],
  },
  {
    id: "err-rate-limited",
    reason: "后端速率限制",
    category: "upstream",
    count: 92,
    share: 23.1,
    lastSeen: "5 分钟前",
    samples: [
      {
        id: "gen_mock_03",
        userId: "usr_mock_002",
        userEmail: "chen.mo@example.test",
        occurredAt: "2026-07-12 22:35:02",
        model: "gpt-image-2",
        channel: "api-backup-sg",
        prompt: "一组白色陶瓷香氛瓶的棚拍，柔和侧光，清洁背景，商业产品摄影",
        rawError: "UPSTREAM_RATE_LIMITED: provider returned HTTP 429",
      },
    ],
  },
  {
    id: "err-storage-write",
    reason: "生成结果存储失败",
    category: "platform",
    count: 68,
    share: 17.1,
    lastSeen: "11 分钟前",
    samples: [
      {
        id: "gen_mock_04",
        userId: "usr_mock_003",
        userEmail: "wang.qi@example.test",
        occurredAt: "2026-07-12 22:28:44",
        model: "gpt-image-1-mini",
        channel: "api-backup-jp",
        prompt:
          "极简网格系统的音乐节海报，红黑两色，粗体中文标题，保留票务信息区域",
        rawError: "STORAGE_WRITE_FAILED: object store returned 503",
      },
    ],
  },
  {
    id: "err-moderation",
    reason: "内容审核未得到可信结论",
    category: "moderation",
    count: 61,
    share: 15.3,
    lastSeen: "18 分钟前",
    samples: [
      {
        id: "gen_mock_05",
        userId: "usr_mock_005",
        userEmail: "sun.he@example.test",
        occurredAt: "2026-07-12 22:21:31",
        model: "gpt-image-2",
        channel: "api-primary-cn",
        prompt: "舞台灯光下的戏剧人物半身像，强烈明暗对比，胶片颗粒",
        rawError: "MODERATION_UNAVAILABLE: fail-closed policy applied",
      },
    ],
  },
  {
    id: "err-invalid-ratio",
    reason: "请求尺寸超出模型限制",
    category: "request",
    count: 51,
    share: 12.8,
    lastSeen: "24 分钟前",
    samples: [
      {
        id: "gen_mock_06",
        userId: "usr_mock_001",
        userEmail: "lin.yan@example.test",
        occurredAt: "2026-07-12 22:15:47",
        model: "gpt-image-1-mini",
        channel: "api-primary-cn",
        prompt: "用于移动端启动页的超长竖幅城市天际线，清晨薄雾，极简构图",
        rawError: "INVALID_IMAGE_RATIO: requested ratio 1:5 exceeds 1:4",
      },
    ],
  },
];

/** 用户管理表和检查器使用的虚构用户数据。 */
export const adminUsers: AdminUser[] = [
  {
    id: "usr_mock_001",
    name: "林言",
    email: "lin.yan@example.test",
    status: "active",
    plan: "Pro",
    credits: 1842.5,
    registeredAt: "2026-02-18 09:24",
    lastActiveAt: "2026-07-12 22:41",
    totalGenerations: 2864,
    currentSessions: 3,
    locale: "zh-CN",
    creditsLedger: [
      {
        id: "tx_mock_101",
        occurredAt: "07-12 22:41",
        label: "生成消费",
        change: -3.5,
        balance: 1842.5,
        sourceRef: "gen_mock_01",
      },
      {
        id: "tx_mock_102",
        occurredAt: "07-12 18:20",
        label: "返利转入",
        change: 126,
        balance: 1846,
        sourceRef: "ref_convert_mock_18",
      },
      {
        id: "tx_mock_103",
        occurredAt: "07-11 09:02",
        label: "套餐发放",
        change: 2000,
        balance: 1720,
        sourceRef: "batch_mock_pro_07",
      },
    ],
    orders: [
      {
        id: "ord_mock_3101",
        occurredAt: "2026-07-11 09:01",
        product: "Pro · 1 个月",
        amountCny: 168,
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
      },
      {
        id: "ord_mock_2804",
        occurredAt: "2026-06-11 08:54",
        product: "Pro · 1 个月",
        amountCny: 168,
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
      },
    ],
    generations: [
      {
        id: "gen_mock_01",
        occurredAt: "07-12 22:41",
        model: "gpt-image-2",
        prompt:
          "雨后的香港街道，行人撑着透明雨伞，电影感长焦构图，霓虹反射清晰",
        status: "failed",
        credits: 0,
        error: "上游响应超时",
      },
      {
        id: "gen_mock_100",
        occurredAt: "07-12 21:58",
        model: "gpt-image-2",
        prompt: "海边独立书店的品牌主视觉，阴天自然光，编辑摄影风格",
        status: "completed",
        credits: 3.5,
      },
    ],
    api: {
      status: "enabled",
      quota: 10_000,
      used: 6842,
      lastUsedAt: "2026-07-12 22:41",
      keyCount: 2,
    },
    tickets: [
      {
        id: "ticket_mock_71",
        subject: "升级后积分显示延迟",
        status: "closed",
        lastReplyAt: "2026-06-18 14:20",
      },
    ],
    audits: [
      {
        id: "audit_mock_991",
        occurredAt: "2026-06-18 14:18",
        action: "人工补发积分",
        actor: "root@example.test",
        reason: "支付履约延迟核对后补发",
        result: "success",
      },
    ],
  },
  {
    id: "usr_mock_002",
    name: "陈默",
    email: "chen.mo@example.test",
    status: "active",
    plan: "Ultra",
    credits: 6430,
    registeredAt: "2025-12-06 16:42",
    lastActiveAt: "2026-07-12 22:35",
    totalGenerations: 9428,
    currentSessions: 2,
    locale: "zh-CN",
    creditsLedger: [
      {
        id: "tx_mock_201",
        occurredAt: "07-12 22:35",
        label: "失败请求退款",
        change: 4,
        balance: 6430,
        sourceRef: "gen_mock_03",
      },
      {
        id: "tx_mock_202",
        occurredAt: "07-10 12:30",
        label: "积分包购买",
        change: 5000,
        balance: 6280,
        sourceRef: "batch_mock_pack_44",
      },
    ],
    orders: [
      {
        id: "ord_mock_3208",
        occurredAt: "2026-07-10 12:29",
        product: "5000 积分包",
        amountCny: 298,
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
      },
    ],
    generations: [
      {
        id: "gen_mock_03",
        occurredAt: "07-12 22:35",
        model: "gpt-image-2",
        prompt: "一组白色陶瓷香氛瓶的棚拍，柔和侧光，清洁背景，商业产品摄影",
        status: "failed",
        credits: 0,
        error: "后端速率限制",
      },
    ],
    api: {
      status: "enabled",
      quota: 50_000,
      used: 28_410,
      lastUsedAt: "2026-07-12 22:35",
      keyCount: 3,
    },
    tickets: [],
    audits: [],
  },
  {
    id: "usr_mock_003",
    name: "王启",
    email: "wang.qi@example.test",
    status: "frozen",
    plan: "Starter",
    credits: 286,
    registeredAt: "2026-05-21 11:08",
    lastActiveAt: "2026-07-12 21:54",
    totalGenerations: 684,
    currentSessions: 0,
    locale: "zh-CN",
    creditsLedger: [
      {
        id: "tx_mock_301",
        occurredAt: "07-12 21:54",
        label: "生成消费",
        change: -1,
        balance: 286,
        sourceRef: "gen_mock_04",
      },
    ],
    orders: [
      {
        id: "ord_mock_3002",
        occurredAt: "2026-07-02 16:48",
        product: "Starter · 1 个月",
        amountCny: 68,
        paymentStatus: "paid",
        fulfillmentStatus: "fulfilled",
      },
    ],
    generations: [
      {
        id: "gen_mock_04",
        occurredAt: "07-12 21:54",
        model: "gpt-image-1-mini",
        prompt: "极简网格系统的音乐节海报，红黑两色，粗体中文标题",
        status: "failed",
        credits: 0,
        error: "生成结果存储失败",
      },
    ],
    api: {
      status: "disabled",
      quota: 0,
      used: 0,
      lastUsedAt: null,
      keyCount: 0,
    },
    tickets: [
      {
        id: "ticket_mock_86",
        subject: "账号无法继续生成",
        status: "processing",
        lastReplyAt: "2026-07-12 20:36",
      },
    ],
    audits: [
      {
        id: "audit_mock_1004",
        occurredAt: "2026-07-12 21:56",
        action: "冻结账户",
        actor: "root@example.test",
        reason: "异常支付风险复核",
        result: "success",
      },
    ],
  },
  {
    id: "usr_mock_004",
    name: "赵宁",
    email: "zhao.ning@example.test",
    status: "active",
    plan: "Free",
    credits: 42,
    registeredAt: "2026-07-08 13:14",
    lastActiveAt: "2026-07-12 22:38",
    totalGenerations: 38,
    currentSessions: 1,
    locale: "zh-CN",
    creditsLedger: [
      {
        id: "tx_mock_401",
        occurredAt: "07-12 20:04",
        label: "生成消费",
        change: -1,
        balance: 42,
        sourceRef: "gen_mock_402",
      },
    ],
    orders: [],
    generations: [
      {
        id: "gen_mock_02",
        occurredAt: "07-12 22:38",
        model: "gpt-image-1.5",
        prompt: "现代美术馆入口的产品发布现场，黑白导视系统，宽幅建筑摄影",
        status: "failed",
        credits: 0,
        error: "上游响应超时",
      },
    ],
    api: {
      status: "disabled",
      quota: 0,
      used: 0,
      lastUsedAt: null,
      keyCount: 0,
    },
    tickets: [],
    audits: [],
  },
  {
    id: "usr_mock_005",
    name: "孙禾",
    email: "sun.he@example.test",
    status: "disabled",
    plan: "Pro",
    credits: 912,
    registeredAt: "2026-01-13 18:06",
    lastActiveAt: "2026-07-01 10:22",
    totalGenerations: 1642,
    currentSessions: 0,
    locale: "en-US",
    creditsLedger: [
      {
        id: "tx_mock_501",
        occurredAt: "06-30 10:20",
        label: "积分过期",
        change: -120,
        balance: 912,
        sourceRef: "expiry_mock_18",
      },
    ],
    orders: [
      {
        id: "ord_mock_2501",
        occurredAt: "2026-05-14 09:32",
        product: "Pro · 1 个月",
        amountCny: 168,
        paymentStatus: "refunded",
        fulfillmentStatus: "reversed",
      },
    ],
    generations: [
      {
        id: "gen_mock_05",
        occurredAt: "07-01 10:20",
        model: "gpt-image-2",
        prompt: "舞台灯光下的戏剧人物半身像，强烈明暗对比，胶片颗粒",
        status: "failed",
        credits: 0,
        error: "内容审核未得到可信结论",
      },
    ],
    api: {
      status: "disabled",
      quota: 10_000,
      used: 1820,
      lastUsedAt: "2026-06-28 18:40",
      keyCount: 1,
    },
    tickets: [
      {
        id: "ticket_mock_64",
        subject: "申请停用账户",
        status: "closed",
        lastReplyAt: "2026-07-01 10:22",
      },
    ],
    audits: [
      {
        id: "audit_mock_884",
        occurredAt: "2026-07-01 10:22",
        action: "停用账户",
        actor: "root@example.test",
        reason: "用户通过已核验工单申请停用",
        result: "success",
      },
    ],
  },
];
