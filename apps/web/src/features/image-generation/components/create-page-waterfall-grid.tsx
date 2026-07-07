"use client";

import { Button } from "@repo/ui/components/button";
import {
  ChevronDown,
  Download,
  Loader2,
  Maximize2,
  RefreshCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import { shouldBypassImageOptimization, thumbSrc } from "./create-page-options";
import type { BatchCard } from "./create-page-types";

// 瀑布流结果网格:负责滚动容器、状态栏、卡片展示、保存/下载/重试入口。

/**
 * 渲染瀑布流运行态网格。
 *
 * @param props.scrollRef 滚动容器 ref。
 * @param props.loadTriggerRef 无限加载触发器 ref。
 * @param props.cards 瀑布流卡片列表。
 * @param props.promptTitle 当前批次提示词标题。
 * @param props.statusText 当前发送/成功/失败/运行统计。
 * @param props.isStopped 是否已停止。
 * @param props.isLoadingMore 是否正在生成更多。
 * @param props.copy 中英文文案选择器。
 * @param props.renderThinkingBlock 思考块渲染器。
 * @param props.renderAgentBlock Agent 文本块渲染器。
 * @param props.onContinue 继续生成回调。
 * @param props.onStop 停止生成回调。
 * @param props.onClear 清空回调。
 * @param props.onOpenPreview 打开图片预览回调。
 * @param props.onSaveCard 保存卡片到最近生成回调。
 * @param props.onRetryCard 重试失败卡片回调。
 * @returns 瀑布流运行态内容。
 * @sideEffects 用户操作通过回调通知父组件。
 * @failureMode 图片缺失时保留加载占位,失败卡片展示重试按钮。
 */
export function CreatePageWaterfallGrid({
  scrollRef,
  loadTriggerRef,
  cards,
  promptTitle,
  statusText,
  isStopped,
  isLoadingMore,
  copy,
  renderThinkingBlock,
  renderAgentBlock,
  onContinue,
  onStop,
  onClear,
  onOpenPreview,
  onSaveCard,
  onRetryCard,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  loadTriggerRef: RefObject<HTMLDivElement | null>;
  cards: BatchCard[];
  promptTitle: string;
  statusText: string;
  isStopped: boolean;
  isLoadingMore: boolean;
  copy: (en: string, zh: string) => string;
  renderThinkingBlock: (thinking?: string, open?: boolean) => ReactNode;
  renderAgentBlock: (agent?: string, open?: boolean) => ReactNode;
  onContinue: () => void;
  onStop: () => void;
  onClear: () => void;
  onOpenPreview: (generationId: string) => void;
  onSaveCard: (card: BatchCard) => void;
  onRetryCard: (cardId: string) => void;
}) {
  return (
    <div ref={scrollRef} className="max-h-[760px] overflow-y-auto p-3">
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{promptTitle}</p>
          <p className="text-muted-foreground">
            {statusText}
            {isStopped ? ` · ${copy("Stopped", "已停止")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isStopped ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onContinue}
            >
              <ChevronDown className="h-4 w-4" />
              {copy("Continue", "继续生成")}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onStop}>
              <X className="h-4 w-4" />
              {copy("Stop", "停止")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <Trash2 className="h-4 w-4" />
            {copy("Clear", "清空")}
          </Button>
        </div>
      </div>
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`mb-3 break-inside-avoid overflow-hidden rounded-lg border bg-muted/30 ${
              card.state === "error" ? "border-destructive/30" : "border-border"
            }`}
            style={
              card.aspectRatio &&
              (card.state === "loading" ||
                (card.state === "image" && !card.imageUrl))
                ? { aspectRatio: card.aspectRatio }
                : undefined
            }
          >
            {card.state === "loading" && !card.imageUrl && (
              <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {card.imageUrl && (
              <button
                type="button"
                className="group relative block w-full bg-muted"
                onClick={() => {
                  if (card.generationId) onOpenPreview(card.generationId);
                }}
                title={copy("Open image preview", "打开图片预览")}
              >
                <Image
                  src={thumbSrc(card.imageUrl, 640)}
                  alt={card.prompt}
                  width={640}
                  height={640}
                  className="h-auto w-full object-contain"
                  unoptimized={shouldBypassImageOptimization(card.imageUrl)}
                />
                {card.state === "loading" && (
                  <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                    {copy("Streaming", "流式生成中")}
                  </span>
                )}
                {card.state === "image" && (
                  <div className="absolute inset-x-2 bottom-2 hidden items-center justify-end gap-1 group-hover:flex">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSaveCard(card);
                      }}
                      disabled={card.saved}
                      title={copy("Save to recent", "保存到最近生成")}
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      size="icon-xs"
                      title={copy("Download", "下载")}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <a
                        href={card.imageUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (card.generationId) onOpenPreview(card.generationId);
                      }}
                      title={copy("Fullscreen", "全屏")}
                    >
                      <Maximize2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </button>
            )}

            {card.state === "text" && (
              <div className="p-3 text-sm leading-relaxed">
                {renderThinkingBlock(card.streamThinking)}
                {renderAgentBlock(card.streamAgent)}
                <p className="whitespace-pre-wrap break-words">
                  {card.text || card.streamText || ""}
                </p>
              </div>
            )}

            {card.state === "error" && (
              <div className="space-y-3 p-3 text-sm text-destructive">
                <p className="break-words">
                  {card.error || copy("Generation failed", "生成失败")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRetryCard(card.id)}
                >
                  <RefreshCcw className="h-4 w-4" />
                  {copy("Retry", "重试")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        ref={loadTriggerRef}
        className="flex h-20 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
      >
        {isLoadingMore ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy("Generating...", "生成中...")}
          </>
        ) : isStopped ? (
          <>
            <X className="h-4 w-4" />
            {copy("Stopped", "已停止")}
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" />
            {copy("Scroll to generate more", "继续下拉生成更多")}
          </>
        )}
      </div>
    </div>
  );
}
