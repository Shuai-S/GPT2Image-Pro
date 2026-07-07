"use client";

import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { MessageSquare, Plus, Trash2, Wand2, X } from "lucide-react";
import type { ActiveMode, ChatConversation } from "./create-page-types";

// Chat/Agent 面板工具栏:负责模式说明、历史会话选择、新建、清理和附件清空入口。

/**
 * 渲染 Chat/Agent 顶部工具栏。
 *
 * @param props.activeMode 当前模式,仅 chat/agent 下渲染不同文案。
 * @param props.activeConversationExists 当前会话 id 是否存在于历史列表。
 * @param props.chatConversationId 当前会话 id。
 * @param props.conversations 当前模式历史会话列表。
 * @param props.isGenerating 是否正在生成。
 * @param props.visibleMessageCount 当前会话可见消息数。
 * @param props.attachmentCount 当前附件数。
 * @param props.copy 中英文文案选择器。
 * @param props.onOpenConversation 打开历史会话回调。
 * @param props.onNewChat 新建会话回调。
 * @param props.onClearHistory 清理当前会话回调。
 * @param props.onClearAttachments 清空附件回调。
 * @returns Chat/Agent 顶部工具栏。
 * @sideEffects 用户操作通过回调交给父组件。
 * @failureMode 无历史会话时禁用下拉选择。
 */
export function CreatePageChatAgentHeader({
  activeMode,
  activeConversationExists,
  chatConversationId,
  conversations,
  isGenerating,
  visibleMessageCount,
  attachmentCount,
  copy,
  onOpenConversation,
  onNewChat,
  onClearHistory,
  onClearAttachments,
}: {
  activeMode: ActiveMode;
  activeConversationExists: boolean;
  chatConversationId: string;
  conversations: ChatConversation[];
  isGenerating: boolean;
  visibleMessageCount: number;
  attachmentCount: number;
  copy: (en: string, zh: string) => string;
  onOpenConversation: (conversation: ChatConversation) => void;
  onNewChat: () => void;
  onClearHistory: () => void;
  onClearAttachments: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {activeMode === "agent" ? (
            <Wand2 className="h-4 w-4" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          {activeMode === "agent"
            ? copy("Agent mode", "Agent 模式")
            : copy("Chat mode", "对话模式")}
        </div>
        <p className="mt-1 max-w-xl text-xs text-muted-foreground">
          {activeMode === "agent"
            ? copy(
                "Codex-style agent mode can search, read attached files, use tools, and show the run process.",
                "Codex 风格 Agent 模式可联网、读取附件、调用工具，并展示运行过程。"
              )
            : copy(
                "Original chat mode keeps conversation context for text/image creation without forcing agent tools.",
                "原对话模式保留上下文进行文字/图片创作，不强制注入 Agent 工具。"
              )}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          value={
            activeConversationExists
              ? chatConversationId
              : conversations[0]?.id || chatConversationId
          }
          onValueChange={(value) => {
            const conversation = conversations.find(
              (item) => item.id === value
            );
            if (conversation) onOpenConversation(conversation);
          }}
          disabled={isGenerating || conversations.length === 0}
        >
          <SelectTrigger className="h-9 w-[180px] sm:w-[220px]">
            <SelectValue placeholder={copy("Chat history", "历史对话")} />
          </SelectTrigger>
          <SelectContent>
            {conversations.map((conversation) => (
              <SelectItem key={conversation.id} value={conversation.id}>
                {conversation.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNewChat}
          disabled={isGenerating}
        >
          <Plus className="h-4 w-4" />
          {copy("New chat", "新对话")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearHistory}
          disabled={isGenerating || visibleMessageCount === 0}
        >
          <Trash2 className="h-4 w-4" />
          {copy("Clear history", "清理记录")}
        </Button>
        {attachmentCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearAttachments}
            disabled={isGenerating}
          >
            <X className="h-4 w-4" />
            {copy("Clear attachments", "清除附件")}
          </Button>
        )}
      </div>
    </div>
  );
}
