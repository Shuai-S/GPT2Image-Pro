// 账户中心高保真原型的静态数据与类型。仅供开发预览使用，不读取真实用户或账务数据。

export type AccountView =
  | "plan"
  | "usage"
  | "referral"
  | "announcements"
  | "support"
  | "profile"
  | "security"
  | "data";

export type AccountNavigationGroup = {
  label: string;
  items: Array<{
    id: AccountView;
    label: string;
    badge?: string;
  }>;
};

export type PlanId = "free" | "starter" | "pro" | "ultra" | "enterprise";
export type PlanTerm = "month" | "year";

export type PlanOption = {
  id: PlanId;
  name: string;
  summary: string;
  monthlyPrice: number;
  yearlyPrice: number;
  credits: number;
  features: string[];
};

export type CreditLedgerRow = {
  id: string;
  occurredAt: string;
  title: string;
  reference: string;
  amount: number;
  balance: number;
  tone: "positive" | "negative" | "warning" | "neutral";
};

export type PaymentOrderRow = {
  id: string;
  occurredAt: string;
  item: string;
  amount: string;
  paymentStatus: "已支付" | "处理中" | "已退款";
  fulfillmentStatus: "已履约" | "处理中" | "已撤销";
};

export type GenerationUsageRow = {
  id: string;
  requestId: string;
  occurredAt: string;
  completedAt: string | null;
  prompt: string;
  model: string;
  size: string;
  source: "基础创作" | "无限画布";
  images: number;
  status: "处理中" | "完成" | "失败";
  credits: number;
  resultImages: string[];
  referenceImages: string[];
  failureMessage: string | null;
};

export type ReferralLedgerRow = {
  id: string;
  occurredAt: string;
  reward: number;
  rate: string;
  status: "可转换" | "冻结中" | "已转换" | "已撤销";
  availableAt: string;
  note: string;
};

export type ReferralTransferRow = {
  id: string;
  occurredAt: string;
  credits: number;
  status: "已完成" | "处理中";
  ledgerReference: string;
};

export type AnnouncementRow = {
  id: string;
  title: string;
  summary: string;
  body: string[];
  publishedAt: string;
  severity: "普通" | "重要";
  unread: boolean;
};

export type SupportTicketRow = {
  id: string;
  subject: string;
  status: "待处理" | "处理中" | "已关闭";
  updatedAt: string;
  unread: boolean;
  messages: Array<{
    id: string;
    author: "你" | "支持团队";
    sentAt: string;
    content: string;
  }>;
};

export type SessionRow = {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
};

export const accountNavigation: AccountNavigationGroup[] = [
  {
    label: "资金与权益",
    items: [
      { id: "plan", label: "套餐与积分" },
      { id: "usage", label: "订单与用量" },
      { id: "referral", label: "邀请返利" },
    ],
  },
  {
    label: "服务",
    items: [
      { id: "announcements", label: "公告" },
      { id: "support", label: "支持工单" },
    ],
  },
  {
    label: "账户",
    items: [
      { id: "profile", label: "个人资料" },
      { id: "security", label: "安全" },
      { id: "data", label: "数据与账户" },
    ],
  },
];

export const planOptions: PlanOption[] = [
  {
    id: "free",
    name: "Free",
    summary: "体验基础创作能力",
    monthlyPrice: 0,
    yearlyPrice: 0,
    credits: 100,
    features: ["基础生成队列", "私人图库", "标准分辨率"],
  },
  {
    id: "starter",
    name: "Starter",
    summary: "适合持续创作与日常项目",
    monthlyPrice: 20,
    yearlyPrice: 144,
    credits: 5_000,
    features: ["更高生成额度", "高分辨率输出", "无限画布"],
  },
  {
    id: "pro",
    name: "Pro",
    summary: "为专业工作流提供优先队列",
    monthlyPrice: 60,
    yearlyPrice: 432,
    credits: 20_000,
    features: ["优先生成队列", "完整输出规格", "更高并发额度"],
  },
  {
    id: "ultra",
    name: "Ultra",
    summary: "面向高频创作与更大并发",
    monthlyPrice: 200,
    yearlyPrice: 1_440,
    credits: 80_000,
    features: ["最高生成优先级", "高并发额度", "更高上传上限"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    summary: "面向持续大规模生产",
    monthlyPrice: 800,
    yearlyPrice: 5_760,
    credits: 320_000,
    features: ["企业资源额度", "最高并发上限", "专属支持"],
  },
];

export const creditPackages = [
  { id: "credits-300", credits: 300, price: 29 },
  { id: "credits-1000", credits: 1_000, price: 88 },
  { id: "credits-3000", credits: 3_000, price: 238 },
] as const;

export const creditLedger: CreditLedgerRow[] = [
  {
    id: "CRD-240712-0917",
    occurredAt: "2026-07-12 09:17",
    title: "图像生成消费",
    reference: "生成请求 GEN-7D93A1",
    amount: -12,
    balance: 1_248.5,
    tone: "negative",
  },
  {
    id: "CRD-240711-2240",
    occurredAt: "2026-07-11 22:40",
    title: "邀请奖励转入",
    reference: "转换记录 RFT-8912",
    amount: 286.5,
    balance: 1_260.5,
    tone: "positive",
  },
  {
    id: "CRD-240711-1852",
    occurredAt: "2026-07-11 18:52",
    title: "生成失败退款",
    reference: "生成请求 GEN-7D628E",
    amount: 4,
    balance: 974,
    tone: "positive",
  },
  {
    id: "CRD-240710-1106",
    occurredAt: "2026-07-10 11:06",
    title: "图像生成消费",
    reference: "生成请求 GEN-7CFB20",
    amount: -8,
    balance: 970,
    tone: "negative",
  },
  {
    id: "CRD-240701-0000",
    occurredAt: "2026-07-01 00:00",
    title: "积分过期",
    reference: "2026 年 6 月套餐积分",
    amount: -42,
    balance: 978,
    tone: "warning",
  },
];

export const paymentOrders: PaymentOrderRow[] = [
  {
    id: "PAY-20260701-8K2F",
    occurredAt: "2026-07-01 10:32",
    item: "Pro · 1 个月",
    amount: "¥60.00",
    paymentStatus: "已支付",
    fulfillmentStatus: "已履约",
  },
  {
    id: "PAY-20260618-Q91H",
    occurredAt: "2026-06-18 16:04",
    item: "1,000 积分包",
    amount: "¥88.00",
    paymentStatus: "已支付",
    fulfillmentStatus: "已履约",
  },
  {
    id: "PAY-20260502-M4LA",
    occurredAt: "2026-05-02 08:41",
    item: "300 积分包",
    amount: "¥29.00",
    paymentStatus: "已退款",
    fulfillmentStatus: "已撤销",
  },
];

export const generationUsage: GenerationUsageRow[] = [
  {
    id: "GEN-7D93A1",
    requestId: "REQ-20260712-0917-4F2A",
    occurredAt: "2026-07-12 09:17",
    completedAt: "2026-07-12 09:18",
    prompt:
      "为建筑品牌制作一组从荒野入口到室内展陈的概念视觉，统一清晨自然光、克制构图与低饱和材质。",
    model: "GPT Image 2",
    size: "2048 × 1152",
    source: "基础创作",
    images: 4,
    status: "完成",
    credits: 12,
    resultImages: [
      "/gallery-examples/prototype-04.jpg",
      "/gallery-examples/prototype-05.jpg",
      "/gallery-examples/prototype-12.jpg",
      "/gallery-examples/prototype-08.jpg",
    ],
    referenceImages: ["/gallery-examples/prototype-06.jpg"],
    failureMessage: null,
  },
  {
    id: "GEN-7DA510",
    requestId: "REQ-20260712-0852-D60E",
    occurredAt: "2026-07-12 08:52",
    completedAt: null,
    prompt:
      "清晨海岸线上的现代美术馆，白色混凝土体块，潮湿地面反射天空，宽幅建筑摄影。",
    model: "GPT Image 2",
    size: "2048 × 1152",
    source: "基础创作",
    images: 2,
    status: "处理中",
    credits: 0,
    resultImages: [],
    referenceImages: [],
    failureMessage: null,
  },
  {
    id: "GEN-7D628E",
    requestId: "REQ-20260711-1852-91BC",
    occurredAt: "2026-07-11 18:52",
    completedAt: "2026-07-11 18:55",
    prompt:
      "延续画布中的建筑轮廓，将远景改为暴雨后的城市天际线，保持冷色环境光和原有透视。",
    model: "GPT Image 1.5",
    size: "1536 × 1024",
    source: "无限画布",
    images: 2,
    status: "失败",
    credits: 0,
    resultImages: [],
    referenceImages: ["/gallery-examples/prototype-12.jpg"],
    failureMessage:
      "任务处理时间超出限制，本次未扣除积分。你可以稍后重试或减少生成张数。",
  },
  {
    id: "GEN-7CFB20",
    requestId: "REQ-20260710-1106-6D71",
    occurredAt: "2026-07-10 11:06",
    completedAt: "2026-07-10 11:07",
    prompt:
      "午夜秀场中的角色概念，银色面料，克制的舞台灯光，人物正面站姿，时装编辑摄影质感。",
    model: "GPT Image 2",
    size: "1024 × 1536",
    source: "基础创作",
    images: 2,
    status: "完成",
    credits: 8,
    resultImages: [
      "/gallery-examples/prototype-03.jpg",
      "/gallery-examples/prototype-02.jpg",
    ],
    referenceImages: ["/gallery-examples/prototype-11.jpg"],
    failureMessage: null,
  },
  {
    id: "GEN-7CDA97",
    requestId: "REQ-20260709-2028-B530",
    occurredAt: "2026-07-09 20:28",
    completedAt: "2026-07-09 20:29",
    prompt:
      "为一家独立咖啡品牌建立器物与空间视觉系统，保留大面积留白，使用柔和自然光和低饱和中性色。",
    model: "GPT Image 1 Mini",
    size: "1024 × 1024",
    source: "基础创作",
    images: 4,
    status: "完成",
    credits: 4,
    resultImages: [
      "/gallery-examples/prototype-09.jpg",
      "/gallery-examples/prototype-07.jpg",
      "/gallery-examples/prototype-06.jpg",
      "/gallery-examples/prototype-08.jpg",
    ],
    referenceImages: [],
    failureMessage: null,
  },
  {
    id: "GEN-7CB188",
    requestId: "REQ-20260708-1544-2F90",
    occurredAt: "2026-07-08 15:44",
    completedAt: "2026-07-08 15:45",
    prompt:
      "扩展当前室内场景的左侧区域，补全落地窗和午后阴影，延续原图的混凝土、木材与低饱和配色。",
    model: "GPT Image 2",
    size: "1792 × 1024",
    source: "无限画布",
    images: 1,
    status: "完成",
    credits: 3,
    resultImages: ["/gallery-examples/prototype-06.jpg"],
    referenceImages: ["/gallery-examples/prototype-08.jpg"],
    failureMessage: null,
  },
  {
    id: "GEN-7C8D42",
    requestId: "REQ-20260707-2309-7A11",
    occurredAt: "2026-07-07 23:09",
    completedAt: "2026-07-07 23:09",
    prompt: "制作针对现实群体的攻击性宣传内容，并模仿现实组织的视觉识别。",
    model: "GPT Image 1.5",
    size: "1024 × 1024",
    source: "基础创作",
    images: 1,
    status: "失败",
    credits: 0,
    resultImages: [],
    referenceImages: [],
    failureMessage:
      "请求内容未通过安全检查，本次未扣除积分。请调整描述后重试。",
  },
  {
    id: "GEN-7C502B",
    requestId: "REQ-20260706-1018-0CC4",
    occurredAt: "2026-07-06 10:18",
    completedAt: "2026-07-06 10:19",
    prompt:
      "几何建筑与天空形成清晰边界，镜头轻微仰拍，硬朗日光，适合作为空间设计提案的封面图。",
    model: "GPT Image 2",
    size: "1536 × 1024",
    source: "基础创作",
    images: 2,
    status: "完成",
    credits: 6,
    resultImages: [
      "/gallery-examples/prototype-12.jpg",
      "/gallery-examples/prototype-04.jpg",
    ],
    referenceImages: [],
    failureMessage: null,
  },
  {
    id: "GEN-7C1EE9",
    requestId: "REQ-20260705-1631-5D8E",
    occurredAt: "2026-07-05 16:31",
    completedAt: "2026-07-05 16:32",
    prompt:
      "将街头人物转化为编辑感肖像，保留帽子与外套轮廓，背景使用雨夜霓虹反射，肤色自然。",
    model: "GPT Image 1.5",
    size: "1024 × 1536",
    source: "基础创作",
    images: 2,
    status: "完成",
    credits: 4,
    resultImages: [
      "/gallery-examples/prototype-01.jpg",
      "/gallery-examples/prototype-11.jpg",
    ],
    referenceImages: ["/gallery-examples/prototype-02.jpg"],
    failureMessage: null,
  },
  {
    id: "GEN-7BEA10",
    requestId: "REQ-20260704-0846-A33D",
    occurredAt: "2026-07-04 08:46",
    completedAt: "2026-07-04 08:47",
    prompt:
      "在现有画布节点中生成沙漠远景，保留地平线位置，并加入低矮的临时剧场与远处人群。",
    model: "GPT Image 1 Mini",
    size: "1792 × 1024",
    source: "无限画布",
    images: 2,
    status: "完成",
    credits: 2,
    resultImages: [
      "/gallery-examples/prototype-05.jpg",
      "/gallery-examples/prototype-10.jpg",
    ],
    referenceImages: ["/gallery-examples/prototype-04.jpg"],
    failureMessage: null,
  },
  {
    id: "GEN-7BA7F3",
    requestId: "REQ-20260703-1940-19EF",
    occurredAt: "2026-07-03 19:40",
    completedAt: "2026-07-03 19:41",
    prompt:
      "根据上传的产品参考图生成桌面静物，柔和窗光，白色背景，主体边缘保持清晰且不改变包装结构。",
    model: "GPT Image 2",
    size: "1024 × 1024",
    source: "基础创作",
    images: 1,
    status: "失败",
    credits: 0,
    resultImages: [],
    referenceImages: ["/gallery-examples/prototype-09.jpg"],
    failureMessage:
      "参考图暂时无法读取，本次未扣除积分。请重新上传图片后再试。",
  },
];

export const referralLedger: ReferralLedgerRow[] = [
  {
    id: "RFL-91A3",
    occurredAt: "2026-07-11 14:20",
    reward: 96,
    rate: "12%",
    status: "可转换",
    availableAt: "2026-07-11 14:20",
    note: "冻结期已结束",
  },
  {
    id: "RFL-8FF2",
    occurredAt: "2026-07-09 19:42",
    reward: 190.5,
    rate: "12%",
    status: "可转换",
    availableAt: "2026-07-11 19:42",
    note: "冻结期已结束",
  },
  {
    id: "RFL-8CE1",
    occurredAt: "2026-07-08 12:06",
    reward: 72,
    rate: "12%",
    status: "冻结中",
    availableAt: "预计 2026-07-15",
    note: "等待关联交易冻结期结束",
  },
  {
    id: "RFL-7BB4",
    occurredAt: "2026-06-28 09:31",
    reward: 144,
    rate: "12%",
    status: "已转换",
    availableAt: "2026-07-02 10:12",
    note: "已转入积分流水",
  },
  {
    id: "RFL-7A92",
    occurredAt: "2026-06-24 11:18",
    reward: 286.5,
    rate: "12%",
    status: "已转换",
    availableAt: "2026-07-11 22:40",
    note: "已转入积分流水",
  },
  {
    id: "RFL-79D8",
    occurredAt: "2026-06-22 17:10",
    reward: 36,
    rate: "12%",
    status: "已撤销",
    availableAt: "-",
    note: "关联交易已撤销，奖励已扣回",
  },
];

export const referralTransfers: ReferralTransferRow[] = [
  {
    id: "RFT-8912",
    occurredAt: "2026-07-11 22:40",
    credits: 286.5,
    status: "已完成",
    ledgerReference: "积分流水 CRD-240711-2240",
  },
  {
    id: "RFT-7618",
    occurredAt: "2026-07-02 10:12",
    credits: 144,
    status: "已完成",
    ledgerReference: "积分流水 CRD-240702-1012",
  },
];

export const announcements: AnnouncementRow[] = [
  {
    id: "ANN-20260712",
    title: "图像生成通道维护通知",
    summary: "7 月 14 日凌晨将进行短时维护，期间部分任务可能排队。",
    body: [
      "维护窗口：2026 年 7 月 14 日 02:00 至 03:00。",
      "维护期间已提交的任务不会丢失，部分任务的等待时间可能延长。",
      "维护完成后无需重新登录或调整创作参数。",
    ],
    publishedAt: "2026-07-12 08:30",
    severity: "重要",
    unread: true,
  },
  {
    id: "ANN-20260708",
    title: "新增 GPT Image 2 模型",
    summary: "基础创作与无限画布现已支持 GPT Image 2。",
    body: [
      "GPT Image 2 已加入模型选择器，支持更稳定的文字布局与细节表现。",
      "不同尺寸和生成数量会消耗不同积分，提交前可在创作输入器查看预计消耗。",
    ],
    publishedAt: "2026-07-08 11:00",
    severity: "普通",
    unread: true,
  },
  {
    id: "ANN-20260630",
    title: "积分流水展示更新",
    summary: "退款、过期与邀请奖励现在拥有独立的流水类型。",
    body: [
      "你可以在“订单与用量”的积分流水中核对每次余额变化。",
      "本次更新不改变历史积分余额与消费规则。",
    ],
    publishedAt: "2026-06-30 16:15",
    severity: "普通",
    unread: false,
  },
];

export const supportTickets: SupportTicketRow[] = [
  {
    id: "SUP-1842",
    subject: "生成失败后的积分退款",
    status: "处理中",
    updatedAt: "2026-07-11 19:10",
    unread: true,
    messages: [
      {
        id: "MSG-1",
        author: "你",
        sentAt: "2026-07-11 18:56",
        content: "GEN-7D628E 显示失败，请确认积分是否已经退回。",
      },
      {
        id: "MSG-2",
        author: "支持团队",
        sentAt: "2026-07-11 19:10",
        content: "退款已进入积分流水，余额增加 4 积分。我们仍在排查失败原因。",
      },
    ],
  },
  {
    id: "SUP-1769",
    subject: "套餐升级抵扣金额咨询",
    status: "已关闭",
    updatedAt: "2026-06-26 14:22",
    unread: false,
    messages: [
      {
        id: "MSG-3",
        author: "你",
        sentAt: "2026-06-26 09:04",
        content: "从 Starter 升级到 Pro 时会如何计算抵扣？",
      },
      {
        id: "MSG-4",
        author: "支持团队",
        sentAt: "2026-06-26 14:22",
        content: "系统会按剩余天数和未使用套餐积分分别折算，并取较小金额抵扣。",
      },
    ],
  },
];

export const accountSessions: SessionRow[] = [
  {
    id: "SES-CURRENT",
    device: "Chrome · macOS",
    location: "上海",
    lastActive: "当前会话",
    current: true,
  },
  {
    id: "SES-IPAD",
    device: "Safari · iPadOS",
    location: "上海",
    lastActive: "2 小时前",
    current: false,
  },
  {
    id: "SES-WIN",
    device: "Edge · Windows",
    location: "杭州",
    lastActive: "3 天前",
    current: false,
  },
];
