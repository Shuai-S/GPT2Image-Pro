"use client";

import {
  GPT54_CHAT_MODEL,
  GPT55_CHAT_MODEL,
} from "@repo/shared/config/subscription-plan";
import { formatCredits } from "@repo/shared/credits/format";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Textarea } from "@repo/ui/components/textarea";
import { CircleHelp, ImagePlus, Loader2, Send } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { getImageBatchCountLimit } from "@/features/image-generation/batch-limits";
import {
  hasSeenWaterfallFirstTimeWarning,
  WaterfallWarningPopup,
  type WaterfallWarningType,
} from "@/features/image-generation/components/waterfall-warning-popup";
import {
  useCreateRuntimeRef,
  useCreateRuntimeState,
  useResetCreateRuntimeKeys,
} from "@/features/image-generation/create-runtime-store";
import { consumePendingReferenceHandoff } from "@/features/image-generation/reference-handoff";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import {
  agentEventToImageUrl,
  appendAgentRunEvent,
  createOptimisticAgentRoundEvents,
} from "../agent-round-cards";
import {
  AUTO_IMAGE_SIZE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageCreditCost,
  IMAGE_DIMENSION_STEP,
  type ImageQualityLevel,
  isFireflyModel,
  MAX_IMAGE_DIMENSION,
  normalizeImageSize,
  normalizeValidImageSize,
  parseImageSize,
  roundUpCreditAmount,
  validateImageSize,
} from "../resolution";
import {
  type AspectRatioSizeDialogValue,
  ImageSizePresetButton,
} from "./aspect-ratio-size-dialog";
import { CreatePageAdvancedImageSettings } from "./create-page-advanced-settings";
import {
  CreatePageAgentBlock,
  CreatePageAgentRoundCards,
  CreatePageThinkingBlock,
} from "./create-page-agent-progress";
import { CreatePageChatAgentHeader } from "./create-page-chat-agent-panel";
import { CreatePageChatInput } from "./create-page-chat-input";
import { CreatePageChatMessageList } from "./create-page-chat-message-list";
import { CreatePageImagePanel } from "./create-page-image-panel";
import {
  BACKGROUND_OPTIONS,
  CHAT_ACTIVE_AGENT_CONVERSATION_STORAGE_KEY,
  CHAT_ACTIVE_CONVERSATION_STORAGE_KEY,
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_CONVERSATION_LIMIT,
  CHAT_CONVERSATIONS_STORAGE_KEY,
  CHAT_IMAGE_MODEL_OPTIONS,
  CHAT_STORAGE_KEY,
  CHAT_SUGGESTIONS,
  CHAT_SUGGESTIONS_ZH,
  CREATE_ACTIVE_MODE_STORAGE_KEY,
  DEFAULT_MAX_EDIT_REQUEST_BYTES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_WATERFALL_TIER,
  defaultDimensions,
  EDIT_MODEL_OPTIONS,
  filterImageModelOptionsForGroup,
  IMAGE_ACCEPT,
  isWithinForceWebPixelRange,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  shouldBypassImageOptimization,
  TEXT_IMAGE_COUNT_SLIDER_MAX,
  TEXT_MODEL_OPTIONS,
  WATERFALL_ASPECT_RATIOS,
  WATERFALL_CONCURRENCY_MULTIPLIER,
  WATERFALL_TIER_PRESETS,
} from "./create-page-options";
import { CreatePageRecentPanel } from "./create-page-recent-panel";
import { CreatePageTextPanel } from "./create-page-text-panel";
import { CreatePageTextSettingsPanel } from "./create-page-text-settings-panel";
import type {
  ActiveMode,
  AgentRunEvent,
  BackendGroupOption,
  BatchCard,
  ChatAttachment,
  ChatConversation,
  ChatMessage,
  ChatModel,
  ChatRecentGeneration,
  ChatResultInput,
  ChatStreamState,
  ChatVariant,
  ConversationMode,
  CreatePageClientProps,
  GenerationRequestError,
  ImageApiResult,
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
  ImageReferenceMentionOption,
  ImageStreamEvent,
  MentionState,
  RecentGeneration,
  ReferenceTargetMode,
  ResultState,
  TextGenerationMode,
  VisualOutputMode,
  WaterfallStats,
} from "./create-page-types";
import {
  activeModeToConversationMode,
  chatActiveConversationStorageKey,
  cloneFile,
  compactChatConversations,
  createChatConversation,
  createGenerationId,
  createInitialChatStreamState,
  createLocalId,
  filterMentionOptions,
  formatMegabytes,
  getActiveChatVariant,
  getChatConversationTitle,
  getChatVariants,
  getCursorAfterInsertedMention,
  getMentionTrigger,
  hasPromptImageReference,
  imageStreamEventToPreviewUrl,
  inferChatConversationMode,
  insertMentionToken,
  isImageFile,
  isReadableChatFile,
  mergeChatVariant,
  parseCreateModeParam,
  persistChatConversationSnapshot,
  readFileAsDataUrl,
  readImageApiJsonResponse,
  readStoredCreateActiveMode,
  replaceChatVariantByGenerationId,
  revokePreview,
  sanitizeChatConversations,
  sanitizeChatMessages,
  sanitizePersistedChatMessages,
  toChatHistory,
  urlToEditImageFile,
  yieldToBrowser,
} from "./create-page-utils";
import { CreatePageVisualOutputPanel } from "./create-page-visual-output-panel";
import { CreatePageWaterfallGrid } from "./create-page-waterfall-grid";
import type { EditImageFile, MaskPoint } from "./image-edit-types";
import { VideoCreatePanel } from "./video-create-panel";

// 创作页主组件:页面级状态和请求编排保留在此,共享类型、常量和纯工具已拆分到同目录模块。

export function CreatePageClient({
  balance: initialBalance,
  recentGenerations: initialRecent,
  capabilities,
  uploadLimits,
  maxEditImages,
  backendGroups,
  selectedBackendGroupId,
  customApiActive,
  moderationEnabled,
  imageBasePricing,
  forceWebPixelRange,
  videoPricing,
  operationFlags,
}: CreatePageClientProps) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isZh = locale === "zh";
  const copy = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );
  // 请求级生图分组覆盖:"default" 表示跟随设置页偏好。切换仅对本页后续请求生效
  // (不写偏好表,可另点「设为默认」保存);服务端对显式分组做 fail-closed 校验。
  const [requestGroupChoice, setRequestGroupChoice] = useCreateRuntimeState(
    "requestGroupChoice",
    "default"
  );
  const preferenceBackendGroup =
    backendGroups.find((group) => group.id === selectedBackendGroupId) ||
    backendGroups.find((group) => group.isDefault) ||
    null;
  const selectedBackendGroup =
    requestGroupChoice === "default"
      ? preferenceBackendGroup
      : (backendGroups.find((group) => group.id === requestGroupChoice) ??
        preferenceBackendGroup);
  // 仅当覆盖选择指向一个仍可选的分组时才随请求发送 groupId;失效选项静默回落偏好,
  // 避免把已下线分组发给服务端触发误报错。
  const requestGroupId =
    requestGroupChoice !== "default" &&
    backendGroups.some((group) => group.id === requestGroupChoice)
      ? requestGroupChoice
      : undefined;
  const activeBillingMultiplier = Math.max(
    0.01,
    selectedBackendGroup?.billingMultiplier || 1
  );
  const applyBillingMultiplier = (credits: number) =>
    activeBillingMultiplier === 1
      ? credits
      : roundUpCreditAmount(credits * activeBillingMultiplier);
  const getPricedImageCreditCost = (
    requestedSize?: string | null,
    options: Parameters<typeof getImageCreditCost>[1] = {}
  ) =>
    getImageCreditCost(requestedSize, {
      ...options,
      basePricing: imageBasePricing,
      quality: (options.quality ?? quality) as ImageQualityLevel | undefined,
    });
  const activeBackendType = selectedBackendGroup?.backendType || "mixed";
  const isWebOnlyBackend = activeBackendType === "web";
  const showImageModelControls = !isWebOnlyBackend;
  const showAgentProcessHint = !isWebOnlyBackend;
  const isConversationMode = (mode: ActiveMode) =>
    mode === "chat" ||
    mode === "chat-web" ||
    mode === "agent" ||
    mode === "waterfall";
  const getConversationMode = (mode: ActiveMode): ConversationMode =>
    activeModeToConversationMode(mode);
  const isMessageInConversationMode = (
    message: ChatMessage,
    mode: ConversationMode
  ) =>
    mode === "agent"
      ? message.mode === "agent"
      : mode === "web"
        ? message.mode === "web"
        : message.mode !== "agent" && message.mode !== "web";
  const batchCostSuffix = (count: number) =>
    count > 1
      ? copy(` for ${count}`, `，共 ${count} 张`)
      : copy("/image", "/张");
  const editModelLabel = (label: string) =>
    label === "Default" ? copy("Default", "默认") : label;
  const textModelLabel = (label: string) =>
    label === "Default" ? copy("Default", "默认") : label;
  const chatImageModelLabel = (label: string) =>
    label === "Default" ? copy("Default", "默认") : label;
  const qualityLabel = (qualityValue: ImageQuality) =>
    copy(
      QUALITY_OPTIONS.find((option) => option.value === qualityValue)?.label ||
        qualityValue,
      {
        auto: "自动",
        high: "高",
        low: "低",
        medium: "中",
      }[qualityValue]
    );
  const outputFormatLabel = (format: ImageOutputFormat) =>
    OUTPUT_FORMAT_OPTIONS.find((option) => option.value === format)?.label ||
    format.toUpperCase();
  const backgroundLabel = (backgroundValue: ImageBackground) =>
    copy(
      BACKGROUND_OPTIONS.find((option) => option.value === backgroundValue)
        ?.label || backgroundValue,
      {
        auto: "自动",
        opaque: "不透明",
        transparent: "透明",
      }[backgroundValue]
    );
  const outputFormatHelpText = copy(
    "Controls the requested output file format for Codex/Responses and compatible API backends. Web backends may ignore it; stored files are still labeled by the actual detected format.",
    "指定 Codex/Responses 和兼容 API 后端的输出文件格式。Web 后端可能忽略；本站保存时仍会按实际识别到的格式标记。"
  );
  const backgroundHelpText = copy(
    "Requests transparent, opaque, or automatic background handling for Codex/Responses and compatible image APIs. Transparent output is only reliable with PNG/WebP and may be ignored by Web backends.",
    "为 Codex/Responses 和兼容 image API 请求透明、不透明或自动背景。透明输出仅在 PNG/WebP 下更可靠，Web 后端可能忽略。"
  );
  const outputCompressionHelpText = copy(
    "Only applies to JPEG/WebP. 0 is smallest file, 100 is highest quality.",
    "仅对 JPEG/WebP 生效。0 体积最小，100 质量最高。"
  );
  const helpMarker = (label: string, title: string) => (
    <span
      aria-label={title}
      className="inline-flex cursor-help items-center text-muted-foreground"
      role="img"
      title={title}
    >
      <CircleHelp className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
  const labelWithHelp = (label: string, title: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {helpMarker(label, title)}
    </span>
  );
  const imageModelHelpText = copy(
    "Image model for generations/edits. Web backend does not have a separate image model field and ignores this control; Codex/Responses uses it as the image_generation tool model; external image API receives it as the image model.",
    "生图/编辑图片模型。Web 后端没有独立图片模型字段，会忽略该控制；Codex/Responses 会作为 image_generation 工具模型；外接 image API 会作为图片模型传递。"
  );
  const promptOptimizationHelpText = copy(
    "Turning this off is best effort: the platform sends the original prompt and uses instant on Web, but an upstream backend may still internally revise or interpret the prompt.",
    "关闭后是尽量少改动：平台会发送原始提示词，并让 Web 使用 instant；但上游后端仍可能在内部改写或理解提示词。"
  );
  const resolutionHelpText = copy(
    "Auto lets the backend decide the output size. Reference images can use their original pixels for preview and masks. The requested output size must still be valid, so non-step reference sizes are rounded to the nearest supported size. Web backend treats resolution as best-effort aspect-ratio guidance and cannot guarantee exact pixels or native 4K. After generation, the actual output size is recorded and credits are settled against the actual size.",
    "Auto 会让后端决定输出尺寸。参考图预览和蒙版仍使用原始像素。请求的输出尺寸必须合法，所以非步进参考图尺寸会贴近到支持的尺寸。Web 后端只能把分辨率作为尽量遵循的画幅提示，不能保证精确像素或原生 4K。生成完成后会记录实际输出尺寸，并按实际尺寸修正计费。"
  );
  const validationMessage = (message?: string) => {
    if (!message || !isZh) return message;
    if (message === "Use WIDTHxHEIGHT format.") {
      return "请使用 宽x高 格式。";
    }
    if (message.startsWith("Width and height must be between")) {
      return `宽和高必须在 256 到 ${MAX_IMAGE_DIMENSION}px 之间，并且能被 ${IMAGE_DIMENSION_STEP} 整除。`;
    }
    if (message.startsWith("Total pixels must be no more than")) {
      return "总像素不能超过 8,294,400。";
    }
    if (message.startsWith("Total pixels must be at least")) {
      return "总像素不能低于 655,360。";
    }
    if (message.startsWith("Aspect ratio must be no more than")) {
      return "宽高比不能超过 3:1。";
    }
    return message;
  };
  const textAllowed = operationFlags.textToImage;
  const imageAllowed = operationFlags.imageToImage;
  const chatAllowed =
    operationFlags.chat && capabilities.features["imageGeneration.chat"];
  const agentAllowed =
    operationFlags.agent &&
    (capabilities.features["imageGeneration.agent"] ?? chatAllowed);
  const waterfallAllowed =
    operationFlags.waterfall &&
    (capabilities.features["imageGeneration.waterfall"] ?? chatAllowed);
  const videoAllowed = operationFlags.video;
  const gpt55ChatAllowed = capabilities.features["models.gpt55"];
  const promptOptimizationAllowed =
    capabilities.features["promptOptimization.control"];
  const maxChatImages = capabilities.limits.maxChatImages;
  // 单次生成张数与服务端统一挂 maxBatchCount，并受平台 4 张硬上限保护。
  const batchCountMax = getImageBatchCountLimit(capabilities.limits);
  const textImageCountMax = Math.min(
    batchCountMax,
    TEXT_IMAGE_COUNT_SLIDER_MAX
  );
  const maxImageBytes =
    uploadLimits.maxFileSizeBytes || DEFAULT_MAX_IMAGE_BYTES;
  const maxEditRequestBytes =
    uploadLimits.maxUploadBytes || DEFAULT_MAX_EDIT_REQUEST_BYTES;
  const [activeMode, setActiveMode] = useCreateRuntimeState<ActiveMode>(
    "activeMode",
    readStoredCreateActiveMode()
  );
  /**
   * 切换创作模式并同步到 URL。
   *
   * @param mode 目标创作模式。
   * @sideEffects 更新共享运行时状态、localStorage 以及当前地址的 mode query。
   */
  const switchActiveMode = useCallback(
    (mode: ActiveMode) => {
      setActiveMode(mode);

      const nextParams = new URLSearchParams(searchParams.toString());
      if (nextParams.get("mode") === mode) return;

      nextParams.set("mode", mode);
      router.replace(`${pathname}?${nextParams.toString()}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams, setActiveMode]
  );
  const [prompt, setPrompt] = useCreateRuntimeState("prompt", "");
  const [textMode, setTextMode] = useCreateRuntimeState<TextGenerationMode>(
    "textMode",
    "single"
  );
  const [linePrompts, setLinePrompts] = useCreateRuntimeState(
    "linePrompts",
    ""
  );
  const [editPrompt, setEditPrompt] = useCreateRuntimeState("editPrompt", "");
  const [promptOptimization, setPromptOptimization] = useCreateRuntimeState(
    "promptOptimization",
    true
  );
  const [chatPrompt, setChatPrompt] = useCreateRuntimeState("chatPrompt", "");
  const [editMention, setEditMention] =
    useCreateRuntimeState<MentionState | null>("editMention", null);
  const [chatMention, setChatMention] =
    useCreateRuntimeState<MentionState | null>("chatMention", null);
  const [chatConversationId, setChatConversationId] = useCreateRuntimeState(
    "chatConversationId",
    () => createLocalId()
  );
  const [chatConversations, setChatConversations] = useCreateRuntimeState<
    ChatConversation[]
  >("chatConversations", []);
  const [chatMessages, setChatMessages] = useCreateRuntimeState<ChatMessage[]>(
    "chatMessages",
    []
  );
  const [chatAttachments, setChatAttachments] = useCreateRuntimeState<
    ChatAttachment[]
  >("chatAttachments", []);
  const [chatStream, setChatStream] =
    useCreateRuntimeState<ChatStreamState | null>("chatStream", null);
  const [retryingChatMessageId, setRetryingChatMessageId] =
    useCreateRuntimeState<string | null>("retryingChatMessageId", null);
  const [batchCards, setBatchCards] = useCreateRuntimeState<BatchCard[]>(
    "batchCards",
    []
  );
  const [batchPrompt, setBatchPrompt] = useCreateRuntimeState(
    "batchPrompt",
    ""
  );
  const [isBatchActive, setIsBatchActive] = useCreateRuntimeState(
    "isBatchActive",
    false
  );
  const [isBatchLoadingMore, setIsBatchLoadingMore] = useCreateRuntimeState(
    "isBatchLoadingMore",
    false
  );
  const [isBatchStopped, setIsBatchStopped] = useCreateRuntimeState(
    "isBatchStopped",
    false
  );
  const [waterfallCreditsConsumed, setWaterfallCreditsConsumed] =
    useCreateRuntimeState("waterfallCreditsConsumed", 0);
  const [waterfallStats, setWaterfallStats] =
    useCreateRuntimeState<WaterfallStats>("waterfallStats", {
      sent: 0,
      success: 0,
      failed: 0,
    });
  // 瀑布流“每批并发张数”(tier)：对齐原项目 TIER。瀑布流每张卡片是独立 count=1 请求，
  // 故真正的并发硬上限是套餐 imageGenerationConcurrency(队列 userConcurrency 实际钳制的值)，
  // 与“单次请求张数上限 maxBatchCount”无关，因此 tier 仅受 imageGenerationConcurrency 约束。
  const [waterfallTier, setWaterfallTier] = useCreateRuntimeState(
    "waterfallTier",
    DEFAULT_WATERFALL_TIER
  );
  // 瀑布流警告弹窗状态：null 表示无弹窗；承载 type/tier/count。
  const [waterfallWarning, setWaterfallWarning] = useCreateRuntimeState<{
    type: WaterfallWarningType;
    tier: number;
    count: number;
  } | null>("waterfallWarning", null);
  // tier 允许上限 = 套餐单用户并发上限(至少 1)
  const waterfallTierLimit = Math.max(
    1,
    capabilities.limits.imageGenerationConcurrency
  );
  // 可选 tier：预设中不超过套餐上限者；若全部超限则保底 [1]
  const waterfallTierOptions = (() => {
    const filtered = WATERFALL_TIER_PRESETS.filter(
      (value) => value <= waterfallTierLimit
    );
    return filtered.length > 0 ? filtered : [1];
  })();
  // 实际生效 tier：钳制到允许上限
  const effectiveWaterfallTier = Math.max(
    1,
    Math.min(waterfallTier, waterfallTierLimit)
  );
  // 每批载入张数 = tier；单批最大并发 = tier * 倍数，再与套餐并发上限取 min 兜底
  const waterfallLoadSize = effectiveWaterfallTier;
  const waterfallMaxConcurrent = Math.max(
    1,
    Math.min(
      effectiveWaterfallTier * WATERFALL_CONCURRENCY_MULTIPLIER,
      waterfallTierLimit
    )
  );
  const [chatModel, setChatModel] = useCreateRuntimeState<ChatModel>(
    "chatModel",
    GPT54_CHAT_MODEL
  );
  const [agentForceRounds, setAgentForceRounds] = useCreateRuntimeState(
    "agentForceRounds",
    false
  );
  const [agentMaxRounds, setAgentMaxRounds] = useCreateRuntimeState(
    "agentMaxRounds",
    3
  );
  // 分层生成("生成即分层"):agent 先出整图、再逐层生成。仅 agent 模式有效。
  const [layeredGeneration, setLayeredGeneration] = useCreateRuntimeState(
    "layeredGeneration",
    false
  );
  const [chatFirstImageSize, setChatFirstImageSize] = useCreateRuntimeState<{
    width: number;
    height: number;
  } | null>("chatFirstImageSize", null);
  const [isChatGenerating, setIsChatGenerating] = useCreateRuntimeState(
    "isChatGenerating",
    false
  );
  const [useAutoSize, setUseAutoSize] = useCreateRuntimeState(
    "useAutoSize",
    false
  );
  const [width, setWidth] = useCreateRuntimeState(
    "width",
    defaultDimensions.width
  );
  const [height, setHeight] = useCreateRuntimeState(
    "height",
    defaultDimensions.height
  );
  const [textMixWebFirst, setTextMixWebFirst] = useCreateRuntimeState(
    "textMixWebFirst",
    true
  );
  const [editMixWebFirst, setEditMixWebFirst] = useCreateRuntimeState(
    "editMixWebFirst",
    true
  );
  const [chatMixWebFirst, setChatMixWebFirst] = useCreateRuntimeState(
    "chatMixWebFirst",
    true
  );
  const [quality, setQuality] = useCreateRuntimeState<ImageQuality>(
    "quality",
    "auto"
  );
  const [outputFormat, setOutputFormat] =
    useCreateRuntimeState<ImageOutputFormat>("outputFormat", "png");
  const [background, setBackground] = useCreateRuntimeState<ImageBackground>(
    "background",
    "auto"
  );
  // 透明背景抠图回退显式开关(issue #27):仅 background=transparent 时有意义。开启后若后端
  // 不支持透明,则不透明重生成 + 服务端 ISNet 抠图;不开则透明直接透传、不支持即返回真实错误。
  // 仅文生图/图生图/chat/瀑布流可用,agent 模式不提供(UI 隐藏 + 后端忽略)。
  const [transparentMatte, setTransparentMatte] = useCreateRuntimeState(
    "transparentMatte",
    false
  );
  // 高清修复:默认关闭(用轻量 general-x4v3,快且安全);勾选才用 SwinIR 复原(文字/结构最佳,
  // 但 CPU 极慢、吃满多核,仅供受控测试)。仅在超分主开关开且上游图偏小触发超分时生效。
  const [hdRepair, setHdRepair] = useCreateRuntimeState("hdRepair", false);
  // 分块修复:默认关。勾选后把最终图切成 2×2 web 块逐块 gpt-image-2 重绘再拼接超分(重点修文字),
  // 逐块单独计费。repairPrompt 为每块提示词(空则用管理端默认)。
  const [blockRepair, setBlockRepair] = useCreateRuntimeState(
    "blockRepair",
    false
  );
  const [repairPrompt, setRepairPrompt] = useCreateRuntimeState(
    "repairPrompt",
    ""
  );
  const [outputCompression, setOutputCompression] = useCreateRuntimeState(
    "outputCompression",
    100
  );
  const [batchCount, setBatchCount] = useCreateRuntimeState("batchCount", 1);
  const [lineBatchRepeatCount, setLineBatchRepeatCount] = useCreateRuntimeState(
    "lineBatchRepeatCount",
    1
  );
  const [editBatchCount, setEditBatchCount] = useCreateRuntimeState(
    "editBatchCount",
    1
  );

  // 路由切换时重置创作页面的表单输入状态,防止从其他页面切换回来时
  // 仍显示上一次的内容。仅清理输入类状态,保留用户偏好(模型/尺寸/质量等)。
  const resetKeys = useResetCreateRuntimeKeys();
  useEffect(() => {
    // 如果 URL 携带 sendRef 参数,说明是从图库/历史发送参考图过来,
    // 不应清理状态(reference-handoff 会填充正确的值)。
    const params = new URLSearchParams(window.location.search);
    if (params.has("sendRef")) return;

    resetKeys([
      "prompt",
      "editPrompt",
      "chatPrompt",
      "batchPrompt",
      "linePrompts",
      "chatAttachments",
    ]);
  }, [resetKeys]);

  useEffect(() => {
    setBatchCount((value) => Math.min(value, textImageCountMax));
    setLineBatchRepeatCount((value) => Math.min(value, textImageCountMax));
    setEditBatchCount((value) => Math.min(value, batchCountMax));
    // 瀑布流 tier 也钳制到当前套餐允许上限(套餐切换/管理员调整并发时收紧)
    setWaterfallTier((value) =>
      Math.max(1, Math.min(value, waterfallTierLimit))
    );
  }, [
    batchCountMax,
    setBatchCount,
    setEditBatchCount,
    setLineBatchRepeatCount,
    setWaterfallTier,
    textImageCountMax,
    waterfallTierLimit,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 处理跨页面参考图只依赖 URL 和权限输入,状态 setter 由运行期 store 保持稳定。
  useEffect(() => {
    const parseReferenceMode = (
      value: string | null | undefined
    ): ReferenceTargetMode =>
      value === "agent" || value === "waterfall" || value === "chat"
        ? value
        : "image";
    const clearReferenceParams = (mode: ActiveMode) => {
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
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    };

    const referenceUrl = searchParams.get("ref");
    const sendRef = searchParams.get("sendRef");
    if (referenceUrl && sendRef) {
      consumePendingReferenceHandoff(sendRef);
    }
    const pendingReference = referenceUrl
      ? null
      : consumePendingReferenceHandoff(sendRef);
    const reference = referenceUrl
      ? {
          mode: parseReferenceMode(searchParams.get("mode")),
          imageUrl: referenceUrl,
          sourceId: searchParams.get("sourceId") || referenceUrl,
          sourceName: searchParams.get("sourceName") || "reference",
          intentId: searchParams.get("intent") || sendRef || "",
          fromUrl: true,
        }
      : pendingReference
        ? {
            mode: parseReferenceMode(pendingReference.mode),
            imageUrl: pendingReference.imageUrl,
            sourceId: pendingReference.sourceId || pendingReference.imageUrl,
            sourceName: pendingReference.sourceName || "reference",
            intentId: pendingReference.id,
            fromUrl: false,
          }
        : null;
    if (!reference) return;

    const referenceKey = [
      reference.mode,
      reference.sourceId,
      reference.imageUrl,
      reference.intentId,
    ].join("|");
    if (appliedReferenceParamKeyRef.current === referenceKey) return;
    appliedReferenceParamKeyRef.current = referenceKey;
    let cancelled = false;

    const attachReference = async () => {
      try {
        const item = await urlToEditImageFile(
          reference.imageUrl,
          reference.sourceName,
          reference.sourceId
        );
        if (cancelled) {
          revokePreview(item.previewUrl);
          return;
        }

        if (
          reference.mode === "chat" ||
          reference.mode === "agent" ||
          reference.mode === "waterfall"
        ) {
          const modeAllowed =
            reference.mode === "agent"
              ? agentAllowed
              : reference.mode === "waterfall"
                ? waterfallAllowed
                : chatAllowed;
          if (!modeAllowed) {
            revokePreview(item.previewUrl);
            switchActiveMode("image");
            toast.error(
              copy(
                "This mode is not enabled for your plan.",
                "当前套餐未开启该模式。"
              )
            );
            return;
          }

          setChatAttachments((prev) => {
            if (
              prev.some(
                (attachment) => attachment.sourceId === reference.sourceId
              )
            ) {
              revokePreview(item.previewUrl);
              return prev;
            }
            if (prev.length >= maxChatImages) {
              revokePreview(item.previewUrl);
              toast.error(
                copy(
                  `Attach up to ${maxChatImages} reference images`,
                  `最多可添加 ${maxChatImages} 张参考图片`
                )
              );
              return prev;
            }
            return [...prev, { ...item, kind: "image" }];
          });
          switchActiveMode(reference.mode);
          toast.success(copy("Reference image attached", "参考图片已添加"));
          if (reference.fromUrl && !cancelled) {
            clearReferenceParams(reference.mode);
          }
          return;
        }

        setEditImages((prev) => {
          if (prev.some((image) => image.sourceId === reference.sourceId)) {
            revokePreview(item.previewUrl);
            return prev;
          }
          if (prev.length >= maxEditImages) {
            revokePreview(item.previewUrl);
            toast.error(
              copy(
                `Upload up to ${maxEditImages} source images`,
                `最多可上传 ${maxEditImages} 张源图片`
              )
            );
            return prev;
          }
          return [...prev, item];
        });
        switchActiveMode("image");
        toast.success(copy("Reference image selected", "参考图片已选择"));
        if (reference.fromUrl && !cancelled) clearReferenceParams("image");
      } catch (error) {
        toast.error(
          copy("Failed to load reference image", "参考图片加载失败"),
          {
            description:
              error instanceof Error
                ? error.message
                : copy("Could not load image.", "无法加载图片。"),
          }
        );
        if (appliedReferenceParamKeyRef.current === referenceKey) {
          appliedReferenceParamKeyRef.current = null;
        }
        if (reference.fromUrl && !cancelled) clearReferenceParams("image");
      }
    };

    void attachReference();

    return () => {
      cancelled = true;
    };
  }, [
    agentAllowed,
    chatAllowed,
    copy,
    maxChatImages,
    maxEditImages,
    pathname,
    router,
    searchParams,
    switchActiveMode,
    waterfallAllowed,
  ]);

  const [textModel, setTextModel] = useCreateRuntimeState(
    "textModel",
    "default"
  );
  const [editModel, setEditModel] = useCreateRuntimeState(
    "editModel",
    "default"
  );
  const [chatImageModel, setChatImageModel] = useCreateRuntimeState(
    "chatImageModel",
    "default"
  );
  const textModelOptions = useMemo(
    () =>
      filterImageModelOptionsForGroup(TEXT_MODEL_OPTIONS, selectedBackendGroup),
    [selectedBackendGroup]
  );
  const editModelOptions = useMemo(
    () =>
      filterImageModelOptionsForGroup(EDIT_MODEL_OPTIONS, selectedBackendGroup),
    [selectedBackendGroup]
  );
  const chatImageModelOptions = useMemo(
    () =>
      filterImageModelOptionsForGroup(
        CHAT_IMAGE_MODEL_OPTIONS,
        selectedBackendGroup,
        false
      ),
    [selectedBackendGroup]
  );
  useEffect(() => {
    const fallbackModel = textModelOptions[0]?.value;
    if (
      showImageModelControls &&
      fallbackModel &&
      !textModelOptions.some((option) => option.value === textModel)
    ) {
      setTextModel(fallbackModel);
    }
  }, [setTextModel, showImageModelControls, textModel, textModelOptions]);
  useEffect(() => {
    const fallbackModel = editModelOptions[0]?.value;
    if (
      showImageModelControls &&
      fallbackModel &&
      !editModelOptions.some((option) => option.value === editModel)
    ) {
      setEditModel(fallbackModel);
    }
  }, [editModel, editModelOptions, setEditModel, showImageModelControls]);
  useEffect(() => {
    const fallbackModel = chatImageModelOptions[0]?.value;
    if (
      showImageModelControls &&
      fallbackModel &&
      !chatImageModelOptions.some((option) => option.value === chatImageModel)
    ) {
      setChatImageModel(fallbackModel);
    }
  }, [
    chatImageModel,
    chatImageModelOptions,
    setChatImageModel,
    showImageModelControls,
  ]);
  const [useEditFirstImageSize, setUseEditFirstImageSize] =
    useCreateRuntimeState("useEditFirstImageSize", true);
  const [useAutoEditSize, setUseAutoEditSize] = useCreateRuntimeState(
    "useAutoEditSize",
    false
  );
  const [useAutoChatEditSize, setUseAutoChatEditSize] = useCreateRuntimeState(
    "useAutoChatEditSize",
    false
  );
  const [editWidth, setEditWidth] = useCreateRuntimeState(
    "editWidth",
    defaultDimensions.width
  );
  const [editHeight, setEditHeight] = useCreateRuntimeState(
    "editHeight",
    defaultDimensions.height
  );
  const [chatEditWidth, setChatEditWidth] = useCreateRuntimeState(
    "chatEditWidth",
    defaultDimensions.width
  );
  const [chatEditHeight, setChatEditHeight] = useCreateRuntimeState(
    "chatEditHeight",
    defaultDimensions.height
  );
  const [editImages, setEditImages] = useCreateRuntimeState<EditImageFile[]>(
    "editImages",
    []
  );
  const [maskFile, setMaskFile] = useCreateRuntimeState<EditImageFile | null>(
    "maskFile",
    null
  );
  const [maskEditorOpen, setMaskEditorOpen] = useCreateRuntimeState(
    "maskEditorOpen",
    false
  );
  const [maskSourceIndex, setMaskSourceIndex] = useCreateRuntimeState(
    "maskSourceIndex",
    0
  );
  const [maskPoints, setMaskPoints] = useCreateRuntimeState<MaskPoint[]>(
    "maskPoints",
    []
  );
  const [maskBrushSize, setMaskBrushSize] = useCreateRuntimeState(
    "maskBrushSize",
    32
  );
  const [firstImageSize, setFirstImageSize] = useCreateRuntimeState<{
    width: number;
    height: number;
  } | null>("firstImageSize", null);
  const [maskSourceImageSize, setMaskSourceImageSize] = useCreateRuntimeState<{
    width: number;
    height: number;
  } | null>("maskSourceImageSize", null);
  const [isEditing, setIsEditing] = useCreateRuntimeState("isEditing", false);
  const [isTextSingleGenerating, setIsTextSingleGenerating] =
    useCreateRuntimeState("isTextSingleGenerating", false);
  const [isTextLinesGenerating, setIsTextLinesGenerating] =
    useCreateRuntimeState("isTextLinesGenerating", false);
  const [, setStreamingPreviewUrl] = useCreateRuntimeState<string | null>(
    "streamingPreviewUrl",
    null
  );
  const [visualPreviewUrls, setVisualPreviewUrls] = useCreateRuntimeState<
    Partial<Record<VisualOutputMode, string | null>>
  >("visualPreviewUrls", {});
  const [visualLoading, setVisualLoading] = useCreateRuntimeState<
    Partial<Record<VisualOutputMode, { size: string } | null>>
  >("visualLoading", {});
  const [balance, setBalance] = useCreateRuntimeState(
    "balance",
    initialBalance
  );
  const [result, setResult] = useCreateRuntimeState<ResultState | null>(
    "result",
    null
  );
  const [visualResults, setVisualResults] = useCreateRuntimeState<
    Partial<Record<VisualOutputMode, ResultState | null>>
  >("visualResults", {});
  const [visualResultLists, setVisualResultLists] = useCreateRuntimeState<
    Partial<Record<VisualOutputMode, ResultState[]>>
  >("visualResultLists", {});
  const [recent, setRecent] = useCreateRuntimeState<ChatRecentGeneration[]>(
    "recent",
    initialRecent
  );
  const [selectedRecentId, setSelectedRecentId] = useCreateRuntimeState<
    string | null
  >("selectedRecentId", null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const batchImageInputRef = useRef<HTMLInputElement | null>(null);
  const editPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatConversationsRef = useCreateRuntimeRef<ChatConversation[]>(
    "chatConversationsRef",
    []
  );
  const didLoadChatRef = useCreateRuntimeRef("didLoadChatRef", false);
  const chatMessagesConversationIdRef = useCreateRuntimeRef<string | null>(
    "chatMessagesConversationIdRef",
    null
  );
  const chatMessagesModeRef = useCreateRuntimeRef<ConversationMode | null>(
    "chatMessagesModeRef",
    null
  );
  const isCreatePageMountedRef = useRef(false);
  const appliedReferenceParamKeyRef = useRef<string | null>(null);
  const activeChatRequestGenerationIdsRef = useCreateRuntimeRef<Set<string>>(
    "activeChatRequestGenerationIdsRef",
    () => new Set()
  );
  const batchLoadTriggerRef = useRef<HTMLDivElement | null>(null);
  const batchScrollRef = useRef<HTMLDivElement | null>(null);
  const batchActiveRequestsRef = useCreateRuntimeRef(
    "batchActiveRequestsRef",
    0
  );
  const batchPromptRef = useCreateRuntimeRef("batchPromptRef", "");
  const batchSizeRef = useCreateRuntimeRef("batchSizeRef", DEFAULT_IMAGE_SIZE);
  const batchLoadingMoreRef = useCreateRuntimeRef("batchLoadingMoreRef", false);
  const batchStoppedRef = useCreateRuntimeRef("batchStoppedRef", false);
  const batchAbortControllersRef = useCreateRuntimeRef<
    Map<string, AbortController>
  >("batchAbortControllersRef", () => new Map());
  // 里程碑警告期间阻塞自动续批；用户确认后解除并恢复生成
  const warningBlockRef = useCreateRuntimeRef(
    "waterfallWarningBlockRef",
    false
  );
  // 本会话累计“已发起”的瀑布流张数，用于跨越里程碑阈值判断
  const sessionCountRef = useCreateRuntimeRef("waterfallSessionCountRef", 0);
  // 已展示过的里程碑阈值集合，避免同一阈值重复弹窗
  const milestoneShownRef = useCreateRuntimeRef<Set<number>>(
    "waterfallMilestoneShownRef",
    () => new Set<number>()
  );
  // 跟踪最新的单批最大并发(供 IntersectionObserver 闭包读取最新值，避免依赖数组过期)
  const waterfallMaxConcurrentRef = useCreateRuntimeRef(
    "waterfallMaxConcurrentRef",
    waterfallMaxConcurrent
  );
  waterfallMaxConcurrentRef.current = waterfallMaxConcurrent;
  const triggerBatchGenerationRef = useRef<
    ((options?: { retryCardId?: string }) => Promise<void>) | null
  >(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastMaskPointRef = useRef<{ x: number; y: number } | null>(null);
  const chatImageAttachmentCount = chatAttachments.filter(
    (item) => item.kind === "image"
  ).length;

  useEffect(() => {
    isCreatePageMountedRef.current = true;
    return () => {
      isCreatePageMountedRef.current = false;
    };
  }, []);
  // 首次进入瀑布流模式且从未看过提示时，弹出 first-time 额度消耗警告。
  // 用 activeMode 作触发条件(瀑布流是 Tab 之一而非独立页面)，避免打扰其它模式用户。
  // 已弹窗(waterfallWarning 非空)或已看过(localStorage)时早退，不会重复弹。
  useEffect(() => {
    if (activeMode !== "waterfall") {
      return;
    }
    if (waterfallWarning) {
      return;
    }
    if (hasSeenWaterfallFirstTimeWarning()) {
      return;
    }
    setWaterfallWarning({
      type: "first-time",
      tier: effectiveWaterfallTier,
      count: 0,
    });
  }, [
    activeMode,
    effectiveWaterfallTier,
    setWaterfallWarning,
    waterfallWarning,
  ]);
  const hasChatImageAttachments = chatImageAttachmentCount > 0;
  const textSizeDialogValue = useMemo<AspectRatioSizeDialogValue>(
    () => ({
      auto: useAutoSize,
      width,
      height,
      mixWebFirst: textMixWebFirst,
    }),
    [height, textMixWebFirst, useAutoSize, width]
  );
  const chatSizeDialogValue = useMemo<AspectRatioSizeDialogValue>(
    () =>
      hasChatImageAttachments
        ? {
            auto: useAutoChatEditSize,
            width: chatEditWidth,
            height: chatEditHeight,
            mixWebFirst: chatMixWebFirst,
          }
        : {
            auto: useAutoSize,
            width,
            height,
            mixWebFirst: chatMixWebFirst,
          },
    [
      chatEditHeight,
      chatEditWidth,
      chatMixWebFirst,
      hasChatImageAttachments,
      height,
      useAutoChatEditSize,
      useAutoSize,
      width,
    ]
  );
  const handleConversationSizeChange = (next: AspectRatioSizeDialogValue) => {
    setChatMixWebFirst(next.mixWebFirst);
    if (hasChatImageAttachments) {
      setUseAutoChatEditSize(next.auto);
      if (!next.auto) {
        setChatEditWidth(next.width);
        setChatEditHeight(next.height);
      }
      return;
    }
    setUseAutoSize(next.auto);
    if (!next.auto) {
      setWidth(next.width);
      setHeight(next.height);
    }
  };

  const effectiveContentSafetyEnabled =
    moderationEnabled &&
    capabilities.features["moderation.blocking"] &&
    selectedBackendGroup?.contentSafetyEnabled !== false;
  const moderationCostOptions = useMemo(
    () => ({
      textModerationCount: effectiveContentSafetyEnabled ? undefined : 0,
    }),
    [effectiveContentSafetyEnabled]
  );
  const getModerationCostOptions = (imageCount: number) => ({
    ...moderationCostOptions,
    imageModerationCount: effectiveContentSafetyEnabled ? imageCount : 0,
  });
  const manualSize = useMemo(
    () => normalizeImageSize(width, height),
    [width, height]
  );
  const size = useAutoSize ? AUTO_IMAGE_SIZE : manualSize;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 计费函数闭包已显式用下方依赖驱动,避免提前移动运行期状态声明。
  const textImageCreditCost = useMemo(
    () =>
      applyBillingMultiplier(
        getPricedImageCreditCost(size, moderationCostOptions)
      ),
    [
      activeBillingMultiplier,
      imageBasePricing,
      moderationCostOptions,
      quality,
      size,
    ]
  );
  const textBatchCreditCost = textImageCreditCost * batchCount;
  const linePromptItems = useMemo(
    () =>
      linePrompts
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    [linePrompts]
  );
  const lineBatchTotalCount = linePromptItems.length * lineBatchRepeatCount;
  const lineBatchCreditCost = textImageCreditCost * lineBatchTotalCount;
  const manualEditSize = useMemo(
    () => normalizeImageSize(editWidth, editHeight),
    [editWidth, editHeight]
  );
  const customEditSize = useAutoEditSize ? AUTO_IMAGE_SIZE : manualEditSize;
  const manualChatCustomEditSize = useMemo(
    () => normalizeImageSize(chatEditWidth, chatEditHeight),
    [chatEditWidth, chatEditHeight]
  );
  const chatCustomEditSize = useAutoChatEditSize
    ? AUTO_IMAGE_SIZE
    : manualChatCustomEditSize;
  const canUseMixWebFirstRouting =
    activeBackendType === "mixed" && !customApiActive;
  const firstImageOriginalSize = useMemo(
    () =>
      firstImageSize
        ? normalizeImageSize(firstImageSize.width, firstImageSize.height)
        : null,
    [firstImageSize]
  );
  const firstImageOutputSize = useMemo(
    () => (firstImageSize ? normalizeValidImageSize(firstImageSize) : null),
    [firstImageSize]
  );
  const chatFirstImageOriginalSize = useMemo(
    () =>
      chatFirstImageSize
        ? normalizeImageSize(
            chatFirstImageSize.width,
            chatFirstImageSize.height
          )
        : null,
    [chatFirstImageSize]
  );
  const effectiveEditSize = useMemo(() => {
    if (useEditFirstImageSize) {
      return firstImageOutputSize;
    }
    return customEditSize;
  }, [customEditSize, firstImageOutputSize, useEditFirstImageSize]);
  const editResolutionControlValue = useMemo<AspectRatioSizeDialogValue>(() => {
    const dimensions =
      effectiveEditSize && effectiveEditSize !== AUTO_IMAGE_SIZE
        ? parseImageSize(effectiveEditSize)
        : null;
    return {
      auto: effectiveEditSize === AUTO_IMAGE_SIZE,
      width: dimensions?.width || editWidth,
      height: dimensions?.height || editHeight,
      mixWebFirst: editMixWebFirst,
    };
  }, [editHeight, editMixWebFirst, editWidth, effectiveEditSize]);
  const editImageCreditCost = effectiveEditSize
    ? applyBillingMultiplier(
        getPricedImageCreditCost(
          effectiveEditSize,
          getModerationCostOptions(editImages.length)
        )
      )
    : applyBillingMultiplier(
        getPricedImageCreditCost(undefined, moderationCostOptions)
      );
  const editBatchCreditCost = editImageCreditCost * editBatchCount;
  const chatRoundCreditCost = applyBillingMultiplier(
    capabilities.billing.chatRoundCredits
  );
  const agentRoundCreditCost = applyBillingMultiplier(
    capabilities.billing.agentRoundCredits
  );
  const chatSingleCreditCost =
    activeMode === "agent" ? agentRoundCreditCost : chatRoundCreditCost;
  const batchFallbackSize = hasChatImageAttachments ? chatCustomEditSize : size;
  const textMixWebFirstActive =
    canUseMixWebFirstRouting &&
    textMixWebFirst &&
    isWithinForceWebPixelRange(size, forceWebPixelRange);
  const editMixWebFirstActive =
    canUseMixWebFirstRouting &&
    editMixWebFirst &&
    Boolean(effectiveEditSize) &&
    isWithinForceWebPixelRange(effectiveEditSize, forceWebPixelRange);
  // 选 Firefly 模型时,输出格式等 Codex/Responses 专属参数对 Adobe 路径无效。
  const textFireflyActive = isFireflyModel(textModel);
  const editFireflyActive = isFireflyModel(editModel);
  const chatMixWebFirstActive =
    canUseMixWebFirstRouting &&
    chatMixWebFirst &&
    isWithinForceWebPixelRange(
      hasChatImageAttachments ? chatCustomEditSize : size,
      forceWebPixelRange
    );
  const agentBackendUnavailableReason = isWebOnlyBackend
    ? copy(
        "Agent mode is unavailable for the current backend group.",
        "当前后端分组暂不支持 Agent 模式。"
      )
    : undefined;
  const effectiveAgentAllowed = agentAllowed && !agentBackendUnavailableReason;
  /**
   * 判断创作模式是否可访问。
   *
   * @param mode 待切换的创作模式。
   * @returns 当前套餐与后端配置是否允许使用该模式。
   */
  const isActiveModeAllowed = useCallback(
    (mode: ActiveMode) =>
      mode === "agent"
        ? effectiveAgentAllowed
        : mode === "waterfall"
          ? waterfallAllowed
          : mode === "chat" || mode === "chat-web"
            ? chatAllowed
            : mode === "image"
              ? imageAllowed
              : mode === "video"
                ? videoAllowed
                : textAllowed,
    [
      chatAllowed,
      effectiveAgentAllowed,
      imageAllowed,
      textAllowed,
      videoAllowed,
      waterfallAllowed,
    ]
  );
  const fallbackMode = useMemo<ActiveMode | null>(
    () =>
      (
        [
          "text",
          "image",
          "chat",
          "chat-web",
          "agent",
          "waterfall",
          "video",
        ] as const
      ).find((mode) => isActiveModeAllowed(mode)) ?? null,
    [isActiveModeAllowed]
  );
  // 高级参数是否可配置只跟当前选中分组的后端类型绑定：
  // web 分组不展示 Codex/Responses 专属参数；mixed/responses 分组允许用户预先配置，
  // 即使 mixed 当前可能先尝试 Web，这些参数也会在需要时生效。
  const disableResponsesOnlyControls = isWebOnlyBackend;
  const batchSingleCreditCost = applyBillingMultiplier(
    getPricedImageCreditCost(
      batchFallbackSize,
      getModerationCostOptions(chatImageAttachmentCount)
    )
  );

  useEffect(() => {
    const requestedMode = parseCreateModeParam(searchParams.get("mode"));

    if (requestedMode && !isActiveModeAllowed(requestedMode)) {
      toast.error(
        copy(
          "This mode is not enabled for your plan or has been disabled by the operator.",
          "当前套餐未开启该模式，或运营端已关闭该模式。"
        )
      );
      if (fallbackMode) {
        switchActiveMode(
          isActiveModeAllowed(activeMode) ? activeMode : fallbackMode
        );
      }
      return;
    }

    if (!isActiveModeAllowed(activeMode)) {
      if (fallbackMode) {
        switchActiveMode(fallbackMode);
      }
      return;
    }

    if (!requestedMode) {
      switchActiveMode(activeMode);
      return;
    }
    if (requestedMode === activeMode) return;

    switchActiveMode(requestedMode);
  }, [
    activeMode,
    copy,
    fallbackMode,
    isActiveModeAllowed,
    searchParams,
    switchActiveMode,
  ]);
  const formattedBalance = formatCredits(balance);
  const formattedTextBatchCreditCost = formatCredits(textBatchCreditCost);
  const formattedLineBatchCreditCost = formatCredits(lineBatchCreditCost);
  const formattedEditBatchCreditCost = formatCredits(editBatchCreditCost);
  const formattedChatSingleCreditCost = formatCredits(chatSingleCreditCost);
  const formattedBatchSingleCreditCost = formatCredits(batchSingleCreditCost);
  const formattedWaterfallCreditsConsumed = formatCredits(
    waterfallCreditsConsumed
  );
  const waterfallInFlight = Math.max(
    0,
    waterfallStats.sent - waterfallStats.success - waterfallStats.failed
  );
  const waterfallStatusText = copy(
    `Sent ${waterfallStats.sent} · Success ${waterfallStats.success} · Failed ${waterfallStats.failed} · Running ${waterfallInFlight}`,
    `已发送 ${waterfallStats.sent} · 成功 ${waterfallStats.success} · 失败 ${waterfallStats.failed} · 进行中 ${waterfallInFlight}`
  );
  const activeConversationMode = getConversationMode(activeMode);
  const currentModeConversations = useMemo(
    () =>
      chatConversations.filter(
        (conversation) => conversation.mode === activeConversationMode
      ),
    [activeConversationMode, chatConversations]
  );
  const activeConversationExists = useMemo(
    () =>
      currentModeConversations.some(
        (conversation) => conversation.id === chatConversationId
      ),
    [chatConversationId, currentModeConversations]
  );
  const visibleChatMessages = chatMessages.filter((message) =>
    isMessageInConversationMode(message, activeConversationMode)
  );
  const canUseEditReferenceMentions =
    activeBackendType === "responses" || activeBackendType === "mixed";
  const canUseChatReferenceMentions =
    (activeBackendType === "responses" || activeBackendType === "mixed") &&
    activeMode !== "waterfall";
  const editHasImageReference = hasPromptImageReference(editPrompt);
  const chatHasImageReference = hasPromptImageReference(chatPrompt);
  const editReferenceOptions = useMemo<ImageReferenceMentionOption[]>(
    () =>
      editImages.map((item, index) => ({
        token: `@图${index + 1}`,
        label: copy(`Source image ${index + 1}`, `源图片 ${index + 1}`),
        detail: item.file.name || copy("Uploaded image", "已上传图片"),
        previewUrl: item.previewUrl,
      })),
    [copy, editImages]
  );
  const chatReferenceOptions = useMemo<ImageReferenceMentionOption[]>(() => {
    const options: ImageReferenceMentionOption[] = chatAttachments
      .filter((item) => item.kind === "image")
      .map((item, index) => ({
        token: `@图${index + 1}`,
        label: copy(`Current attachment ${index + 1}`, `当前附件 ${index + 1}`),
        detail: item.file.name || copy("Uploaded image", "已上传图片"),
        previewUrl: item.previewUrl,
      }));
    let roundIndex = 0;
    for (const message of visibleChatMessages) {
      if (message.role !== "assistant" || message.error) continue;
      const imageVariants = getChatVariants(message).filter(
        (variant) => variant.imageUrl || variant.imageFileId
      );
      if (!imageVariants.length) continue;
      roundIndex += 1;
      imageVariants.forEach((variant, imageIndex) => {
        options.push({
          token: `@第${roundIndex}轮图${imageIndex + 1}`,
          label: copy(
            `Round ${roundIndex} image ${imageIndex + 1}`,
            `第 ${roundIndex} 轮图 ${imageIndex + 1}`
          ),
          detail:
            variant.prompt || variant.size || copy("History image", "历史图片"),
          previewUrl: variant.imageUrl,
        });
      });
    }
    return options;
  }, [chatAttachments, copy, visibleChatMessages]);
  const filteredEditReferenceOptions = filterMentionOptions(
    editReferenceOptions,
    editMention?.query || ""
  );
  const filteredChatReferenceOptions = filterMentionOptions(
    chatReferenceOptions,
    chatMention?.query || ""
  );
  const editReferenceMentionStatusText = !canUseEditReferenceMentions
    ? copy(
        "Exact @ image references are available only with Codex/Responses or Mixed backend groups. Web-only routes do not expose this exact reference mechanism.",
        "精确 @ 图片引用仅支持 Codex/Responses 或 Mixed 后端分组；纯 Web 路线暂不提供这种精确引用机制。"
      )
    : editHasImageReference
      ? copy(
          "This request contains @ references and has exact source images selected.",
          "本次请求包含 @ 引用，已明确指定源图片。"
        )
      : copy(
          "Type @ to choose a source image. The selected image will be attached as real input.",
          "输入 @ 可选择源图片。选中的图片会作为真实图片输入。"
        );
  const chatReferenceMentionStatusText = !canUseChatReferenceMentions
    ? copy(
        "Exact @ image references are hidden while Web-only routing is active. Switch to Codex/Responses or Mixed to reference a specific image.",
        "当前纯 Web 路线下隐藏精确 @ 图片引用。切换到 Codex/Responses 或 Mixed 后，可明确引用指定图片。"
      )
    : chatHasImageReference
      ? copy(
          "This message contains @ references. Agent normally carries image context, but @ pins the exact attachment or draft.",
          "本条消息包含 @ 引用。Agent 通常会带图片上下文，但 @ 会明确钉住指定附件或草稿。"
        )
      : copy(
          "Type @ to choose current attachments or generated history images. Agent already carries image context, but @ is useful when you need one exact draft or round.",
          "输入 @ 可选择当前附件或历史生成图。Agent 默认会带图片上下文，但 @ 适合在多图、多轮草稿中明确指定某一张。"
        );
  const customApiBillingLabel = copy(
    "Custom API active, no site credits",
    "自填 API 已启用，不消耗本站积分"
  );
  const sizeCheck = useMemo(() => validateImageSize(size), [size]);
  const customEditSizeCheck = useMemo(
    () => validateImageSize(customEditSize),
    [customEditSize]
  );
  const chatCustomEditSizeCheck = useMemo(
    () => validateImageSize(chatCustomEditSize),
    [chatCustomEditSize]
  );
  const visualModeBusy = (mode: VisualOutputMode) =>
    mode === "image"
      ? isEditing
      : mode === "text-single"
        ? isTextSingleGenerating
        : isTextLinesGenerating;
  const hasActiveRuntimeTask =
    isEditing ||
    isTextSingleGenerating ||
    isTextLinesGenerating ||
    isChatGenerating ||
    isBatchActive;
  const setVisualModeLoading = (
    mode: VisualOutputMode,
    value: { size: string } | null
  ) => {
    setVisualLoading((prev) => ({ ...prev, [mode]: value }));
  };
  useEffect(() => {
    if (hasActiveRuntimeTask) return;
    setBalance(initialBalance);
    setRecent(initialRecent);
  }, [
    hasActiveRuntimeTask,
    initialBalance,
    initialRecent,
    setBalance,
    setRecent,
  ]);
  useEffect(() => {
    if (activeMode !== "agent" || effectiveAgentAllowed) return;
    switchActiveMode("chat");
    toast.error(copy("Agent is unavailable", "Agent 当前不可用"), {
      description: agentBackendUnavailableReason,
    });
  }, [
    activeMode,
    agentBackendUnavailableReason,
    copy,
    effectiveAgentAllowed,
    switchActiveMode,
  ]);
  const firstPreviewUrl = editImages[0]?.previewUrl || null;
  const maskSourceImage = editImages[maskSourceIndex] || editImages[0] || null;
  const maskSourcePreviewUrl = maskSourceImage?.previewUrl || null;
  const maskSourceDisplayIndex = maskSourceImage
    ? Math.max(
        0,
        editImages.findIndex((item) => item.previewUrl === maskSourcePreviewUrl)
      )
    : 0;
  const chatFirstPreviewUrl =
    chatAttachments.find((item) => item.kind === "image")?.previewUrl || null;
  const autoSizeLabel = copy("Auto", "自动");
  const editDisplaySize =
    effectiveEditSize === AUTO_IMAGE_SIZE
      ? autoSizeLabel
      : effectiveEditSize || copy("Reference image", "参考图片");
  const editReferenceSizeNote =
    useEditFirstImageSize && firstImageOriginalSize && effectiveEditSize
      ? firstImageOriginalSize === effectiveEditSize
        ? copy(
            `Reference image: ${firstImageOriginalSize}`,
            `参考图：${firstImageOriginalSize}`
          )
        : copy(
            `Reference image: ${firstImageOriginalSize}; output adjusted to ${effectiveEditSize}.`,
            `参考图：${firstImageOriginalSize}；输出已贴近为 ${effectiveEditSize}。`
          )
      : null;
  const isVisualModeLoading = (mode: VisualOutputMode) =>
    Boolean(visualLoading[mode]) && visualModeBusy(mode);
  const getVisualLoadingDimensions = (mode: VisualOutputMode) => {
    const fallbackSize =
      mode === "image" ? effectiveEditSize || customEditSize : size;
    return (
      parseImageSize(visualLoading[mode]?.size || fallbackSize) ||
      defaultDimensions
    );
  };
  const chatSuggestions = isZh ? CHAT_SUGGESTIONS_ZH : CHAT_SUGGESTIONS;
  const promptOptimizationField = (id: string, disabled = false) => (
    <label
      htmlFor={id}
      className={`flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm ${
        promptOptimizationAllowed
          ? "cursor-pointer text-foreground"
          : "cursor-not-allowed text-muted-foreground"
      }`}
    >
      <Checkbox
        id={id}
        checked={promptOptimizationAllowed ? promptOptimization : true}
        onCheckedChange={(checked) => setPromptOptimization(checked === true)}
        disabled={disabled || !promptOptimizationAllowed}
        className="mt-0.5"
      />
      <span>
        {labelWithHelp(
          copy("Prompt optimization", "提示词优化"),
          promptOptimizationHelpText
        )}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {promptOptimizationAllowed
            ? copy(
                "Turn this off to minimize prompt changes. Some backends may still interpret or revise the prompt internally.",
                "关闭后将尽量减少对提示词的改动，但部分后端仍可能在内部理解或优化提示词。"
              )
            : copy(
                "Pro plan or higher can reduce prompt changes.",
                "专业版或更高套餐可尽量减少提示词改动。"
              )}
        </span>
      </span>
    </label>
  );

  const renderImageModelSelect = (params: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    compact?: boolean;
  }) => (
    <Select
      value={params.value}
      onValueChange={params.onChange}
      disabled={params.disabled}
    >
      <SelectTrigger
        id={params.id}
        className={params.compact ? "h-8 w-[146px]" : "w-full"}
        title={imageModelHelpText}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {chatImageModelOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {chatImageModelLabel(option.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderBackgroundSelect = (params: {
    id: string;
    disabled?: boolean;
    compact?: boolean;
  }) => (
    <Select
      value={background}
      onValueChange={(value) => setBackground(value as ImageBackground)}
      disabled={params.disabled}
    >
      <SelectTrigger
        id={params.id}
        className={params.compact ? "h-8 w-[126px]" : "w-full"}
        title={backgroundHelpText}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BACKGROUND_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {params.compact
              ? `${copy("BG", "背景")} ${backgroundLabel(option.value)}`
              : backgroundLabel(option.value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // 透明抠图回退开关:仅当背景选为 transparent 时出现。开启后会经服务端 ISNet 抠图链路
  // (issue #27)。agent 模式不调用此处(不渲染)。
  const renderTransparentMatteToggle = (params: {
    id: string;
    disabled?: boolean;
  }) => {
    if (background !== "transparent") return null;
    return (
      <label
        htmlFor={params.id}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          transparentMatte
            ? "border-primary bg-primary/10 text-primary"
            : "border-primary/40 bg-primary/5 text-foreground"
        }`}
        title={copy(
          "Transparent matte fallback: if the backend does not support transparent output, regenerate opaque then matte it server-side (ISNet) to deliver a transparent PNG. When off, transparent is passed through and an unsupported backend returns a real error.",
          "透明抠图回退:若后端不支持透明输出,则不透明重生成后用服务端 ISNet 抠图得到透明 PNG。关闭时透明直接透传,后端不支持即返回真实错误。"
        )}
      >
        <Checkbox
          id={params.id}
          checked={transparentMatte}
          onCheckedChange={(checked) => setTransparentMatte(checked === true)}
          disabled={params.disabled}
        />
        {copy("Matte fallback", "透明抠图回退")}
      </label>
    );
  };

  /**
   * 渲染文生图/图生图共用的高级参数面板。
   *
   * @param params 高级参数面板的控件 id 与禁用态。
   * @returns 可折叠高级参数面板。
   * @sideEffects 用户修改表单控件时更新创作页运行时状态。
   * @failureMode Web-only 后端下隐藏 Responses-only 控件，仅保留提示词优化。
   */
  const renderAdvancedImageSettings = (params: {
    idPrefix: string;
    promptDisabled: boolean;
    repairDisabled: boolean;
    hideResponseControls: boolean;
    responseControlsDisabledReason?: string;
    qualityDisabled: boolean;
    outputDisabled: boolean;
    backgroundDisabled: boolean;
  }) => (
    <CreatePageAdvancedImageSettings
      {...params}
      copy={copy}
      labelWithHelp={labelWithHelp}
      renderPromptOptimization={promptOptimizationField}
      renderHdRepair={renderHdRepairToggle}
      renderBlockRepair={renderBlockRepairToggle}
      renderBackgroundSelect={renderBackgroundSelect}
      renderTransparentMatte={renderTransparentMatteToggle}
      quality={quality}
      outputFormat={outputFormat}
      outputCompression={outputCompression}
      backgroundHelpText={backgroundHelpText}
      outputFormatHelpText={outputFormatHelpText}
      outputCompressionHelpText={outputCompressionHelpText}
      qualityLabel={qualityLabel}
      outputFormatLabel={outputFormatLabel}
      onQualityChange={setQuality}
      onOutputFormatChange={setOutputFormat}
      onOutputCompressionChange={setOutputCompression}
    />
  );

  // 后端分组选择器:默认跟随设置页偏好,切换仅影响本页后续请求(requestGroupId 随请求
  // 发送,服务端 fail-closed 校验)。只要存在可用分组就展示,便于用户确认模型列表来源。
  // 展示各分组计费倍率,选中非 1 倍率分组时提示价差。
  // compact 形态用于 chat/瀑布流工具条。
  const renderBackendGroupSelect = (params: {
    id: string;
    disabled?: boolean;
    compact?: boolean;
  }) => {
    if (backendGroups.length < 1) return null;
    const groupItemLabel = (group: BackendGroupOption) =>
      `${group.name}${group.isDefault ? copy(" (default)", "（默认）") : ""} · x${
        Number(group.billingMultiplier.toFixed(4)) || 1
      }`;
    const helpText = copy(
      "Overrides the backend group for requests from this page only. Billing follows the selected group's multiplier. Use settings to change the default.",
      "仅覆盖本页请求使用的后端分组,计费按所选分组倍率结算;默认分组请在设置页修改。"
    );
    const singleGroup = backendGroups.length === 1;
    const select = (
      <Select
        value={requestGroupChoice}
        onValueChange={setRequestGroupChoice}
        disabled={params.disabled}
      >
        <SelectTrigger
          id={params.id}
          className={params.compact ? "h-8 w-auto gap-1" : "w-full"}
          title={helpText}
        >
          {params.compact && (
            <span className="text-xs text-muted-foreground">
              {copy("Group", "分组")}
            </span>
          )}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {singleGroup && preferenceBackendGroup
              ? groupItemLabel(preferenceBackendGroup)
              : preferenceBackendGroup
                ? copy(
                    `Preferred · ${groupItemLabel(preferenceBackendGroup)}`,
                    `跟随偏好 · ${groupItemLabel(preferenceBackendGroup)}`
                  )
                : copy("Preferred group", "跟随偏好分组")}
          </SelectItem>
          {!singleGroup &&
            backendGroups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {groupItemLabel(group)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    );
    if (params.compact) return select;
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={params.id}
          className="text-xs font-medium text-muted-foreground"
        >
          {labelWithHelp(copy("Backend group", "后端分组"), helpText)}
        </label>
        {select}
        {activeBillingMultiplier !== 1 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {copy(
              `Credits are billed at x${activeBillingMultiplier} in this group.`,
              `当前分组按 x${activeBillingMultiplier} 倍率扣费。`
            )}
          </p>
        )}
      </div>
    );
  };

  // 高清修复开关:总是可见。开启用 SwinIR 复原(文字/结构最佳,较慢),关闭用 general-x4v3(快)。
  // 仅在管理端超分主开关开、且上游图较长边不足目标 2/3 触发超分时才实际生效。
  const renderHdRepairToggle = (params: { id: string; disabled?: boolean }) => (
    <label
      htmlFor={params.id}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
        hdRepair
          ? "border-primary bg-primary/10 text-primary"
          : "border-primary/40 bg-primary/5 text-foreground"
      }`}
      title={copy(
        "HD repair (SCUNet): off by default. When on, the final image is restored with SCUNet (denoise / de-blocking / detail enhancement, no size change) — independent of upscaling. It is CPU-heavy (about 11s at 512, 35s at 1024) and runs one-at-a-time server-side, so results take longer. Enable only when you want a cleaner, restored result. Requires the server-side restoration switch to be on.",
        "高清修复(SCUNet):默认关闭。勾选后,最终图会用 SCUNet 做盲复原(去噪/去压缩块/增强质感,不改分辨率),与放大(超分)相互独立。CPU 推理较重(512 约 11 秒、1024 约 35 秒)、服务端串行排队,出图会更慢。想要更干净、修复过的结果时再开。需管理端开启「高清修复」主开关。"
      )}
    >
      <Checkbox
        id={params.id}
        checked={hdRepair}
        onCheckedChange={(checked) => setHdRepair(checked === true)}
        disabled={params.disabled}
      />
      {copy("HD repair", "高清修复")}
    </label>
  );

  // 分块修复开关 + 每块提示词输入。开关总是可见(与后端无关);勾选后展开提示词输入。
  const renderBlockRepairToggle = (params: {
    id: string;
    disabled?: boolean;
  }) => (
    <>
      <label
        htmlFor={params.id}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          blockRepair
            ? "border-primary bg-primary/10 text-primary"
            : "border-primary/40 bg-primary/5 text-foreground"
        }`}
        title={copy(
          "Generative repair (gpt-image-2): off by default. When on, the final image is shrunk to the web sweet-spot resolution (~1280) and redrawn once with gpt-image-2 img2img (fixing text/detail while keeping composition and content unchanged), then upscaled to the target. Whole-image redraw means no seams. One extra backend call, billed separately; slower and costlier. Requires the server-side generative-repair switch.",
          "生成式修复(gpt-image-2):默认关闭。勾选后,最终图缩到 web 甜点分辨率(约1280)、一次性用 gpt-image-2 img2img 整图重绘(修文字/细节、保持构图与内容不变),再超分到目标尺寸。整图一次重绘无接缝。额外调用一次后端、单独计费,更慢也更贵。需管理端开启「生成式修复」主开关。"
        )}
      >
        <Checkbox
          id={params.id}
          checked={blockRepair}
          onCheckedChange={(checked) => setBlockRepair(checked === true)}
          disabled={params.disabled}
        />
        {copy("Generative repair", "生成式修复")}
      </label>
      {blockRepair && (
        <input
          type="text"
          value={repairPrompt}
          onChange={(event) => setRepairPrompt(event.target.value)}
          disabled={params.disabled}
          placeholder={copy(
            "Repair prompt (optional, defaults to server setting)",
            "修复提示词(可选,留空用默认)"
          )}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
        />
      )}
    </>
  );

  const renderReferenceMentionMenu = (params: {
    open: boolean;
    options: ImageReferenceMentionOption[];
    onSelect: (option: ImageReferenceMentionOption) => void;
    emptyText: string;
  }) => {
    if (!params.open) return null;
    const visibleOptions = params.options.slice(0, 8);
    return (
      <div className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
        {visibleOptions.length > 0 ? (
          <div className="max-h-64 overflow-y-auto py-1">
            {visibleOptions.map((option) => (
              <button
                key={option.token}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  params.onSelect(option);
                }}
              >
                {option.previewUrl ? (
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded border bg-muted">
                    <Image
                      src={option.previewUrl}
                      alt={option.label}
                      fill
                      sizes="36px"
                      className="object-contain"
                      unoptimized={shouldBypassImageOptimization(
                        option.previewUrl
                      )}
                    />
                  </span>
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-muted text-xs font-medium text-muted-foreground">
                    @
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {option.token} · {option.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {params.emptyText}
          </div>
        )}
      </div>
    );
  };

  const handleEditPromptChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const next = event.target.value;
    setEditPrompt(next);
    setEditMention(
      canUseEditReferenceMentions
        ? getMentionTrigger(next, event.target.selectionStart ?? next.length)
        : null
    );
  };

  const handleChatPromptChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const next = event.target.value;
    setChatPrompt(next);
    setChatMention(
      canUseChatReferenceMentions
        ? getMentionTrigger(next, event.target.selectionStart ?? next.length)
        : null
    );
  };

  const selectEditMention = (option: ImageReferenceMentionOption) => {
    if (!editMention) return;
    const nextPrompt = insertMentionToken(
      editPrompt,
      editMention,
      option.token
    );
    const nextCursor = getCursorAfterInsertedMention(editMention, option.token);
    setEditPrompt(nextPrompt);
    setEditMention(null);
    requestAnimationFrame(() => {
      editPromptRef.current?.focus();
      editPromptRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const selectChatMention = (option: ImageReferenceMentionOption) => {
    if (!chatMention) return;
    const nextPrompt = insertMentionToken(
      chatPrompt,
      chatMention,
      option.token
    );
    const nextCursor = getCursorAfterInsertedMention(chatMention, option.token);
    setChatPrompt(nextPrompt);
    setChatMention(null);
    requestAnimationFrame(() => {
      chatPromptRef.current?.focus();
      chatPromptRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const clearStreamingPreview = () => {
    setStreamingPreviewUrl(null);
  };

  const activateChatConversation = (
    conversation: ChatConversation | null | undefined,
    fallbackMode: ConversationMode = activeConversationMode
  ) => {
    const nextId = conversation?.id || createLocalId();
    const nextMode = conversation?.mode || fallbackMode;
    chatMessagesConversationIdRef.current = nextId;
    chatMessagesModeRef.current = nextMode;
    setChatConversationId(nextId);
    setChatMessages(conversation?.messages || []);
    window.localStorage.setItem(
      chatActiveConversationStorageKey(nextMode),
      nextId
    );
  };

  const setVisualStreamingPreview = (
    mode: VisualOutputMode,
    imageUrl: string | null
  ) => {
    setVisualPreviewUrls((prev) => ({ ...prev, [mode]: imageUrl }));
  };

  const clearVisualStreamingPreview = (mode: VisualOutputMode) => {
    setVisualStreamingPreview(mode, null);
  };

  const resetChatConversation = () => {
    chatMessagesConversationIdRef.current = chatConversationId;
    chatMessagesModeRef.current = activeConversationMode;
    setChatMessages([]);
    setChatStream(null);
    setRetryingChatMessageId(null);
    clearStreamingPreview();
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
  };

  const handleNewChat = () => {
    if (isChatGenerating) return;
    resetChatConversation();
    const nextId = createLocalId();
    chatMessagesConversationIdRef.current = nextId;
    chatMessagesModeRef.current = activeConversationMode;
    setChatConversationId(nextId);
    window.localStorage.setItem(
      chatActiveConversationStorageKey(activeConversationMode),
      nextId
    );
    setChatPrompt("");
    clearChatAttachments();
    toast.success(copy("New chat started", "已新建对话"));
  };

  const handleClearChatHistory = () => {
    if (isChatGenerating) return;
    const nextConversations = chatConversations.filter(
      (conversation) => conversation.id !== chatConversationId
    );
    chatConversationsRef.current = nextConversations;
    setChatConversations(nextConversations);
    window.localStorage.setItem(
      CHAT_CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(nextConversations)
    );
    resetChatConversation();
    const nextId = createLocalId();
    chatMessagesConversationIdRef.current = nextId;
    chatMessagesModeRef.current = activeConversationMode;
    setChatConversationId(nextId);
    window.localStorage.setItem(
      chatActiveConversationStorageKey(activeConversationMode),
      nextId
    );
    setChatPrompt("");
    toast.success(copy("Chat history cleared", "对话记录已清理"));
  };

  const handleOpenChatConversation = (conversation: ChatConversation) => {
    if (isChatGenerating) return;
    activateChatConversation(conversation, conversation.mode);
    setChatStream(null);
    setRetryingChatMessageId(null);
    clearStreamingPreview();
    setChatPrompt("");
    clearChatAttachments();
    scrollChatToBottom();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时依赖运行期 ref 的当前值,补入 ref.current 会改变切换时机。
  useEffect(() => {
    try {
      window.localStorage.setItem(CREATE_ACTIVE_MODE_STORAGE_KEY, activeMode);
    } catch {
      /* ignore local storage quota errors */
    }

    if (!didLoadChatRef.current || !isConversationMode(activeMode)) return;
    if (isChatGenerating || chatStream?.generationId) return;
    if (
      activeConversationExists &&
      chatMessagesModeRef.current === activeConversationMode
    ) {
      return;
    }

    const storedId = window.localStorage.getItem(
      chatActiveConversationStorageKey(activeConversationMode)
    );
    const conversation = currentModeConversations.find(
      (item) => item.id === storedId
    );
    if (conversation) {
      activateChatConversation(conversation, activeConversationMode);
    } else if (storedId) {
      chatMessagesConversationIdRef.current = storedId;
      chatMessagesModeRef.current = activeConversationMode;
      setChatConversationId(storedId);
      setChatMessages([]);
    } else {
      const fallbackConversation = currentModeConversations[0];
      if (fallbackConversation) {
        activateChatConversation(fallbackConversation, activeConversationMode);
        setChatStream(null);
        setRetryingChatMessageId(null);
        clearStreamingPreview();
        return;
      }
      const nextId = createLocalId();
      chatMessagesConversationIdRef.current = nextId;
      chatMessagesModeRef.current = activeConversationMode;
      setChatConversationId(nextId);
      setChatMessages([]);
      window.localStorage.setItem(
        chatActiveConversationStorageKey(activeConversationMode),
        nextId
      );
    }
    setChatStream(null);
    setRetryingChatMessageId(null);
    clearStreamingPreview();
  }, [
    activeConversationExists,
    activeConversationMode,
    activeMode,
    chatStream?.generationId,
    currentModeConversations,
    isChatGenerating,
  ]);

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      const element = chatMessagesRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  };

  const readImageStreamResponse = async (
    response: Response,
    options?: { previewMode?: VisualOutputMode }
  ) => {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      return readImageApiJsonResponse(response);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { error: "API returned an empty stream" };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const completed: ImageApiResult[] = [];
    let failed: ImageApiResult | null = null;

    const processBlock = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data || data === "[DONE]") return;

      let event: ImageStreamEvent;
      try {
        event = JSON.parse(data) as ImageStreamEvent;
      } catch {
        return;
      }

      if (event.type === "partial_image") {
        const previewUrl = imageStreamEventToPreviewUrl(event);
        if (previewUrl) {
          if (options?.previewMode) {
            setVisualStreamingPreview(options.previewMode, previewUrl);
          } else {
            setStreamingPreviewUrl(previewUrl);
          }
        }
        return;
      }

      if (
        event.type === "text_delta" ||
        event.type === "thinking_delta" ||
        event.type === "agent_delta"
      ) {
        return;
      }

      if (event.type === "completed") {
        completed.push(event);
        return;
      }

      if (event.type === "error") {
        failed = event;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        processBlock(block);
      }
      if (done) break;
    }

    if (buffer.trim()) {
      processBlock(buffer);
    }

    if (completed.length === 1) {
      return completed[0] as ImageApiResult;
    }

    if (completed.length > 1) {
      return { results: completed };
    }

    if (failed) return failed;
    return { error: "API returned no image data" };
  };

  const runChatRequest = async ({
    prompt,
    attachments = [],
    fallbackSize,
    historyMessages,
    generationId,
    streamMessageId,
    streamCardId,
    agentMode,
    webChat = false,
    signal,
  }: {
    prompt: string;
    attachments?: ChatAttachment[];
    fallbackSize: string;
    historyMessages: ChatMessage[];
    generationId?: string;
    streamMessageId?: string;
    streamCardId?: string;
    agentMode: boolean;
    webChat?: boolean;
    signal?: AbortSignal;
  }) => {
    if (generationId) {
      activeChatRequestGenerationIdsRef.current.add(generationId);
    }
    const executeChatRequest = async (): Promise<ImageApiResult> => {
      const streamMode: ConversationMode | undefined =
        streamCardId && !streamMessageId
          ? undefined
          : agentMode
            ? "agent"
            : webChat
              ? "web"
              : "chat";
      const updateChatStream = (next: Omit<ChatStreamState, "mode">) => {
        if (streamCardId && !streamMessageId) return;
        setChatStream({ ...next, mode: streamMode });
      };
      const hasImageAttachment = attachments.some(
        (item) => item.kind === "image"
      );
      const requestSize = hasImageAttachment
        ? chatCustomEditSize
        : validateImageSize(fallbackSize).valid
          ? fallbackSize
          : size;
      const formData = new FormData();
      formData.append("prompt", prompt);
      if (generationId) formData.append("generation_id", generationId);
      if (requestGroupId) formData.append("groupId", requestGroupId);
      formData.append(
        "history",
        JSON.stringify(toChatHistory(historyMessages))
      );
      formData.append("quality", quality);
      formData.append("output_format", outputFormat);
      formData.append("background", background);
      // 透明抠图回退仅 chat/瀑布流可用,agent 不传(issue #27)。
      if (!agentMode && background === "transparent" && transparentMatte) {
        formData.append("transparent_matte", "true");
      }
      // 高清修复:关闭时显式传 false 走轻量 general-x4v3;默认(true)由后端选 SwinIR。
      formData.append("hd_repair", String(hdRepair));
      // 分块修复:开关 + 每块提示词(非空才传)。
      formData.append("block_repair", String(blockRepair));
      if (blockRepair && repairPrompt.trim()) {
        formData.append("repair_prompt", repairPrompt.trim());
      }
      if (outputFormat !== "png") {
        formData.append("output_compression", String(outputCompression));
      }
      formData.append("model", chatModel);
      if (showImageModelControls && chatImageModel !== "default") {
        formData.append("image_model", chatImageModel);
      }
      formData.append("size", requestSize);
      formData.append("count", "1");
      formData.append("stream", "true");
      formData.append(
        "conversation_mode",
        agentMode ? "agent" : streamCardId ? "waterfall" : "chat"
      );
      formData.append("agent_mode", String(agentMode));
      if (webChat) {
        formData.append("web_chat", "true");
        formData.append("mix_web_first", "true");
      }
      if (agentMode) {
        formData.append("agent_max_rounds", String(agentMaxRounds));
        formData.append("agent_force_max_rounds", String(agentForceRounds));
        formData.append("layered_generation", String(layeredGeneration));
      }
      formData.append("waterfall_mode", String(Boolean(streamCardId)));
      if (promptOptimizationAllowed) {
        formData.append("prompt_optimization", String(promptOptimization));
      }
      if (agentMode || (!webChat && hasPromptImageReference(prompt))) {
        formData.append("requires_responses_backend", "true");
      } else if (!webChat && chatMixWebFirstActive) {
        formData.append("mix_web_first", "true");
      }
      const imageAttachments = attachments.filter(
        (item) => item.kind === "image"
      );
      const fileAttachments = attachments.filter(
        (item) => item.kind === "file"
      );
      imageAttachments.forEach(({ file }) => {
        formData.append(
          imageAttachments.length === 1 ? "image" : "image[]",
          file
        );
      });
      fileAttachments.forEach(({ file }) => {
        formData.append(fileAttachments.length === 1 ? "file" : "file[]", file);
      });

      const response = await fetch("/api/images/chat", {
        method: "POST",
        signal,
        headers: {
          Accept: "text/event-stream",
        },
        body: formData,
      });

      const createRequestError = (
        message: string,
        creditsConsumed?: number
      ) => {
        const error = new Error(message) as GenerationRequestError;
        if (creditsConsumed !== undefined) {
          error.creditsConsumed = creditsConsumed;
        }
        return error;
      };

      const buildStreamState = (next?: {
        text?: string;
        thinking?: string;
        agent?: string;
        agentEvents?: AgentRunEvent[];
        imageUrl?: string;
      }): Omit<ChatStreamState, "mode"> => ({
        messageId: streamMessageId,
        cardId: streamCardId,
        generationId,
        prompt,
        model: chatImageModel !== "default" ? chatImageModel : chatModel,
        size: requestSize,
        text: next?.text ?? "",
        thinking: next?.thinking ?? "",
        agent: next?.agent ?? "",
        agentEvents: next?.agentEvents ?? [],
        imageUrl: next?.imageUrl,
      });

      const syncAssistantStreamVariant = (
        state: Omit<ChatStreamState, "mode">
      ) => {
        if (!streamMessageId || streamCardId) return;
        setChatMessages((prev) =>
          prev.map((message) => {
            if (message.id !== streamMessageId) return message;
            const variants = getChatVariants(message);
            const currentVariant =
              variants.find(
                (variant) => variant.generationId === generationId
              ) || getActiveChatVariant(message);
            const nextVariant = mergeChatVariant(currentVariant || undefined, {
              generationId,
              imageUrl: state.imageUrl,
              prompt,
              model: chatImageModel !== "default" ? chatImageModel : chatModel,
              size: requestSize,
              responseText: state.text || undefined,
              responseThinking: state.thinking || undefined,
              responseAgent: state.agent || undefined,
              agentEvents: state.agentEvents.length
                ? state.agentEvents
                : undefined,
              pending: true,
            });
            return {
              ...message,
              text:
                state.text ||
                (state.imageUrl
                  ? copy("Generating image...", "正在生成图片...")
                  : message.text),
              variants: replaceChatVariantByGenerationId(
                variants.length ? variants : [nextVariant],
                generationId,
                [nextVariant]
              ),
              activeVariant: Math.max(
                0,
                variants.findIndex(
                  (variant) => variant.generationId === generationId
                )
              ),
            };
          })
        );
      };

      const publishStreamState = async (next?: {
        text?: string;
        thinking?: string;
        agent?: string;
        agentEvents?: AgentRunEvent[];
        imageUrl?: string;
      }) => {
        const state = buildStreamState(next);
        updateChatStream(state);
        syncAssistantStreamVariant(state);
        await yieldToBrowser();
      };

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await readImageApiJsonResponse(response);
        if (!response.ok || data.error) {
          throw createRequestError(
            data.error || `API error: ${response.status}`,
            data.creditsConsumed
          );
        }
        return data;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("API returned an empty stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let failed: ImageApiResult | null = null;
      let completed: ImageApiResult | undefined;
      let text = "";
      let thinking = "";
      let agent = "";
      let agentEvents: AgentRunEvent[] = agentMode
        ? createOptimisticAgentRoundEvents(1)
        : [];
      let previewUrl: string | undefined;
      // 分层生成:第 1 轮整图出来后把它钉为主预览,后续逐层(背景/元素)只进事件列表缩略图,
      // 不再覆盖主预览——否则用户看到的"整图"会被后面的单层图替换掉。非分层不受影响。
      let layeredCompositePinned = false;
      const allowMainPreviewUpdate = () =>
        !(layeredGeneration && layeredCompositePinned);

      const processBlock = async (block: string) => {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
          .trim();

        if (!data || data === "[DONE]") return;

        let event: ImageStreamEvent;
        try {
          event = JSON.parse(data) as ImageStreamEvent;
        } catch {
          return;
        }

        if (event.type === "text_delta") {
          text += event.delta;
          await publishStreamState({
            text,
            thinking,
            agent,
            agentEvents,
            imageUrl: previewUrl,
          });
          if (streamCardId) {
            setBatchCards((prev) =>
              prev.map((card) =>
                card.id === streamCardId &&
                (card.state === "loading" || card.state === "text")
                  ? { ...card, state: "text", streamText: text }
                  : card
              )
            );
          }
          return;
        }

        if (event.type === "thinking_delta") {
          thinking += event.delta;
          await publishStreamState({
            text,
            thinking,
            agent,
            agentEvents,
            imageUrl: previewUrl,
          });
          if (streamCardId) {
            setBatchCards((prev) =>
              prev.map((card) =>
                card.id === streamCardId &&
                (card.state === "loading" || card.state === "text")
                  ? { ...card, streamThinking: thinking }
                  : card
              )
            );
          }
          return;
        }

        if (event.type === "agent_delta") {
          agent += event.delta;
          await publishStreamState({
            text,
            thinking,
            agent,
            agentEvents,
            imageUrl: previewUrl,
          });
          if (streamCardId) {
            setBatchCards((prev) =>
              prev.map((card) =>
                card.id === streamCardId &&
                (card.state === "loading" || card.state === "text")
                  ? { ...card, streamAgent: agent }
                  : card
              )
            );
          }
          return;
        }

        if (event.type === "agent_event") {
          agentEvents = appendAgentRunEvent(agentEvents, event.event);
          const eventImageUrl = agentEventToImageUrl(event.event);
          if (eventImageUrl && allowMainPreviewUpdate()) {
            previewUrl = eventImageUrl;
            setStreamingPreviewUrl(eventImageUrl);
          }
          await publishStreamState({
            text,
            thinking,
            agent,
            agentEvents,
            imageUrl: previewUrl,
          });
          return;
        }

        if (event.type === "partial_image") {
          const nextPreviewUrl = imageStreamEventToPreviewUrl(event);
          if (nextPreviewUrl) {
            const updateMain = allowMainPreviewUpdate();
            if (updateMain) {
              previewUrl = nextPreviewUrl;
              setStreamingPreviewUrl(nextPreviewUrl);
            }
            if (!event.final) {
              agentEvents = appendAgentRunEvent(agentEvents, {
                kind: "image_partial",
                status: "completed",
                title: copy("Streaming preview generated", "流式预览已生成"),
                imageUrl: nextPreviewUrl,
                index: event.index,
                partialImageIndex: event.partial_image_index,
                timestamp: new Date().toISOString(),
              });
            }
            // 分层:首张整图(final)出现后钉住主预览,后续逐层图只进事件列表、不覆盖主图。
            if (layeredGeneration && event.final) {
              layeredCompositePinned = true;
            }
            await publishStreamState({
              text,
              thinking,
              agent,
              agentEvents,
              imageUrl: previewUrl,
            });
            if (streamCardId && updateMain) {
              setBatchCards((prev) =>
                prev.map((card) =>
                  card.id === streamCardId && card.state === "loading"
                    ? { ...card, imageUrl: nextPreviewUrl }
                    : card
                )
              );
            }
          }
          return;
        }

        if (event.type === "completed") {
          completed = event;
          return;
        }

        if (event.type === "error") {
          failed = event;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          await processBlock(block);
        }
        if (done) break;
      }

      if (buffer.trim()) await processBlock(buffer);

      const failedResult = failed as ImageApiResult | null;
      if (!response.ok || failedResult) {
        throw createRequestError(
          failedResult?.error || `API error: ${response.status}`,
          failedResult?.creditsConsumed
        );
      }

      if (!completed) {
        throw new Error("API returned no image data");
      }

      return {
        ...completed,
        responseText: completed.responseText || text || undefined,
        responseThinking: completed.responseThinking || thinking || undefined,
        responseAgent: agent || completed.responseAgent || undefined,
        agentEvents: completed.agentEvents || agentEvents,
        agentRoundCount: completed.agentRoundCount,
        webConversation: completed.webConversation,
        responsesPreviousResponse: completed.responsesPreviousResponse,
      };
    };

    try {
      return await executeChatRequest();
    } finally {
      if (generationId) {
        activeChatRequestGenerationIdsRef.current.delete(generationId);
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅首次迁移本地历史记录,依赖运行期快照避免重复导入。
  useEffect(() => {
    if (didLoadChatRef.current) return;
    try {
      if (chatMessages.length > 0 || chatConversations.length > 0) {
        chatConversationsRef.current = chatConversations;
        chatMessagesConversationIdRef.current = chatConversationId;
        chatMessagesModeRef.current = chatMessages.length
          ? inferChatConversationMode(chatMessages)
          : null;
        return;
      }

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
            JSON.stringify(conversation.messages) ===
            JSON.stringify(legacyMessages)
        );
      const nextConversations = compactChatConversations(
        hasLegacyConversation
          ? [
              createChatConversation(
                legacyMessages,
                getChatConversationTitle(
                  legacyMessages,
                  isZh ? "历史对话" : "Previous chat"
                )
              ),
              ...conversations,
            ]
          : conversations
      );

      if (nextConversations.length > 0) {
        const sortedConversations = nextConversations
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
          sortedConversations.find(
            (conversation) =>
              conversation.mode === storedConversationMode &&
              conversation.id === activeConversationId
          ) ||
          sortedConversations.find(
            (conversation) => conversation.mode === storedConversationMode
          ) ||
          sortedConversations[0];
        chatConversationsRef.current = sortedConversations;
        setChatConversations(sortedConversations);
        chatMessagesConversationIdRef.current = activeConversation?.id || null;
        chatMessagesModeRef.current = activeConversation?.mode || null;
        setChatConversationId(activeConversation?.id || createLocalId());
        setChatMessages(activeConversation?.messages || []);
        if (activeConversation) {
          window.localStorage.setItem(
            chatActiveConversationStorageKey(activeConversation.mode),
            activeConversation.id
          );
        }
      }
      window.localStorage.setItem(
        CHAT_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(
          compactChatConversations(nextConversations).slice(
            0,
            CHAT_CONVERSATION_LIMIT
          )
        )
      );
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
      window.localStorage.removeItem(CHAT_CONVERSATIONS_STORAGE_KEY);
      window.localStorage.removeItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);
      window.localStorage.removeItem(
        CHAT_ACTIVE_AGENT_CONVERSATION_STORAGE_KEY
      );
    } finally {
      didLoadChatRef.current = true;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 持久化对话时读取运行期 ref 快照,不应因 ref.current 变化重复写入。
  useEffect(() => {
    if (!didLoadChatRef.current) return;
    try {
      if (
        chatMessages.length > 0 &&
        chatMessagesConversationIdRef.current &&
        (chatMessagesConversationIdRef.current !== chatConversationId ||
          (chatMessagesModeRef.current &&
            chatMessagesModeRef.current !==
              inferChatConversationMode(chatMessages)))
      ) {
        return;
      }
      if (chatMessages.length === 0) {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      const persistedMessages = sanitizePersistedChatMessages(chatMessages);
      const conversationMode = inferChatConversationMode(persistedMessages);
      chatMessagesConversationIdRef.current = chatConversationId;
      chatMessagesModeRef.current = conversationMode;
      const title = getChatConversationTitle(
        persistedMessages.filter((message) =>
          isMessageInConversationMode(message, conversationMode)
        ),
        isZh ? "未命名对话" : "Untitled chat"
      );
      const now = new Date().toISOString();
      const previousConversations = chatConversationsRef.current;
      const existing = previousConversations.find(
        (conversation) => conversation.id === chatConversationId
      );
      const current: ChatConversation = {
        id: chatConversationId,
        mode: existing?.mode || conversationMode,
        title,
        messages: persistedMessages,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const nextConversations = compactChatConversations([
        current,
        ...previousConversations.filter(
          (conversation) => conversation.id !== chatConversationId
        ),
      ]).slice(0, CHAT_CONVERSATION_LIMIT);
      chatConversationsRef.current = nextConversations;
      setChatConversations(nextConversations);
      window.localStorage.setItem(
        CHAT_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(nextConversations)
      );
      window.localStorage.setItem(
        chatActiveConversationStorageKey(current.mode),
        chatConversationId
      );
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore local storage quota errors */
    }
  }, [chatConversationId, chatMessages, isZh]);

  useEffect(() => {
    if (!gpt55ChatAllowed && chatModel === GPT55_CHAT_MODEL) {
      setChatModel(GPT54_CHAT_MODEL);
    }
  }, [chatModel, gpt55ChatAllowed, setChatModel]);

  useEffect(() => {
    if (!firstPreviewUrl) {
      setFirstImageSize(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const nextImageSize = {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
      setFirstImageSize(nextImageSize);
    };
    img.onerror = () => {
      setFirstImageSize(null);
    };
    img.src = firstPreviewUrl;
  }, [firstPreviewUrl, setFirstImageSize]);

  useEffect(() => {
    if (editImages.length === 0) {
      if (maskSourceIndex !== 0) setMaskSourceIndex(0);
      return;
    }
    if (maskSourceIndex >= editImages.length) {
      setMaskSourceIndex(editImages.length - 1);
    }
  }, [editImages.length, maskSourceIndex, setMaskSourceIndex]);

  useEffect(() => {
    if (!maskSourcePreviewUrl) {
      setMaskSourceImageSize(null);
      setMaskEditorOpen(false);
      setMaskPoints([]);
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return null;
      });
      return;
    }

    setMaskSourceImageSize(null);
    setMaskPoints([]);
    setMaskFile((prev) => {
      if (prev) revokePreview(prev.previewUrl);
      return null;
    });

    const img = new window.Image();
    img.onload = () => {
      setMaskSourceImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.onerror = () => {
      setMaskSourceImageSize(null);
      setMaskEditorOpen(false);
    };
    img.src = maskSourcePreviewUrl;
  }, [
    maskSourcePreviewUrl,
    setMaskEditorOpen,
    setMaskFile,
    setMaskPoints,
    setMaskSourceImageSize,
  ]);

  useEffect(() => {
    if (!chatFirstPreviewUrl) {
      setChatFirstImageSize(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setChatFirstImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.onerror = () => {
      setChatFirstImageSize(null);
    };
    img.src = chatFirstPreviewUrl;
  }, [chatFirstPreviewUrl, setChatFirstImageSize]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !maskSourceImageSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(220, 38, 38, 0.46)";
    for (const point of maskPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [maskPoints, maskSourceImageSize]);

  const addSuccessfulResult = (
    data: ChatResultInput,
    resultPrompt: string,
    fallbackSize = size,
    options?: {
      syncCredits?: boolean;
      addRecent?: boolean;
      previewMode?: VisualOutputMode | null;
    }
  ): ChatVariant | null => {
    const syncCredits = options?.syncCredits ?? true;
    const addRecent = options?.addRecent ?? true;
    const previewMode = options?.previewMode;
    const model = data.model || DEFAULT_IMAGE_MODEL;
    const resultSize = data.size || fallbackSize;
    if (!data.imageUrl && !data.responseText) return null;

    const isAgentDraft = data.outputRole === "agent_draft";
    if (
      previewMode !== null &&
      data.imageUrl &&
      data.generationId &&
      !isAgentDraft
    ) {
      const nextResult: ResultState = {
        generationId: data.generationId,
        imageUrl: data.imageUrl,
        prompt: resultPrompt,
        model,
        size: resultSize,
        creditsConsumed: data.creditsConsumed,
      };
      if (data.revisedPrompt) nextResult.revisedPrompt = data.revisedPrompt;
      if (data.promptRepairNotice) {
        nextResult.promptRepairNotice = data.promptRepairNotice;
      }
      setResult(nextResult);
      if (previewMode) {
        setVisualResults((prev) => ({ ...prev, [previewMode]: nextResult }));
      }
    }
    if (syncCredits) {
      setBalance(
        (b) =>
          Math.round(Math.max(0, b - (data.creditsConsumed || 0)) * 100) / 100
      );
    }
    if (addRecent && data.imageUrl && data.generationId && !isAgentDraft) {
      const generationId = data.generationId;
      setRecent((prev) => [
        {
          id: generationId,
          prompt: resultPrompt,
          revisedPrompt: data.revisedPrompt || null,
          model,
          size: resultSize,
          creditsConsumed: data.creditsConsumed || 0,
          status: "completed",
          imageUrl: data.imageUrl || null,
          createdAt: new Date().toISOString(),
          canDelete: true,
          isLayered: data.layered,
        },
        ...prev.slice(0, 5),
      ]);
    }

    return {
      generationId: data.generationId,
      imageUrl: data.imageUrl,
      imageFileId: data.imageFileId,
      webImageMessageId: data.webImageMessageId,
      webImageGroupId: data.webImageGroupId,
      prompt: resultPrompt,
      model,
      size: resultSize,
      revisedPrompt: data.revisedPrompt,
      promptRepairNotice: data.promptRepairNotice,
      responseText: data.responseText,
      responseThinking: data.responseThinking,
      responseAgent: data.responseAgent,
      agentEvents: data.agentEvents,
      agentRoundCount: data.agentRoundCount,
      webConversation: data.webConversation,
      backendMember: data.backendMember,
      responsesPreviousResponse: data.responsesPreviousResponse,
      creditsConsumed: data.creditsConsumed,
      createdAt: new Date().toISOString(),
      outputRole: data.outputRole,
    };
  };

  const expandChatImageOutputs = (data: ImageApiResult): ChatResultInput[] => {
    const outputs = (data.imageOutputs || [])
      .filter((item) => item.imageUrl && item.generationId)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (outputs.length === 0) return [data];

    const outputUrlByIndex = new Map<number, string>();
    for (const [index, output] of outputs.entries()) {
      if (output.imageUrl)
        outputUrlByIndex.set(output.index ?? index, output.imageUrl);
    }

    return outputs.map((output, index) => {
      const isLast = index === outputs.length - 1;
      const isChoice = output.outputRole === "choice";
      const choiceConversation =
        isChoice && data.webConversation
          ? {
              ...data.webConversation,
              selectedImageMessageId:
                output.webImageMessageId ||
                data.webConversation.selectedImageMessageId,
            }
          : undefined;
      const outputAgentEvents = isLast
        ? (data.agentEvents || []).map((event) => {
            if (
              event.kind === "image_generation" &&
              event.status === "completed" &&
              event.imageUrl === undefined
            ) {
              const imageUrl = outputUrlByIndex.get(event.index ?? -1);
              return imageUrl ? { ...event, imageUrl } : event;
            }
            return event;
          })
        : undefined;
      return {
        generationId: output.generationId,
        imageUrl: output.imageUrl,
        imageFileId: output.imageFileId,
        webImageMessageId: output.webImageMessageId,
        webImageGroupId: output.webImageGroupId,
        model: data.model,
        size: output.size || data.size,
        revisedPrompt:
          output.revisedPrompt ||
          output.upstreamRevisedPrompt ||
          data.revisedPrompt,
        promptRepairNotice:
          output.promptRepairNotice || data.promptRepairNotice,
        responseText: isChoice || isLast ? data.responseText : undefined,
        responseThinking: isLast ? data.responseThinking : undefined,
        responseAgent: isLast ? data.responseAgent : undefined,
        agentEvents: outputAgentEvents,
        agentRoundCount: isLast ? data.agentRoundCount : undefined,
        webConversation:
          choiceConversation || (isLast ? data.webConversation : undefined),
        backendMember: data.backendMember,
        responsesPreviousResponse: isLast
          ? data.responsesPreviousResponse
          : undefined,
        creditsConsumed: isLast ? data.creditsConsumed : 0,
        outputRole: output.outputRole || (isLast ? "final" : "agent_draft"),
      };
    });
  };

  const addSuccessfulChatResults = (
    data: ImageApiResult,
    resultPrompt: string,
    fallbackSize = size,
    options?: { syncCredits?: boolean }
  ) => {
    const shouldSyncCredits = options?.syncCredits ?? true;
    const expanded = expandChatImageOutputs(data);
    const variants: ChatVariant[] = [];
    for (const [index, item] of expanded.entries()) {
      const variant = addSuccessfulResult(item, resultPrompt, fallbackSize, {
        syncCredits: shouldSyncCredits && index === expanded.length - 1,
        addRecent: false,
        previewMode: null,
      });
      if (variant) variants.push(variant);
    }
    if (variants.length > 0) {
      const activeChoiceIndex = variants.findIndex(
        (variant) =>
          variant.outputRole === "choice" &&
          variant.webConversation?.selectedImageMessageId &&
          variant.webImageMessageId ===
            variant.webConversation.selectedImageMessageId
      );
      if (activeChoiceIndex >= 0 && activeChoiceIndex < variants.length - 1) {
        const [selected] = variants.splice(activeChoiceIndex, 1);
        if (selected) variants.push(selected);
      }
      const nextRecent = variants
        .filter((variant) => variant.imageUrl && variant.generationId)
        .toReversed()
        .flatMap((variant, index) => {
          if (!variant.generationId) return [];
          return [
            {
              id: variant.generationId,
              prompt: resultPrompt,
              revisedPrompt: variant.revisedPrompt || null,
              model: variant.model,
              size: variant.size,
              creditsConsumed: index === 0 ? data.creditsConsumed || 0 : 0,
              status: "completed" as const,
              imageUrl: variant.imageUrl || null,
              createdAt: new Date().toISOString(),
              canDelete: index === 0,
              isLayered: data.layered,
            },
          ];
        });
      if (nextRecent.length > 0) {
        setRecent((prev) => {
          const known = new Set(prev.map((item) => item.id));
          const uniqueNext = nextRecent.filter((item) => !known.has(item.id));
          return [...uniqueNext, ...prev].slice(0, 6);
        });
      }
    }
    return variants;
  };

  const addSuccessfulResults = (
    data: ImageApiResult,
    resultPrompt: string,
    fallbackSize = size,
    options?: { syncCredits?: boolean; previewMode?: VisualOutputMode }
  ) => {
    const successfulResults =
      data.results?.filter((item) => item.imageUrl && item.generationId) ||
      (data.imageUrl && data.generationId ? [data] : []);

    if (successfulResults.length === 0) return [];

    const variants: ChatVariant[] = [];
    for (const item of successfulResults.toReversed()) {
      const variant = addSuccessfulResult(item, resultPrompt, fallbackSize, {
        syncCredits: options?.syncCredits ?? true,
        previewMode: options?.previewMode,
      });
      if (variant) {
        variants.unshift(variant);
      }
    }
    const previewMode = options?.previewMode;
    if (previewMode) {
      const nextResults = variants.flatMap((variant): ResultState[] => {
        if (!variant.generationId || !variant.imageUrl) return [];
        const nextResult: ResultState = {
          generationId: variant.generationId,
          imageUrl: variant.imageUrl,
          prompt: resultPrompt,
          model: variant.model,
          size: variant.size,
          creditsConsumed: variant.creditsConsumed,
        };
        if (variant.revisedPrompt) {
          nextResult.revisedPrompt = variant.revisedPrompt;
        }
        if (variant.promptRepairNotice) {
          nextResult.promptRepairNotice = variant.promptRepairNotice;
        }
        return [nextResult];
      });
      setVisualResultLists((prev) => {
        const previousResults = prev[previewMode] || [];
        return {
          ...prev,
          [previewMode]: [...previousResults, ...nextResults],
        };
      });
    }

    return variants;
  };

  const syncChargedCredits = (creditsConsumed?: number) => {
    if (!creditsConsumed || creditsConsumed <= 0) return;
    setBalance((b) => Math.round(Math.max(0, b - creditsConsumed) * 100) / 100);
  };

  const syncWaterfallCredits = (creditsConsumed?: number) => {
    if (!creditsConsumed || creditsConsumed <= 0) return;
    setWaterfallCreditsConsumed(
      (value) => Math.round((value + creditsConsumed) * 100) / 100
    );
  };

  const showGenerationError = (
    message: string,
    options?: { creditsConsumed?: number }
  ) => {
    syncChargedCredits(options?.creditsConsumed);

    if (message.toLowerCase().includes("insufficient credits")) {
      toast.error(copy("Insufficient credits", "积分不足"), {
        description: copy(
          "You don't have enough credits to generate an image.",
          "当前积分不足，无法生成图片。"
        ),
        action: {
          label: copy("Top up", "去充值"),
          onClick: () => {
            window.location.href = `/${locale}/dashboard/credits/buy`;
          },
        },
      });
      return;
    }

    toast.error(copy("Generation failed", "生成失败"), {
      description: message,
    });
  };

  const addChatAttachments = async (files: FileList | File[] | null) => {
    const uploadFiles = Array.from(files || []);
    if (!uploadFiles.length) return;

    const accepted: ChatAttachment[] = [];
    for (const file of uploadFiles) {
      const isImage = isImageFile(file);
      if (!isImage && !isReadableChatFile(file)) {
        toast.error(copy("Unsupported file type", "不支持的文件类型"), {
          description: copy(
            "Use PNG/JPEG/WebP images, PDF, or text/code files.",
            "请使用 PNG/JPEG/WebP 图片、PDF，或文本/代码文件。"
          ),
        });
        continue;
      }
      if (file.size > maxImageBytes) {
        toast.error(copy("File too large", "文件过大"), {
          description: copy(
            `${file.name} exceeds ${formatMegabytes(maxImageBytes)}.`,
            `${file.name} 超过 ${formatMegabytes(maxImageBytes)}。`
          ),
        });
        continue;
      }
      try {
        accepted.push({
          file,
          kind: isImage ? "image" : "file",
          previewUrl: isImage ? await readFileAsDataUrl(file) : "",
        });
      } catch {
        toast.error(copy("Failed to load attachment", "附件加载失败"), {
          description:
            file.name ||
            copy("Could not read the selected file.", "无法读取所选文件。"),
        });
      }
    }

    if (!accepted.length) return;

    setChatAttachments((prev) => {
      const slots = maxChatImages - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl || "");
        }
        toast.error(
          copy(
            `Attach up to ${maxChatImages} files`,
            `最多可添加 ${maxChatImages} 个附件`
          )
        );
        return prev;
      }

      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl || "");
      }
      if (accepted.length > slots) {
        toast.error(
          copy(
            `Only ${slots} more attachment(s) can be added`,
            `还可以再添加 ${slots} 个附件`
          )
        );
      }
      return [...prev, ...next];
    });
  };

  const removeChatAttachment = (index: number) => {
    setChatAttachments((prev) => {
      const target = prev[index];
      if (target) revokePreview(target.previewUrl || "");
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      return next;
    });
  };

  const clearChatAttachments = () => {
    setChatAttachments((prev) => {
      for (const item of prev) {
        revokePreview(item.previewUrl || "");
      }
      return [];
    });
  };

  const attachImageUrlToChat = async (
    imageUrl: string,
    name: string,
    sourceId?: string
  ) => {
    if (chatAttachments.some((item) => item.sourceId === sourceId)) {
      toast.success(
        copy("Reference image is already attached", "参考图片已添加")
      );
      return;
    }
    if (chatAttachments.length >= maxChatImages) {
      toast.error(
        copy(
          `Attach up to ${maxChatImages} reference images`,
          `最多可添加 ${maxChatImages} 张参考图片`
        )
      );
      return;
    }

    try {
      const item = await urlToEditImageFile(imageUrl, name, sourceId);
      setChatAttachments((prev) => [...prev, { ...item, kind: "image" }]);
      if (!isConversationMode(activeMode)) {
        switchActiveMode("chat");
      }
      toast.success(copy("Reference image attached", "参考图片已添加"));
    } catch (error) {
      toast.error(copy("Failed to attach image", "添加图片失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("Could not load image.", "无法加载图片。"),
      });
    }
  };

  const attachResultToChat = async (variant?: ChatVariant) => {
    const imageUrl = variant?.imageUrl || result?.imageUrl;
    const id = variant?.generationId || result?.generationId;
    if (!imageUrl || !id) return;
    await attachImageUrlToChat(imageUrl, `gpt2image-${id}`, id);
  };

  const findPrecedingUserMessage = (assistantIndex: number) => {
    const assistantMessage = chatMessages[assistantIndex];
    const targetMode =
      assistantMessage?.mode === "agent"
        ? "agent"
        : assistantMessage?.mode === "web"
          ? "web"
          : ("chat" as const);
    for (let index = assistantIndex - 1; index >= 0; index--) {
      const message = chatMessages[index];
      if (
        message?.role === "user" &&
        isMessageInConversationMode(message, targetMode)
      ) {
        return message;
      }
    }
    return null;
  };

  const syncWebImageSelection = async (variant?: ChatVariant | null) => {
    if (
      variant?.outputRole !== "choice" ||
      !variant.generationId ||
      !variant.webImageMessageId ||
      !variant.webConversation?.selectionMessageId
    ) {
      return;
    }

    try {
      const response = await fetch("/api/images/chat/web-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: variant.generationId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to sync Web selection");
      }
    } catch (error) {
      toast.error(
        copy("Failed to sync Web image choice", "同步 Web 图片选择失败"),
        {
          description:
            error instanceof Error
              ? error.message
              : copy(
                  "The local selection is still preserved.",
                  "本地选择仍会保留。"
                ),
        }
      );
    }
  };

  const handleChatVariantSelect = (messageId: string, nextIndex: number) => {
    let selectedVariant: ChatVariant | null = null;
    setChatMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        const variants = getChatVariants(message);
        const next = Math.max(
          0,
          Math.min(variants.length - 1, Math.floor(nextIndex))
        );
        selectedVariant = variants[next] || null;
        return {
          ...message,
          activeVariant: next,
        };
      })
    );
    void syncWebImageSelection(selectedVariant);
  };

  const handleChatVariantChange = (messageId: string, direction: -1 | 1) => {
    const message = chatMessages.find((item) => item.id === messageId);
    const current = message?.activeVariant || 0;
    handleChatVariantSelect(messageId, current + direction);
  };

  const handleChatRetry = async (assistantId: string) => {
    if (isChatGenerating) return;

    const assistantIndex = chatMessages.findIndex(
      (message) => message.id === assistantId
    );
    if (assistantIndex < 0) return;
    const userMessage = findPrecedingUserMessage(assistantIndex);
    if (!userMessage?.text) return;

    const assistantMessage = chatMessages[assistantIndex];
    if (!assistantMessage) return;
    const activeVariant = getActiveChatVariant(assistantMessage);
    const retrySize = activeVariant?.size || size;
    const generationId = createGenerationId();
    const userIndex = chatMessages.findIndex(
      (message) => message.id === userMessage.id
    );
    const conversationMode =
      assistantMessage.mode === "agent"
        ? "agent"
        : assistantMessage.mode === "web"
          ? "web"
          : ("chat" as const);
    const historyMessages = (
      userIndex >= 0
        ? chatMessages.slice(0, userIndex)
        : chatMessages.slice(0, assistantIndex)
    ).filter((message) =>
      isMessageInConversationMode(message, conversationMode)
    );
    const pendingVariant = mergeChatVariant(undefined, {
      generationId,
      prompt: userMessage.text,
      model: chatImageModel !== "default" ? chatImageModel : chatModel,
      size: retrySize,
      agentEvents:
        assistantMessage.mode === "agent" || userMessage.mode === "agent"
          ? createOptimisticAgentRoundEvents(1)
          : undefined,
      pending: true,
    });
    const pendingMessages = chatMessages.map((message) => {
      if (message.id !== assistantId) return message;
      const variants = getChatVariants(message);
      return {
        ...message,
        error: undefined,
        variants: [...variants, pendingVariant],
        activeVariant: variants.length,
      };
    });

    setRetryingChatMessageId(assistantId);
    setIsChatGenerating(true);
    setChatStream(
      createInitialChatStreamState({
        messageId: assistantId,
        mode: conversationMode,
        agentMode:
          assistantMessage.mode === "agent" || userMessage.mode === "agent",
        generationId,
        prompt: userMessage.text,
        model: chatImageModel !== "default" ? chatImageModel : chatModel,
        size: retrySize,
      })
    );
    setChatMessages(pendingMessages);
    persistChatConversationSnapshot({
      conversations: chatConversationsRef.current,
      conversationId: chatConversationId,
      mode: conversationMode,
      messages: pendingMessages,
      titleFallback: isZh ? "未命名对话" : "Untitled chat",
    });

    try {
      const data = await runChatRequest({
        prompt: userMessage.text,
        fallbackSize: retrySize,
        historyMessages,
        generationId,
        streamMessageId: assistantId,
        agentMode:
          assistantMessage.mode === "agent" || userMessage.mode === "agent",
        webChat: assistantMessage.mode === "web" || userMessage.mode === "web",
      });
      const newVariants = addSuccessfulChatResults(
        data,
        userMessage.text,
        retrySize
      );
      const variant = newVariants[newVariants.length - 1];
      if (!variant || newVariants.length === 0) {
        throw new Error(
          copy("API returned no image data", "接口未返回图片数据")
        );
      }

      setChatMessages((prev) =>
        prev.map((message) => {
          if (message.id !== assistantId) return message;
          const existingVariants = getChatVariants(message);
          const replacedIndex = existingVariants.findIndex(
            (item) => item.generationId === generationId
          );
          const variants = replaceChatVariantByGenerationId(
            existingVariants,
            generationId,
            newVariants
          );
          const activeVariantIndex =
            replacedIndex >= 0
              ? replacedIndex + newVariants.length - 1
              : variants.length - 1;
          return {
            ...message,
            error: undefined,
            text:
              variant.responseText ||
              (variant.imageUrl
                ? copy("Image generated", "图片已生成")
                : copy("Response generated", "回复已生成")),
            variants: variants.map((item) => ({
              ...item,
              pending: false,
            })),
            activeVariant: activeVariantIndex,
          };
        })
      );
      if (isCreatePageMountedRef.current) {
        toast.success(copy("Variant generated", "新版本已生成"));
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy("Retry failed.", "重试失败。");
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                variants: getChatVariants(item).map((variant) => ({
                  ...variant,
                  pending: false,
                })),
              }
            : item
        )
      );
      if (isCreatePageMountedRef.current) {
        toast.error(copy("Retry failed", "重试失败"), { description: message });
      }
    } finally {
      setRetryingChatMessageId(null);
      setIsChatGenerating(false);
      setChatStream(null);
      clearStreamingPreview();
      if (isCreatePageMountedRef.current) {
        scrollChatToBottom();
      }
    }
  };

  const saveBatchCardToRecent = (card: BatchCard) => {
    if (!card.imageUrl || !card.generationId) return;

    setRecent((prev) => {
      if (prev.some((item) => item.id === card.generationId)) return prev;
      return [
        {
          id: card.generationId || createLocalId(),
          prompt: card.prompt,
          revisedPrompt: null,
          model: card.model || DEFAULT_IMAGE_MODEL,
          size: card.size,
          creditsConsumed: 0,
          status: "completed",
          imageUrl: card.imageUrl || null,
          createdAt: new Date().toISOString(),
          canDelete: false,
        },
        ...prev.slice(0, 5),
      ];
    });
    setBatchCards((prev) =>
      prev.map((item) =>
        item.id === card.id ? { ...item, saved: true } : item
      )
    );
    toast.success(copy("Saved to recent", "已保存到最近生成"));
  };

  const handleBatchSuggestion = (suggestion: string) => {
    setBatchPrompt(suggestion);
  };

  const renderThinkingBlock = (thinking?: string, open = false) => (
    <CreatePageThinkingBlock thinking={thinking} open={open} copy={copy} />
  );

  const renderAgentBlock = (agent?: string, open = false) => (
    <CreatePageAgentBlock
      agent={agent}
      open={open}
      showAgentProcessHint={showAgentProcessHint}
      copy={copy}
    />
  );

  const renderAgentRoundCards = (
    events?: AgentRunEvent[],
    fallbackAgent?: string,
    open = false
  ) => (
    <CreatePageAgentRoundCards
      events={events}
      fallbackAgent={fallbackAgent}
      open={open}
      showAgentProcessHint={showAgentProcessHint}
      copy={copy}
    />
  );

  const renderChatStreamBubble = (messageId?: string) => {
    if (!chatStream || chatStream.messageId !== messageId) return null;
    const isAgentStream = chatStream.mode === "agent";
    const hasVisibleAgentProgress =
      isAgentStream && chatStream.agentEvents.length > 0;
    return (
      <div className="rounded-lg border border-border bg-muted/35 px-3 py-3 text-sm text-foreground">
        {renderThinkingBlock(chatStream.thinking, true)}
        {hasVisibleAgentProgress
          ? renderAgentRoundCards(
              chatStream.agentEvents,
              chatStream.agent,
              true
            )
          : null}
        {chatStream.text && (
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {chatStream.text}
          </p>
        )}
        {chatStream.imageUrl && (
          <div className="relative mt-3 max-w-sm overflow-hidden rounded-md border bg-muted">
            <Image
              src={chatStream.imageUrl}
              alt={copy("Streaming preview", "流式预览")}
              width={320}
              height={320}
              className="h-auto w-full object-contain"
              unoptimized={shouldBypassImageOptimization(chatStream.imageUrl)}
            />
          </div>
        )}
        {!chatStream.text &&
          !chatStream.imageUrl &&
          !hasVisibleAgentProgress && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy("Generating...", "生成中...")}
            </div>
          )}
      </div>
    );
  };

  const renderChatInput = () => {
    const isEditChat = hasChatImageAttachments;
    const activeChatSize = isEditChat ? chatCustomEditSize : size;

    return (
      <CreatePageChatInput
        activeMode={activeMode}
        chatAttachments={chatAttachments}
        chatPrompt={chatPrompt}
        chatMention={chatMention}
        chatImageModel={chatImageModel}
        activeChatSize={activeChatSize}
        chatSizeDialogValue={chatSizeDialogValue}
        agentForceRounds={agentForceRounds}
        layeredGeneration={layeredGeneration}
        agentMaxRounds={agentMaxRounds}
        isChatGenerating={isChatGenerating}
        showImageModelControls={showImageModelControls}
        isWebOnlyBackend={isWebOnlyBackend}
        disableResponsesOnlyControls={disableResponsesOnlyControls}
        isEditChat={isEditChat}
        chatFirstImageOriginalSize={chatFirstImageOriginalSize}
        customApiActive={customApiActive}
        chatHasImageReference={chatHasImageReference}
        customApiBillingLabel={customApiBillingLabel}
        formattedChatSingleCreditCost={formattedChatSingleCreditCost}
        canUseChatReferenceMentions={canUseChatReferenceMentions}
        filteredChatReferenceOptions={filteredChatReferenceOptions}
        maxChatImages={maxChatImages}
        chatAttachmentAccept={CHAT_ATTACHMENT_ACCEPT}
        chatReferenceMentionStatusText={chatReferenceMentionStatusText}
        autoSizeLabel={autoSizeLabel}
        backgroundHelpText={backgroundHelpText}
        resolutionHelpText={resolutionHelpText}
        copy={copy}
        chatImageInputRef={chatImageInputRef}
        chatPromptRef={chatPromptRef}
        onSubmit={handleChatSubmit}
        onPaste={handleChatPaste}
        onRemoveChatAttachment={removeChatAttachment}
        onChatImageModelChange={setChatImageModel}
        onConversationSizeChange={handleConversationSizeChange}
        onAgentForceRoundsChange={setAgentForceRounds}
        onLayeredGenerationChange={setLayeredGeneration}
        onAgentMaxRoundsChange={setAgentMaxRounds}
        onChatPromptChange={handleChatPromptChange}
        onChatMentionChange={setChatMention}
        onSelectChatMention={selectChatMention}
        onAddChatAttachments={(files) => void addChatAttachments(files)}
        renderBackendGroupSelect={renderBackendGroupSelect}
        renderImageModelSelect={renderImageModelSelect}
        renderBackgroundSelect={renderBackgroundSelect}
        renderTransparentMatteToggle={renderTransparentMatteToggle}
        renderHdRepairToggle={renderHdRepairToggle}
        renderBlockRepairToggle={renderBlockRepairToggle}
        renderReferenceMentionMenu={renderReferenceMentionMenu}
        promptOptimizationField={promptOptimizationField}
        helpMarker={helpMarker}
        getMentionTriggerForPrompt={getMentionTrigger}
      />
    );
  };

  const addBatchAttachments = async (files: FileList | File[] | null) => {
    const imageFiles = Array.from(files || []).filter(isImageFile);
    await addChatAttachments(imageFiles);
  };

  const getBatchFallbackSize = () => {
    return hasChatImageAttachments ? chatCustomEditSize : size;
  };

  const validateChatAttachments = (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return true;
    const totalUploadSize = attachments.reduce(
      (total, item) => total + item.file.size,
      0
    );
    if (totalUploadSize > maxEditRequestBytes) {
      toast.error(copy("Upload is too large", "上传内容过大"), {
        description: copy(
          `Attachments total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
          `附件总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
        ),
      });
      return false;
    }
    return true;
  };

  const triggerBatchGeneration = async (options?: { retryCardId?: string }) => {
    if (batchStoppedRef.current && !options?.retryCardId) return;
    // 里程碑警告期间阻塞自动续批(单卡 retry 不受影响)，待用户确认后解除
    if (warningBlockRef.current && !options?.retryCardId) return;
    const currentPrompt = (batchPromptRef.current || batchPrompt).trim();
    if (!currentPrompt) return;
    if (hasPromptImageReference(currentPrompt)) {
      toast.error(
        copy(
          "@ references are not available in waterfall",
          "瀑布流暂不支持 @ 精确引用"
        ),
        {
          description: copy(
            "Use Chat or Agent to reference a specific image.",
            "请在 Chat 或 Agent 中精确引用指定图片。"
          ),
        }
      );
      return;
    }

    const fallbackSize = batchSizeRef.current || getBatchFallbackSize();
    if (!validateImageSize(fallbackSize).valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"));
      return;
    }

    const attachments = chatAttachments.map((item) => ({
      ...item,
      file: cloneFile(item.file),
    }));
    if (!validateChatAttachments(attachments)) return;

    const requestCount = options?.retryCardId ? 1 : waterfallLoadSize;
    const available = waterfallMaxConcurrent - batchActiveRequestsRef.current;
    const loadSize = Math.min(requestCount, Math.max(available, 0));
    if (loadSize <= 0) return;
    if (batchStoppedRef.current && !options?.retryCardId) return;

    // 里程碑阈值检测：仅对自动续批(非 retry)生效。当本会话累计生成数跨越
    // [tier*10, tier*100, tier*1000] 中某个未展示阈值时，弹用量提醒并阻塞本批，
    // 待用户确认后由弹窗 onClose 解除阻塞并续批(对齐原项目)。
    if (!options?.retryCardId) {
      const tier = effectiveWaterfallTier;
      const nextCount = sessionCountRef.current + loadSize;
      const thresholds = [tier * 10, tier * 100, tier * 1000];
      for (const threshold of thresholds) {
        if (
          sessionCountRef.current < threshold &&
          nextCount >= threshold &&
          !milestoneShownRef.current.has(threshold)
        ) {
          milestoneShownRef.current.add(threshold);
          sessionCountRef.current = nextCount;
          warningBlockRef.current = true;
          setWaterfallWarning({ type: "milestone", tier, count: nextCount });
          return;
        }
      }
      sessionCountRef.current = nextCount;
    }

    const creditsPerRequest = applyBillingMultiplier(
      getPricedImageCreditCost(
        fallbackSize,
        getModerationCostOptions(
          attachments.filter((item) => item.kind === "image").length
        )
      )
    );
    const pendingCredits = batchActiveRequestsRef.current * creditsPerRequest;
    const requiredCredits = creditsPerRequest * loadSize + pendingCredits;
    if (!customApiActive && balance < requiredCredits) {
      showGenerationError("Insufficient credits");
      return;
    }

    const cards: BatchCard[] = options?.retryCardId
      ? []
      : Array.from({ length: loadSize }, () => ({
          id: createLocalId(),
          state: "loading" as const,
          aspectRatio:
            WATERFALL_ASPECT_RATIOS[
              Math.floor(Math.random() * WATERFALL_ASPECT_RATIOS.length)
            ] || WATERFALL_ASPECT_RATIOS[0],
          prompt: currentPrompt,
          size: fallbackSize,
        }));

    if (cards.length > 0) {
      setBatchCards((prev) => [...prev, ...cards]);
      setWaterfallStats((prev) => ({
        ...prev,
        sent: prev.sent + cards.length,
      }));
    } else if (options?.retryCardId) {
      setBatchCards((prev) =>
        prev.map((card) =>
          card.id === options.retryCardId
            ? {
                ...card,
                state: "loading",
                error: undefined,
                streamText: undefined,
                streamThinking: undefined,
                streamAgent: undefined,
              }
            : card
        )
      );
      setWaterfallStats((prev) => ({
        sent: prev.sent + 1,
        success: prev.success,
        failed: Math.max(0, prev.failed - 1),
      }));
    }

    const runCard = async (cardId: string) => {
      const controller = new AbortController();
      batchAbortControllersRef.current.set(cardId, controller);
      batchActiveRequestsRef.current += 1;
      try {
        const data = await runChatRequest({
          prompt: currentPrompt,
          attachments,
          fallbackSize,
          historyMessages: [],
          streamCardId: cardId,
          agentMode: false,
          signal: controller.signal,
        });
        const variants = addSuccessfulChatResults(
          data,
          currentPrompt,
          fallbackSize
        );
        const variant = variants[variants.length - 1];
        syncWaterfallCredits(data.creditsConsumed);
        setWaterfallStats((prev) => ({
          ...prev,
          success: prev.success + 1,
        }));
        setBatchCards((prev) =>
          prev.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  state: variant?.imageUrl ? "image" : "text",
                  imageUrl: variant?.imageUrl || data.imageUrl,
                  generationId: variant?.generationId || data.generationId,
                  text: data.responseText || variant?.responseText,
                  streamText: undefined,
                  streamThinking: data.responseThinking,
                  streamAgent: data.responseAgent,
                  model: data.model,
                  size: variant?.size || data.size || fallbackSize,
                  creditsConsumed: data.creditsConsumed,
                }
              : card
          )
        );
      } catch (error) {
        if (controller.signal.aborted) {
          setBatchCards((prev) =>
            prev.map((card) =>
              card.id === cardId && card.state === "loading"
                ? {
                    ...card,
                    state: "error",
                    error: copy("Stopped", "已停止"),
                  }
                : card
            )
          );
          return;
        }
        const creditsConsumed =
          error instanceof Error
            ? (error as GenerationRequestError).creditsConsumed
            : undefined;
        syncChargedCredits(creditsConsumed);
        syncWaterfallCredits(creditsConsumed);
        setWaterfallStats((prev) => ({
          ...prev,
          failed: prev.failed + 1,
        }));
        setBatchCards((prev) =>
          prev.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  state: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : copy("Generation failed", "生成失败"),
                  creditsConsumed,
                }
              : card
          )
        );
      } finally {
        batchActiveRequestsRef.current = Math.max(
          0,
          batchActiveRequestsRef.current - 1
        );
        batchAbortControllersRef.current.delete(cardId);
      }
    };

    if (options?.retryCardId) {
      if (batchStoppedRef.current) {
        batchStoppedRef.current = false;
        setIsBatchStopped(false);
      }
      void runCard(options.retryCardId);
      return;
    }

    cards.forEach((card) => {
      void runCard(card.id);
    });
  };
  triggerBatchGenerationRef.current = triggerBatchGeneration;

  const handleBatchSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const currentPrompt = batchPrompt.trim();
    if (!currentPrompt) {
      toast.error(copy("Please enter a prompt", "请输入提示词"));
      return;
    }
    batchPromptRef.current = currentPrompt;
    batchSizeRef.current = getBatchFallbackSize();
    batchActiveRequestsRef.current = 0;
    for (const controller of batchAbortControllersRef.current.values()) {
      controller.abort();
    }
    batchAbortControllersRef.current.clear();
    batchLoadingMoreRef.current = false;
    batchStoppedRef.current = false;
    // 新会话：重置里程碑计数/已展示阈值/阻塞标记，避免跨会话残留
    sessionCountRef.current = 0;
    milestoneShownRef.current = new Set<number>();
    warningBlockRef.current = false;
    setBatchCards([]);
    setWaterfallCreditsConsumed(0);
    setWaterfallStats({ sent: 0, success: 0, failed: 0 });
    setIsBatchLoadingMore(false);
    setIsBatchStopped(false);
    setIsBatchActive(true);
    await triggerBatchGeneration();
  };

  const handleStopWaterfall = () => {
    batchStoppedRef.current = true;
    batchLoadingMoreRef.current = false;
    const abortingCount = batchAbortControllersRef.current.size;
    for (const controller of batchAbortControllersRef.current.values()) {
      controller.abort();
    }
    batchAbortControllersRef.current.clear();
    batchActiveRequestsRef.current = 0;
    if (abortingCount > 0) {
      setWaterfallStats((prev) => ({
        ...prev,
        failed: prev.failed + abortingCount,
      }));
    }
    setBatchCards((prev) =>
      prev.map((card) =>
        card.state === "loading"
          ? { ...card, state: "error", error: copy("Stopped", "已停止") }
          : card
      )
    );
    setIsBatchStopped(true);
    setIsBatchLoadingMore(false);
    toast.info(copy("Waterfall stopped", "瀑布流已停止"));
  };

  const handleClearWaterfall = () => {
    batchStoppedRef.current = false;
    for (const controller of batchAbortControllersRef.current.values()) {
      controller.abort();
    }
    batchAbortControllersRef.current.clear();
    batchActiveRequestsRef.current = 0;
    batchLoadingMoreRef.current = false;
    // 清空瀑布流：一并重置里程碑计数/阈值/阻塞，并关闭可能驻留的警告弹窗
    sessionCountRef.current = 0;
    milestoneShownRef.current = new Set<number>();
    warningBlockRef.current = false;
    setWaterfallWarning(null);
    setBatchCards([]);
    setWaterfallCreditsConsumed(0);
    setWaterfallStats({ sent: 0, success: 0, failed: 0 });
    setIsBatchLoadingMore(false);
    setIsBatchStopped(false);
    setIsBatchActive(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 自动续批观察器依赖运行期 ref 的最新值,不随 ref.current 变化重建观察器。
  useEffect(() => {
    if (
      !isBatchActive ||
      !batchLoadTriggerRef.current ||
      !batchScrollRef.current
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!batchPromptRef.current || batchLoadingMoreRef.current) return;
        if (batchStoppedRef.current) return;
        if (batchActiveRequestsRef.current >= waterfallMaxConcurrentRef.current)
          return;
        const triggerGeneration = triggerBatchGenerationRef.current;
        if (!triggerGeneration) return;
        batchLoadingMoreRef.current = true;
        setIsBatchLoadingMore(true);
        void triggerGeneration().finally(() => {
          batchLoadingMoreRef.current = false;
          setIsBatchLoadingMore(false);
        });
      },
      { root: batchScrollRef.current, threshold: 0.1 }
    );

    observer.observe(batchLoadTriggerRef.current);
    return () => observer.disconnect();
  }, [isBatchActive]);

  const handleChatPaste = (event: React.ClipboardEvent) => {
    if (
      !["chat", "chat-web", "agent", "waterfall"].includes(activeMode) ||
      isChatGenerating
    ) {
      return;
    }

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File =>
        Boolean(file && (isImageFile(file) || isReadableChatFile(file)))
      );

    if (!files.length) return;
    event.preventDefault();
    void addChatAttachments(files);
  };

  const handleChatSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activeMode === "agent" && !effectiveAgentAllowed) {
      toast.error(copy("Agent is unavailable", "Agent 当前不可用"), {
        description: agentBackendUnavailableReason,
      });
      return;
    }
    if (!chatPrompt.trim()) {
      toast.error(copy("Please enter a message", "请输入消息"));
      return;
    }

    const currentPrompt = chatPrompt.trim();
    const requiresResponsesForReference =
      hasPromptImageReference(currentPrompt);
    const attachments = chatAttachments.map((item) => ({
      ...item,
      file: cloneFile(item.file),
    }));
    const hasImageAttachment = attachments.some(
      (item) => item.kind === "image"
    );
    const fallbackSize = hasImageAttachment ? chatCustomEditSize : size;
    const conversationMode = getConversationMode(activeMode);
    const cost =
      conversationMode === "agent" ? agentRoundCreditCost : chatRoundCreditCost;
    const outputSizeCheck = hasImageAttachment
      ? chatCustomEditSizeCheck
      : sizeCheck;

    if ((!customApiActive || requiresResponsesForReference) && balance < cost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!outputSizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(outputSizeCheck.message),
      });
      return;
    }
    if (attachments.length > 0) {
      const totalUploadSize = attachments.reduce(
        (total, item) => total + item.file.size,
        0
      );
      if (totalUploadSize > maxEditRequestBytes) {
        toast.error(copy("Upload is too large", "上传内容过大"), {
          description: copy(
            `Attachments total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
            `附件总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
          ),
        });
        return;
      }
    }

    const attachmentPreviews = attachments.map((item) => ({
      id: item.sourceId || item.previewUrl || item.file.name,
      name: item.file.name,
      previewUrl:
        item.kind === "image" ? URL.createObjectURL(item.file) : undefined,
      kind: item.kind,
    }));
    const generationId = createGenerationId();
    const userMessageId = createLocalId();
    const assistantMessageId = createLocalId();
    const createdAt = new Date().toISOString();
    const assistantInitialVariant = mergeChatVariant(undefined, {
      generationId,
      prompt: currentPrompt,
      model: chatImageModel !== "default" ? chatImageModel : chatModel,
      size: fallbackSize || size,
      agentEvents:
        conversationMode === "agent"
          ? createOptimisticAgentRoundEvents(1)
          : undefined,
      pending: true,
    });
    const conversationBeforeSend = chatMessages.filter((message) =>
      isMessageInConversationMode(message, conversationMode)
    );
    const pendingMessages: ChatMessage[] = [
      ...chatMessages,
      {
        id: userMessageId,
        role: "user",
        text: currentPrompt,
        mode: conversationMode,
        attachments: attachmentPreviews,
        createdAt,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        mode: conversationMode,
        text: hasImageAttachment
          ? copy("Editing image...", "正在编辑图片...")
          : copy("Generating image...", "正在生成图片..."),
        variants: [assistantInitialVariant],
        activeVariant: 0,
        createdAt,
      },
    ];
    setChatMessages(pendingMessages);
    persistChatConversationSnapshot({
      conversations: chatConversationsRef.current,
      conversationId: chatConversationId,
      mode: conversationMode,
      messages: pendingMessages,
      titleFallback: isZh ? "未命名对话" : "Untitled chat",
    });
    setChatPrompt("");
    clearStreamingPreview();
    setIsChatGenerating(true);
    setChatStream(
      createInitialChatStreamState({
        messageId: assistantMessageId,
        mode: conversationMode,
        agentMode: conversationMode === "agent",
        generationId,
        prompt: currentPrompt,
        model: chatImageModel !== "default" ? chatImageModel : chatModel,
        size: fallbackSize || size,
      })
    );
    scrollChatToBottom();

    try {
      const data = await runChatRequest({
        prompt: currentPrompt,
        attachments,
        fallbackSize: fallbackSize || size,
        historyMessages: conversationBeforeSend,
        generationId,
        streamMessageId: assistantMessageId,
        agentMode: conversationMode === "agent",
        webChat: conversationMode === "web",
      });
      const variants = addSuccessfulChatResults(
        data,
        currentPrompt,
        fallbackSize || size
      );
      // 默认展示"成品"那张:分层结果整图的 outputRole 为 final(其余层为 agent_draft),
      // 用它作活动变体,避免大图落在最后生成的某个图层上。非分层时 final 即最后一张,行为不变。
      const finalVariantIndex = variants.findIndex(
        (item) => item.outputRole === "final"
      );
      const activeIndex =
        finalVariantIndex >= 0 ? finalVariantIndex : variants.length - 1;
      const variant = variants[activeIndex];
      if (!variant || variants.length === 0) {
        const message = copy(
          "API returned no image data",
          "接口未返回图片数据"
        );
        setChatMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId
              ? {
                  ...item,
                  text: copy("Generation failed", "生成失败"),
                  error: message,
                }
              : item
          )
        );
        if (isCreatePageMountedRef.current) {
          showGenerationError(message);
        }
        return;
      }

      setChatMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text:
                  variant.responseText ||
                  (variant.imageUrl
                    ? copy("Image generated", "图片已生成")
                    : copy("Response generated", "回复已生成")),
                variants: variants.map((item) => ({
                  ...item,
                  pending: false,
                })),
                activeVariant: activeIndex,
              }
            : message
        )
      );
      clearChatAttachments();
      if (isCreatePageMountedRef.current) {
        toast.success(
          data.imageUrl
            ? copy("Image generated", "图片已生成")
            : copy("Response generated", "回复已生成")
        );
      }
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      const message =
        error instanceof Error
          ? error.message
          : copy("An unexpected error occurred.", "发生未知错误。");
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                text: copy("Generation failed", "生成失败"),
                error: message,
                variants: getChatVariants(item).map((variant) => ({
                  ...variant,
                  pending: false,
                })),
              }
            : item
        )
      );
      if (isCreatePageMountedRef.current) {
        toast.error(copy("Generation failed", "生成失败"), {
          description: message,
        });
      }
    } finally {
      setIsChatGenerating(false);
      setChatStream(null);
      clearStreamingPreview();
      if (isCreatePageMountedRef.current) {
        scrollChatToBottom();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error(copy("Please enter a prompt", "请输入提示词"));
      return;
    }
    if (!customApiActive && balance < textBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(sizeCheck.message),
      });
      return;
    }
    const currentPrompt = prompt.trim();
    const requestSize = size;
    const previewMode: VisualOutputMode = "text-single";
    const generationIds = Array.from({ length: batchCount }, () =>
      createGenerationId()
    );
    setVisualResults((prev) => ({ ...prev, [previewMode]: null }));
    setVisualResultLists((prev) => ({ ...prev, [previewMode]: [] }));
    setVisualModeLoading(previewMode, { size: requestSize });
    clearVisualStreamingPreview(previewMode);
    setIsTextSingleGenerating(true);
    try {
      const data = await runTextGenerationRequest({
        prompt: currentPrompt,
        count: batchCount,
        stream: true,
        previewMode,
        generationIds,
      });

      const generatedCount = addSuccessfulResults(data, currentPrompt, size, {
        previewMode,
      }).length;
      toast.success(
        generatedCount > 1
          ? copy(
              `${generatedCount} images generated`,
              `已生成 ${generatedCount} 张图片`
            )
          : copy("Image generated", "图片已生成")
      );
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsTextSingleGenerating(false);
      setVisualModeLoading(previewMode, null);
      clearVisualStreamingPreview(previewMode);
    }
  };

  const runTextGenerationRequest = async (params: {
    prompt: string;
    count?: number;
    stream?: boolean;
    previewMode?: VisualOutputMode;
    generationIds?: string[];
  }) => {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: {
        Accept: params.stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: params.prompt,
        size,
        stream: Boolean(params.stream),
        count: params.count || 1,
        ...(requestGroupId ? { groupId: requestGroupId } : {}),
        ...(params.generationIds?.length === 1
          ? { generationId: params.generationIds[0] }
          : {}),
        ...(params.generationIds && params.generationIds.length > 1
          ? { generationIds: params.generationIds }
          : {}),
        quality,
        output_format: outputFormat,
        background,
        ...(background === "transparent" && transparentMatte
          ? { transparent_matte: true }
          : {}),
        ...(outputFormat !== "png"
          ? { output_compression: outputCompression }
          : {}),
        ...(showImageModelControls && textModel !== "default"
          ? { model: textModel }
          : {}),
        ...(promptOptimizationAllowed ? { promptOptimization } : {}),
        ...(textMixWebFirstActive ? { mix_web_first: true } : {}),
        hd_repair: hdRepair,
        block_repair: blockRepair,
        ...(blockRepair && repairPrompt.trim()
          ? { repair_prompt: repairPrompt.trim() }
          : {}),
      }),
    });

    const data = params.stream
      ? await readImageStreamResponse(response, {
          previewMode: params.previewMode,
        })
      : await readImageApiJsonResponse(response);

    if (!response.ok || data.error) {
      const error = new Error(data.error || `API error: ${response.status}`);
      (error as GenerationRequestError).creditsConsumed = data.creditsConsumed;
      throw error;
    }

    return data;
  };

  const handleTextLineBatchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (linePromptItems.length === 0) {
      toast.error(
        copy("Enter at least one prompt line", "请至少输入一行提示词")
      );
      return;
    }
    if (!customApiActive && balance < lineBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(sizeCheck.message),
      });
      return;
    }

    const requestSize = size;
    const previewMode: VisualOutputMode = "text-lines";
    const generationIds = linePromptItems.flatMap(() =>
      Array.from({ length: lineBatchRepeatCount }, () => createGenerationId())
    );
    setVisualResults((prev) => ({ ...prev, [previewMode]: null }));
    setVisualResultLists((prev) => ({ ...prev, [previewMode]: [] }));
    setVisualModeLoading(previewMode, { size: requestSize });
    clearVisualStreamingPreview(previewMode);
    setIsTextLinesGenerating(true);
    let generatedCount = 0;
    let generationIndex = 0;
    try {
      for (const itemPrompt of linePromptItems) {
        for (
          let repeatIndex = 0;
          repeatIndex < lineBatchRepeatCount;
          repeatIndex++
        ) {
          const data = await runTextGenerationRequest({
            prompt: itemPrompt,
            count: 1,
            stream: true,
            previewMode,
            generationIds: [
              generationIds[generationIndex] || createGenerationId(),
            ],
          });
          generationIndex += 1;
          generatedCount += addSuccessfulResults(data, itemPrompt, size, {
            previewMode,
          }).length;
        }
      }

      toast.success(
        generatedCount > 1
          ? copy(
              `${generatedCount} images generated`,
              `已生成 ${generatedCount} 张图片`
            )
          : copy("Image generated", "图片已生成")
      );
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsTextLinesGenerating(false);
      setVisualModeLoading(previewMode, null);
      clearVisualStreamingPreview(previewMode);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPrompt.trim()) {
      toast.error(copy("Please enter an edit prompt", "请输入编辑提示词"));
      return;
    }
    if (editImages.length === 0) {
      toast.error(
        copy("Upload at least one source image", "请至少上传一张源图片")
      );
      return;
    }
    if (!effectiveEditSize) {
      toast.error(copy("Waiting for source image size", "正在读取源图片尺寸"), {
        description: copy(
          "The first source image is still loading.",
          "第一张源图片仍在加载。"
        ),
      });
      return;
    }
    if (!useEditFirstImageSize && !customEditSizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(customEditSizeCheck.message),
      });
      return;
    }
    const editRequiresResponsesForReference =
      hasPromptImageReference(editPrompt);
    if (
      (!customApiActive || editRequiresResponsesForReference) &&
      balance < editBatchCreditCost
    ) {
      showGenerationError("Insufficient credits");
      return;
    }
    const effectiveMaskFile =
      maskFile ||
      (maskPoints.length > 0 ? await saveDrawnMask({ silent: true }) : null);
    if (maskPoints.length > 0 && !effectiveMaskFile) return;
    const orderedEditImages =
      effectiveMaskFile && maskSourceIndex > 0
        ? [
            editImages[maskSourceIndex],
            ...editImages.filter((_, index) => index !== maskSourceIndex),
          ].filter((item): item is EditImageFile => Boolean(item))
        : editImages;
    const totalUploadSize =
      orderedEditImages.reduce((total, item) => total + item.file.size, 0) +
      (effectiveMaskFile?.file.size || 0);
    if (totalUploadSize > maxEditRequestBytes) {
      toast.error(copy("Upload is too large", "上传内容过大"), {
        description: copy(
          `Source images and mask total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
          `源图片和蒙版总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
        ),
      });
      return;
    }

    const currentEditPrompt = editPrompt.trim();
    const generationIds = Array.from({ length: editBatchCount }, () =>
      createGenerationId()
    );
    const formData = new FormData();
    formData.append("prompt", currentEditPrompt);
    if (requestGroupId) formData.append("groupId", requestGroupId);
    formData.append("quality", quality);
    formData.append("output_format", outputFormat);
    formData.append("background", background);
    // 透明抠图回退显式开关(issue #27)。
    if (background === "transparent" && transparentMatte) {
      formData.append("transparent_matte", "true");
    }
    // 高清修复:关闭时显式传 false 走轻量 general-x4v3;默认(true)由后端选 SwinIR。
    formData.append("hd_repair", String(hdRepair));
    // 分块修复:开关 + 每块提示词(非空才传)。
    formData.append("block_repair", String(blockRepair));
    if (blockRepair && repairPrompt.trim()) {
      formData.append("repair_prompt", repairPrompt.trim());
    }
    if (outputFormat !== "png") {
      formData.append("output_compression", String(outputCompression));
    }
    if (showImageModelControls && editModel !== "default") {
      formData.append("model", editModel);
    }
    if (useEditFirstImageSize) {
      formData.append("displaySize", effectiveEditSize);
    } else {
      formData.append("size", effectiveEditSize);
    }
    orderedEditImages.forEach(({ file }) => {
      formData.append(
        orderedEditImages.length === 1 ? "image" : "image[]",
        file
      );
    });
    if (effectiveMaskFile) formData.append("mask", effectiveMaskFile.file);
    formData.append("count", String(editBatchCount));
    if (generationIds.length === 1) {
      const generationId = generationIds[0];
      if (!generationId) {
        throw new Error("Expected one generation id for edit request");
      }
      formData.append("generationId", generationId);
    } else {
      formData.append("generationIds", JSON.stringify(generationIds));
    }
    if (promptOptimizationAllowed) {
      formData.append("prompt_optimization", String(promptOptimization));
    }
    if (hasPromptImageReference(editPrompt)) {
      formData.append("requires_responses_backend", "true");
    } else if (editMixWebFirstActive) {
      formData.append("mix_web_first", "true");
    }

    setVisualResults((prev) => ({ ...prev, image: null }));
    setVisualResultLists((prev) => ({ ...prev, image: [] }));
    setVisualModeLoading("image", { size: effectiveEditSize });
    setIsEditing(true);
    clearVisualStreamingPreview("image");
    formData.append("stream", "true");
    try {
      const response = await fetch("/api/images/edit", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
        },
        body: formData,
      });
      const data = await readImageStreamResponse(response, {
        previewMode: "image",
      });

      if (!response.ok || data.error) {
        showGenerationError(data.error || `API error: ${response.status}`, {
          creditsConsumed: data.creditsConsumed,
        });
        return;
      }

      const generatedCount = addSuccessfulResults(
        data,
        currentEditPrompt,
        effectiveEditSize,
        { previewMode: "image" }
      ).length;
      toast.success(
        generatedCount > 1
          ? copy(
              `${generatedCount} images edited`,
              `已编辑 ${generatedCount} 张图片`
            )
          : copy("Image edited", "图片已编辑")
      );
    } catch (error) {
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsEditing(false);
      setVisualModeLoading("image", null);
      clearVisualStreamingPreview("image");
    }
  };

  const addImages = (files: FileList | File[] | null) => {
    const imageFiles = Array.from(files || []);
    if (!imageFiles.length) return;

    const accepted: EditImageFile[] = [];
    for (const file of imageFiles) {
      if (!isImageFile(file)) {
        toast.error(copy("Unsupported file type", "不支持的文件类型"), {
          description: copy(
            "Use PNG, JPEG, or WebP images.",
            "请使用 PNG、JPEG 或 WebP 图片。"
          ),
        });
        continue;
      }
      if (file.size > maxImageBytes) {
        toast.error(copy("File too large", "文件过大"), {
          description: copy(
            `${file.name} exceeds ${formatMegabytes(maxImageBytes)}.`,
            `${file.name} 超过 ${formatMegabytes(maxImageBytes)}。`
          ),
        });
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (!accepted.length) return;
    setEditImages((prev) => {
      const slots = maxEditImages - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl);
        }
        toast.error(
          copy(
            `Upload up to ${maxEditImages} source images`,
            `最多可上传 ${maxEditImages} 张源图片`
          )
        );
        return prev;
      }
      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(
          copy(
            `Only ${slots} more source image(s) can be added`,
            `还可以再添加 ${slots} 张源图片`
          )
        );
      }
      return [...prev, ...next];
    });
  };

  const handleImagePaste = (event: React.ClipboardEvent) => {
    if (activeMode !== "image" || isEditing) return;

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file && isImageFile(file)));

    if (!files.length) return;
    event.preventDefault();
    addImages(files);
  };

  const removeImage = (index: number) => {
    setEditImages((prev) => {
      const target = prev[index];
      if (target) revokePreview(target.previewUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
    setMaskSourceIndex((prev) => {
      if (prev === index) return Math.max(0, prev - 1);
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  const clearEditImages = () => {
    setEditImages((prev) => {
      for (const item of prev) {
        revokePreview(item.previewUrl);
      }
      return [];
    });
    setMaskEditorOpen(false);
    setMaskSourceIndex(0);
    setMaskPoints([]);
    clearMask();
  };

  const clearMask = () => {
    setMaskFile((prev) => {
      if (prev) revokePreview(prev.previewUrl);
      return null;
    });
  };

  const clearDrawnMask = () => {
    setMaskPoints([]);
    clearMask();
  };

  const addMaskPoint = (x: number, y: number) => {
    setMaskPoints((prev) => [...prev, { x, y, size: maskBrushSize }]);
    clearMask();
  };

  const getMaskPointerPosition = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const point =
      "touches" in event ? event.touches[0] || event.changedTouches[0] : event;
    if (!point) return null;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startMaskDrawing = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    if (!point) return;
    isDrawingRef.current = true;
    lastMaskPointRef.current = point;
    addMaskPoint(point.x, point.y);
  };

  const drawMaskLine = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    const lastPoint = lastMaskPointRef.current;
    if (!point || !lastPoint) return;

    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    const angle = Math.atan2(point.y - lastPoint.y, point.x - lastPoint.x);
    const step = Math.max(1, maskBrushSize / 4);
    const nextPoints: MaskPoint[] = [];

    for (let i = step; i < distance; i += step) {
      nextPoints.push({
        x: lastPoint.x + Math.cos(angle) * i,
        y: lastPoint.y + Math.sin(angle) * i,
        size: maskBrushSize,
      });
    }
    nextPoints.push({ x: point.x, y: point.y, size: maskBrushSize });
    setMaskPoints((prev) => [...prev, ...nextPoints]);
    clearMask();
    lastMaskPointRef.current = point;
  };

  const stopMaskDrawing = () => {
    isDrawingRef.current = false;
    lastMaskPointRef.current = null;
  };

  const saveDrawnMask = (options?: { silent?: boolean }) =>
    new Promise<EditImageFile | null>((resolve) => {
      if (!maskSourceImageSize || maskPoints.length === 0) {
        if (!options?.silent) {
          toast.error(copy("Draw a mask area first", "请先绘制蒙版区域"));
        }
        resolve(null);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = maskSourceImageSize.width;
      canvas.height = maskSourceImageSize.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "destination-out";
      for (const point of maskPoints) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        ctx.fill();
      }

      const previewUrl = canvas.toDataURL("image/png");
      canvas.toBlob((blob) => {
        if (!blob) {
          if (!options?.silent) {
            toast.error(copy("Failed to save mask", "保存蒙版失败"));
          }
          resolve(null);
          return;
        }
        const file = new File([blob], "generated-mask.png", {
          type: "image/png",
        });
        const item = { file, previewUrl };
        setMaskFile((prev) => {
          if (prev) revokePreview(prev.previewUrl);
          return item;
        });
        if (!options?.silent) {
          toast.success(copy("Mask saved", "蒙版已保存"));
        }
        resolve(item);
      }, "image/png");
    });

  const openMaskEditorForImage = (index: number) => {
    if (isEditing) return;
    setMaskSourceIndex(index);
    setMaskEditorOpen(true);
    // 重新打开画板时 canvas 会重新挂载,克隆点位触发重绘以保留未保存笔迹。
    setMaskPoints((prev) => [...prev]);
  };

  /**
   * 收起当前蒙版画板,保留已绘制点位和已保存蒙版供后续提交使用。
   *
   * @returns 无返回值。
   * @sideEffects 终止当前绘制手势并关闭蒙版编辑 UI。
   * @failureMode 生成中时不允许关闭,避免提交过程中的状态抖动。
   */
  const closeMaskEditor = () => {
    if (isEditing) return;
    stopMaskDrawing();
    setMaskEditorOpen(false);
  };

  const applyResultAsReference = async (sourceResult = result) => {
    if (!sourceResult?.imageUrl) return;

    try {
      const item = await urlToEditImageFile(
        sourceResult.imageUrl,
        `gpt2image-${sourceResult.generationId}`,
        sourceResult.generationId
      );
      clearEditImages();
      setEditImages([item]);
      switchActiveMode("image");
      setEditPrompt("");
      toast.success(
        copy("Result added as reference image", "结果已作为参考图片")
      );
    } catch (error) {
      toast.error(
        copy("Failed to use result as reference", "设置参考图片失败"),
        {
          description:
            error instanceof Error
              ? error.message
              : copy("Could not load image.", "无法加载图片。"),
        }
      );
    }
  };

  const selectRecentAsReference = async (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error(copy("This image is not available yet", "这张图片暂不可用"));
      return;
    }

    const existingIndex = editImages.findIndex(
      (item) => item.sourceId === generation.id
    );
    if (existingIndex >= 0) {
      removeImage(existingIndex);
      toast.success(copy("Reference image removed", "参考图片已移除"));
      return;
    }

    if (editImages.length >= maxEditImages) {
      toast.error(
        copy(
          `Upload up to ${maxEditImages} source images`,
          `最多可上传 ${maxEditImages} 张源图片`
        )
      );
      return;
    }

    try {
      const item = await urlToEditImageFile(
        generation.imageUrl,
        `gpt2image-${generation.id}`,
        generation.id
      );
      setEditImages((prev) => [...prev, item]);
      toast.success(copy("Reference image selected", "参考图片已选择"));
    } catch (error) {
      toast.error(
        copy("Failed to use image as reference", "设置参考图片失败"),
        {
          description:
            error instanceof Error
              ? error.message
              : copy("Could not load image.", "无法加载图片。"),
        }
      );
    }
  };

  const openRecentPreview = (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error(copy("This image is not available yet", "这张图片暂不可用"));
      return;
    }
    setSelectedRecentId(generation.id);
  };

  const handleRecentClick = (generation: RecentGeneration) => {
    if (isConversationMode(activeMode)) {
      if (!generation.imageUrl) {
        toast.error(
          copy("This image is not available yet", "这张图片暂不可用")
        );
        return;
      }
      void attachImageUrlToChat(
        generation.imageUrl,
        `gpt2image-${generation.id}`,
        generation.id
      );
      return;
    }

    if (activeMode === "image") {
      void selectRecentAsReference(generation);
      return;
    }
    openRecentPreview(generation);
  };

  const selectedRecent =
    recent.find((item) => item.id === selectedRecentId) ??
    chatMessages.flatMap((message) =>
      getChatVariants(message)
        .filter((variant) => variant.generationId === selectedRecentId)
        .map(
          (variant): ChatRecentGeneration => ({
            id: variant.generationId || createLocalId(),
            prompt: variant.prompt,
            revisedPrompt: variant.revisedPrompt || null,
            model: variant.model,
            size: variant.size,
            creditsConsumed: variant.creditsConsumed || 0,
            status: "completed",
            imageUrl: variant.imageUrl || null,
            createdAt: variant.createdAt || new Date().toISOString(),
            canDelete: false,
          })
        )
    )[0] ??
    // 文生图/视觉模式的结果存在 visualResults(不在 recent/chat 里),也要能解析出来供预览,
    // 否则点击结果图时找不到对应项 → 预览打不开(假按钮)。
    Object.values(visualResults)
      .filter(
        (result): result is ResultState =>
          result != null && result.generationId === selectedRecentId
      )
      .map(
        (result): ChatRecentGeneration => ({
          id: result.generationId,
          prompt: result.prompt,
          revisedPrompt: result.revisedPrompt ?? null,
          model: result.model,
          size: result.size,
          creditsConsumed: result.creditsConsumed ?? 0,
          status: "completed",
          imageUrl: result.imageUrl,
          createdAt: new Date().toISOString(),
          canDelete: false,
        })
      )[0] ??
    Object.values(visualResultLists)
      .flatMap((items) => items || [])
      .filter((result) => result.generationId === selectedRecentId)
      .map(
        (result): ChatRecentGeneration => ({
          id: result.generationId,
          prompt: result.prompt,
          revisedPrompt: result.revisedPrompt ?? null,
          model: result.model,
          size: result.size,
          creditsConsumed: result.creditsConsumed ?? 0,
          status: "completed",
          imageUrl: result.imageUrl,
          createdAt: new Date().toISOString(),
          canDelete: false,
        })
      )[0] ??
    null;

  const textSettingsPanel = (
    mode: TextGenerationMode,
    actionButton: ReactNode
  ) => {
    const isLineMode = mode === "lines";
    const modeBusy = isLineMode
      ? isTextLinesGenerating
      : isTextSingleGenerating;
    const countValue = isLineMode ? lineBatchRepeatCount : batchCount;
    const setCountValue = (value: number) => {
      const normalized = Math.min(Math.max(1, value), textImageCountMax);
      if (isLineMode) {
        setLineBatchRepeatCount(normalized);
      } else {
        setBatchCount(normalized);
      }
    };
    const formattedCost = isLineMode
      ? formattedLineBatchCreditCost
      : formattedTextBatchCreditCost;
    const costSuffix = isLineMode
      ? copy(
          ` for ${lineBatchTotalCount} total`,
          `，共 ${lineBatchTotalCount} 张`
        )
      : batchCostSuffix(batchCount);

    return (
      <CreatePageTextSettingsPanel
        mode={mode}
        modeBusy={modeBusy}
        copy={copy}
        renderBackendGroupSelect={renderBackendGroupSelect}
        renderAdvancedImageSettings={renderAdvancedImageSettings}
        showImageModelControls={showImageModelControls}
        labelWithHelp={labelWithHelp}
        imageModelHelpText={imageModelHelpText}
        textModel={textModel}
        textModelOptions={textModelOptions}
        textModelLabel={textModelLabel}
        onTextModelChange={setTextModel}
        countValue={countValue}
        countMax={textImageCountMax}
        onCountChange={setCountValue}
        textSizeDialogValue={textSizeDialogValue}
        onTextSizeChange={(next) => {
          setUseAutoSize(next.auto);
          setTextMixWebFirst(next.mixWebFirst);
          if (!next.auto) {
            setWidth(next.width);
            setHeight(next.height);
          }
        }}
        resolutionHelpText={resolutionHelpText}
        formattedBalance={formattedBalance}
        formattedCost={formattedCost}
        costSuffix={costSuffix}
        customApiActive={customApiActive}
        customApiBillingLabel={customApiBillingLabel}
        sizeCheckValid={sizeCheck.valid}
        sizeCheckMessage={sizeCheck.valid ? undefined : sizeCheck.message}
        validationMessage={validationMessage}
        hideResponseControls={isWebOnlyBackend}
        qualityDisabled={modeBusy || disableResponsesOnlyControls}
        outputDisabled={
          modeBusy || disableResponsesOnlyControls || textFireflyActive
        }
        backgroundDisabled={modeBusy || disableResponsesOnlyControls}
        actionButton={actionButton}
      />
    );
  };

  const renderVisualOutput = (mode: VisualOutputMode) => {
    const loading = isVisualModeLoading(mode);
    const modeResult = visualResults[mode] || null;
    const modeResults = visualResultLists[mode] || [];
    const dimensions = getVisualLoadingDimensions(mode);
    const previewUrl = visualPreviewUrls[mode] || null;
    const resultDimensions = modeResult
      ? parseImageSize(modeResult.size)
      : null;
    const placeholderCount =
      mode === "image"
        ? editBatchCount
        : mode === "text-lines"
          ? lineBatchTotalCount
          : batchCount;

    return (
      <CreatePageVisualOutputPanel
        loading={loading}
        modeResult={modeResult}
        modeResults={modeResults}
        placeholderCount={placeholderCount}
        dimensions={dimensions}
        resultDimensions={resultDimensions}
        previewUrl={previewUrl}
        copy={copy}
        onOpenPreview={setSelectedRecentId}
        onApplyAsReference={applyResultAsReference}
      />
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] px-0 py-2 md:py-4">
      {!fallbackMode && (
        <div className="rounded-lg border bg-background px-4 py-5 text-sm text-muted-foreground">
          {copy(
            "All creation modes are currently disabled by the operator.",
            "运营端已暂时关闭所有创作模式。"
          )}
        </div>
      )}

      <div className="mb-10">
        <CreatePageTextPanel
          activeMode={activeMode}
          textAllowed={textAllowed}
          textMode={textMode}
          prompt={prompt}
          linePrompts={linePrompts}
          linePromptCount={linePromptItems.length}
          lineBatchTotalCount={lineBatchTotalCount}
          isTextSingleGenerating={isTextSingleGenerating}
          isTextLinesGenerating={isTextLinesGenerating}
          copy={copy}
          onTextModeChange={setTextMode}
          onPromptChange={setPrompt}
          onLinePromptsChange={setLinePrompts}
          onSingleSubmit={handleSubmit}
          onLinesSubmit={handleTextLineBatchSubmit}
          renderVisualOutput={renderVisualOutput}
          renderSettingsPanel={textSettingsPanel}
        />

        <CreatePageImagePanel
          activeMode={activeMode}
          imageAllowed={imageAllowed}
          copy={copy}
          onSubmit={handleEditSubmit}
          onPaste={handleImagePaste}
          renderVisualOutput={renderVisualOutput}
          renderReferenceMentionMenu={renderReferenceMentionMenu}
          renderBackendGroupSelect={renderBackendGroupSelect}
          renderAdvancedImageSettings={renderAdvancedImageSettings}
          hideResponseControls={isWebOnlyBackend}
          qualityDisabled={isEditing || disableResponsesOnlyControls}
          outputDisabled={
            isEditing || disableResponsesOnlyControls || editFireflyActive
          }
          backgroundDisabled={isEditing || disableResponsesOnlyControls}
          imageAccept={IMAGE_ACCEPT}
          editImages={editImages}
          imageInputRef={imageInputRef}
          maskCanvasRef={maskCanvasRef}
          maxEditImages={maxEditImages}
          maxEditRequestBytes={maxEditRequestBytes}
          isEditing={isEditing}
          maskEditorOpen={maskEditorOpen}
          maskSourceDisplayIndex={maskSourceDisplayIndex}
          maskSourcePreviewUrl={maskSourcePreviewUrl}
          maskSourceImageSize={maskSourceImageSize}
          maskBrushSize={maskBrushSize}
          maskHasPoints={maskPoints.length > 0}
          maskFile={maskFile}
          onAddImages={addImages}
          onClearEditImages={clearEditImages}
          onOpenMaskEditorForImage={openMaskEditorForImage}
          onCloseMaskEditor={closeMaskEditor}
          onRemoveImage={removeImage}
          onStartMaskDrawing={startMaskDrawing}
          onDrawMaskLine={drawMaskLine}
          onStopMaskDrawing={stopMaskDrawing}
          onMaskBrushSizeChange={setMaskBrushSize}
          onClearDrawnMask={clearDrawnMask}
          onClearSavedMask={clearMask}
          onSaveDrawnMask={() => void saveDrawnMask()}
          editMention={editMention}
          canUseEditReferenceMentions={canUseEditReferenceMentions}
          filteredEditReferenceOptions={filteredEditReferenceOptions}
          onSelectEditMention={selectEditMention}
          editPromptRef={editPromptRef}
          editPrompt={editPrompt}
          onEditPromptChange={handleEditPromptChange}
          onEditMentionChange={setEditMention}
          getMentionTriggerForPrompt={getMentionTrigger}
          editReferenceMentionStatusText={editReferenceMentionStatusText}
          showImageModelControls={showImageModelControls}
          labelWithHelp={labelWithHelp}
          imageModelHelpText={imageModelHelpText}
          editModel={editModel}
          onEditModelChange={setEditModel}
          editModelOptions={editModelOptions}
          editModelLabel={editModelLabel}
          useEditFirstImageSize={useEditFirstImageSize}
          onUseEditFirstImageSizeChange={setUseEditFirstImageSize}
          onUseAutoEditSizeChange={setUseAutoEditSize}
          editBatchCount={editBatchCount}
          batchCountMax={batchCountMax}
          onEditBatchCountChange={setEditBatchCount}
          editResolutionControlValue={editResolutionControlValue}
          onEditResolutionChange={(next) => {
            setUseEditFirstImageSize(false);
            setUseAutoEditSize(next.auto);
            setEditMixWebFirst(next.mixWebFirst);
            if (!next.auto) {
              setEditWidth(next.width);
              setEditHeight(next.height);
            }
          }}
          customEditSizeCheckValid={customEditSizeCheck.valid}
          customEditSizeCheckMessage={
            customEditSizeCheck.valid ? undefined : customEditSizeCheck.message
          }
          validationMessage={validationMessage}
          editDisplaySize={editDisplaySize}
          editReferenceSizeNote={editReferenceSizeNote}
          customApiActive={customApiActive}
          editHasImageReference={editHasImageReference}
          customApiBillingLabel={customApiBillingLabel}
          formattedEditBatchCreditCost={formattedEditBatchCreditCost}
          batchCostSuffix={batchCostSuffix}
          resolutionHelpText={resolutionHelpText}
        />

        <div
          role="tabpanel"
          hidden={
            (activeMode !== "chat" &&
              activeMode !== "chat-web" &&
              activeMode !== "agent") ||
            (activeMode === "chat" && !chatAllowed) ||
            (activeMode === "chat-web" && !chatAllowed) ||
            (activeMode === "agent" && !effectiveAgentAllowed)
          }
          className="mt-0"
        >
          <div className="space-y-4">
            <CreatePageChatAgentHeader
              activeMode={activeMode}
              activeConversationExists={activeConversationExists}
              chatConversationId={chatConversationId}
              conversations={currentModeConversations}
              isGenerating={isChatGenerating}
              visibleMessageCount={visibleChatMessages.length}
              attachmentCount={chatAttachments.length}
              copy={copy}
              onOpenConversation={handleOpenChatConversation}
              onNewChat={handleNewChat}
              onClearHistory={handleClearChatHistory}
              onClearAttachments={clearChatAttachments}
            />

            <div className="flex min-h-[680px] flex-col overflow-hidden rounded-lg border border-border bg-background">
              <CreatePageChatMessageList
                messages={visibleChatMessages}
                chatMessagesRef={chatMessagesRef}
                activeMode={activeMode}
                activeConversationMode={activeConversationMode}
                chatStream={chatStream}
                retryingChatMessageId={retryingChatMessageId}
                isChatGenerating={isChatGenerating}
                copy={copy}
                renderChatStreamBubble={renderChatStreamBubble}
                renderThinkingBlock={renderThinkingBlock}
                renderAgentRoundCards={renderAgentRoundCards}
                onOpenPreview={setSelectedRecentId}
                onAttachResultToChat={(variant) =>
                  void attachResultToChat(variant)
                }
                onVariantChange={handleChatVariantChange}
                onVariantSelect={handleChatVariantSelect}
                onRetry={(assistantId) => void handleChatRetry(assistantId)}
              />

              {renderChatInput()}
            </div>
          </div>
        </div>

        <div
          role="tabpanel"
          hidden={activeMode !== "waterfall" || !waterfallAllowed}
          className="mt-0"
        >
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {renderBackendGroupSelect({
                  id: "batch-backend-group",
                  disabled: isBatchActive,
                  compact: true,
                })}
                {/* 每批并发张数(tier)：对齐原项目 TIER，可选项受套餐并发上限约束 */}
                <Select
                  value={String(effectiveWaterfallTier)}
                  onValueChange={(value) => setWaterfallTier(Number(value))}
                  disabled={isBatchActive}
                >
                  <SelectTrigger
                    id="waterfall-tier"
                    className="h-8 w-auto gap-1"
                    title={copy(
                      "Images per batch (concurrency)",
                      "每批生成张数(并发)"
                    )}
                  >
                    <span className="text-xs text-muted-foreground">
                      {copy("Batch", "每批")}
                    </span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {waterfallTierOptions.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* 质量：复用 quality 状态(瀑布流请求已发送该参数)，Web-only 后端不支持故隐藏 */}
                {!isWebOnlyBackend && (
                  <Select
                    value={quality}
                    onValueChange={(value) => setQuality(value as ImageQuality)}
                    disabled={isBatchActive || disableResponsesOnlyControls}
                  >
                    <SelectTrigger
                      id="waterfall-quality"
                      className="h-8 w-auto gap-1"
                      title={copy("Image quality", "图像质量")}
                    >
                      <span className="text-xs text-muted-foreground">
                        {copy("Quality", "质量")}
                      </span>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {qualityLabel(option.value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <ImageSizePresetButton
                  label={`${copy("Size", "尺寸")}：${
                    hasChatImageAttachments
                      ? useAutoChatEditSize
                        ? autoSizeLabel
                        : chatCustomEditSize
                      : useAutoSize
                        ? autoSizeLabel
                        : size
                  }`}
                  value={chatSizeDialogValue}
                  onChange={handleConversationSizeChange}
                  disabled={isBatchActive}
                  className="h-8 rounded-md px-3 text-xs"
                  title={copy("Set image aspect ratio", "设置图像比例")}
                  copy={copy}
                />
                {!isWebOnlyBackend && (
                  <div title={backgroundHelpText}>
                    {renderBackgroundSelect({
                      id: "batch-background",
                      disabled: isBatchActive || disableResponsesOnlyControls,
                      compact: true,
                    })}
                  </div>
                )}
                {!isWebOnlyBackend &&
                  renderTransparentMatteToggle({
                    id: "batch-transparent-matte",
                    disabled: isBatchActive || disableResponsesOnlyControls,
                  })}
                {renderHdRepairToggle({
                  id: "batch-hd-repair",
                  disabled: isBatchActive,
                })}
                {renderBlockRepairToggle({
                  id: "batch-block-repair",
                  disabled: isBatchActive,
                })}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {promptOptimizationField(
                  "batch-prompt-optimization",
                  isBatchActive
                )}
                <div className="text-xs text-muted-foreground">
                  {customApiActive ? (
                    <span className="font-medium text-foreground">
                      {customApiBillingLabel}
                    </span>
                  ) : (
                    <>
                      {copy("Per image", "单张预计")}{" "}
                      <span className="font-medium text-foreground">
                        {formattedBatchSingleCreditCost}
                      </span>
                      {isBatchActive && (
                        <>
                          {" "}
                          <span className="text-muted-foreground">/</span>{" "}
                          {copy("Used", "已用")}{" "}
                          <span className="font-medium text-foreground">
                            {formattedWaterfallCreditsConsumed}
                          </span>
                        </>
                      )}{" "}
                      <span className="text-muted-foreground">/</span>{" "}
                      {copy("Balance", "余额")}{" "}
                      <span className="font-medium text-foreground">
                        {formattedBalance}
                      </span>{" "}
                    </>
                  )}
                </div>
              </div>
            </div>

            {!isBatchActive ? (
              <div className="mx-auto flex min-h-[560px] max-w-3xl flex-col justify-center px-4 py-10">
                <div className="mb-5 text-center">
                  <h2 className="font-serif text-2xl font-semibold tracking-tight">
                    {copy(
                      "What world will you flood with art?",
                      "你想让哪个世界充满图像？"
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {copy(
                      "One prompt, endless creations",
                      "一个提示词，瀑布生成灵感"
                    )}
                  </p>
                </div>
                <form
                  onSubmit={handleBatchSubmit}
                  onPaste={handleChatPaste}
                  className="space-y-3"
                >
                  {hasChatImageAttachments && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {chatAttachments
                        .filter((item) => item.kind === "image")
                        .map((item, index) => (
                          <button
                            type="button"
                            key={`${item.file.name}-${item.previewUrl}`}
                            className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted"
                            onClick={() => removeChatAttachment(index)}
                            title={copy(
                              "Remove reference image",
                              "移除参考图片"
                            )}
                          >
                            <Image
                              src={item.previewUrl || ""}
                              alt={item.file.name}
                              fill
                              sizes="48px"
                              className="object-cover"
                              unoptimized
                            />
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => batchImageInputRef.current?.click()}
                      disabled={chatAttachments.length >= maxChatImages}
                      title={copy("Attach reference image", "添加参考图片")}
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                    <Textarea
                      value={batchPrompt}
                      onChange={(event) => setBatchPrompt(event.target.value)}
                      placeholder={copy(
                        "Describe the images you want to generate...",
                        "描述你想生成的图片..."
                      )}
                      rows={1}
                      className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <Button
                      type="submit"
                      size="icon-sm"
                      disabled={!batchPrompt.trim()}
                      title={copy("Start waterfall", "开始瀑布流")}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <input
                      ref={batchImageInputRef}
                      type="file"
                      multiple
                      accept={IMAGE_ACCEPT}
                      className="sr-only"
                      onChange={(event) => {
                        void addBatchAttachments(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                </form>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {chatSuggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="max-w-full"
                      onClick={() => handleBatchSuggestion(suggestion)}
                      title={suggestion}
                    >
                      <span className="truncate">
                        {suggestion.length > 40
                          ? `${suggestion.slice(0, 40)}...`
                          : suggestion}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <CreatePageWaterfallGrid
                scrollRef={batchScrollRef}
                loadTriggerRef={batchLoadTriggerRef}
                cards={batchCards}
                promptTitle={batchPromptRef.current || batchPrompt}
                statusText={waterfallStatusText}
                isStopped={isBatchStopped}
                isLoadingMore={isBatchLoadingMore}
                copy={copy}
                renderThinkingBlock={renderThinkingBlock}
                renderAgentBlock={renderAgentBlock}
                onContinue={() => {
                  batchStoppedRef.current = false;
                  setIsBatchStopped(false);
                  void triggerBatchGeneration();
                }}
                onStop={handleStopWaterfall}
                onClear={handleClearWaterfall}
                onOpenPreview={setSelectedRecentId}
                onSaveCard={saveBatchCardToRecent}
                onRetryCard={(cardId) =>
                  void triggerBatchGeneration({ retryCardId: cardId })
                }
              />
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          hidden={activeMode !== "video" || !videoAllowed}
          className="mt-0"
        >
          <VideoCreatePanel recent={recent} pricing={videoPricing} />
        </div>
      </div>

      <CreatePageRecentPanel
        recent={recent}
        activeMode={activeMode}
        editImages={editImages}
        selectedRecent={selectedRecent}
        selectedRecentId={selectedRecentId}
        copy={copy}
        isConversationMode={isConversationMode}
        onRecentClick={handleRecentClick}
        onClosePreview={() => setSelectedRecentId(null)}
        onDeleteRecent={(id) => {
          setRecent((prev) => prev.filter((item) => item.id !== id));
          setEditImages((prev) => {
            const next = prev.filter((item) => item.sourceId !== id);
            for (const item of prev) {
              if (item.sourceId === id) revokePreview(item.previewUrl);
            }
            return next;
          });
        }}
      />

      {waterfallWarning && (
        <WaterfallWarningPopup
          type={waterfallWarning.type}
          tier={waterfallWarning.tier}
          count={waterfallWarning.count}
          copy={copy}
          onClose={() => {
            // 里程碑警告确认后：解除阻塞并恢复自动续批；首次提示关闭仅落标记不续批
            const wasMilestoneBlock = warningBlockRef.current;
            setWaterfallWarning(null);
            if (wasMilestoneBlock) {
              warningBlockRef.current = false;
              void triggerBatchGeneration();
            }
          }}
        />
      )}
    </div>
  );
}
