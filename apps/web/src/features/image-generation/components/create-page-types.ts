import type {
  RESPONSES_IMAGE_MODELS,
  SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import type { PlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import type { OperationFeatureFlags } from "@repo/shared/system-settings";
import type { ImageBackendGroupBackendType } from "@/features/image-backend-pool/types";
import type { ReferenceHandoffMode } from "@/features/image-generation/reference-handoff";
import type { ImageBaseCreditPricing } from "../resolution";
import type { VideoPricingInfo } from "../video-operations";
import type { EditImageFile } from "./image-edit-types";

// 创作页共享类型:供主页面、拆分组件和纯工具函数复用,避免 UI 文件继续膨胀。

export type RecentGeneration = {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  imageUrl: string | null;
  createdAt: string;
  isLayered?: boolean;
};

export type ResultState = {
  generationId: string;
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  creditsConsumed?: number;
  revisedPrompt?: string;
  promptRepairNotice?: string;
};

export type ImageApiResult = {
  error?: string;
  status?: "pending" | "completed" | "failed";
  prompt?: string;
  generationId?: string;
  imageUrl?: string;
  imageFileId?: string;
  imageOutputs?: Array<{
    generationId?: string;
    imageUrl?: string;
    imageFileId?: string;
    webImageMessageId?: string;
    webImageGroupId?: string;
    size?: string;
    revisedPrompt?: string;
    upstreamRevisedPrompt?: string;
    promptRepairNotice?: string;
    index?: number;
    outputRole?: "final" | "agent_draft" | "choice";
  }>;
  model?: string;
  size?: string;
  revisedPrompt?: string;
  promptRepairNotice?: string;
  responseText?: string;
  responseThinking?: string;
  responseAgent?: string;
  agentEvents?: AgentRunEvent[];
  agentRoundCount?: number;
  layered?: boolean;
  webConversation?: ChatGptWebConversationState;
  backendMember?: StickyBackendMemberState;
  responsesPreviousResponse?: ResponsesPreviousResponseState;
  creditsConsumed?: number;
  createdAt?: string;
  completedAt?: string;
  results?: ImageApiResult[];
};

export type GenerationRequestError = Error & {
  creditsConsumed?: number;
};

export type AgentRunEvent = {
  id?: string;
  kind:
    | "message"
    | "reasoning"
    | "web_search"
    | "code_interpreter"
    | "image_generation"
    | "image_partial"
    | "tool";
  status?: "started" | "running" | "completed" | "failed";
  title: string;
  detail?: string;
  imageBase64?: string;
  imageUrl?: string;
  index?: number;
  partialImageIndex?: number;
  timestamp?: string;
  toolType?: string;
};

export type ImageStreamEvent =
  | {
      type: "partial_image";
      index?: number;
      partial_image_index?: number;
      b64_json?: string;
      url?: string;
      final?: boolean;
    }
  | {
      type: "text_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "thinking_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "agent_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "agent_event";
      index?: number;
      event: AgentRunEvent;
    }
  | ({ type: "completed" } & ImageApiResult)
  | ({ type: "error"; error: string } & ImageApiResult)
  | { type: "done" };

export type ChatAttachment = EditImageFile & {
  kind: "image" | "file";
};

export type ChatAttachmentPreview = {
  id: string;
  name: string;
  previewUrl?: string;
  kind?: "image" | "file";
};

export type ChatVariant = {
  generationId?: string;
  imageUrl?: string;
  imageFileId?: string;
  pending?: boolean;
  webImageMessageId?: string;
  webImageGroupId?: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
  promptRepairNotice?: string;
  responseText?: string;
  responseThinking?: string;
  responseAgent?: string;
  agentEvents?: AgentRunEvent[];
  agentRoundCount?: number;
  webConversation?: ChatGptWebConversationState;
  backendMember?: StickyBackendMemberState;
  responsesPreviousResponse?: ResponsesPreviousResponseState;
  creditsConsumed?: number;
  createdAt?: string;
  outputRole?: "final" | "agent_draft" | "choice";
  files?: Array<{ label: string; url: string }>;
};

export type ChatRecentGeneration = RecentGeneration & {
  canDelete?: boolean;
};

export type ChatResultInput = Pick<
  ImageApiResult,
  | "generationId"
  | "imageUrl"
  | "imageFileId"
  | "model"
  | "size"
  | "revisedPrompt"
  | "promptRepairNotice"
  | "responseText"
  | "responseThinking"
  | "responseAgent"
  | "agentEvents"
  | "agentRoundCount"
  | "layered"
  | "webConversation"
  | "backendMember"
  | "responsesPreviousResponse"
  | "creditsConsumed"
> & {
  webImageMessageId?: string;
  webImageGroupId?: string;
  pending?: boolean;
  outputRole?: "final" | "agent_draft" | "choice";
};

export type ChatGptWebConversationState = {
  conversationId: string;
  parentMessageId: string;
  accountId?: string;
  apiKeyId?: string;
  selectionMessageId?: string;
  selectedImageMessageId?: string;
};

export type StickyBackendMemberState = {
  type: "api" | "account";
  id: string;
  groupId?: string | null;
  accountBackend?: "web" | "responses";
};

export type ResponsesPreviousResponseState = {
  responseId: string;
  backendMember: StickyBackendMemberState;
  store: true;
  createdAt?: string;
};

export type ConversationMode = "chat" | "agent" | "web";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: ConversationMode;
  attachments?: ChatAttachmentPreview[];
  variants?: ChatVariant[];
  activeVariant?: number;
  error?: string;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  mode: ConversationMode;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ImageReferenceMentionOption = {
  token: string;
  label: string;
  detail: string;
  previewUrl?: string;
};

export type MentionState = {
  open: boolean;
  start: number;
  end: number;
  query: string;
};

export type ForceWebPixelRange = {
  minPixels: number;
  maxPixels: number;
};

export type ChatStreamState = {
  messageId?: string;
  cardId?: string;
  mode?: ConversationMode;
  text: string;
  thinking: string;
  agent: string;
  agentEvents: AgentRunEvent[];
  imageUrl?: string;
  generationId?: string;
  prompt?: string;
  model?: string;
  size?: string;
};

export type ChatModel = (typeof RESPONSES_IMAGE_MODELS)[number];
export type TextGenerationMode = "single" | "lines";

export type BatchCard = {
  id: string;
  state: "loading" | "image" | "text" | "error";
  aspectRatio: string;
  prompt: string;
  size: string;
  streamText?: string;
  streamThinking?: string;
  streamAgent?: string;
  imageUrl?: string;
  generationId?: string;
  text?: string;
  error?: string;
  model?: string;
  creditsConsumed?: number;
  saved?: boolean;
};

export type WaterfallStats = {
  sent: number;
  success: number;
  failed: number;
};

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "auto" | "opaque" | "transparent";

export type ActiveMode =
  | "text"
  | "image"
  | "chat"
  | "chat-web"
  | "agent"
  | "waterfall"
  | "video";
export type ReferenceTargetMode = Extract<ActiveMode, ReferenceHandoffMode>;
export type VisualOutputMode = "text-single" | "text-lines" | "image";

export type BackendGroupOption = {
  id: string;
  name: string;
  isDefault: boolean;
  backendType: ImageBackendGroupBackendType;
  contentSafetyEnabled: boolean | null;
  billingMultiplier: number;
  availableModels: string[];
};

export interface CreatePageClientProps {
  balance: number;
  recentGenerations: RecentGeneration[];
  plan: SubscriptionPlan;
  capabilities: PlanCapabilitySnapshot;
  uploadLimits: {
    maxFileSizeBytes: number;
    maxUploadBytes: number;
  };
  maxEditImages: number;
  backendGroups: BackendGroupOption[];
  selectedBackendGroupId: string | null;
  customApiActive: boolean;
  moderationEnabled: boolean;
  imageBasePricing: ImageBaseCreditPricing;
  forceWebPixelRange: ForceWebPixelRange;
  videoPricing: VideoPricingInfo;
  operationFlags: OperationFeatureFlags;
}
