// 视觉重构原型的静态数据。仅供开发预览使用，不读取数据库或调用业务接口。

export type PreviewView =
  | "home"
  | "create-empty"
  | "create-results"
  | "gallery"
  | "canvas";

export type Artwork = {
  id: string;
  src: string;
  width: number;
  height: number;
  title: string;
  category: string;
  alt: string;
  depth: "near" | "mid" | "far";
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export const previewTitle = "GPT2IMAGE";
export const previewPromise = "任何人都能轻松完成高质量创作";

export const artworks: Artwork[] = [
  {
    id: "art-01",
    src: "/gallery-examples/prototype-01.jpg",
    width: 900,
    height: 1200,
    title: "城市漫游者",
    category: "兴趣创作",
    alt: "戴帽子的人物肖像",
    depth: "near",
    position: [-5.4, 1, 0.1],
    rotation: [0.03, 0.14, -0.06],
    scale: 1,
  },
  {
    id: "art-02",
    src: "/gallery-examples/prototype-02.jpg",
    width: 1000,
    height: 1000,
    title: "凝视",
    category: "角色设计",
    alt: "人物面部特写",
    depth: "near",
    position: [3.9, 1.05, 0.1],
    rotation: [-0.02, -0.12, 0.04],
    scale: 1.15,
  },
  {
    id: "art-03",
    src: "/gallery-examples/prototype-03.jpg",
    width: 900,
    height: 1200,
    title: "午夜秀场",
    category: "影视概念",
    alt: "时装人物肖像",
    depth: "near",
    position: [0.2, -2.35, -0.2],
    rotation: [0.05, 0.02, 0.03],
    scale: 0.94,
  },
  {
    id: "art-04",
    src: "/gallery-examples/prototype-04.jpg",
    width: 1200,
    height: 800,
    title: "远方入口",
    category: "环境概念",
    alt: "山脉与道路风景",
    depth: "mid",
    position: [-1.1, 2.95, -1.7],
    rotation: [0.02, 0.1, -0.03],
    scale: 0.84,
  },
  {
    id: "art-05",
    src: "/gallery-examples/prototype-05.jpg",
    width: 1200,
    height: 800,
    title: "沙丘剧场",
    category: "影视概念",
    alt: "沙漠中的远景",
    depth: "mid",
    position: [4.8, -1.65, -2.5],
    rotation: [-0.04, -0.18, 0.05],
    scale: 0.76,
  },
  {
    id: "art-06",
    src: "/gallery-examples/prototype-06.jpg",
    width: 1200,
    height: 800,
    title: "静默房间",
    category: "品牌空间",
    alt: "现代室内空间",
    depth: "mid",
    position: [-5.1, -1.55, -2.1],
    rotation: [0.01, 0.19, -0.02],
    scale: 0.78,
  },
  {
    id: "art-07",
    src: "/gallery-examples/prototype-07.jpg",
    width: 1000,
    height: 1000,
    title: "材质研究 01",
    category: "品牌视觉",
    alt: "桌椅与光影细节",
    depth: "mid",
    position: [1.55, 2.05, -2.6],
    rotation: [0.02, -0.05, 0.08],
    scale: 0.7,
  },
  {
    id: "art-08",
    src: "/gallery-examples/prototype-08.jpg",
    width: 1200,
    height: 800,
    title: "留白结构",
    category: "编辑视觉",
    alt: "明亮的室内结构",
    depth: "mid",
    position: [-3.35, -3.1, -3.1],
    rotation: [0.02, 0.12, -0.1],
    scale: 0.68,
  },
  {
    id: "art-09",
    src: "/gallery-examples/prototype-09.jpg",
    width: 1000,
    height: 1000,
    title: "微光物件",
    category: "商品视觉",
    alt: "桌面上的咖啡与器物",
    depth: "far",
    position: [5.35, 2.9, -4.7],
    rotation: [-0.02, -0.18, 0.02],
    scale: 0.58,
  },
  {
    id: "art-10",
    src: "/gallery-examples/prototype-10.jpg",
    width: 1200,
    height: 800,
    title: "声场",
    category: "叙事场景",
    alt: "舞台与观众形成的空间",
    depth: "far",
    position: [-5.75, 2.85, -4.5],
    rotation: [0.01, 0.22, -0.04],
    scale: 0.55,
  },
  {
    id: "art-11",
    src: "/gallery-examples/prototype-11.jpg",
    width: 900,
    height: 1200,
    title: "移动肖像",
    category: "兴趣创作",
    alt: "街头时装人物",
    depth: "far",
    position: [0.65, 4.15, -5.2],
    rotation: [0.02, -0.05, -0.05],
    scale: 0.52,
  },
  {
    id: "art-12",
    src: "/gallery-examples/prototype-12.jpg",
    width: 1200,
    height: 800,
    title: "展陈边界",
    category: "空间概念",
    alt: "几何建筑与天空",
    depth: "far",
    position: [2.4, -3.7, -5.3],
    rotation: [-0.04, 0.05, 0.08],
    scale: 0.55,
  },
];

export const createSamples = [
  "一位在雨夜霓虹街道中行走的角色，电影感构图",
  "为一家独立咖啡品牌设计极简黑白海报，留出标题空间",
  "漂浮在雾海上方的古老观测站，概念艺术，宽幅构图",
];

export const modelOptions = [
  { id: "gpt-image-2", name: "GPT Image 2", detail: "高质量", cost: 3 },
  { id: "gpt-image-1.5", name: "GPT Image 1.5", detail: "均衡", cost: 2 },
  { id: "gpt-image-1-mini", name: "GPT Image 1 Mini", detail: "快速", cost: 1 },
  {
    id: "firefly-gpt-image-2",
    name: "Firefly GPT Image 2",
    detail: "商业视觉",
    cost: 4,
  },
];

export type HistoryBatch = {
  id: string;
  time: string;
  prompt: string;
  status: "完成" | "生成中";
  imageIds: string[];
};

export const historyBatches: HistoryBatch[] = [
  {
    id: "batch-01",
    time: "刚刚",
    prompt: "一座漂浮在雾海上方的古老观测站",
    status: "完成",
    imageIds: ["art-04", "art-05", "art-12", "art-08"],
  },
  {
    id: "batch-02",
    time: "12 分钟前",
    prompt: "午夜秀场中的角色概念",
    status: "完成",
    imageIds: ["art-03", "art-02", "art-11"],
  },
  {
    id: "batch-03",
    time: "昨天",
    prompt: "留白充足的咖啡品牌视觉",
    status: "完成",
    imageIds: ["art-09", "art-07"],
  },
  {
    id: "batch-04",
    time: "昨天",
    prompt: "一个适合电影片头的空间场景",
    status: "完成",
    imageIds: ["art-06", "art-10", "art-04", "art-05"],
  },
  {
    id: "batch-05",
    time: "周一",
    prompt: "一位穿着银色外套的未来角色",
    status: "完成",
    imageIds: ["art-01", "art-02", "art-03"],
  },
];

export type PreviewNode = {
  id: string;
  type: "prompt" | "image" | "generator" | "output";
  title: string;
  text?: string;
  imageId?: string;
  x: number;
  y: number;
  width: number;
};

export const previewNodes: PreviewNode[] = [
  {
    id: "node-prompt",
    type: "prompt",
    title: "提示词",
    text: "一座漂浮在雾海上方的古老观测站",
    x: 130,
    y: 250,
    width: 260,
  },
  {
    id: "node-reference",
    type: "image",
    title: "参考图",
    imageId: "art-04",
    x: 130,
    y: 500,
    width: 210,
  },
  {
    id: "node-generator",
    type: "generator",
    title: "生成",
    text: "GPT Image 2 · 1 张",
    x: 560,
    y: 250,
    width: 250,
  },
  {
    id: "node-output",
    type: "output",
    title: "结果",
    imageId: "art-05",
    x: 980,
    y: 230,
    width: 250,
  },
];

export const previewEdges = [
  ["node-prompt", "node-generator"],
  ["node-reference", "node-generator"],
  ["node-generator", "node-output"],
] as const;

export function getArtwork(id: string) {
  const artwork = artworks.find((item) => item.id === id) ?? artworks.at(0);
  if (!artwork) {
    throw new Error("Design preview artwork catalog is empty");
  }
  return artwork;
}
