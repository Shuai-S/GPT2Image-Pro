"use client";

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
import { FileText, Loader2, Send, Upload, X } from "lucide-react";
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  MutableRefObject,
  ReactNode,
} from "react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import { AUTO_IMAGE_SIZE } from "../resolution";
import {
  type AspectRatioSizeDialogValue,
  ImageSizePresetButton,
} from "./aspect-ratio-size-dialog";
import type {
  ActiveMode,
  ChatAttachment,
  ImageReferenceMentionOption,
  MentionState,
} from "./create-page-types";

// Chat/Agent 输入区:负责附件预览、模型/尺寸/Agent 控件、mention 菜单和提交输入框。

/**
 * 渲染 Chat/Agent 底部输入区。
 *
 * @param props.activeMode 当前模式。
 * @param props.chatAttachments 当前附件。
 * @param props.chatPrompt 当前输入文本。
 * @param props.copy 中英文文案选择器。
 * @returns Chat/Agent 输入表单。
 * @sideEffects 用户操作通过回调通知父组件。
 * @failureMode 上传数量、引用候选和提交禁用态由父组件控制。
 */
export function CreatePageChatInput({
  activeMode,
  chatAttachments,
  chatPrompt,
  chatMention,
  chatImageModel,
  activeChatSize,
  chatSizeDialogValue,
  agentForceRounds,
  layeredGeneration,
  agentMaxRounds,
  isChatGenerating,
  showImageModelControls,
  isWebOnlyBackend,
  disableResponsesOnlyControls,
  isEditChat,
  chatFirstImageOriginalSize,
  customApiActive,
  chatHasImageReference,
  customApiBillingLabel,
  formattedChatSingleCreditCost,
  canUseChatReferenceMentions,
  filteredChatReferenceOptions,
  maxChatImages,
  chatAttachmentAccept,
  chatReferenceMentionStatusText,
  autoSizeLabel,
  backgroundHelpText,
  resolutionHelpText,
  copy,
  chatImageInputRef,
  chatPromptRef,
  onSubmit,
  onPaste,
  onRemoveChatAttachment,
  onChatImageModelChange,
  onConversationSizeChange,
  onAgentForceRoundsChange,
  onLayeredGenerationChange,
  onAgentMaxRoundsChange,
  onChatPromptChange,
  onChatMentionChange,
  onSelectChatMention,
  onAddChatAttachments,
  renderBackendGroupSelect,
  renderImageModelSelect,
  renderBackgroundSelect,
  renderTransparentMatteToggle,
  renderHdRepairToggle,
  renderBlockRepairToggle,
  renderReferenceMentionMenu,
  promptOptimizationField,
  helpMarker,
  getMentionTriggerForPrompt,
}: {
  activeMode: ActiveMode;
  chatAttachments: ChatAttachment[];
  chatPrompt: string;
  chatMention: MentionState | null;
  chatImageModel: string;
  activeChatSize: string;
  chatSizeDialogValue: AspectRatioSizeDialogValue;
  agentForceRounds: boolean;
  layeredGeneration: boolean;
  agentMaxRounds: number;
  isChatGenerating: boolean;
  showImageModelControls: boolean;
  isWebOnlyBackend: boolean;
  disableResponsesOnlyControls: boolean;
  isEditChat: boolean;
  chatFirstImageOriginalSize: string | null;
  customApiActive: boolean;
  chatHasImageReference: boolean;
  customApiBillingLabel: string;
  formattedChatSingleCreditCost: string;
  canUseChatReferenceMentions: boolean;
  filteredChatReferenceOptions: ImageReferenceMentionOption[];
  maxChatImages: number;
  chatAttachmentAccept: string;
  chatReferenceMentionStatusText: string;
  autoSizeLabel: string;
  backgroundHelpText: string;
  resolutionHelpText: string;
  copy: (en: string, zh: string) => string;
  chatImageInputRef: MutableRefObject<HTMLInputElement | null>;
  chatPromptRef: MutableRefObject<HTMLTextAreaElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onRemoveChatAttachment: (index: number) => void;
  onChatImageModelChange: (value: string) => void;
  onConversationSizeChange: (value: AspectRatioSizeDialogValue) => void;
  onAgentForceRoundsChange: (value: boolean) => void;
  onLayeredGenerationChange: (value: boolean) => void;
  onAgentMaxRoundsChange: (value: number) => void;
  onChatPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onChatMentionChange: (mention: MentionState | null) => void;
  onSelectChatMention: (option: ImageReferenceMentionOption) => void;
  onAddChatAttachments: (files: FileList | null) => void;
  renderBackendGroupSelect: (params: {
    id: string;
    disabled?: boolean;
    compact?: boolean;
  }) => ReactNode;
  renderImageModelSelect: (params: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    compact?: boolean;
  }) => ReactNode;
  renderBackgroundSelect: (params: {
    id: string;
    disabled?: boolean;
    compact?: boolean;
  }) => ReactNode;
  renderTransparentMatteToggle: (params: {
    id: string;
    disabled?: boolean;
  }) => ReactNode;
  renderHdRepairToggle: (params: {
    id: string;
    disabled?: boolean;
  }) => ReactNode;
  renderBlockRepairToggle: (params: {
    id: string;
    disabled?: boolean;
  }) => ReactNode;
  renderReferenceMentionMenu: (params: {
    open: boolean;
    options: ImageReferenceMentionOption[];
    onSelect: (option: ImageReferenceMentionOption) => void;
    emptyText: string;
  }) => ReactNode;
  promptOptimizationField: (id: string, disabled?: boolean) => ReactNode;
  helpMarker: (label: string, title: string) => ReactNode;
  getMentionTriggerForPrompt: (
    text: string,
    cursor: number
  ) => MentionState | null;
}) {
  return (
    <form
      onSubmit={onSubmit}
      onPaste={onPaste}
      className="border-t border-border p-3"
    >
      {chatAttachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {chatAttachments.map((item, index) => (
            <button
              type="button"
              key={`${item.file.name}-${item.previewUrl || item.file.size}`}
              className="group relative h-12 w-12 overflow-hidden rounded-md border bg-muted"
              onClick={() => onRemoveChatAttachment(index)}
              disabled={isChatGenerating}
              title={copy("Remove attachment", "移除附件")}
            >
              {item.kind === "image" && item.previewUrl ? (
                <Image
                  src={item.previewUrl}
                  alt={
                    item.file.name ||
                    copy(`Reference ${index + 1}`, `参考图片 ${index + 1}`)
                  }
                  fill
                  sizes="48px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center px-1">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </span>
              )}
              <span className="absolute inset-0 hidden items-center justify-center bg-background/70 group-hover:flex">
                <X className="h-3.5 w-3.5 text-foreground" />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {renderBackendGroupSelect({
          id: "chat-backend-group",
          disabled: isChatGenerating,
          compact: true,
        })}
        {showImageModelControls && (
          <div>
            {renderImageModelSelect({
              id: "chat-image-model",
              value: chatImageModel,
              onChange: onChatImageModelChange,
              disabled: isChatGenerating,
              compact: true,
            })}
          </div>
        )}
        {!isWebOnlyBackend && (
          <div title={backgroundHelpText}>
            {renderBackgroundSelect({
              id: "chat-background",
              disabled: isChatGenerating || disableResponsesOnlyControls,
              compact: true,
            })}
          </div>
        )}
        {!isWebOnlyBackend &&
          activeMode !== "agent" &&
          renderTransparentMatteToggle({
            id: "chat-transparent-matte",
            disabled: isChatGenerating || disableResponsesOnlyControls,
          })}
        {renderHdRepairToggle({
          id: "chat-hd-repair",
          disabled: isChatGenerating,
        })}
        {renderBlockRepairToggle({
          id: "chat-block-repair",
          disabled: isChatGenerating,
        })}
        <ImageSizePresetButton
          label={`${copy("Size", "尺寸")} · ${
            activeChatSize === AUTO_IMAGE_SIZE ? autoSizeLabel : activeChatSize
          }`}
          value={chatSizeDialogValue}
          onChange={onConversationSizeChange}
          disabled={isChatGenerating}
          className="h-8 rounded-full px-3 text-xs"
          title={resolutionHelpText}
          copy={copy}
        />
        {activeMode === "agent" && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-2 py-1">
            <label
              htmlFor="agent-force-rounds"
              className="flex items-center gap-1.5 text-xs text-foreground"
              title={copy(
                "When enabled, Agent runs all selected rounds instead of stopping when the model does not request continue_generation.",
                "开启后，Agent 会跑满所选轮数，而不是在模型未请求 continue_generation 时提前停止。"
              )}
            >
              <Checkbox
                id="agent-force-rounds"
                checked={agentForceRounds}
                onCheckedChange={(checked) =>
                  onAgentForceRoundsChange(checked === true)
                }
                disabled={isChatGenerating}
              />
              {copy("Force", "强制")}
            </label>
            <label
              htmlFor="layered-generation"
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                layeredGeneration
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-primary/40 bg-primary/5 text-foreground"
              }`}
              title={copy(
                "Split into PSD layers: the agent first creates the full image, then decomposes it into editable layers (background + each element) for PSD export.",
                "打散元素生成 PSD:先出整图,再把整图打散成可编辑图层(背景 + 每个元素各一层),完成后可导出分层 PSD。"
              )}
            >
              <Checkbox
                id="layered-generation"
                checked={layeredGeneration}
                onCheckedChange={(checked) =>
                  onLayeredGenerationChange(checked === true)
                }
                disabled={isChatGenerating}
              />
              {copy("Split into PSD layers", "打散元素生成 PSD")}
            </label>
            <Select
              value={String(agentMaxRounds)}
              onValueChange={(value) =>
                onAgentMaxRoundsChange(Math.min(8, Math.max(1, Number(value))))
              }
              disabled={isChatGenerating}
            >
              <SelectTrigger className="h-7 w-[86px] border-0 px-2 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((round) => (
                  <SelectItem key={round} value={String(round)}>
                    {copy(`${round} rounds`, `${round} 轮`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {helpMarker(copy("Resolution", "分辨率"), resolutionHelpText)}
        {isEditChat && chatFirstImageOriginalSize && (
          <span className="text-xs text-muted-foreground">
            {copy("Reference", "参考图")} {chatFirstImageOriginalSize}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {customApiActive && !chatHasImageReference ? (
            <span className="font-medium text-foreground">
              {customApiBillingLabel}
            </span>
          ) : (
            <>
              {copy("Cost", "费用")}{" "}
              <span className="font-medium text-foreground">
                {formattedChatSingleCreditCost}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mb-2">
        {promptOptimizationField("chat-prompt-optimization", isChatGenerating)}
      </div>

      <div className="relative flex items-end gap-2 rounded-lg border border-border bg-background p-2">
        {renderReferenceMentionMenu({
          open: Boolean(chatMention?.open) && canUseChatReferenceMentions,
          options: filteredChatReferenceOptions,
          onSelect: onSelectChatMention,
          emptyText: copy("No reference images available.", "暂无可引用图片。"),
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => chatImageInputRef.current?.click()}
          disabled={isChatGenerating || chatAttachments.length >= maxChatImages}
          title={copy("Attach image or file", "添加图片或文件")}
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Textarea
          ref={chatPromptRef}
          value={chatPrompt}
          onChange={onChatPromptChange}
          placeholder={copy("Continue creating...", "继续描述你的创作...")}
          rows={1}
          disabled={isChatGenerating}
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0"
          onBlur={() => setTimeout(() => onChatMentionChange(null), 120)}
          onClick={(event) => {
            const target = event.currentTarget;
            onChatMentionChange(
              canUseChatReferenceMentions
                ? getMentionTriggerForPrompt(
                    target.value,
                    target.selectionStart ?? target.value.length
                  )
                : null
            );
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              chatMention?.open &&
              filteredChatReferenceOptions[0]
            ) {
              event.preventDefault();
              onSelectChatMention(filteredChatReferenceOptions[0]);
              return;
            }
            if (event.key === "Escape" && chatMention?.open) {
              event.preventDefault();
              onChatMentionChange(null);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={isChatGenerating || !chatPrompt.trim()}
          title={copy("Send", "发送")}
        >
          {isChatGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
        <input
          ref={chatImageInputRef}
          type="file"
          multiple
          accept={chatAttachmentAccept}
          className="sr-only"
          onChange={(event) => {
            onAddChatAttachments(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      <p className="mt-2 text-xs leading-snug text-muted-foreground">
        {chatReferenceMentionStatusText}
      </p>
    </form>
  );
}
