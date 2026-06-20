/**
 * Adobe Firefly（adobe2api）响应解析（纯函数，DB-free，可单测）。
 *
 * 职责：从 adobe2api 的 OpenAI 兼容响应里提取产物媒体 URL。adobe2api 把产物写到本机
 * `/generated/{job_id}` 并在响应里给出该 URL（相对或绝对），故解析后须按后端 baseUrl
 * 解析为绝对地址，再由调用方 fetch 回来 re-host 到我方存储。
 *
 * 两种返回形态（依据 adobe2api 源码 api/routes/generation.py）：
 * - /v1/images/generations: `{ data: [{ url }] }`
 * - /v1/chat/completions:   `{ choices: [{ message: { content } }] }`，其中
 *   图像 content 为 markdown `![...](url)`，视频为 ```html `<video src='url'>` ```。
 * 使用方：image-generation 的 adobe 后端适配（apps/web 侧响应解析）。
 * 关键依赖：无（纯字符串/正则）。
 */

export type AdobeMediaResult = { url: string } | { error: string };

/**
 * 从 chat/completions 的 message.content 文本里抽出媒体 URL。
 * 支持 markdown 图片 `![alt](url)`、HTML 视频 `<video src='url'>`、裸 URL。
 */
export function extractAdobeMediaUrl(content: string): string | null {
  const markdown = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (markdown?.[1]) return markdown[1].trim();

  const srcAttr = content.match(/src=['"]([^'"]+)['"]/);
  if (srcAttr?.[1]) return srcAttr[1].trim();

  const bare = content.trim();
  if (/^https?:\/\//i.test(bare) || bare.startsWith("/")) return bare;

  return null;
}

/**
 * 把可能为相对路径（`/generated/...`）的媒体 URL 解析为绝对地址。
 * 绝对 URL 原样返回；相对路径拼到后端 baseUrl 的源（scheme://host[:port]）下。
 */
export function resolveAdobeMediaUrl(url: string, baseUrl: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // baseUrl 可能带路径（如 .../v1），相对的 /generated 路径应挂在 host 根上。
  let origin = baseUrl.trim();
  const schemeMatch = origin.match(/^(https?:\/\/[^/]+)/i);
  if (schemeMatch?.[1]) origin = schemeMatch[1];
  origin = origin.replace(/\/+$/, "");

  return `${origin}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/**
 * 解析 adobe2api 响应，提取产物媒体的绝对 URL（兼容 images 与 chat 两种端点）。
 * 失败返回 error 文案（供错误分类与日志）。
 */
export function parseAdobeMediaResult(
  payload: unknown,
  baseUrl: string
): AdobeMediaResult {
  if (!payload || typeof payload !== "object") {
    return { error: "adobe2api 响应不是对象" };
  }
  const obj = payload as Record<string, unknown>;

  // 形态一：/v1/images/generations -> { data: [{ url }] }
  const data = obj.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown> | undefined;
    const url = first?.url;
    if (typeof url === "string" && url.trim()) {
      return { url: resolveAdobeMediaUrl(url, baseUrl) };
    }
  }

  // 形态二：/v1/chat/completions -> { choices: [{ message: { content } }] }
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown> | undefined)
      ?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") {
      const extracted = extractAdobeMediaUrl(content);
      if (extracted) return { url: resolveAdobeMediaUrl(extracted, baseUrl) };
      return {
        error: `adobe2api 响应未含媒体 URL: ${content.slice(0, 120)}`,
      };
    }
  }

  return { error: "adobe2api 响应缺少 data[].url 或 choices[].message.content" };
}
