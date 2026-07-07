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
 * @param props.modeResults 当前模式最终结果列表。
 * @param props.placeholderCount 当前参数对应的展示格数量。
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
  modeResults,
  placeholderCount,
  dimensions,
  resultDimensions,
  previewUrl,
  copy,
  onOpenPreview,
  onApplyAsReference,
}: {
  loading: boolean;
  modeResult: ResultState | null;
  modeResults: ResultState[];
  placeholderCount: number;
  dimensions: { width: number; height: number };
  resultDimensions: { width: number; height: number } | null;
  previewUrl: string | null;
  copy: (en: string, zh: string) => string;
  onOpenPreview: (generationId: string) => void;
  onApplyAsReference: (result: ResultState) => void;
}) {
  const displayCount = Math.max(1, placeholderCount);
  const visibleResults = modeResults.length
    ? modeResults.slice(0, displayCount)
    : modeResult
      ? [modeResult]
      : [];
  const emptySlotCount = Math.max(0, displayCount - visibleResults.length);
  const gridClassName =
    displayCount === 1
      ? "mx-auto grid w-full max-w-3xl grid-cols-1 gap-4"
      : "mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2";
  const loadingSlotKeys = createSlotKeys("loading", displayCount);
  const emptySlotKeys = createSlotKeys("empty", emptySlotCount);

  return (
    <section className="flex h-full min-h-[420px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-background p-4 sm:min-h-[560px] xl:min-h-[620px]">
      {(loading || visibleResults.length > 0 || emptySlotCount > 0) && (
        <div className={gridClassName}>
          {loading &&
            visibleResults.length === 0 &&
            loadingSlotKeys.map((slotKey, index) => (
              <VisualPlaceholderSlot
                key={slotKey}
                dimensions={dimensions}
                copy={copy}
                loading
                previewUrl={index === 0 ? previewUrl : null}
              />
            ))}

          {!loading &&
            visibleResults.map((result) => (
              <VisualResultSlot
                key={result.generationId}
                result={result}
                resultDimensions={resultDimensions}
                copy={copy}
                onOpenPreview={onOpenPreview}
                onApplyAsReference={onApplyAsReference}
              />
            ))}

          {!loading &&
            emptySlotKeys.map((slotKey) => (
              <VisualPlaceholderSlot
                key={slotKey}
                dimensions={dimensions}
                copy={copy}
              />
            ))}
        </div>
      )}
    </section>
  );
}

/**
 * 生成稳定的占位格 key。
 *
 * @param prefix key 前缀。
 * @param count 占位格数量。
 * @returns 对应数量的字符串 key。
 * @sideEffects 无。
 * @failureMode count 小于等于 0 时返回空数组。
 */
function createSlotKeys(prefix: string, count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, slotNumber) => {
    return `${prefix}-${slotNumber + 1}`;
  });
}

/**
 * 渲染单个结果图卡片。
 *
 * @param props.result 已完成的生成结果。
 * @param props.resultDimensions 最终图尺寸。
 * @param props.copy 中英文文案选择器。
 * @param props.onOpenPreview 打开灯箱回调。
 * @param props.onApplyAsReference 把当前结果作为编辑参考图。
 * @returns 单张结果卡片。
 * @sideEffects 用户点击按钮时触发下载、预览或继续编辑。
 * @failureMode 图片地址不可用时由图片组件显示为空态。
 */
function VisualResultSlot({
  result,
  resultDimensions,
  copy,
  onOpenPreview,
  onApplyAsReference,
}: {
  result: ResultState;
  resultDimensions: { width: number; height: number } | null;
  copy: (en: string, zh: string) => string;
  onOpenPreview: (generationId: string) => void;
  onApplyAsReference: (result: ResultState) => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onOpenPreview(result.generationId)}
        className="group relative block w-full overflow-hidden rounded-lg border bg-muted"
        style={{
          aspectRatio: `${resultDimensions?.width || defaultDimensions.width} / ${
            resultDimensions?.height || defaultDimensions.height
          }`,
        }}
        title={copy("Open image preview", "打开图片预览")}
      >
        <Image
          src={result.imageUrl}
          alt={result.prompt}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain"
          unoptimized={shouldBypassImageOptimization(result.imageUrl)}
        />
        <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100">
          <Eye className="mr-1 inline h-3.5 w-3.5" />
          {copy("Preview", "预览")}
        </span>
      </button>
      <div className="space-y-2">
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {result.prompt}
        </p>
        <p className="text-xs text-muted-foreground">
          {copy("Model", "模型")}:{" "}
          <span className="font-medium text-foreground">{result.model}</span> ·{" "}
          {copy("Resolution", "分辨率")}:{" "}
          <span className="font-medium text-foreground">{result.size}</span>
        </p>
        {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
          <p className="line-clamp-2 text-xs italic text-muted-foreground">
            {copy("Revised", "优化提示词")}: {result.revisedPrompt}
          </p>
        )}
        {result.promptRepairNotice && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {copy(
              "The original prompt was rejected by safety checks, so the system made additional adjustments before generating this result.",
              "原提示词因审核被拒，系统已进行更多修改后生成本次结果。"
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={result.imageUrl}
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
            onClick={() => onApplyAsReference(result)}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            {copy("Edit this", "编辑这张")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 渲染等待生成的空展示格。
 *
 * @param props.dimensions 展示格尺寸比例。
 * @param props.copy 中英文文案选择器。
 * @param props.loading 是否显示加载状态。
 * @param props.previewUrl 流式预览图片地址。
 * @returns 占位展示格。
 * @sideEffects 无。
 * @failureMode 无预览地址时显示稳定的空白骨架。
 */
function VisualPlaceholderSlot({
  dimensions,
  copy,
  loading = false,
  previewUrl,
}: {
  dimensions: { width: number; height: number };
  copy: (en: string, zh: string) => string;
  loading?: boolean;
  previewUrl?: string | null;
}) {
  return (
    <div
      className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30"
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
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-contain"
            unoptimized={shouldBypassImageOptimization(previewUrl)}
          />
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {copy("Previewing stream", "正在预览流式结果")}
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">
            {copy("Generating your image...", "正在生成图片...")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
