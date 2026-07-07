"use client";

import { Button } from "@repo/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import { ImagePlus, Loader2 } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type {
  ActiveMode,
  TextGenerationMode,
  VisualOutputMode,
} from "./create-page-types";

// 文生图模式面板:承载单提示词与逐行批量两种布局,状态和提交逻辑由父组件注入。

/**
 * 渲染文生图完整面板。
 *
 * @param props.activeMode 当前创作模式。
 * @param props.textAllowed 文生图能力是否可用。
 * @param props.textMode 文生图子模式。
 * @param props.prompt 单提示词内容。
 * @param props.linePrompts 逐行批量提示词内容。
 * @param props.linePromptCount 当前有效提示词行数。
 * @param props.lineBatchTotalCount 逐行批量总生成张数。
 * @param props.isTextSingleGenerating 单提示词生成中状态。
 * @param props.isTextLinesGenerating 逐行批量生成中状态。
 * @param props.copy 中英文文案选择器。
 * @param props.onTextModeChange 子模式切换回调。
 * @param props.onPromptChange 单提示词变更回调。
 * @param props.onLinePromptsChange 逐行提示词变更回调。
 * @param props.onSingleSubmit 单提示词提交回调。
 * @param props.onLinesSubmit 逐行批量提交回调。
 * @param props.renderVisualOutput 输出预览区渲染器。
 * @param props.renderSettingsPanel 参数面板渲染器。
 * @returns 文生图 tab 内容。
 * @sideEffects 用户输入和提交通过回调交给父组件。
 * @failureMode 禁用状态由父组件控制,本组件不直接校验生成参数。
 */
export function CreatePageTextPanel({
  activeMode,
  textAllowed,
  textMode,
  prompt,
  linePrompts,
  linePromptCount,
  lineBatchTotalCount,
  isTextSingleGenerating,
  isTextLinesGenerating,
  copy,
  onTextModeChange,
  onPromptChange,
  onLinePromptsChange,
  onSingleSubmit,
  onLinesSubmit,
  renderVisualOutput,
  renderSettingsPanel,
}: {
  activeMode: ActiveMode;
  textAllowed: boolean;
  textMode: TextGenerationMode;
  prompt: string;
  linePrompts: string;
  linePromptCount: number;
  lineBatchTotalCount: number;
  isTextSingleGenerating: boolean;
  isTextLinesGenerating: boolean;
  copy: (en: string, zh: string) => string;
  onTextModeChange: (mode: TextGenerationMode) => void;
  onPromptChange: (value: string) => void;
  onLinePromptsChange: (value: string) => void;
  onSingleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLinesSubmit: (event: FormEvent<HTMLFormElement>) => void;
  renderVisualOutput: (mode: VisualOutputMode) => ReactNode;
  renderSettingsPanel: (mode: TextGenerationMode) => ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      hidden={activeMode !== "text" || !textAllowed}
      className="mt-0"
    >
      <Tabs
        value={textMode}
        onValueChange={(value) => onTextModeChange(value as TextGenerationMode)}
        className="space-y-5"
      >
        <div role="tabpanel" hidden={textMode !== "single"} className="mt-0">
          <form
            onSubmit={onSingleSubmit}
            className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start"
          >
            <div className="min-w-0 self-stretch xl:col-start-1 xl:row-start-1">
              {renderVisualOutput("text-single")}
            </div>
            <div className="relative min-w-0 xl:col-start-1 xl:row-start-2">
              <Textarea
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder={copy(
                  "Describe the image you want to create...",
                  "描述你想创作的图片..."
                )}
                rows={5}
                disabled={isTextSingleGenerating}
                className="min-h-28 resize-none border-input bg-background pr-32 text-base sm:pr-36"
              />
              <TextModeTabs copy={copy} />
            </div>
            <aside className="space-y-4 xl:col-start-2 xl:row-start-1">
              {renderSettingsPanel("single")}
              <Button
                type="submit"
                disabled={isTextSingleGenerating || !prompt.trim()}
                className="w-full"
              >
                {isTextSingleGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {copy("Generating", "生成中")}
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    {copy("Generate", "生成")}
                  </>
                )}
              </Button>
            </aside>
          </form>
        </div>

        <div role="tabpanel" hidden={textMode !== "lines"} className="mt-0">
          <form
            onSubmit={onLinesSubmit}
            className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start"
          >
            <div className="min-w-0 self-stretch xl:col-start-1 xl:row-start-1">
              {renderVisualOutput("text-lines")}
            </div>
            <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-2">
              <div className="relative">
                <Textarea
                  value={linePrompts}
                  onChange={(event) => onLinePromptsChange(event.target.value)}
                  placeholder={copy(
                    "One prompt per line. Each line generates one image.",
                    "每行一个提示词，每行生成一张图片。"
                  )}
                  rows={8}
                  disabled={isTextLinesGenerating}
                  className="min-h-48 resize-none border-input bg-background pr-32 text-base sm:pr-36"
                />
                <TextModeTabs copy={copy} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {copy("Prompt lines", "提示词行数")}:{" "}
                  <span className="font-medium text-foreground">
                    {linePromptCount}
                  </span>
                </span>
                <span>
                  {copy("Total images", "总图片数")}:{" "}
                  <span className="font-medium text-foreground">
                    {lineBatchTotalCount}
                  </span>
                </span>
              </div>
            </div>
            <aside className="space-y-4 xl:col-start-2 xl:row-start-1">
              {renderSettingsPanel("lines")}
              <Button
                type="submit"
                disabled={isTextLinesGenerating || linePromptCount === 0}
                className="w-full"
              >
                {isTextLinesGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {copy("Generating", "生成中")}
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    {copy("Generate line batch", "生成逐行批量")}
                  </>
                )}
              </Button>
            </aside>
          </form>
        </div>
      </Tabs>
    </div>
  );
}

/**
 * 渲染文生图子模式切换按钮。
 *
 * @param props.copy 中英文文案选择器。
 * @returns 绝对定位的 TabsList。
 * @sideEffects 无。
 * @failureMode value 由上层 Tabs 管理。
 */
function TextModeTabs({ copy }: { copy: (en: string, zh: string) => string }) {
  return (
    <TabsList className="absolute right-3 top-3 z-10 h-auto flex-col border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
      <TabsTrigger value="single" className="h-8 w-24">
        {copy("Single prompt", "单提示词")}
      </TabsTrigger>
      <TabsTrigger value="lines" className="h-8 w-24">
        {copy("Line batch", "逐行批量")}
      </TabsTrigger>
    </TabsList>
  );
}
