"use client";

import { Button } from "@repo/ui/components/button";
import { Download, Eye, Loader2, RefreshCcw } from "lucide-react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import {
  defaultDimensions,
  shouldBypassImageOptimization,
} from "./create-page-options";
import type { ResultState } from "./create-page-types";

// 视觉输出预览面板:文生图和图生图共用的加载、预览、下载与继续编辑区域。

/**
 * 渲染生成结果的加载态、流式预览和最终图。
 *
 * @param props.loading 当前模式是否正在生成。
 * @param props.modeResult 当前模式最终结果。
 * @param props.dimensions 加载骨架使用的尺寸。
 * @param props.resultDimensions 最终图尺寸。
 * @param props.previewUrl 流式预览图片地址。
 * @param props.copy 中英文文案选择器。
 * @param props.onOpenPreview 打开灯箱回调。
 * @param props.onApplyAsReference 把当前结果作为编辑参考图。
 * @returns 视觉输出区。
 * @sideEffects 用户点击下载、预览或继续编辑时触发浏览器/父组件动作。
 * @failureMode 无结果且不加载时渲染空白承载区,保持布局稳定。
 */
export function CreatePageVisualOutputPanel({
  loading,
  modeResult,
  dimensions,
  resultDimensions,
  previewUrl,
  copy,
  onOpenPreview,
  onApplyAsReference,
}: {
  loading: boolean;
  modeResult: ResultState | null;
  dimensions: { width: number; height: number };
  resultDimensions: { width: number; height: number } | null;
  previewUrl: string | null;
  copy: (en: string, zh: string) => string;
  onOpenPreview: (generationId: string) => void;
  onApplyAsReference: (result: ResultState) => void;
}) {
  return (
    <section className="flex h-full min-h-[420px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-background p-4 sm:min-h-[560px] xl:min-h-[620px]">
      {loading && (
        <div
          className="mx-auto flex w-full max-w-3xl items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30"
          style={{
            aspectRatio: `${dimensions.width} / ${dimensions.height}`,
          }}
        >
          {previewUrl ? (
            <div className="relative h-full w-full">
              <Image
                src={previewUrl}
                alt={copy("Streaming preview", "流式预览")}
                fill
                sizes="(max-width: 1024px) 100vw, 768px"
                className="object-contain"
                unoptimized={shouldBypassImageOptimization(previewUrl)}
              />
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {copy("Previewing stream", "正在预览流式结果")}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">
                {copy("Generating your image...", "正在生成图片...")}
              </p>
            </div>
          )}
        </div>
      )}

      {modeResult && !loading && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => onOpenPreview(modeResult.generationId)}
            className="group relative mx-auto block w-full max-w-3xl overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: `${resultDimensions?.width || defaultDimensions.width} / ${
                resultDimensions?.height || defaultDimensions.height
              }`,
            }}
            title={copy("Open image preview", "打开图片预览")}
          >
            <Image
              src={modeResult.imageUrl}
              alt={modeResult.prompt}
              fill
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-contain"
              unoptimized={shouldBypassImageOptimization(modeResult.imageUrl)}
            />
            <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100">
              <Eye className="mr-1 inline h-3.5 w-3.5" />
              {copy("Preview", "预览")}
            </span>
          </button>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{modeResult.prompt}</p>
            <p className="text-xs text-muted-foreground">
              {copy("Model", "模型")}:{" "}
              <span className="font-medium text-foreground">
                {modeResult.model}
              </span>{" "}
              · {copy("Resolution", "分辨率")}:{" "}
              <span className="font-medium text-foreground">
                {modeResult.size}
              </span>
            </p>
            {modeResult.revisedPrompt &&
              modeResult.revisedPrompt !== modeResult.prompt && (
                <p className="text-xs italic text-muted-foreground">
                  {copy("Revised", "优化提示词")}: {modeResult.revisedPrompt}
                </p>
              )}
            {modeResult.promptRepairNotice && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {copy(
                  "The original prompt was rejected by safety checks, so the system made additional adjustments before generating this result.",
                  "原提示词因审核被拒，系统已进行更多修改后生成本次结果。"
                )}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={modeResult.imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {copy("Download", "下载")}
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onApplyAsReference(modeResult)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {copy("Edit this", "编辑这张")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
