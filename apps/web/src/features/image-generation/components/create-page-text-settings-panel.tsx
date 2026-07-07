"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Coins } from "lucide-react";
import type { ReactNode } from "react";
import {
  type AspectRatioSizeDialogValue,
  InlineImageSizeControl,
} from "./aspect-ratio-size-dialog";
import { ImageCountSlider } from "./create-page-controls";
import type { ImageModelOption } from "./create-page-options";
import type { TextGenerationMode } from "./create-page-types";

// 文生图参数面板:负责模型、张数、分辨率、高级参数和计费展示。

/**
 * 渲染文生图参数侧栏。
 *
 * @param props.mode 文生图子模式。
 * @param props.modeBusy 当前子模式是否生成中。
 * @param props.copy 中英文文案选择器。
 * @param props.actionButton 固定在参数栏底部的提交按钮。
 * @returns 文生图参数面板。
 * @sideEffects 用户修改控件时通过回调更新父组件状态。
 * @failureMode 尺寸非法时展示父组件传入的校验消息。
 */
export function CreatePageTextSettingsPanel({
  mode,
  modeBusy,
  copy,
  renderBackendGroupSelect,
  renderAdvancedImageSettings,
  showImageModelControls,
  labelWithHelp,
  imageModelHelpText,
  textModel,
  textModelOptions,
  textModelLabel,
  onTextModelChange,
  countValue,
  countMax,
  onCountChange,
  textSizeDialogValue,
  onTextSizeChange,
  resolutionHelpText,
  formattedBalance,
  formattedCost,
  costSuffix,
  customApiActive,
  customApiBillingLabel,
  sizeCheckValid,
  sizeCheckMessage,
  validationMessage,
  hideResponseControls,
  qualityDisabled,
  outputDisabled,
  backgroundDisabled,
  actionButton,
}: {
  mode: TextGenerationMode;
  modeBusy: boolean;
  copy: (en: string, zh: string) => string;
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
  showImageModelControls: boolean;
  labelWithHelp: (label: string, title: string) => ReactNode;
  imageModelHelpText: string;
  textModel: string;
  textModelOptions: ImageModelOption[];
  textModelLabel: (label: string) => string;
  onTextModelChange: (value: string) => void;
  countValue: number;
  countMax: number;
  onCountChange: (value: number) => void;
  textSizeDialogValue: AspectRatioSizeDialogValue;
  onTextSizeChange: (value: AspectRatioSizeDialogValue) => void;
  resolutionHelpText: string;
  formattedBalance: string;
  formattedCost: string;
  costSuffix: string;
  customApiActive: boolean;
  customApiBillingLabel: string;
  sizeCheckValid: boolean;
  sizeCheckMessage?: string;
  validationMessage: (message?: string) => string | undefined;
  hideResponseControls: boolean;
  qualityDisabled: boolean;
  outputDisabled: boolean;
  backgroundDisabled: boolean;
  actionButton: ReactNode;
}) {
  const isLineMode = mode === "lines";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="space-y-4">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {copy("Parameters", "参数")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy(
              "Models, size, output, and billing for this run.",
              "本次生成的模型、尺寸、输出与费用。"
            )}
          </p>
        </div>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="sm:col-span-2 lg:col-span-1">
              {renderBackendGroupSelect({
                id: `image-backend-group-${mode}`,
                disabled: modeBusy,
              })}
            </div>
            {showImageModelControls && (
              <div className="space-y-1.5">
                <label
                  htmlFor={`text-model-${mode}`}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {labelWithHelp(
                    copy("Image model", "图片模型"),
                    imageModelHelpText
                  )}
                </label>
                <Select
                  value={textModel}
                  onValueChange={onTextModelChange}
                  disabled={modeBusy}
                >
                  <SelectTrigger
                    id={`text-model-${mode}`}
                    className="w-full"
                    title={imageModelHelpText}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {textModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {textModelLabel(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <ImageCountSlider
              id={isLineMode ? "line-repeat-count" : "batch-count"}
              label={
                isLineMode
                  ? copy("Images per line", "每行张数")
                  : copy("Images", "张数")
              }
              value={countValue}
              max={countMax}
              disabled={modeBusy}
              onChange={onCountChange}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <label
              htmlFor={`text-resolution-${mode}`}
              className="text-sm font-medium text-foreground"
            >
              {labelWithHelp(copy("Resolution", "分辨率"), resolutionHelpText)}
            </label>
            <InlineImageSizeControl
              id={`text-resolution-${mode}`}
              value={textSizeDialogValue}
              disabled={modeBusy}
              copy={copy}
              onChange={onTextSizeChange}
            />
          </div>

          {renderAdvancedImageSettings({
            idPrefix: `image-${mode}`,
            promptDisabled: modeBusy,
            repairDisabled: modeBusy,
            hideResponseControls,
            qualityDisabled,
            outputDisabled,
            backgroundDisabled,
          })}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground lg:justify-end">
          <Coins className="h-3.5 w-3.5" />
          {customApiActive ? (
            <span className="font-medium text-foreground">
              {customApiBillingLabel}
            </span>
          ) : (
            <span>
              {copy("Balance", "余额")}:{" "}
              <span className="font-medium text-foreground">
                {formattedBalance}
              </span>{" "}
              · {copy("Cost", "费用")}:{" "}
              <span className="font-medium text-foreground">
                {formattedCost}
              </span>
              {costSuffix}
            </span>
          )}
        </div>
      </div>
      {!sizeCheckValid && (
        <p className="text-xs text-destructive">
          {validationMessage(sizeCheckMessage)}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-border bg-background/95 p-4 backdrop-blur">
        {actionButton}
      </div>
    </div>
  );
}
