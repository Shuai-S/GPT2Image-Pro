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
import { ImagePlus, Loader2 } from "lucide-react";
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  MutableRefObject,
  MouseEvent,
  ReactNode,
  TouchEvent,
} from "react";
import { formatMegabytes } from "./create-page-utils";
import { ConcurrencyNumberInput } from "./create-page-controls";
import type { ImageModelOption } from "./create-page-options";
import type {
  ActiveMode,
  ImageReferenceMentionOption,
  MentionState,
  VisualOutputMode,
} from "./create-page-types";
import {
  type AspectRatioSizeDialogValue,
  InlineImageSizeControl,
} from "./aspect-ratio-size-dialog";
import { EditSourceImagesPanel } from "./edit-source-images-panel";
import type { EditImageFile } from "./image-edit-types";

// 图生图模式面板:负责上传参考图、蒙版、编辑提示词与图生图参数区的渲染。

/**
 * 渲染图生图完整面板。
 *
 * @param props.activeMode 当前创作模式。
 * @param props.imageAllowed 图生图能力是否可用。
 * @param props.copy 中英文文案选择器。
 * @param props.onSubmit 表单提交回调。
 * @param props.onPaste 图片粘贴回调。
 * @returns 图生图 tab 内容。
 * @sideEffects 用户交互通过回调更新父组件状态。
 * @failureMode 参数合法性仍由父组件和服务端校验。
 */
export function CreatePageImagePanel({
  activeMode,
  imageAllowed,
  copy,
  onSubmit,
  onPaste,
  renderVisualOutput,
  renderReferenceMentionMenu,
  renderBackendGroupSelect,
  renderAdvancedImageSettings,
  hideResponseControls,
  qualityDisabled,
  outputDisabled,
  backgroundDisabled,
  imageAccept,
  editImages,
  imageInputRef,
  maskCanvasRef,
  maxEditImages,
  maxEditRequestBytes,
  isEditing,
  maskEditorOpen,
  maskSourceDisplayIndex,
  maskSourcePreviewUrl,
  maskSourceImageSize,
  maskBrushSize,
  maskHasPoints,
  maskFile,
  onAddImages,
  onClearEditImages,
  onOpenMaskEditorForImage,
  onRemoveImage,
  onStartMaskDrawing,
  onDrawMaskLine,
  onStopMaskDrawing,
  onMaskBrushSizeChange,
  onClearDrawnMask,
  onClearSavedMask,
  onSaveDrawnMask,
  editMention,
  canUseEditReferenceMentions,
  filteredEditReferenceOptions,
  onSelectEditMention,
  editPromptRef,
  editPrompt,
  onEditPromptChange,
  onEditMentionChange,
  getMentionTriggerForPrompt,
  editReferenceMentionStatusText,
  showImageModelControls,
  labelWithHelp,
  imageModelHelpText,
  editModel,
  onEditModelChange,
  editModelOptions,
  editModelLabel,
  useEditFirstImageSize,
  onUseEditFirstImageSizeChange,
  onUseAutoEditSizeChange,
  editBatchCount,
  batchCountMax,
  onEditBatchCountChange,
  editResolutionControlValue,
  onEditResolutionChange,
  customEditSizeCheckValid,
  customEditSizeCheckMessage,
  validationMessage,
  editDisplaySize,
  editReferenceSizeNote,
  customApiActive,
  editHasImageReference,
  customApiBillingLabel,
  formattedEditBatchCreditCost,
  batchCostSuffix,
  resolutionHelpText,
}: {
  activeMode: ActiveMode;
  imageAllowed: boolean;
  copy: (en: string, zh: string) => string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  renderVisualOutput: (mode: VisualOutputMode) => ReactNode;
  renderReferenceMentionMenu: (params: {
    open: boolean;
    options: ImageReferenceMentionOption[];
    onSelect: (option: ImageReferenceMentionOption) => void;
    emptyText: string;
  }) => ReactNode;
  renderBackendGroupSelect: (params: {
    id: string;
    disabled?: boolean;
    compact?: boolean;
  }) => ReactNode;
  renderAdvancedImageSettings: (params: {
    idPrefix: string;
    promptDisabled: boolean;
    repairDisabled: boolean;
    hideResponseControls: boolean;
    responseControlsDisabledReason?: string;
    qualityDisabled: boolean;
    outputDisabled: boolean;
    backgroundDisabled: boolean;
  }) => ReactNode;
  hideResponseControls: boolean;
  qualityDisabled: boolean;
  outputDisabled: boolean;
  backgroundDisabled: boolean;
  imageAccept: string;
  editImages: EditImageFile[];
  imageInputRef: MutableRefObject<HTMLInputElement | null>;
  maskCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  maxEditImages: number;
  maxEditRequestBytes: number;
  isEditing: boolean;
  maskEditorOpen: boolean;
  maskSourceDisplayIndex: number;
  maskSourcePreviewUrl: string | null;
  maskSourceImageSize: { width: number; height: number } | null;
  maskBrushSize: number;
  maskHasPoints: boolean;
  maskFile: EditImageFile | null;
  onAddImages: (files: FileList | File[] | null) => void;
  onClearEditImages: () => void;
  onOpenMaskEditorForImage: (index: number) => void;
  onRemoveImage: (index: number) => void;
  onStartMaskDrawing: (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => void;
  onDrawMaskLine: (
    event: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>
  ) => void;
  onStopMaskDrawing: () => void;
  onMaskBrushSizeChange: (value: number) => void;
  onClearDrawnMask: () => void;
  onClearSavedMask: () => void;
  onSaveDrawnMask: () => void;
  editMention: MentionState | null;
  canUseEditReferenceMentions: boolean;
  filteredEditReferenceOptions: ImageReferenceMentionOption[];
  onSelectEditMention: (option: ImageReferenceMentionOption) => void;
  editPromptRef: MutableRefObject<HTMLTextAreaElement | null>;
  editPrompt: string;
  onEditPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onEditMentionChange: (mention: MentionState | null) => void;
  getMentionTriggerForPrompt: (
    text: string,
    cursor: number
  ) => MentionState | null;
  editReferenceMentionStatusText: string;
  showImageModelControls: boolean;
  labelWithHelp: (label: string, title: string) => ReactNode;
  imageModelHelpText: string;
  editModel: string;
  onEditModelChange: (value: string) => void;
  editModelOptions: ImageModelOption[];
  editModelLabel: (label: string) => string;
  useEditFirstImageSize: boolean;
  onUseEditFirstImageSizeChange: (value: boolean) => void;
  onUseAutoEditSizeChange: (value: boolean) => void;
  editBatchCount: number;
  batchCountMax: number;
  onEditBatchCountChange: (value: number) => void;
  editResolutionControlValue: AspectRatioSizeDialogValue;
  onEditResolutionChange: (value: AspectRatioSizeDialogValue) => void;
  customEditSizeCheckValid: boolean;
  customEditSizeCheckMessage?: string;
  validationMessage: (message?: string) => string | undefined;
  editDisplaySize: string;
  editReferenceSizeNote: string | null;
  customApiActive: boolean;
  editHasImageReference: boolean;
  customApiBillingLabel: string;
  formattedEditBatchCreditCost: string;
  batchCostSuffix: (count: number) => string;
  resolutionHelpText: string;
}) {
  return (
    <div
      role="tabpanel"
      hidden={activeMode !== "image" || !imageAllowed}
      className="mt-0"
    >
      <form
        onSubmit={onSubmit}
        onPaste={onPaste}
        className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6"
      >
        <div className="xl:col-start-1">{renderVisualOutput("image")}</div>
        <EditSourceImagesPanel
          copy={copy}
          editImages={editImages}
          imageInputRef={imageInputRef}
          maskCanvasRef={maskCanvasRef}
          imageAccept={imageAccept}
          maxEditImages={maxEditImages}
          maxEditRequestBytesLabel={formatMegabytes(maxEditRequestBytes)}
          isEditing={isEditing}
          maskEditorOpen={maskEditorOpen}
          maskSourceDisplayIndex={maskSourceDisplayIndex}
          maskSourcePreviewUrl={maskSourcePreviewUrl}
          maskSourceImageSize={maskSourceImageSize}
          maskBrushSize={maskBrushSize}
          maskHasPoints={maskHasPoints}
          maskFile={maskFile}
          onAddImages={onAddImages}
          onClearEditImages={onClearEditImages}
          onOpenMaskEditorForImage={onOpenMaskEditorForImage}
          onRemoveImage={onRemoveImage}
          onStartMaskDrawing={onStartMaskDrawing}
          onDrawMaskLine={onDrawMaskLine}
          onStopMaskDrawing={onStopMaskDrawing}
          onMaskBrushSizeChange={onMaskBrushSizeChange}
          onClearDrawnMask={onClearDrawnMask}
          onClearSavedMask={onClearSavedMask}
          onSaveDrawnMask={onSaveDrawnMask}
        />
        <div className="relative xl:col-start-1">
          {renderReferenceMentionMenu({
            open: Boolean(editMention?.open) && canUseEditReferenceMentions,
            options: filteredEditReferenceOptions,
            onSelect: onSelectEditMention,
            emptyText: copy("Upload a source image first.", "请先上传源图片。"),
          })}
          <Textarea
            ref={editPromptRef}
            value={editPrompt}
            onChange={onEditPromptChange}
            placeholder={copy(
              "Describe how to transform the uploaded image...",
              "描述如何改造上传的图片..."
            )}
            rows={5}
            disabled={isEditing}
            className="resize-none border-input bg-background text-base"
            onBlur={() => setTimeout(() => onEditMentionChange(null), 120)}
            onClick={(event) => {
              const target = event.currentTarget;
              onEditMentionChange(
                canUseEditReferenceMentions
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
                editMention?.open &&
                filteredEditReferenceOptions[0]
              ) {
                event.preventDefault();
                onSelectEditMention(filteredEditReferenceOptions[0]);
                return;
              }
              if (event.key === "Escape" && editMention?.open) {
                event.preventDefault();
                onEditMentionChange(null);
              }
            }}
          />
        </div>
        <p className="text-xs leading-snug text-muted-foreground xl:col-start-1">
          {editReferenceMentionStatusText}
        </p>
        <div className="grid gap-4 xl:contents">
          <div className="space-y-4 rounded-lg border border-border bg-background p-4 shadow-sm xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1">
            <div className="border-b border-border pb-3">
              <h2 className="text-sm font-semibold text-foreground">
                {copy("Parameters", "参数")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy(
                  "Reference, size, output, and billing for this edit.",
                  "本次改图的参考、尺寸、输出与费用。"
                )}
              </p>
            </div>
            {renderBackendGroupSelect({
              id: "edit-backend-group",
              disabled: isEditing,
            })}
            {showImageModelControls && (
              <div className="space-y-2">
                <label
                  htmlFor="edit-model"
                  className="text-sm font-medium text-foreground"
                >
                  {labelWithHelp(
                    copy("Image model", "图片模型"),
                    imageModelHelpText
                  )}
                </label>
                <Select
                  value={editModel}
                  onValueChange={onEditModelChange}
                  disabled={isEditing}
                >
                  <SelectTrigger
                    id="edit-model"
                    className="w-full"
                    title={imageModelHelpText}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {editModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {editModelLabel(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {renderAdvancedImageSettings({
              idPrefix: "edit",
              promptDisabled: isEditing,
              repairDisabled: isEditing,
              hideResponseControls,
              qualityDisabled,
              outputDisabled,
              backgroundDisabled,
            })}

            <div className="space-y-2">
              <label
                htmlFor="edit-batch-count"
                className="text-sm font-medium text-foreground"
              >
                {copy("Batch", "批量")}
              </label>
              <ConcurrencyNumberInput
                id="edit-batch-count"
                value={editBatchCount}
                max={batchCountMax}
                disabled={isEditing}
                onChange={onEditBatchCountChange}
              />
            </div>

            <div className="space-y-3 rounded-md bg-muted/40 p-3">
              <label
                htmlFor="edit-use-source-size"
                className="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
              >
                <Checkbox
                  id="edit-use-source-size"
                  checked={useEditFirstImageSize}
                  onCheckedChange={(checked) => {
                    onUseEditFirstImageSizeChange(checked === true);
                    if (checked === true) onUseAutoEditSizeChange(false);
                  }}
                  disabled={isEditing}
                  className="mt-0.5"
                />
                <span>
                  {copy("Use first image resolution", "使用第一张图片分辨率")}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {copy(
                      "Default for edits. If the reference dimensions are not supported as an output size, the request is rounded to the nearest valid size. Turn off for outpainting or canvas extension.",
                      "编辑默认使用该尺寸；如果参考图尺寸不能作为输出尺寸，请求会贴近到合法尺寸。扩图或扩展画布时可关闭。"
                    )}
                  </span>
                </span>
              </label>

              <div className="space-y-3 border-t border-border pt-3">
                <label
                  htmlFor="edit-resolution"
                  className="text-sm font-medium text-foreground"
                >
                  {labelWithHelp(
                    copy("Resolution", "分辨率"),
                    resolutionHelpText
                  )}
                </label>
                <InlineImageSizeControl
                  id="edit-resolution"
                  value={editResolutionControlValue}
                  disabled={isEditing}
                  copy={copy}
                  onChange={onEditResolutionChange}
                />
                {useEditFirstImageSize && (
                  <p className="text-xs leading-snug text-muted-foreground">
                    {copy(
                      "Editing the resolution switches to custom output size.",
                      "修改分辨率会切换为自定义输出尺寸。"
                    )}
                  </p>
                )}
                {!useEditFirstImageSize && !customEditSizeCheckValid && (
                  <p className="text-xs text-destructive">
                    {validationMessage(customEditSizeCheckMessage)}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              <p>
                {labelWithHelp(
                  copy("Output size", "输出尺寸"),
                  resolutionHelpText
                )}
                :{" "}
                <span className="font-medium text-foreground">
                  {editDisplaySize}
                </span>
              </p>
              {editReferenceSizeNote && (
                <p className="mt-1">{editReferenceSizeNote}</p>
              )}
              <p className="mt-1">
                {customApiActive && !editHasImageReference ? (
                  <span className="font-medium text-foreground">
                    {customApiBillingLabel}
                  </span>
                ) : (
                  <>
                    {copy("Cost", "费用")}:{" "}
                    <span className="font-medium text-foreground">
                      {formattedEditBatchCreditCost}
                    </span>
                    {batchCostSuffix(editBatchCount)}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end xl:col-start-2">
          <Button
            type="submit"
            disabled={
              isEditing || !editPrompt.trim() || editImages.length === 0
            }
            className="w-full xl:w-full"
          >
            {isEditing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {copy("Editing", "编辑中")}
              </>
            ) : (
              <>
                <ImagePlus className="mr-2 h-4 w-4" />
                {copy("Edit image", "编辑图片")}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
