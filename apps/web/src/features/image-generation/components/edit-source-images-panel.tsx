"use client";

// 图生图源图与蒙版编辑面板。由创作页主容器提供状态,本组件只负责展示和转发交互。

import { Button } from "@repo/ui/components/button";
import { Brush, Eraser, Save, Upload, X } from "lucide-react";
import type React from "react";
import { CachedImage as Image } from "@/features/shared/components/cached-image";
import type { EditImageFile } from "./image-edit-types";

type ImageSize = {
  width: number;
  height: number;
};

type EditSourceImagesPanelProps = {
  copy: (en: string, zh: string) => string;
  editImages: EditImageFile[];
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  imageAccept: string;
  maxEditImages: number;
  maxEditRequestBytesLabel: string;
  isEditing: boolean;
  maskEditorOpen: boolean;
  maskSourceDisplayIndex: number;
  maskSourcePreviewUrl: string | null;
  maskSourceImageSize: ImageSize | null;
  maskBrushSize: number;
  maskHasPoints: boolean;
  maskFile: EditImageFile | null;
  onAddImages: (files: FileList | null) => void;
  onClearEditImages: () => void;
  onOpenMaskEditorForImage: (index: number) => void;
  onCloseMaskEditor: () => void;
  onRemoveImage: (index: number) => void;
  onStartMaskDrawing: (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => void;
  onDrawMaskLine: (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => void;
  onStopMaskDrawing: () => void;
  onMaskBrushSizeChange: (size: number) => void;
  onClearDrawnMask: () => void;
  onClearSavedMask: () => void;
  onSaveDrawnMask: () => void;
};

/**
 * 渲染图生图源图上传、缩略图选择和内联蒙版画板。
 *
 * @param props 由创作页主容器传入的图片、蒙版状态与事件处理器。
 * @returns 图生图输入区域。
 * @sideEffects 用户交互会通过回调修改父组件状态,本组件不直接持久化数据。
 * @failureMode 预览 URL 无效时图片组件会显示为空态,提交校验仍由父组件与服务端兜底。
 */
export function EditSourceImagesPanel({
  copy,
  editImages,
  imageInputRef,
  maskCanvasRef,
  imageAccept,
  maxEditImages,
  maxEditRequestBytesLabel,
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
  onCloseMaskEditor,
  onRemoveImage,
  onStartMaskDrawing,
  onDrawMaskLine,
  onStopMaskDrawing,
  onMaskBrushSizeChange,
  onClearDrawnMask,
  onClearSavedMask,
  onSaveDrawnMask,
}: EditSourceImagesPanelProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4 xl:col-start-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">
            {copy("Source images", "源图片")}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy(
              `Upload PNG, JPEG, or WebP. Click an uploaded image to edit its mask. Up to ${maxEditImages} images, ${maxEditRequestBytesLabel} total.`,
              `上传 PNG、JPEG 或 WebP。点击已上传图片即可编辑它的蒙版。最多 ${maxEditImages} 张，总大小不超过 ${maxEditRequestBytesLabel}。`
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => imageInputRef.current?.click()}
            disabled={isEditing || editImages.length >= maxEditImages}
          >
            <Upload className="mr-2 h-4 w-4" />
            {copy("Upload images", "上传图片")}
          </Button>
          {editImages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={onClearEditImages}
              disabled={isEditing}
            >
              {copy("Clear all", "全部清除")}
            </Button>
          )}
        </div>
        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept={imageAccept}
          className="sr-only"
          onChange={(event) => {
            onAddImages(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {editImages.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {editImages.map((item, index) => {
            const isMaskSource =
              maskEditorOpen && index === maskSourceDisplayIndex;
            return (
              <div
                key={`${item.file.name}-${item.previewUrl}`}
                className={`group relative aspect-square overflow-hidden rounded-md border bg-muted outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                  isMaskSource
                    ? "border-primary ring-2 ring-primary/50"
                    : "hover:border-foreground/40"
                }`}
              >
                <button
                  type="button"
                  className="absolute inset-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                  title={copy("Edit mask on this image", "编辑这张图的蒙版")}
                  disabled={isEditing}
                  onClick={() => {
                    if (isMaskSource) {
                      onCloseMaskEditor();
                      return;
                    }
                    onOpenMaskEditorForImage(index);
                  }}
                >
                  <span className="absolute left-1 top-1 z-10 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                    {index + 1}
                  </span>
                  <Image
                    src={item.previewUrl}
                    alt={
                      item.file.name ||
                      copy(`Source image ${index + 1}`, `源图片 ${index + 1}`)
                    }
                    fill
                    sizes="160px"
                    className="object-cover"
                    unoptimized
                  />
                  {isMaskSource && (
                    <span className="absolute inset-x-1 bottom-1 z-10 inline-flex items-center justify-center rounded bg-background/90 px-1.5 py-1 text-[10px] font-medium text-foreground shadow-sm">
                      <Brush className="mr-1 h-3 w-3" />
                      {copy("Mask editing", "蒙版编辑中")}
                    </span>
                  )}
                </button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  className="absolute right-1 top-1 z-20 opacity-95"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveImage(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {maskEditorOpen && maskSourcePreviewUrl && maskSourceImageSize && (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {copy(
                  `Editing mask on image ${maskSourceDisplayIndex + 1}`,
                  `正在编辑第 ${maskSourceDisplayIndex + 1} 张图的蒙版`
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy(
                  "Click the same thumbnail again or close this editor when finished.",
                  "再次点击同一缩略图或关闭编辑器即可收起蒙版。"
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCloseMaskEditor}
              disabled={isEditing}
              aria-label={copy("Close mask editor", "关闭蒙版编辑器")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div
            className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-md border bg-muted"
            style={{
              aspectRatio: `${maskSourceImageSize.width} / ${maskSourceImageSize.height}`,
            }}
          >
            <Image
              src={maskSourcePreviewUrl}
              alt={copy(
                "Source image for mask editing",
                "用于蒙版编辑的源图片"
              )}
              fill
              sizes="(max-width: 1024px) 100vw, 640px"
              className="object-contain"
              unoptimized
            />
            <canvas
              ref={maskCanvasRef}
              width={maskSourceImageSize.width}
              height={maskSourceImageSize.height}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onMouseDown={onStartMaskDrawing}
              onMouseMove={onDrawMaskLine}
              onMouseUp={onStopMaskDrawing}
              onMouseLeave={onStopMaskDrawing}
              onTouchStart={onStartMaskDrawing}
              onTouchMove={onDrawMaskLine}
              onTouchEnd={onStopMaskDrawing}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label
              htmlFor="mask-brush-size"
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              {copy("Brush", "画笔")} {maskBrushSize}px
              <input
                id="mask-brush-size"
                type="range"
                min={4}
                max={128}
                step={1}
                value={maskBrushSize}
                onChange={(event) =>
                  onMaskBrushSizeChange(Number(event.target.value))
                }
                className="w-40 accent-primary"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClearDrawnMask}
                disabled={isEditing}
              >
                <Eraser className="mr-2 h-4 w-4" />
                {copy("Clear mask", "清除蒙版")}
              </Button>
              {maskFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClearSavedMask}
                  disabled={isEditing}
                >
                  {copy("Clear saved", "清除已保存")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={onSaveDrawnMask}
                disabled={isEditing || !maskHasPoints}
              >
                <Save className="mr-2 h-4 w-4" />
                {copy("Save mask", "保存蒙版")}
              </Button>
            </div>
          </div>
          {maskFile && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {copy("Saved mask", "已保存蒙版")}
              </p>
              <div className="relative aspect-video w-44 overflow-hidden rounded-md border bg-muted">
                <Image
                  src={maskFile.previewUrl}
                  alt={copy("Mask preview", "蒙版预览")}
                  fill
                  sizes="176px"
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
