"use client";

import { Check, Eye, ImagePlus, MessageSquare } from "lucide-react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import { shouldBypassImageOptimization, thumbSrc } from "./create-page-options";
import type { ActiveMode, ChatRecentGeneration } from "./create-page-types";
import type { EditImageFile } from "./image-edit-types";
import { ImageLightbox, type LightboxGeneration } from "./image-lightbox";

// 最近生成展示区:负责缩略图网格、选中态和灯箱,主页面只保留状态编排。

/**
 * 渲染创作页底部最近生成面板。
 *
 * @param props.recent 最近生成记录。
 * @param props.activeMode 当前创作模式。
 * @param props.editImages 图生图已选参考图,用于展示选中态。
 * @param props.selectedRecent 当前灯箱记录。
 * @param props.selectedRecentId 当前灯箱记录 id。
 * @param props.timeZone 灯箱时间展示时区。
 * @param props.copy 中英文文案选择器。
 * @param props.isConversationMode 判断当前模式是否为对话类模式。
 * @param props.onRecentClick 缩略图点击回调。
 * @param props.onClosePreview 关闭灯箱回调。
 * @param props.onDeleteRecent 删除灯箱当前记录回调。
 * @returns 最近生成区和可选灯箱。
 * @sideEffects 仅响应用户点击并通过回调通知父组件。
 * @failureMode 空列表时只保留灯箱;无图片记录禁用缩略图点击。
 */
export function CreatePageRecentPanel({
  recent,
  activeMode,
  editImages,
  selectedRecent,
  selectedRecentId,
  timeZone,
  copy,
  isConversationMode,
  onRecentClick,
  onClosePreview,
  onDeleteRecent,
}: {
  recent: ChatRecentGeneration[];
  activeMode: ActiveMode;
  editImages: EditImageFile[];
  selectedRecent: ChatRecentGeneration | null;
  selectedRecentId: string | null;
  timeZone: string;
  copy: (en: string, zh: string) => string;
  isConversationMode: (mode: ActiveMode) => boolean;
  onRecentClick: (generation: ChatRecentGeneration) => void;
  onClosePreview: () => void;
  onDeleteRecent: (id: string) => void;
}) {
  return (
    <>
      {recent.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-serif text-xl font-semibold">
              {copy("Recent", "最近生成")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isConversationMode(activeMode)
                ? copy(
                    "Click an image to attach it as the next reference.",
                    "点击图片可作为下一次参考图。"
                  )
                : activeMode === "image"
                  ? copy(
                      "Click an image to add or remove it as a reference.",
                      "点击图片可添加或移除为参考图。"
                    )
                  : copy(
                      "Click an image to open the full preview.",
                      "点击图片打开完整预览。"
                    )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {recent.map((generation) => {
              const selectedForEdit = editImages.some(
                (item) => item.sourceId === generation.id
              );
              return (
                <button
                  key={generation.id}
                  type="button"
                  className={`group relative aspect-square overflow-hidden rounded-md border bg-muted text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selectedForEdit && activeMode === "image"
                      ? "border-primary ring-2 ring-primary/50"
                      : "hover:border-foreground/40"
                  }`}
                  title={
                    isConversationMode(activeMode)
                      ? copy("Attach as reference", "添加为参考")
                      : activeMode === "image"
                        ? copy("Use as reference image", "作为参考图片")
                        : copy("Open image preview", "打开图片预览")
                  }
                  onClick={() => onRecentClick(generation)}
                  disabled={!generation.imageUrl}
                >
                  {generation.imageUrl ? (
                    <Image
                      src={thumbSrc(generation.imageUrl, 320)}
                      alt={generation.prompt}
                      fill
                      sizes="80px"
                      className="object-contain transition-transform group-hover:scale-105"
                      unoptimized={shouldBypassImageOptimization(
                        generation.imageUrl
                      )}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImagePlus className="h-6 w-6" />
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {isConversationMode(activeMode) ? (
                      <>
                        <MessageSquare className="mr-1 h-3 w-3" />
                        {copy("Attach", "添加参考")}
                      </>
                    ) : activeMode === "image" ? (
                      selectedForEdit ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          {copy("Selected", "已选择")}
                        </>
                      ) : (
                        <>
                          <ImagePlus className="mr-1 h-3 w-3" />
                          {copy("Use as reference", "作为参考图")}
                        </>
                      )
                    ) : (
                      <>
                        <Eye className="mr-1 h-3 w-3" />
                        {copy("Preview", "预览")}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {selectedRecent && (
        <ImageLightbox
          generation={selectedRecent as LightboxGeneration}
          imageUrl={selectedRecent.imageUrl}
          open={selectedRecentId !== null}
          timeZone={timeZone}
          onClose={onClosePreview}
          onDelete={
            selectedRecent.canDelete === false ? undefined : onDeleteRecent
          }
        />
      )}
    </>
  );
}
