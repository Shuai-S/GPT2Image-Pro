import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE } from "../resolution";
import { normalizeAgentEvent } from "../agent-round-cards";
import { createOptimisticAgentRoundEvents } from "../agent-round-cards";
import {
  consumePendingReferenceHandoff,
  normalizeReferenceFetchUrl,
} from "../reference-handoff";
import { nanoid } from "nanoid";
import {
  CHAT_ACTIVE_AGENT_CONVERSATION_STORAGE_KEY,
  CHAT_ACTIVE_CONVERSATION_STORAGE_KEY,
  CHAT_CONTEXT_MESSAGE_LIMIT,
  CHAT_CONVERSATION_LIMIT,
  CHAT_CONVERSATIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  CREATE_ACTIVE_MODE_STORAGE_KEY,
} from "./create-page-options";
import type {
  ActiveMode,
  AgentRunEvent,
  ChatConversation,
  ChatMessage,
  ChatStreamState,
  ChatVariant,
  ConversationMode,
  ImageApiResult,
  ImageReferenceMentionOption,
  ImageStreamEvent,
  MentionState,
  ReferenceTargetMode,
} from "./create-page-types";
import type { EditImageFile } from "./image-edit-types";

// 创作页纯工具:集中处理本地存储、流式响应、文件校验和对话快照。

const PROMPT_IMAGE_REFERENCE_PATTERN = /@(?:第)?\d+轮图\d+|@图\d+/;

/**
 * 创建对话流初始状态。
 *
 * @param params 流式消息、卡片、模式和生成参数。
 * @returns 可直接写入运行时 store 的流状态。
 * @sideEffects 无。
 * @failureMode Agent 模式会预填第 1 轮乐观事件,非 Agent 为空事件列表。
 */
export function createInitialChatStreamState(params: {
  messageId?: string;
  cardId?: string;
  mode?: ConversationMode;
  agentMode: boolean;
  generationId?: string;
  prompt?: string;
  model?: string;
  size?: string;
}): ChatStreamState {
  return {
    messageId: params.messageId,
    cardId: params.cardId,
    mode: params.mode,
    text: "",
    thinking: "",
    agent: "",
    agentEvents: params.agentMode ? createOptimisticAgentRoundEvents(1) : [],
    generationId: params.generationId,
    prompt: params.prompt,
    model: params.model,
    size: params.size,
  };
}

/**
 * 从 localStorage 读取创作页上次使用模式。
 *
 * @returns 合法创作模式,无浏览器环境或读取失败时返回 text。
 * @sideEffects 读取 localStorage。
 * @failureMode 非法存储值回退 text。
 */
export function readStoredCreateActiveMode(): ActiveMode {
  if (typeof window === "undefined") return "text";
  try {
    const value = window.localStorage.getItem(CREATE_ACTIVE_MODE_STORAGE_KEY);
    return value === "text" ||
      value === "image" ||
      value === "chat" ||
      value === "chat-web" ||
      value === "agent" ||
      value === "waterfall" ||
      value === "video"
      ? value
      : "text";
  } catch {
    return "text";
  }
}

/**
 * 从 URL 读取创作模式。
 *
 * @param value URL query 中的 mode 值。
 * @returns 合法创作模式;非法值返回 null。
 * @sideEffects 无。
 * @failureMode 空值或未知模式返回 null。
 */
export function parseCreateModeParam(value: string | null): ActiveMode | null {
  return value === "text" ||
    value === "image" ||
    value === "chat" ||
    value === "chat-web" ||
    value === "agent" ||
    value === "waterfall" ||
    value === "video"
    ? value
    : null;
}

/**
 * 判断文件是否为图片附件。
 *
 * @param file 用户选择的文件。
 * @returns 是否为支持的图片 MIME。
 * @sideEffects 无。
 * @failureMode 未知 MIME 返回 false。
 */
export function isImageFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

/**
 * 判断文件是否为可读文本或 PDF 附件。
 *
 * @param file 用户选择的文件。
 * @returns 是否允许作为对话文件附件。
 * @sideEffects 无。
 * @failureMode MIME 缺失时回退扩展名判断。
 */
export function isReadableChatFile(file: File) {
  const type = file.type.toLowerCase();
  if (type.startsWith("text/")) return true;
  if (type === "application/pdf") return true;
  if (
    [
      "application/json",
      "application/jsonl",
      "application/ld+json",
      "application/xml",
      "application/x-yaml",
      "application/yaml",
    ].includes(type)
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|json|jsonl|ya?ml|log|xml|html?|css|jsx?|tsx?|mjs|cjs|py|java|go|rs|c|cc|cpp|h|hpp|sql|sh|toml|ini|env|pdf)$/i.test(
    file.name
  );
}

/**
 * 释放本地预览 URL。
 *
 * @param url 预览地址。
 * @sideEffects 对 blob URL 调用 URL.revokeObjectURL。
 * @failureMode 非 blob 地址直接忽略。
 */
export function revokePreview(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

/**
 * 将字节数格式化为向上取整的 MB。
 *
 * @param bytes 字节数。
 * @returns 面向用户展示的 MB 文案。
 * @sideEffects 无。
 * @failureMode 非有限值会沿用 JavaScript 数学结果。
 */
export function formatMegabytes(bytes: number) {
  return `${Math.ceil(bytes / 1024 / 1024)}MB`;
}

/**
 * 从流式图片事件提取可预览 URL。
 *
 * @param event SSE 图片事件。
 * @returns data URL、远程 URL 或 null。
 * @sideEffects 无。
 * @failureMode 非 partial_image 事件返回 null。
 */
export function imageStreamEventToPreviewUrl(event: ImageStreamEvent) {
  if (event.type !== "partial_image") return null;
  if (event.b64_json) return `data:image/png;base64,${event.b64_json}`;
  return event.url || null;
}

/**
 * 清理 Agent 事件以便写入 localStorage。
 *
 * @param events 原始 Agent 事件。
 * @returns 已标准化且移除内联 data 图片的事件列表。
 * @sideEffects 无。
 * @failureMode 空输入返回空数组。
 */
export function sanitizeAgentEventsForStorage(
  events: AgentRunEvent[] | undefined
) {
  return (events || []).map((event) => {
    const normalized = normalizeAgentEvent(event);
    if (normalized.imageUrl?.startsWith("data:image/")) {
      return { ...normalized, imageUrl: undefined };
    }
    return normalized;
  });
}

/**
 * 创建本地唯一 id。
 *
 * @returns 带时间前缀的短 id。
 * @sideEffects 读取当前时间和随机数。
 * @failureMode 极小概率碰撞由调用场景容忍。
 */
export function createLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 判断提示词是否包含图片引用 token。
 *
 * @param text 提示词文本。
 * @returns 是否包含 @图 或 @第 N 轮图 M。
 * @sideEffects 无。
 * @failureMode 仅识别当前约定格式。
 */
export function hasPromptImageReference(text: string) {
  return PROMPT_IMAGE_REFERENCE_PATTERN.test(text);
}

/**
 * 从光标位置识别 @ 引用触发状态。
 *
 * @param text 当前文本。
 * @param cursor 光标位置。
 * @returns 命中时的 mention 状态。
 * @sideEffects 无。
 * @failureMode 光标前不满足格式返回 null。
 */
export function getMentionTrigger(
  text: string,
  cursor: number
): MentionState | null {
  const beforeCursor = text.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const token = match[0].trimStart();
  return {
    open: true,
    start: cursor - token.length,
    end: cursor,
    query: match[2] || "",
  };
}

/**
 * 根据用户输入过滤图片引用候选。
 *
 * @param options 全部候选。
 * @param query 搜索词。
 * @returns 匹配 token、标题或详情的候选列表。
 * @sideEffects 无。
 * @failureMode 空搜索词返回原列表。
 */
export function filterMentionOptions(
  options: ImageReferenceMentionOption[],
  query: string
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.token} ${option.label} ${option.detail}`
      .toLowerCase()
      .includes(normalized)
  );
}

/**
 * 将引用 token 插入提示词。
 *
 * @param text 原文本。
 * @param mention 当前 mention 范围。
 * @param token 被选中的引用 token。
 * @returns 插入 token 后的新文本。
 * @sideEffects 无。
 * @failureMode mention 范围不合法时按字符串 slice 结果处理。
 */
export function insertMentionToken(
  text: string,
  mention: MentionState,
  token: string
) {
  return `${text.slice(0, mention.start)}${token} ${text.slice(mention.end)}`;
}

/**
 * 让出一次浏览器事件循环。
 *
 * @returns 下一轮宏任务完成的 Promise。
 * @sideEffects 创建定时器。
 * @failureMode 定时器延迟由浏览器调度决定。
 */
export function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 计算插入 mention 后的光标位置。
 *
 * @param mention 当前 mention 范围。
 * @param token 插入 token。
 * @returns 光标应移动到的位置。
 * @sideEffects 无。
 * @failureMode 与 insertMentionToken 的尾随空格约定绑定。
 */
export function getCursorAfterInsertedMention(
  mention: MentionState,
  token: string
) {
  return mention.start + token.length + 1;
}

/**
 * 创建服务端生成请求使用的 generation id。
 *
 * @returns nanoid 生成的唯一 id。
 * @sideEffects 读取随机源。
 * @failureMode 极小概率碰撞由服务端幂等和唯一约束兜底。
 */
export function createGenerationId() {
  return nanoid();
}

/**
 * 读取文件为 data URL。
 *
 * @param file 待读取文件。
 * @returns data URL 字符串。
 * @sideEffects 使用 FileReader 读取本地文件。
 * @failureMode 读取失败时 reject。
 */
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

/**
 * 截断响应文本用于错误提示。
 *
 * @param text 响应正文。
 * @returns 最多 240 字符的单行摘要。
 * @sideEffects 无。
 * @failureMode 空白文本返回空字符串。
 */
export function responseTextSnippet(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 240)}...`;
}

/**
 * 格式化 HTTP 状态。
 *
 * @param response fetch 响应。
 * @returns 状态码和状态文本。
 * @sideEffects 无。
 * @failureMode 状态文本缺失时仅返回状态码。
 */
export function responseStatusLabel(response: Response) {
  return `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
}

/**
 * 将非 JSON 响应转为可展示错误。
 *
 * @param response fetch 响应。
 * @param text 响应正文。
 * @returns 面向用户的错误描述。
 * @sideEffects 无。
 * @failureMode 空响应会按状态码返回通用错误。
 */
export function nonJsonResponseError(response: Response, text: string) {
  const snippet = responseTextSnippet(text);
  const status = responseStatusLabel(response);
  if (
    !response.ok &&
    (response.status === 504 || /Gateway Time-out/i.test(snippet))
  ) {
    return "Image generation timed out at the gateway. Please retry, or lower the resolution/thinking level if it happens repeatedly.";
  }
  if (!snippet) {
    return response.ok
      ? "API returned an empty response"
      : `API returned ${status} with an empty response`;
  }
  return response.ok
    ? `API returned a non-JSON response: ${snippet}`
    : `API returned ${status}: ${snippet}`;
}

/**
 * 容错读取图片 API JSON 响应。
 *
 * @param response fetch 响应。
 * @returns API 结果或标准化错误对象。
 * @sideEffects 消费 response body。
 * @failureMode 空响应、非对象 JSON 和非 JSON 文本都会返回 error 字段。
 */
export async function readImageApiJsonResponse(
  response: Response
): Promise<ImageApiResult> {
  const text = await response.text();
  if (!text.trim()) {
    return { error: nonJsonResponseError(response, text) };
  }

  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object") {
      return data as ImageApiResult;
    }
    return { error: `API returned invalid JSON: ${responseTextSnippet(text)}` };
  } catch {
    return { error: nonJsonResponseError(response, text) };
  }
}

/**
 * 清洗本地存储中的消息列表。
 *
 * @param value 未信任的 JSON 值。
 * @returns 符合当前结构的消息列表。
 * @sideEffects 无。
 * @failureMode 非法项被丢弃,缺失字段使用安全默认值。
 */
export function sanitizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const item = message as Partial<ChatMessage>;
    if (item.role !== "user" && item.role !== "assistant") return [];
    if (typeof item.text !== "string") return [];
    const messageText = item.text;
    const variants = Array.isArray(item.variants)
      ? item.variants.flatMap((variant) => {
          if (!variant || typeof variant !== "object") return [];
          const value = variant as Partial<ChatVariant>;
          const webConversation =
            value.webConversation &&
            typeof value.webConversation === "object" &&
            typeof value.webConversation.conversationId === "string" &&
            typeof value.webConversation.parentMessageId === "string"
              ? {
                  conversationId: value.webConversation.conversationId,
                  parentMessageId: value.webConversation.parentMessageId,
                  accountId:
                    typeof value.webConversation.accountId === "string"
                      ? value.webConversation.accountId
                      : undefined,
                  apiKeyId:
                    typeof value.webConversation.apiKeyId === "string"
                      ? value.webConversation.apiKeyId
                      : undefined,
                  selectionMessageId:
                    typeof value.webConversation.selectionMessageId === "string"
                      ? value.webConversation.selectionMessageId
                      : undefined,
                  selectedImageMessageId:
                    typeof value.webConversation.selectedImageMessageId ===
                    "string"
                      ? value.webConversation.selectedImageMessageId
                      : undefined,
                }
              : undefined;
          const backendMember =
            value.backendMember &&
            typeof value.backendMember === "object" &&
            (value.backendMember.type === "api" ||
              value.backendMember.type === "account") &&
            typeof value.backendMember.id === "string"
              ? {
                  type: value.backendMember.type,
                  id: value.backendMember.id,
                  groupId:
                    typeof value.backendMember.groupId === "string"
                      ? value.backendMember.groupId
                      : value.backendMember.groupId === null
                        ? null
                        : undefined,
                  accountBackend:
                    value.backendMember.accountBackend === "web" ||
                    value.backendMember.accountBackend === "responses"
                      ? value.backendMember.accountBackend
                      : undefined,
                }
              : undefined;
          const responsesBackendMember =
            value.responsesPreviousResponse?.backendMember &&
            typeof value.responsesPreviousResponse.backendMember === "object" &&
            (value.responsesPreviousResponse.backendMember.type === "api" ||
              value.responsesPreviousResponse.backendMember.type ===
                "account") &&
            typeof value.responsesPreviousResponse.backendMember.id === "string"
              ? {
                  type: value.responsesPreviousResponse.backendMember.type,
                  id: value.responsesPreviousResponse.backendMember.id,
                  groupId:
                    typeof value.responsesPreviousResponse.backendMember
                      .groupId === "string"
                      ? value.responsesPreviousResponse.backendMember.groupId
                      : value.responsesPreviousResponse.backendMember
                            .groupId === null
                        ? null
                        : undefined,
                  accountBackend:
                    value.responsesPreviousResponse.backendMember
                      .accountBackend === "web" ||
                    value.responsesPreviousResponse.backendMember
                      .accountBackend === "responses"
                      ? value.responsesPreviousResponse.backendMember
                          .accountBackend
                      : undefined,
                }
              : undefined;
          const responsesPreviousResponse =
            value.responsesPreviousResponse &&
            typeof value.responsesPreviousResponse === "object" &&
            typeof value.responsesPreviousResponse.responseId === "string" &&
            responsesBackendMember
              ? {
                  responseId: value.responsesPreviousResponse.responseId,
                  backendMember: responsesBackendMember,
                  store: true as const,
                  createdAt:
                    typeof value.responsesPreviousResponse.createdAt ===
                    "string"
                      ? value.responsesPreviousResponse.createdAt
                      : undefined,
                }
              : undefined;
          return [
            {
              ...value,
              prompt: value.prompt || messageText,
              model: value.model || DEFAULT_IMAGE_MODEL,
              size: value.size || DEFAULT_IMAGE_SIZE,
              pending: value.pending === true,
              agentEvents: Array.isArray(value.agentEvents)
                ? value.agentEvents
                    .filter((event): event is AgentRunEvent =>
                      Boolean(
                        event &&
                          typeof event === "object" &&
                          typeof event.title === "string"
                      )
                    )
                    .map(normalizeAgentEvent)
                : undefined,
              webConversation,
              backendMember,
              responsesPreviousResponse,
              outputRole:
                value.outputRole === "agent_draft" ||
                value.outputRole === "choice" ||
                value.outputRole === "final"
                  ? value.outputRole
                  : undefined,
              files: Array.isArray(value.files)
                ? value.files
                    .filter((file): file is { label: string; url: string } =>
                      Boolean(
                        file &&
                          typeof file === "object" &&
                          typeof file.label === "string" &&
                          typeof file.url === "string"
                      )
                    )
                    .slice(0, 4)
                : undefined,
            },
          ];
        })
      : undefined;
    return [
      {
        id: typeof item.id === "string" ? item.id : createLocalId(),
        role: item.role,
        text: messageText,
        mode:
          item.mode === "agent" || item.mode === "chat" || item.mode === "web"
            ? item.mode
            : undefined,
        attachments: item.attachments,
        variants,
        activeVariant: item.activeVariant,
        error: item.error,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
      },
    ];
  });
}

/**
 * 移除不适合持久化的消息字段。
 *
 * @param messages 当前消息列表。
 * @returns 最多 80 条、可写入 localStorage 的消息。
 * @sideEffects 无。
 * @failureMode blob 预览不会被持久化。
 */
export function sanitizePersistedChatMessages(
  messages: ChatMessage[]
): ChatMessage[] {
  return messages.slice(-80).map((message) => ({
    ...message,
    attachments: message.attachments?.filter(
      (attachment) => !attachment.previewUrl?.startsWith("blob:")
    ),
    variants: message.variants?.map((variant) => ({
      ...variant,
      agentEvents: sanitizeAgentEventsForStorage(variant.agentEvents),
    })),
  }));
}

/**
 * 创建本地对话快照。
 *
 * @param messages 对话消息。
 * @param title 标题回退。
 * @param id 对话 id。
 * @param mode 对话模式。
 * @returns 新对话对象。
 * @sideEffects 读取当前时间。
 * @failureMode 缺省模式按消息内容推断。
 */
export function createChatConversation(
  messages: ChatMessage[],
  title: string,
  id = createLocalId(),
  mode: ConversationMode = inferChatConversationMode(messages)
): ChatConversation {
  const now = new Date().toISOString();
  return {
    id,
    mode,
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 从消息列表推断对话模式。
 *
 * @param messages 消息列表。
 * @returns 含 web 消息时为 web,含 Agent 消息时为 agent,否则为 chat。
 * @sideEffects 无。
 * @failureMode 空消息按 chat 处理。
 */
export function inferChatConversationMode(
  messages: ChatMessage[]
): ConversationMode {
  if (messages.some((message) => message.mode === "web")) return "web";
  return messages.some((message) => message.mode === "agent")
    ? "agent"
    : "chat";
}

/**
 * 获取对应模式的活跃对话存储键。
 *
 * @param mode 对话模式。
 * @returns localStorage key。
 * @sideEffects 无。
 * @failureMode 非联合类型值由 TypeScript 拦截。
 */
export function chatActiveConversationStorageKey(mode: ConversationMode) {
  return mode === "agent"
    ? CHAT_ACTIVE_AGENT_CONVERSATION_STORAGE_KEY
    : CHAT_ACTIVE_CONVERSATION_STORAGE_KEY;
}

/**
 * 将创作模式映射为对话模式。
 *
 * @param mode 当前创作模式。
 * @returns Agent 归入 agent,其余对话类归入 chat。
 * @sideEffects 无。
 * @failureMode 非对话模式调用也会回退 chat。
 */
export function activeModeToConversationMode(
  mode: ActiveMode
): ConversationMode {
  return mode === "agent" ? "agent" : mode === "chat-web" ? "web" : "chat";
}

/**
 * 清洗本地存储中的对话列表。
 *
 * @param value 未信任 JSON 值。
 * @returns 合法对话列表。
 * @sideEffects 无。
 * @failureMode 非法对话被丢弃,混合模式历史会拆分。
 */
export function sanitizeChatConversations(value: unknown): ChatConversation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((conversation) => {
    if (!conversation || typeof conversation !== "object") return [];
    const item = conversation as Partial<ChatConversation>;
    const messages = sanitizeChatMessages(item.messages);
    if (messages.length === 0) return [];
    const now = new Date().toISOString();
    const baseId = typeof item.id === "string" ? item.id : createLocalId();
    const storedMode: ConversationMode | null =
      item.mode === "agent"
        ? "agent"
        : item.mode === "web"
          ? "web"
          : item.mode === "chat"
            ? "chat"
            : null;
    const storedTitle =
      typeof item.title === "string" && item.title.trim()
        ? item.title
        : "Untitled chat";
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : now;
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : now;
    const modeBuckets: Array<{
      mode: ConversationMode;
      messages: ChatMessage[];
    }> = [
      {
        mode: "chat",
        messages: messages.filter(
          (message) => message.mode !== "agent" && message.mode !== "web"
        ),
      },
      {
        mode: "agent",
        messages: messages.filter((message) => message.mode === "agent"),
      },
      {
        mode: "web",
        messages: messages.filter((message) => message.mode === "web"),
      },
    ];
    const byMode = modeBuckets.filter((entry) => entry.messages.length > 0);

    const entries: Array<{ mode: ConversationMode; messages: ChatMessage[] }> =
      byMode.length > 1
        ? byMode
        : [
            {
              mode: storedMode || inferChatConversationMode(messages),
              messages,
            },
          ];

    return entries.map((entry) => ({
      id:
        entries.length > 1 && storedMode !== entry.mode
          ? `${baseId}:${entry.mode}`
          : baseId,
      mode: entry.mode,
      title: getChatConversationTitle(entry.messages, storedTitle),
      messages: entry.messages,
      createdAt,
      updatedAt,
    }));
  });
}

/**
 * 创建消息快照签名。
 *
 * @param message 消息对象。
 * @returns 用于比较快照的稳定字符串。
 * @sideEffects 无。
 * @failureMode 文本中包含分隔符仍可比较,但不是加密签名。
 */
export function getChatMessageSignature(message: ChatMessage) {
  return `${message.role}\u0000${message.id}\u0000${message.text}`;
}

/**
 * 判断一个对话是否是另一个对话的前缀快照。
 *
 * @param candidate 候选旧快照。
 * @param target 目标完整对话。
 * @returns candidate 是否可被 target 覆盖。
 * @sideEffects 无。
 * @failureMode 不同模式直接返回 false。
 */
export function isConversationSnapshotOf(
  candidate: ChatConversation,
  target: ChatConversation
) {
  if (candidate.mode !== target.mode) return false;
  if (candidate.id === target.id) return true;
  if (candidate.messages.length > target.messages.length) return false;
  return candidate.messages.every(
    (message, index) =>
      getChatMessageSignature(message) ===
      getChatMessageSignature(target.messages[index] as ChatMessage)
  );
}

/**
 * 压缩本地对话列表,删除被完整对话覆盖的历史快照。
 *
 * @param conversations 原始对话列表。
 * @returns 去重并按更新时间倒序排列的对话列表。
 * @sideEffects 无。
 * @failureMode 相同长度快照保留更新时间较新的项。
 */
export function compactChatConversations(conversations: ChatConversation[]) {
  const byCompleteness = [...conversations].sort((a, b) => {
    const messageCountDelta = b.messages.length - a.messages.length;
    if (messageCountDelta !== 0) return messageCountDelta;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const compacted: ChatConversation[] = [];

  for (const conversation of byCompleteness) {
    if (
      compacted.some((existing) =>
        isConversationSnapshotOf(conversation, existing)
      )
    ) {
      continue;
    }
    compacted.push(conversation);
  }

  return compacted.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * 持久化当前对话快照。
 *
 * @param params 对话列表、目标对话和标题回退。
 * @sideEffects 写入 localStorage 并清理旧单对话存储。
 * @failureMode 无浏览器环境、空消息或写入失败时静默跳过。
 */
export function persistChatConversationSnapshot(params: {
  conversations: ChatConversation[];
  conversationId: string;
  mode: ConversationMode;
  messages: ChatMessage[];
  titleFallback: string;
  defer?: boolean;
}) {
  if (typeof window === "undefined" || params.messages.length === 0) return;
  try {
    const persistedMessages = sanitizePersistedChatMessages(params.messages);
    const title = getChatConversationTitle(
      persistedMessages.filter((message) =>
        params.mode === "agent"
          ? message.mode === "agent"
          : params.mode === "web"
            ? message.mode === "web"
            : message.mode !== "agent" && message.mode !== "web"
      ),
      params.titleFallback
    );
    const now = new Date().toISOString();
    const existing = params.conversations.find(
      (conversation) => conversation.id === params.conversationId
    );
    const current: ChatConversation = {
      id: params.conversationId,
      mode: existing?.mode || params.mode,
      title,
      messages: persistedMessages,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextConversations = compactChatConversations([
      current,
      ...params.conversations.filter(
        (conversation) => conversation.id !== params.conversationId
      ),
    ]).slice(0, CHAT_CONVERSATION_LIMIT);
    const write = () => {
      window.localStorage.setItem(
        CHAT_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(nextConversations)
      );
      window.localStorage.setItem(
        chatActiveConversationStorageKey(current.mode),
        params.conversationId
      );
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    };
    if (params.defer && "requestIdleCallback" in window) {
      window.requestIdleCallback(write, { timeout: 1000 });
    } else if (params.defer) {
      window.setTimeout(write, 120);
    } else {
      write();
    }
  } catch {
    /* ignore local storage quota errors */
  }
}

/**
 * 从 localStorage 恢复并迁移对话快照。
 *
 * @param params.isZh 是否中文，用于旧单对话迁移时生成标题。
 * @returns 压缩后的对话列表与当前模式对应的活跃对话。
 * @sideEffects 读取并修正 localStorage，对旧单对话存储做一次性迁移。
 * @failureMode 读写异常时抛错，由调用方决定清空损坏的存储。
 */
export function restoreChatConversationsFromStorage(params: { isZh: boolean }) {
  const conversationRaw = window.localStorage.getItem(
    CHAT_CONVERSATIONS_STORAGE_KEY
  );
  const conversations = compactChatConversations(
    sanitizeChatConversations(
      conversationRaw ? JSON.parse(conversationRaw) : []
    )
  );

  const legacyRaw = window.localStorage.getItem(CHAT_STORAGE_KEY);
  const legacyMessages = sanitizeChatMessages(
    legacyRaw ? JSON.parse(legacyRaw) : []
  );
  const hasLegacyConversation =
    legacyMessages.length > 0 &&
    !conversations.some(
      (conversation) =>
        JSON.stringify(conversation.messages) === JSON.stringify(legacyMessages)
    );
  const nextConversations = compactChatConversations(
    hasLegacyConversation
      ? [
          createChatConversation(
            legacyMessages,
            getChatConversationTitle(
              legacyMessages,
              params.isZh ? "历史对话" : "Previous chat"
            )
          ),
          ...conversations,
        ]
      : conversations
  )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, CHAT_CONVERSATION_LIMIT);

  const storedConversationMode = activeModeToConversationMode(
    readStoredCreateActiveMode()
  );
  const activeConversationId = window.localStorage.getItem(
    chatActiveConversationStorageKey(storedConversationMode)
  );
  const activeConversation =
    nextConversations.find(
      (conversation) =>
        conversation.mode === storedConversationMode &&
        conversation.id === activeConversationId
    ) ||
    nextConversations.find(
      (conversation) => conversation.mode === storedConversationMode
    ) ||
    nextConversations[0] ||
    null;

  window.localStorage.setItem(
    CHAT_CONVERSATIONS_STORAGE_KEY,
    JSON.stringify(nextConversations)
  );
  if (activeConversation) {
    window.localStorage.setItem(
      chatActiveConversationStorageKey(activeConversation.mode),
      activeConversation.id
    );
  }
  window.localStorage.removeItem(CHAT_STORAGE_KEY);

  return {
    conversations: nextConversations,
    activeConversation,
  };
}

/**
 * 读取某个会话模式下应激活的对话。
 *
 * @param params.mode 目标会话模式。
 * @param params.conversations 当前模式的对话列表（已按 mode 过滤）。
 * @returns localStorage 中记住的 id 以及实际可激活的对话。
 * @sideEffects 读取 localStorage。
 * @failureMode 存储 id 失效时回退到当前模式下的第一个对话。
 */
export function resolveStoredConversationForMode(params: {
  mode: ConversationMode;
  conversations: ChatConversation[];
}) {
  const storedId = window.localStorage.getItem(
    chatActiveConversationStorageKey(params.mode)
  );
  const conversation =
    params.conversations.find((item) => item.id === storedId) ||
    params.conversations[0] ||
    null;
  return { storedId, conversation };
}

/**
 * 解析模式切换时应激活的会话目标。
 *
 * @param params.mode 目标会话模式。
 * @param params.conversations 当前模式下的对话列表。
 * @returns 已命中的会话、失效的旧 id，或需新建空会话的标记。
 * @sideEffects 读取 localStorage。
 * @failureMode 本地未记录任何 id 时返回 new。
 */
export function resolveConversationSwitchTarget(params: {
  mode: ConversationMode;
  conversations: ChatConversation[];
}) {
  const { storedId, conversation } = resolveStoredConversationForMode(params);
  if (conversation) {
    return { kind: "conversation" as const, conversation };
  }
  if (storedId) {
    return { kind: "stale-id" as const, storedId };
  }
  return { kind: "new" as const };
}

/**
 * 根据套餐上限钳制批量计数相关状态。
 *
 * @param current 当前值。
 * @param max 套餐允许的最大值。
 * @returns 不超过 max 的值(不会低于 1,调用方保证 max >= 1)。
 * @sideEffects 无。
 * @failureMode 已在合法范围内的值原样返回。
 */
export function clampBatchCount(current: number, max: number) {
  return Math.min(current, max);
}

/**
 * 根据套餐上限钳制瀑布流 tier。
 *
 * @param current 当前 tier。
 * @param max 套餐允许的最大 tier。
 * @returns 不低于 1 且不超过 max 的 tier。
 * @sideEffects 无。
 * @failureMode max < 1 时返回 1,避免负值。
 */
export function clampWaterfallTier(current: number, max: number) {
  return Math.max(1, Math.min(current, max));
}

/**
 * 解析 URL 模式守卫的切换目标。
 *
 * 把"URL 请求了某模式但套餐不允许""当前模式已失效""URL 无请求""URL 请求与当前一致"
 * 四种分支统一收敛为一条决策,供 effect 调用 switchActiveMode。
 *
 * @param params.requestedMode URL 解析出的模式(null 表示无请求)。
 * @param params.activeMode 当前激活模式。
 * @param params.isActiveModeAllowed 判断某模式是否被允许的纯函数。
 * @param params.fallbackMode 兜底模式(null 表示无兜底)。
 * @returns 切换决策:目标模式 + 是否需要弹出"模式不可用"提示。
 * @sideEffects 无。
 * @failureMode requestedMode 失效且 activeMode 也失效时回退 fallbackMode(null 表示不切换)。
 */
export function resolveModeGuardTarget(params: {
  requestedMode: ActiveMode | null;
  activeMode: ActiveMode;
  isActiveModeAllowed: (mode: ActiveMode) => boolean;
  fallbackMode: ActiveMode | null;
}):
  | {
      target: ActiveMode | null;
      shouldToast: false;
    }
  | {
      target: ActiveMode | null;
      shouldToast: true;
    } {
  const { requestedMode, activeMode, isActiveModeAllowed, fallbackMode } =
    params;

  if (requestedMode && !isActiveModeAllowed(requestedMode)) {
    return {
      target: isActiveModeAllowed(activeMode) ? activeMode : fallbackMode,
      shouldToast: true,
    };
  }

  if (!isActiveModeAllowed(activeMode)) {
    return { target: fallbackMode, shouldToast: false };
  }

  if (!requestedMode) {
    return { target: activeMode, shouldToast: false };
  }

  return { target: requestedMode, shouldToast: false };
}

/**
 * 解析跨页面参考图的目标模式字符串。
 *
 * @param value URL 或 sessionStorage 中的 mode 值。
 * @returns 合法的参考图目标模式，未知值统一回退 image。
 * @sideEffects 无。
 * @failureMode 非合法模式回退 image。
 */
export function parseReferenceTargetMode(
  value: string | null | undefined
): ReferenceTargetMode {
  return value === "agent" || value === "waterfall" || value === "chat"
    ? value
    : "image";
}

/**
 * 跨页面参考图统一目标。
 *
 * 来自 URL query 时 fromUrl=true,来自 sessionStorage 时 fromUrl=false。
 */
export type ResolvedReferenceTarget = {
  mode: ReferenceTargetMode;
  imageUrl: string;
  sourceId: string;
  sourceName: string;
  intentId: string;
  fromUrl: boolean;
};

/**
 * 从 URL query 或 sessionStorage 解析跨页面参考图目标。
 *
 * URL 优先:query 携带 ref + sendRef 时直接消费对应 handoff(标记为已消费),
 * 避免后续再次命中。否则尝试消费 sessionStorage 中的 pending handoff。
 * 两者都没有时返回 null,表示无需挂载任何参考图。
 *
 * @param searchParams 当前路由的查询参数。
 * @returns 解析出的参考图目标,无目标时为 null。
 * @sideEffects 可能消费 sessionStorage 中的 pending handoff。
 * @failureMode URL 或 handoff 校验失败时返回 null。
 */
export function resolveReferenceTarget(searchParams: URLSearchParams) {
  const referenceUrl = searchParams.get("ref");
  const sendRef = searchParams.get("sendRef");
  if (referenceUrl && sendRef) {
    consumePendingReferenceHandoff(sendRef);
  }
  const pendingReference = referenceUrl
    ? null
    : consumePendingReferenceHandoff(sendRef);

  const fromUrl = Boolean(referenceUrl);
  const target: ResolvedReferenceTarget | null = referenceUrl
    ? {
        mode: parseReferenceTargetMode(searchParams.get("mode")),
        imageUrl: referenceUrl,
        sourceId: searchParams.get("sourceId") || referenceUrl,
        sourceName: searchParams.get("sourceName") || "reference",
        intentId: searchParams.get("intent") || sendRef || "",
        fromUrl,
      }
    : pendingReference
      ? {
          mode: parseReferenceTargetMode(pendingReference.mode),
          imageUrl: pendingReference.imageUrl,
          sourceId: pendingReference.sourceId || pendingReference.imageUrl,
          sourceName: pendingReference.sourceName || "reference",
          intentId: pendingReference.id,
          fromUrl,
        }
      : null;

  return target;
}

/**
 * 构造跨页面参考图的幂等键。
 *
 * @param target 已解析的参考图目标。
 * @returns 用于去重的稳定字符串。
 * @sideEffects 无。
 * @failureMode target 为 null 返回空串。
 */
export function buildReferenceKey(target: ResolvedReferenceTarget) {
  return [target.mode, target.sourceId, target.imageUrl, target.intentId].join(
    "|"
  );
}

/**
 * 从 URL 查询参数中清理参考图相关键。
 *
 * 用于挂载完成后把 URL 收敛回干净状态,避免刷新或分享时重复触发挂载。
 * 返回新的 URLSearchParams,不直接修改入参。
 *
 * @param searchParams 当前路由的查询参数。
 * @param mode 清理后保留的模式值。
 * @returns 移除参考图键后、仅保留 mode 的新 URLSearchParams。
 * @sideEffects 无(返回新对象)。
 * @failureMode 无。
 */
export function stripReferenceUrlParams(
  searchParams: URLSearchParams,
  mode: ActiveMode
) {
  const nextParams = new URLSearchParams(searchParams.toString());
  for (const key of [
    "mode",
    "ref",
    "sourceId",
    "sourceName",
    "intent",
    "sendRef",
  ]) {
    nextParams.delete(key);
  }
  nextParams.set("mode", mode);
  return nextParams;
}

/**
 * 获取对话标题。
 *
 * @param messages 消息列表。
 * @param fallback 无用户消息时的回退标题。
 * @returns 最多 48 字符的标题。
 * @sideEffects 无。
 * @failureMode 空白首条用户消息使用 fallback。
 */
export function getChatConversationTitle(
  messages: ChatMessage[],
  fallback: string
) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.text.trim();
  if (!title) return fallback;
  return title.length > 48 ? `${title.slice(0, 48)}...` : title;
}

/**
 * 获取消息变体列表。
 *
 * @param message 消息对象。
 * @returns 变体数组,缺失时为空数组。
 * @sideEffects 无。
 * @failureMode 无 variants 字段返回空数组。
 */
export function getChatVariants(message: ChatMessage) {
  return message.variants || [];
}

/**
 * 获取当前激活的消息变体。
 *
 * @param message 消息对象。
 * @returns 激活变体或 null。
 * @sideEffects 无。
 * @failureMode activeVariant 越界时回退第一个变体。
 */
export function getActiveChatVariant(message: ChatMessage) {
  const variants = getChatVariants(message);
  return variants[message.activeVariant || 0] || variants[0] || null;
}

/**
 * 合并聊天结果变体。
 *
 * @param variant 当前变体。
 * @param patch 增量字段。
 * @returns 带必需字段默认值的新变体。
 * @sideEffects 无。
 * @failureMode 缺失 prompt/model/size 时使用安全默认值。
 */
export function mergeChatVariant(
  variant: ChatVariant | undefined,
  patch: Partial<ChatVariant>
): ChatVariant {
  return {
    prompt: variant?.prompt || patch.prompt || "",
    model: variant?.model || patch.model || DEFAULT_IMAGE_MODEL,
    size: variant?.size || patch.size || DEFAULT_IMAGE_SIZE,
    ...variant,
    ...patch,
  };
}

/**
 * 按 generationId 替换聊天变体。
 *
 * @param variants 现有变体。
 * @param generationId 目标生成 id。
 * @param replacements 替换变体。
 * @returns 新变体数组。
 * @sideEffects 无。
 * @failureMode generationId 缺失时空列表返回 replacements,非空列表保持原列表。
 */
export function replaceChatVariantByGenerationId(
  variants: ChatVariant[],
  generationId: string | undefined,
  replacements: ChatVariant[]
) {
  if (!generationId) return variants.length ? variants : replacements;
  const targetIndex = variants.findIndex(
    (variant) => variant.generationId === generationId
  );
  if (targetIndex < 0) return [...variants, ...replacements];
  return [
    ...variants.slice(0, targetIndex),
    ...replacements,
    ...variants.slice(targetIndex + 1),
  ];
}

/**
 * 提取用户消息中的图片 URL。
 *
 * @param message 消息对象。
 * @returns 可传给服务端的图片 URL 列表。
 * @sideEffects 无。
 * @failureMode 仅接受 data/http/https 图片预览。
 */
export function getMessageImageUrls(message: ChatMessage) {
  const urls: string[] = [];
  for (const attachment of message.attachments || []) {
    const url = attachment.previewUrl;
    if (
      url &&
      (url.startsWith("data:image/") ||
        url.startsWith("http://") ||
        url.startsWith("https://"))
    ) {
      urls.push(url);
    }
  }
  return urls;
}

/**
 * 将 UI 消息转成服务端对话历史。
 *
 * @param messages 当前消息列表。
 * @returns 最多 CHAT_CONTEXT_MESSAGE_LIMIT 条历史记录。
 * @sideEffects 无。
 * @failureMode 无图或无文本的变体会省略对应字段。
 */
export function toChatHistory(messages: ChatMessage[]) {
  return messages
    .filter(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" && message.variants?.length)
    )
    .slice(-CHAT_CONTEXT_MESSAGE_LIMIT)
    .map((message) => ({
      role: message.role,
      text: message.text,
      imageUrls: message.role === "user" ? getMessageImageUrls(message) : [],
      variants: message.variants?.map((variant) => ({
        text:
          variant.responseText ||
          variant.responseAgent ||
          variant.revisedPrompt ||
          (variant.imageUrl
            ? `Generated an image at ${variant.size}: ${variant.imageUrl}`
            : undefined),
        imageUrl: variant.imageUrl,
        imageFileId: variant.imageFileId,
        webImageMessageId: variant.webImageMessageId,
        webImageGroupId: variant.webImageGroupId,
        size: variant.size,
        timestamp: variant.createdAt,
        webConversation: variant.webConversation,
        backendMember: variant.backendMember,
        responsesPreviousResponse: variant.responsesPreviousResponse,
      })),
      activeVariant: message.activeVariant || 0,
      error: message.error,
    }));
}

/**
 * 将远程图片 URL 拉取为图生图输入文件。
 *
 * @param imageUrl 图片 URL。
 * @param name 文件名基础值。
 * @param sourceId 来源 id。
 * @returns 可放入编辑或对话附件的图片文件。
 * @sideEffects 发起 fetch 并创建 blob URL。
 * @failureMode 拉取失败时抛出错误。
 */
export async function urlToEditImageFile(
  imageUrl: string,
  name: string,
  sourceId?: string
): Promise<EditImageFile> {
  const response = await fetch(normalizeReferenceFetchUrl(imageUrl));
  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`);
  }

  const blob = await response.blob();
  const type = blob.type.startsWith("image/") ? blob.type : "image/png";
  const extension =
    type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  const file = new File([blob], `${name}.${extension}`, { type });
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    sourceId,
  };
}
