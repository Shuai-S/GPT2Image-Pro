"use client";

import { Button } from "@repo/ui/components/button";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Wand2,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { memo } from "react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import { parseImageSize } from "../resolution";
import {
  defaultDimensions,
  shouldBypassImageOptimization,
  thumbSrc,
} from "./create-page-options";
import type {
  ActiveMode,
  AgentRunEvent,
  ChatMessage,
  ChatStreamState,
  ChatVariant,
  ConversationMode,
} from "./create-page-types";
import { getActiveChatVariant, getChatVariants } from "./create-page-utils";

// Chat/Agent 消息列表:负责用户/助手气泡、图片预览、变体翻页、多候选选择和重试入口。

/**
 * 渲染 Chat/Agent 对话消息列表。
 *
 * @param props.messages 当前模式可见消息。
 * @param props.chatMessagesRef 滚动容器 ref。
 * @param props.activeMode 当前模式。
 * @param props.activeConversationMode 当前对话模式。
 * @param props.chatStream 当前流式消息状态。
 * @param props.retryingChatMessageId 当前重试消息 id。
 * @param props.isChatGenerating 是否正在生成。
 * @param props.copy 中英文文案选择器。
 * @param props.renderChatStreamBubble 流式气泡渲染器。
 * @param props.renderThinkingBlock thinking 渲染器。
 * @param props.renderAgentRoundCards Agent 过程渲染器。
 * @param props.onOpenPreview 打开图片预览回调。
 * @param props.onAttachResultToChat 将结果作为下一轮附件回调。
 * @param props.onVariantChange 切换上一/下一变体回调。
 * @param props.onVariantSelect 选择指定变体回调。
 * @param props.onRetry 重试 assistant 消息回调。
 * @returns Chat/Agent 消息滚动区。
 * @sideEffects 用户操作通过回调通知父组件。
 * @failureMode 无消息时展示当前模式的空状态。
 */
export function CreatePageChatMessageList({
  messages,
  chatMessagesRef,
  activeMode,
  activeConversationMode,
  chatStream,
  retryingChatMessageId,
  isChatGenerating,
  copy,
  renderChatStreamBubble,
  renderThinkingBlock,
  renderAgentRoundCards,
  onOpenPreview,
  onAttachResultToChat,
  onVariantChange,
  onVariantSelect,
  onRetry,
}: {
  messages: ChatMessage[];
  chatMessagesRef: RefObject<HTMLDivElement | null>;
  activeMode: ActiveMode;
  activeConversationMode: ConversationMode;
  chatStream: ChatStreamState | null;
  retryingChatMessageId: string | null;
  isChatGenerating: boolean;
  copy: (en: string, zh: string) => string;
  renderChatStreamBubble: (messageId?: string) => ReactNode;
  renderThinkingBlock: (thinking?: string, open?: boolean) => ReactNode;
  renderAgentRoundCards: (
    events?: AgentRunEvent[],
    fallbackAgent?: string,
    open?: boolean
  ) => ReactNode;
  onOpenPreview: (generationId: string) => void;
  onAttachResultToChat: (variant: ChatVariant) => void;
  onVariantChange: (messageId: string, direction: -1 | 1) => void;
  onVariantSelect: (messageId: string, nextIndex: number) => void;
  onRetry: (assistantId: string) => void;
}) {
  // 长会话虚拟化:scrollRef = chatMessagesRef(overflow-y-auto 容器)。WHY 选用 useVirtualizer
  // 而非 window 版:chat 是面板内独立滚动区,scroll element 为该 div 而非 window。
  // 流式追加时消息数与单条高度都会变,virtualizer 内部动态 measure 维持滚动条正确;
  // getItemKey 用 message.id 保证流式追加/重排时 DOM 复用稳定,避免列表跳变。父组件
  // scrollChatToBottom 用 element.scrollTop = element.scrollHeight 仍有效,因虚拟占位
  // 容器 height = totalSize 保持文档盒模型真实高度。
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => chatMessagesRef.current,
    estimateSize: () => 160,
    overscan: 6,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  return (
    <div
      ref={chatMessagesRef}
      className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 ? (
        <ChatEmptyState activeMode={activeMode} copy={copy} />
      ) : (
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index];
            if (!message) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-5"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <ChatMessageBubble
                  message={message}
                  chatStream={chatStream}
                  isChatGenerating={isChatGenerating}
                  copy={copy}
                  renderChatStreamBubble={renderChatStreamBubble}
                  renderThinkingBlock={renderThinkingBlock}
                  renderAgentRoundCards={renderAgentRoundCards}
                  onOpenPreview={onOpenPreview}
                  onAttachResultToChat={onAttachResultToChat}
                  onVariantChange={onVariantChange}
                  onVariantSelect={onVariantSelect}
                  onRetry={onRetry}
                />
              </div>
            );
          })}
        </div>
      )}

      {chatStream &&
        !retryingChatMessageId &&
        !chatStream.messageId &&
        chatStream.mode === activeConversationMode && (
          <div className="flex justify-start">
            <div className="max-w-[88%]">
              {renderChatStreamBubble(undefined)}
            </div>
          </div>
        )}
    </div>
  );
}

/**
 * 渲染 Chat/Agent 空状态。
 *
 * @param props.activeMode 当前模式。
 * @param props.copy 中英文文案选择器。
 * @returns 空状态内容。
 * @sideEffects 无。
 * @failureMode 非 agent 模式按 chat 文案展示。
 */
function ChatEmptyState({
  activeMode,
  copy,
}: {
  activeMode: ActiveMode;
  copy: (en: string, zh: string) => string;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-muted-foreground">
      {activeMode === "agent" ? (
        <Wand2 className="mb-3 h-8 w-8" />
      ) : (
        <MessageSquare className="mb-3 h-8 w-8" />
      )}
      <p className="text-sm font-medium text-foreground">
        {activeMode === "agent"
          ? copy("Start an agent run", "开始 Agent 任务")
          : copy("Start a visual conversation", "开始视觉对话")}
      </p>
      <p className="mt-1 max-w-md text-xs">
        {activeMode === "agent"
          ? copy(
              "Agent mode can use tools, search, and iterate images in the same run.",
              "Agent 模式可以调用工具、联网查询，并在同一轮中迭代图片。"
            )
          : copy(
              "Auto mode generates from text, edits attached images, and keeps the conversation as context.",
              "Auto 模式会根据文字生成图片、编辑附件图片，并保留对话上下文。"
            )}
      </p>
    </div>
  );
}

/**
 * 渲染单条 Chat 消息气泡。
 *
 * @param props.message 消息。
 * @param props.chatStream 当前流式状态。
 * @param props.isChatGenerating 是否正在生成。
 * @param props.copy 中英文文案选择器。
 * @returns 单条消息气泡和 assistant 操作区。
 * @sideEffects 用户操作通过回调通知父组件。
 * @failureMode assistant 无活动变体时展示生成中占位。
 */
const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  chatStream,
  isChatGenerating,
  copy,
  renderChatStreamBubble,
  renderThinkingBlock,
  renderAgentRoundCards,
  onOpenPreview,
  onAttachResultToChat,
  onVariantChange,
  onVariantSelect,
  onRetry,
}: {
  message: ChatMessage;
  chatStream: ChatStreamState | null;
  isChatGenerating: boolean;
  copy: (en: string, zh: string) => string;
  renderChatStreamBubble: (messageId?: string) => ReactNode;
  renderThinkingBlock: (thinking?: string, open?: boolean) => ReactNode;
  renderAgentRoundCards: (
    events?: AgentRunEvent[],
    fallbackAgent?: string,
    open?: boolean
  ) => ReactNode;
  onOpenPreview: (generationId: string) => void;
  onAttachResultToChat: (variant: ChatVariant) => void;
  onVariantChange: (messageId: string, direction: -1 | 1) => void;
  onVariantSelect: (messageId: string, nextIndex: number) => void;
  onRetry: (assistantId: string) => void;
}) {
  const variants = getChatVariants(message);
  const activeVariant = getActiveChatVariant(message);
  const activeIndex = message.activeVariant || 0;
  const webChoiceVariants = variants.filter(
    (variant) => variant.outputRole === "choice" && variant.imageUrl
  );
  const isStreamingMessage = chatStream?.messageId === message.id;
  const activeVariantPending = activeVariant?.pending === true;

  return (
    <div
      className={`flex ${
        message.role === "user" ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[88%] ${
          message.role === "user" ? "text-right" : "text-left"
        }`}
      >
        <div
          className={`rounded-lg border px-3 py-3 text-sm ${
            message.role === "user"
              ? "border-primary/20 bg-primary text-primary-foreground"
              : "border-border bg-muted/35 text-foreground"
          }`}
        >
          {message.role === "user" ? (
            <UserMessageContent message={message} />
          ) : isStreamingMessage ? (
            renderChatStreamBubble(message.id)
          ) : message.error ? (
            <p className="text-destructive">{message.error}</p>
          ) : activeVariant ? (
            <AssistantVariantContent
              message={message}
              activeVariant={activeVariant}
              activeVariantPending={activeVariantPending}
              copy={copy}
              renderThinkingBlock={renderThinkingBlock}
              renderAgentRoundCards={renderAgentRoundCards}
              onOpenPreview={onOpenPreview}
              onAttachResultToChat={onAttachResultToChat}
            />
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy("Generating...", "生成中...")}
            </div>
          )}
        </div>

        {message.role === "assistant" && (
          <AssistantVariantControls
            message={message}
            variants={variants}
            activeIndex={activeIndex}
            webChoiceVariants={webChoiceVariants}
            isChatGenerating={isChatGenerating}
            copy={copy}
            onVariantChange={onVariantChange}
            onVariantSelect={onVariantSelect}
            onRetry={onRetry}
          />
        )}
      </div>
    </div>
  );
});

/**
 * 渲染用户消息内容。
 *
 * @param props.message 用户消息。
 * @returns 附件缩略图和文本。
 * @sideEffects 无。
 * @failureMode 无附件时仅展示文本。
 */
const UserMessageContent = memo(function UserMessageContent({
  message,
}: {
  message: ChatMessage;
}) {
  return (
    <div className="flex flex-col gap-3">
      {message.attachments?.length ? (
        <div className="flex flex-wrap justify-end gap-2">
          {message.attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative h-12 w-12 overflow-hidden rounded-md border border-primary-foreground/25 bg-muted"
            >
              {attachment.kind === "file" || !attachment.previewUrl ? (
                <span className="flex h-full w-full items-center justify-center">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </span>
              ) : (
                <Image
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  fill
                  sizes="48px"
                  className="object-cover"
                  unoptimized
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
      <p className="whitespace-pre-wrap break-words">{message.text}</p>
    </div>
  );
});

/**
 * 渲染 assistant 当前变体内容。
 *
 * @param props.message assistant 消息。
 * @param props.activeVariant 当前变体。
 * @param props.activeVariantPending 当前变体是否仍在生成。
 * @param props.copy 中英文文案选择器。
 * @returns assistant 文本、图片、thinking 和 Agent 过程。
 * @sideEffects 用户点击图片或继续编辑时触发回调。
 * @failureMode 无文本无图且非 pending 时展示通用完成文案。
 */
const AssistantVariantContent = memo(function AssistantVariantContent({
  message,
  activeVariant,
  activeVariantPending,
  copy,
  renderThinkingBlock,
  renderAgentRoundCards,
  onOpenPreview,
  onAttachResultToChat,
}: {
  message: ChatMessage;
  activeVariant: ChatVariant;
  activeVariantPending: boolean;
  copy: (en: string, zh: string) => string;
  renderThinkingBlock: (thinking?: string, open?: boolean) => ReactNode;
  renderAgentRoundCards: (
    events?: AgentRunEvent[],
    fallbackAgent?: string,
    open?: boolean
  ) => ReactNode;
  onOpenPreview: (generationId: string) => void;
  onAttachResultToChat: (variant: ChatVariant) => void;
}) {
  return (
    <div>
      {renderThinkingBlock(
        activeVariant.responseThinking,
        message.mode === "agent"
      )}
      {message.mode === "agent"
        ? renderAgentRoundCards(
            activeVariant.agentEvents,
            activeVariant.responseAgent,
            true
          )
        : null}
      {activeVariant.responseText && (
        <p
          className={`whitespace-pre-wrap break-words leading-relaxed ${
            activeVariant.imageUrl ? "mb-3" : ""
          }`}
        >
          {activeVariant.responseText}
        </p>
      )}
      {activeVariant.imageUrl && (
        <AssistantImageResult
          activeVariant={activeVariant}
          copy={copy}
          onOpenPreview={onOpenPreview}
          onAttachResultToChat={onAttachResultToChat}
        />
      )}
      {activeVariantPending && (
        <div className="mt-3 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {copy(
            "Generation is still running. Reconnecting to status...",
            "仍在生成中，正在恢复状态..."
          )}
        </div>
      )}
      {!activeVariant.responseText &&
        !activeVariant.imageUrl &&
        !activeVariantPending && (
          <p className="text-muted-foreground">
            {copy("Response generated", "回复已生成")}
          </p>
        )}
    </div>
  );
});

/**
 * 渲染 assistant 图片结果。
 *
 * @param props.activeVariant 当前图片变体。
 * @param props.copy 中英文文案选择器。
 * @returns 图片结果和操作按钮。
 * @sideEffects 用户点击触发预览或继续编辑回调。
 * @failureMode generationId 缺失时预览按钮不触发。
 */
const AssistantImageResult = memo(function AssistantImageResult({
  activeVariant,
  copy,
  onOpenPreview,
  onAttachResultToChat,
}: {
  activeVariant: ChatVariant;
  copy: (en: string, zh: string) => string;
  onOpenPreview: (generationId: string) => void;
  onAttachResultToChat: (variant: ChatVariant) => void;
}) {
  const dimensions = parseImageSize(activeVariant.size);
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <button
        type="button"
        className="group relative block w-full bg-muted"
        style={{
          aspectRatio: `${dimensions?.width || defaultDimensions.width} / ${
            dimensions?.height || defaultDimensions.height
          }`,
        }}
        onClick={() => {
          if (activeVariant.generationId) {
            onOpenPreview(activeVariant.generationId);
          }
        }}
        title={copy("Open image preview", "打开图片预览")}
      >
        <Image
          src={activeVariant.imageUrl || ""}
          alt={activeVariant.prompt}
          fill
          sizes="(max-width: 768px) 80vw, 420px"
          className="object-contain"
          unoptimized={shouldBypassImageOptimization(activeVariant.imageUrl)}
        />
        <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <Eye className="mr-1 inline h-3 w-3" />
          {copy("Preview", "预览")}
        </span>
      </button>
      <div className="flex flex-wrap gap-2 p-2">
        <Button asChild variant="outline" size="xs">
          <a
            href={activeVariant.imageUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="h-3 w-3" />
            {copy("Download", "下载")}
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onAttachResultToChat(activeVariant)}
        >
          <RefreshCcw className="h-3 w-3" />
          {copy("Edit next", "继续编辑")}
        </Button>
      </div>
    </div>
  );
});

/**
 * 渲染 assistant 变体控制区。
 *
 * @param props.message assistant 消息。
 * @param props.variants 变体列表。
 * @param props.activeIndex 当前变体索引。
 * @param props.webChoiceVariants Web 多候选变体。
 * @param props.isChatGenerating 是否正在生成。
 * @param props.copy 中英文文案选择器。
 * @returns 变体翻页、多候选缩略图和重试按钮。
 * @sideEffects 用户点击时触发父组件回调。
 * @failureMode 无多变体时仅展示重试按钮。
 */
const AssistantVariantControls = memo(function AssistantVariantControls({
  message,
  variants,
  activeIndex,
  webChoiceVariants,
  isChatGenerating,
  copy,
  onVariantChange,
  onVariantSelect,
  onRetry,
}: {
  message: ChatMessage;
  variants: ChatVariant[];
  activeIndex: number;
  webChoiceVariants: ChatVariant[];
  isChatGenerating: boolean;
  copy: (en: string, zh: string) => string;
  onVariantChange: (messageId: string, direction: -1 | 1) => void;
  onVariantSelect: (messageId: string, nextIndex: number) => void;
  onRetry: (assistantId: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {variants.length > 1 && (
        <div className="inline-flex items-center rounded-md border border-border bg-background text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={isChatGenerating || activeIndex === 0}
            onClick={() => onVariantChange(message.id, -1)}
            title={copy("Previous variant", "上一个版本")}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="px-2">
            {activeIndex + 1} / {variants.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={isChatGenerating || activeIndex >= variants.length - 1}
            onClick={() => onVariantChange(message.id, 1)}
            title={copy("Next variant", "下一个版本")}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
      {webChoiceVariants.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {variants.map((variant, index) => {
            if (variant.outputRole !== "choice" || !variant.imageUrl) {
              return null;
            }
            return (
              <button
                key={`${variant.generationId || index}-choice`}
                type="button"
                className={`relative h-10 w-10 overflow-hidden rounded-md border bg-muted ${
                  index === activeIndex
                    ? "border-primary ring-1 ring-primary"
                    : "border-border"
                }`}
                onClick={() => onVariantSelect(message.id, index)}
                title={copy(
                  `Choose image ${index + 1}`,
                  `选择第 ${index + 1} 张`
                )}
              >
                <Image
                  src={thumbSrc(variant.imageUrl, 256)}
                  alt={variant.prompt}
                  fill
                  sizes="40px"
                  className="object-contain"
                  unoptimized={shouldBypassImageOptimization(variant.imageUrl)}
                />
                {index === activeIndex && (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {variants.some((variant) => variant.outputRole === "choice") && (
        <span className="text-xs text-muted-foreground">
          {copy(
            "Web returned multiple choices; switching syncs the selected image.",
            "Web 返回了多个候选，切换时会同步选中图片。"
          )}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={isChatGenerating}
        onClick={() => onRetry(message.id)}
        title={
          message.error
            ? copy("Retry generation", "重试生成")
            : copy("Generate another variant", "再生成一个版本")
        }
      >
        <RefreshCcw className="h-4 w-4" />
      </Button>
    </div>
  );
});
