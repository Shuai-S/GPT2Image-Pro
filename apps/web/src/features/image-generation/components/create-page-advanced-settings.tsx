"use client";

import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { ChevronDown, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { OUTPUT_FORMAT_OPTIONS, QUALITY_OPTIONS } from "./create-page-options";
import type { ImageOutputFormat, ImageQuality } from "./create-page-types";

// 高级参数面板:集中渲染提示词优化、修复、质量、背景、输出格式和压缩率控件。

/**
 * 渲染文生图/图生图共用的高级参数面板。
 *
 * @param props.idPrefix 控件 id 前缀。
 * @param props.promptDisabled 提示词优化开关禁用态。
 * @param props.repairDisabled 修复开关禁用态。
 * @param props.hideResponseControls 是否隐藏 Responses 专属控件。
 * @param props.responseControlsDisabledReason Responses 专属控件禁用说明。
 * @param props.qualityDisabled 质量控件禁用态。
 * @param props.outputDisabled 输出控件禁用态。
 * @param props.backgroundDisabled 背景控件禁用态。
 * @param props.copy 中英文文案选择器。
 * @param props.labelWithHelp 带帮助图标的标签渲染器。
 * @param props.renderPromptOptimization 提示词优化控件渲染器。
 * @param props.renderHdRepair 高清修复控件渲染器。
 * @param props.renderBlockRepair 生成式修复控件渲染器。
 * @param props.renderBackgroundSelect 背景选择控件渲染器。
 * @param props.renderTransparentMatte 透明抠图回退控件渲染器。
 * @param props.quality 当前质量档位。
 * @param props.outputFormat 当前输出格式。
 * @param props.outputCompression 当前压缩率。
 * @param props.backgroundHelpText 背景帮助文案。
 * @param props.outputFormatHelpText 输出格式帮助文案。
 * @param props.outputCompressionHelpText 压缩率帮助文案。
 * @param props.qualityLabel 质量档位文案格式化器。
 * @param props.outputFormatLabel 输出格式文案格式化器。
 * @param props.onQualityChange 质量变更回调。
 * @param props.onOutputFormatChange 输出格式变更回调。
 * @param props.onOutputCompressionChange 压缩率变更回调。
 * @returns 可折叠高级参数面板。
 * @sideEffects 用户修改控件时通过回调更新父组件状态。
 * @failureMode Web-only 后端可隐藏 Responses-only 控件。
 */
export function CreatePageAdvancedImageSettings({
  idPrefix,
  promptDisabled,
  repairDisabled,
  hideResponseControls,
  responseControlsDisabledReason,
  qualityDisabled,
  outputDisabled,
  backgroundDisabled,
  copy,
  labelWithHelp,
  renderPromptOptimization,
  renderHdRepair,
  renderBlockRepair,
  renderBackgroundSelect,
  renderTransparentMatte,
  quality,
  outputFormat,
  outputCompression,
  backgroundHelpText,
  outputFormatHelpText,
  outputCompressionHelpText,
  qualityLabel,
  outputFormatLabel,
  onQualityChange,
  onOutputFormatChange,
  onOutputCompressionChange,
}: {
  idPrefix: string;
  promptDisabled: boolean;
  repairDisabled: boolean;
  hideResponseControls: boolean;
  responseControlsDisabledReason?: string;
  qualityDisabled: boolean;
  outputDisabled: boolean;
  backgroundDisabled: boolean;
  copy: (en: string, zh: string) => string;
  labelWithHelp: (label: string, title: string) => ReactNode;
  renderPromptOptimization: (id: string, disabled: boolean) => ReactNode;
  renderHdRepair: (params: { id: string; disabled?: boolean }) => ReactNode;
  renderBlockRepair: (params: { id: string; disabled?: boolean }) => ReactNode;
  renderBackgroundSelect: (params: {
    id: string;
    disabled?: boolean;
  }) => ReactNode;
  renderTransparentMatte: (params: {
    id: string;
    disabled?: boolean;
  }) => ReactNode;
  quality: ImageQuality;
  outputFormat: ImageOutputFormat;
  outputCompression: number;
  backgroundHelpText: string;
  outputFormatHelpText: string;
  outputCompressionHelpText: string;
  qualityLabel: (quality: ImageQuality) => string;
  outputFormatLabel: (format: ImageOutputFormat) => string;
  onQualityChange: (quality: ImageQuality) => void;
  onOutputFormatChange: (format: ImageOutputFormat) => void;
  onOutputCompressionChange: (value: number) => void;
}) {
  const responseControlsDisabled = Boolean(responseControlsDisabledReason);

  return (
    <details className="group overflow-hidden rounded-lg border border-primary/20 bg-background shadow-sm transition-colors open:border-primary/35">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          {copy("Advanced settings", "高级参数")}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 px-3 pb-3 pt-1 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="md:col-span-2 xl:col-span-1 2xl:col-span-2">
          {renderPromptOptimization(
            `${idPrefix}-prompt-optimization`,
            promptDisabled
          )}
        </div>
        <div className="space-y-2 md:col-span-2 xl:col-span-1 2xl:col-span-2">
          {renderHdRepair({
            id: `${idPrefix}-hd-repair`,
            disabled: repairDisabled,
          })}
          {renderBlockRepair({
            id: `${idPrefix}-block-repair`,
            disabled: repairDisabled,
          })}
        </div>

        {!hideResponseControls && (
          <>
            <div
              className={`space-y-2 ${
                responseControlsDisabled ? "opacity-55" : ""
              }`}
              title={responseControlsDisabledReason}
            >
              <label
                htmlFor={`${idPrefix}-quality`}
                className="text-sm font-semibold text-foreground"
              >
                {copy("Quality tier", "质量档位")}
              </label>
              <Select
                value={quality}
                onValueChange={(value) =>
                  onQualityChange(value as ImageQuality)
                }
                disabled={qualityDisabled}
              >
                <SelectTrigger
                  id={`${idPrefix}-quality`}
                  className="min-h-12 rounded-xl"
                >
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
            </div>

            <div
              className={`space-y-2 ${
                responseControlsDisabled ? "opacity-55" : ""
              }`}
              title={responseControlsDisabledReason || backgroundHelpText}
            >
              <label
                htmlFor={`${idPrefix}-background`}
                className="text-sm font-semibold text-foreground"
              >
                {labelWithHelp(copy("Background", "背景"), backgroundHelpText)}
              </label>
              {renderBackgroundSelect({
                id: `${idPrefix}-background`,
                disabled: backgroundDisabled,
              })}
              <p className="text-xs leading-snug text-muted-foreground">
                {copy(
                  "Transparent background only applies to PNG/WebP.",
                  "透明背景只对 PNG/WebP 生效。"
                )}
              </p>
              {renderTransparentMatte({
                id: `${idPrefix}-transparent-matte`,
                disabled: backgroundDisabled,
              })}
            </div>

            <div
              className={`space-y-2 ${
                responseControlsDisabled ? "opacity-55" : ""
              }`}
              title={responseControlsDisabledReason || outputFormatHelpText}
            >
              <label
                htmlFor={`${idPrefix}-output-format`}
                className="text-sm font-semibold text-foreground"
              >
                {labelWithHelp(
                  copy("Output format", "输出格式"),
                  outputFormatHelpText
                )}
              </label>
              <Select
                value={outputFormat}
                onValueChange={(value) =>
                  onOutputFormatChange(value as ImageOutputFormat)
                }
                disabled={outputDisabled}
              >
                <SelectTrigger
                  id={`${idPrefix}-output-format`}
                  className="min-h-12 rounded-xl"
                  title={outputFormatHelpText}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMAT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {outputFormatLabel(option.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-snug text-muted-foreground">
                {copy(
                  "WebP is smaller; PNG has better compatibility.",
                  "WebP 体积更小；PNG 兼容性更好。"
                )}
              </p>
            </div>

            {outputFormat !== "png" && (
              <div
                className={`space-y-2 ${
                  responseControlsDisabled ? "opacity-55" : ""
                }`}
                title={
                  responseControlsDisabledReason || outputCompressionHelpText
                }
              >
                <label
                  htmlFor={`${idPrefix}-output-compression`}
                  className="text-sm font-semibold text-foreground"
                >
                  {labelWithHelp(
                    copy("Compression", "压缩率"),
                    outputCompressionHelpText
                  )}
                </label>
                <Input
                  id={`${idPrefix}-output-compression`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={outputCompression}
                  onChange={(event) =>
                    onOutputCompressionChange(
                      Math.min(
                        100,
                        Math.max(0, Number(event.target.value) || 0)
                      )
                    )
                  }
                  disabled={outputDisabled}
                  title={outputCompressionHelpText}
                  className="min-h-12 rounded-xl"
                />
              </div>
            )}
          </>
        )}

        {responseControlsDisabledReason && !hideResponseControls && (
          <p className="text-xs leading-snug text-muted-foreground md:col-span-2 xl:col-span-1 2xl:col-span-2">
            {responseControlsDisabledReason}
          </p>
        )}
      </div>
    </details>
  );
}
