"use client";

import { buildStorageThumbnailUrl } from "@repo/shared/storage/image-url";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  Download,
  ImagePlus,
  MousePointerClick,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { batchDeleteGenerationAction } from "@/features/image-generation/actions";
import { ImageCard } from "@/features/image-generation/components/image-card";
import type {
  LightboxGeneration,
  LightboxReferenceImage,
} from "@/features/image-generation/components/image-lightbox";
import { prefetchLocalImageCache } from "@/features/shared/components/local-image-cache";
import { generateDownloadFilename } from "@/lib/download-filename";

// 懒加载:lightbox 仅在点开某张图时才需要,改 next/dynamic 后从图库首屏 bundle 移出。
const ImageLightbox = dynamic(
  () =>
    import("@/features/image-generation/components/image-lightbox").then(
      (m) => m.ImageLightbox
    ),
  { ssr: false }
);

export interface GenerationWithUrl {
  id: string;
  parentId?: string;
  prompt: string;
  revisedPrompt: string | null;
  promptRepairNotice?: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
  // 视频项(视频 tab)：产物 mp4 的签名 URL;imageUrl 为空,渲染 <video> 而非 <img>。
  videoUrl?: string | null;
  outputRole?: "final" | "agent_draft" | "upload" | "video";
  referenceImages?: LightboxReferenceImage[];
  isLayered?: boolean;
}

export interface GalleryClientProps {
  initialGenerations: GenerationWithUrl[];
  totalCount: number;
  finalCount: number;
  draftCount: number;
  uploadCount: number;
  videoCount: number;
  activeTab: "final" | "agent-drafts" | "uploads" | "videos";
  page: number;
}

export function GalleryClient({
  initialGenerations,
  totalCount,
  finalCount,
  draftCount,
  uploadCount,
  videoCount,
  activeTab,
  page,
}: GalleryClientProps) {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );
  const [items, setItems] = useState<GenerationWithUrl[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // -- 虚拟化:响应式列数。WHY 画廊是 CSS grid 多列(grid-cols-2 md:3 lg:4),
  // 直接虚拟化每个格子会与多列 grid 难以对齐;改为"虚拟行"(每行 N 个卡片,
  // 行本身仍是 grid),只渲染可视区+overscan 的行,DOM 节点数随视口而非数据量增长。
  // 列数通过 matchMedia 跟踪 Tailwind 断点(md=768,lg=1024),保证与 CSS grid 一致。
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const mqlMd = window.matchMedia("(min-width: 768px)");
    const mqlLg = window.matchMedia("(min-width: 1024px)");
    const update = () => setColumns(mqlLg.matches ? 4 : mqlMd.matches ? 3 : 2);
    update();
    mqlMd.addEventListener("change", update);
    mqlLg.addEventListener("change", update);
    return () => {
      mqlMd.removeEventListener("change", update);
      mqlLg.removeEventListener("change", update);
    };
  }, []);

  // -- 多选模式状态 --
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 记录上一次点选的索引,用于 Shift 范围选择 */
  const lastSelectedIndexRef = useRef<number>(-1);
  /** 批量删除二次确认:第一次点击设为 true,第二次才真正执行 */
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const hasMore = items.length < totalCount;

  // -- 多选模式:退出时清空选中集 --
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmBatchDelete(false);
    lastSelectedIndexRef.current = -1;
  }, []);

  // -- 多选模式:切换单个 item 的选中状态,支持 Shift 范围选 --
  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent) => {
      const currentIndex = items.findIndex((i) => i.id === id);

      setSelectedIds((prev) => {
        const next = new Set(prev);

        // Shift+点击:选中上次与本次之间的所有项
        if (
          event?.shiftKey &&
          lastSelectedIndexRef.current >= 0 &&
          lastSelectedIndexRef.current !== currentIndex
        ) {
          const start = Math.min(lastSelectedIndexRef.current, currentIndex);
          const end = Math.max(lastSelectedIndexRef.current, currentIndex);
          for (let i = start; i <= end; i++) {
            const item = items[i];
            if (item) next.add(item.id);
          }
        } else {
          // 普通点击 / Ctrl+点击:切换单项
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }

        return next;
      });

      lastSelectedIndexRef.current = currentIndex;
      // 重置删除二次确认
      setConfirmBatchDelete(false);
    },
    [items]
  );

  // -- 批量下载:依次创建临时 <a> 触发下载,间隔 100ms 避免浏览器拦截 --
  const handleBatchDownload = useCallback(() => {
    const toDownload = items.filter((i) => selectedIds.has(i.id) && i.imageUrl);
    if (toDownload.length === 0) return;
    for (let idx = 0; idx < toDownload.length; idx++) {
      const item = toDownload[idx];
      if (!item?.imageUrl) continue;
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = item.imageUrl as string;
        a.download = generateDownloadFilename(item.prompt, item.createdAt);
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 100);
    }
    toast.success(
      copy(
        `Downloading ${toDownload.length} images`,
        `正在下载 ${toDownload.length} 张图片`
      )
    );
  }, [items, selectedIds, copy]);

  // -- 批量删除 --
  const handleBatchDelete = useCallback(async () => {
    if (!confirmBatchDelete) {
      setConfirmBatchDelete(true);
      return;
    }
    setBatchDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await batchDeleteGenerationAction({
        generationIds: ids,
      });
      if (result?.data?.success) {
        const count = result.data.deletedCount ?? ids.length;
        setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
        setSelectedIds(new Set());
        setConfirmBatchDelete(false);
        toast.success(
          copy(`Deleted ${count} images`, `已删除 ${count} 张图片`)
        );
      } else {
        const msg = result?.serverError || copy("Failed to delete", "删除失败");
        toast.error(
          typeof msg === "string" ? msg : copy("Failed to delete", "删除失败")
        );
      }
    } catch {
      toast.error(copy("Failed to delete", "删除失败"));
    } finally {
      setBatchDeleting(false);
    }
  }, [confirmBatchDelete, selectedIds, copy]);

  // -- 全选 / 取消全选 --
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
    setConfirmBatchDelete(false);
  }, [items, selectedIds.size]);

  const createHref = `/${locale}/dashboard/create`;
  const galleryHref = (tab: GalleryClientProps["activeTab"], nextPage = 1) =>
    `/${locale}/dashboard/gallery?tab=${tab}&page=${nextPage}`;
  const nextPageHref = galleryHref(activeTab, page + 1);
  const countBadgeClass = (active: boolean) =>
    [
      "ml-2 rounded-full px-1.5 py-0 text-[10px] font-normal",
      active
        ? "border-transparent bg-primary-foreground text-primary"
        : "border-border text-foreground",
    ].join(" ");

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const tabs = (
    <div className="flex items-center gap-3">
      <Tabs value={activeTab} className="flex-1">
        <TabsList className="h-auto flex-wrap justify-start border border-border bg-muted/40">
          <TabsTrigger value="final" asChild>
            <Link href={galleryHref("final")} scroll={false}>
              {copy("Final images", "成品")}
              <Badge
                variant="outline"
                className={countBadgeClass(activeTab === "final")}
              >
                {finalCount}
              </Badge>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="agent-drafts" asChild>
            <Link href={galleryHref("agent-drafts")} scroll={false}>
              {copy("Agent drafts", "Agent 中间图")}
              <Badge
                variant="outline"
                className={countBadgeClass(activeTab === "agent-drafts")}
              >
                {draftCount}
              </Badge>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="uploads" asChild>
            <Link href={galleryHref("uploads")} scroll={false}>
              {copy("User uploads", "用户上传图")}
              <Badge
                variant="outline"
                className={countBadgeClass(activeTab === "uploads")}
              >
                {uploadCount}
              </Badge>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="videos" asChild>
            <Link href={galleryHref("videos")} scroll={false}>
              {copy("Videos", "视频")}
              <Badge
                variant="outline"
                className={countBadgeClass(activeTab === "videos")}
              >
                {videoCount}
              </Badge>
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {/* 多选模式切换按钮(批量选择/下载是图片专用,视频 tab 隐藏) */}
      {activeTab !== "videos" && (
        <Button
          variant={selectMode ? "secondary" : "outline"}
          size="sm"
          onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
          className="shrink-0"
        >
          {selectMode ? (
            <>
              <X className="mr-1.5 h-3.5 w-3.5" />
              {copy("Cancel", "取消")}
            </>
          ) : (
            <>
              <MousePointerClick className="mr-1.5 h-3.5 w-3.5" />
              {copy("Select", "选择")}
            </>
          )}
        </Button>
      )}
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {tabs}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-24 text-center">
          <ImagePlus
            className="h-10 w-10 text-muted-foreground"
            strokeWidth={1.2}
          />
          <h3 className="mt-4 font-serif text-lg font-medium text-foreground">
            {activeTab === "agent-drafts"
              ? copy("No Agent drafts yet", "还没有 Agent 中间图")
              : activeTab === "uploads"
                ? copy("No user uploads yet", "还没有用户上传图")
                : activeTab === "videos"
                  ? copy("No videos yet", "还没有视频")
                  : copy("No images yet", "还没有图片")}
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {activeTab === "agent-drafts"
              ? copy(
                  "Intermediate images from Agent iterations will appear here.",
                  "Agent 自动迭代产生的中间图会显示在这里。"
                )
              : activeTab === "uploads"
                ? copy(
                    "Reference images uploaded for image edits and chats will appear here.",
                    "图生图和 Chat 上传的参考图会显示在这里。"
                  )
                : activeTab === "videos"
                  ? copy(
                      "Videos you generate will appear here. Create one in the Video tab on the create page.",
                      "你生成的视频会显示在这里。在创作页的「视频」tab 里生成。"
                    )
                  : copy(
                      "Your generated images will appear here. Start by creating your first one.",
                      "你生成的图片会显示在这里。先创建第一张图片吧。"
                    )}
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href={createHref}>{copy("Create an image", "创建图片")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">{tabs}</div>
      <GalleryVirtualGrid
        gridRef={gridContainerRef}
        items={items}
        columns={columns}
        selectMode={selectMode}
        selectedIds={selectedIds}
        handleSelect={handleSelect}
        setSelectedId={setSelectedId}
        copy={copy}
      />

      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button asChild variant="outline">
            <Link href={nextPageHref} scroll={false}>
              {copy("Load more", "加载更多")}
            </Link>
          </Button>
        </div>
      )}

      {/* 多选模式下的浮动批量操作栏 */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2.5 shadow-lg">
            <span className="text-sm text-muted-foreground">
              {copy(
                `Selected ${selectedIds.size} items`,
                `已选择 ${selectedIds.size} 项`
              )}
            </span>
            <div className="h-4 w-px bg-border" />
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              {selectedIds.size === items.length
                ? copy("Deselect all", "取消全选")
                : copy("Select all", "全选")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleBatchDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {copy("Download", "下载")}
            </Button>
            <Button
              variant={confirmBatchDelete ? "destructive" : "outline"}
              size="sm"
              disabled={batchDeleting}
              onClick={handleBatchDelete}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {confirmBatchDelete
                ? copy(
                    `Confirm delete ${selectedIds.size} items`,
                    `确认删除 ${selectedIds.size} 项`
                  )
                : copy("Delete", "删除")}
            </Button>
          </div>
        </div>
      )}

      {selected && (
        <ImageLightbox
          generation={selected as LightboxGeneration}
          imageUrl={selected.imageUrl}
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
          onDelete={
            selected.outputRole === "agent_draft" ||
            selected.outputRole === "upload"
              ? undefined
              : handleDelete
          }
        />
      )}
    </>
  );
}

/**
 * 渲染单个画廊卡片(图片或视频),提取为子组件以便父级 memo 比对 props。
 *
 * WHY:CachedImage 与 ImageCard 各自的 effect/handler 较重,提升为独立组件并
 * 经 React.memo 包裹后,列表重渲(如选中态切换、父级 items 增删)时未改动的
 * 卡片不再重新执行渲染与子 effect;selectMode 切换才整列重渲。
 */
const GalleryCard = memo(function GalleryCard({
  item,
  selectMode,
  selected,
  handleSelect,
  setSelectedId,
  copy,
}: {
  item: GenerationWithUrl;
  selectMode: boolean;
  selected: boolean;
  handleSelect: (id: string, event: MouseEvent) => void;
  setSelectedId: (id: string) => void;
  copy: (en: string, zh: string) => string;
}) {
  return item.outputRole === "video" ? (
    // 视频项:直接内联 <video>(preload=metadata 显示首帧,点 controls 播放),
    // 不参与多选/批量下载(那套是图片专用)。
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {item.videoUrl ? (
        <video
          src={item.videoUrl}
          controls
          preload="metadata"
          className="aspect-square w-full bg-black object-contain"
        >
          <track kind="captions" />
        </video>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground">
          {copy("Video unavailable", "视频不可用")}
        </div>
      )}
      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {item.prompt}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {item.model} · {item.size}
        </p>
      </div>
    </div>
  ) : (
    <ImageCard
      id={item.id}
      prompt={item.prompt}
      imageUrl={item.imageUrl}
      model={item.model}
      size={item.size}
      creditsConsumed={item.creditsConsumed}
      createdAt={item.createdAt}
      status={item.status}
      selectable={selectMode}
      selected={selected}
      onSelect={selectMode ? handleSelect : undefined}
      onClick={selectMode ? undefined : () => setSelectedId(item.id)}
      badge={
        item.outputRole === "agent_draft"
          ? copy("Draft", "中间图")
          : item.outputRole === "upload"
            ? copy("Upload", "上传")
            : undefined
      }
    />
  );
});

/**
 * 画廊虚拟滚动网格。
 *
 * WHY:画廊是服务端累积分页(page * 20),一次拿到数组可能上百项。原实现全量
 * items.map 渲染会一次性创建上百个 CachedImage/ImageCard,首屏解码/IndexedDB
 * 并发读取高、滚动卡顿。这里以"行"为单位用 useWindowVirtualizer 虚拟化:
 * 行数 = ceil(items.length / columns),仅渲染可视区 + overscan 的行。
 *
 * 视觉等价说明:每行是一个 grid 子容器(limit 到当前列数),内部按列摆卡片,
 * 行之间用 top:virtualRow.start 做绝对定位,外层容器 height = totalSize 作为
 * 占位,使页面整体可滚动;滚动事件由 window 拦截(virtualizer 默认行为),与原
 * CSS grid 整页滚动表现一致。scrollMargin 动态测量网格容器顶到文档顶的距离,
 * 兼容标题/Tab 等上方占位,避免可视区偏移导致首行漏渲染。
 *
 * @param props.items 全部画廊项(来自累积分页)。
 * @param props.columns 当前响应式列数(与 CSS grid 断点一致)。
 * @returns 占位容器 + 可视区绝对行。
 * @sideEffects 注册 window 滚动监听(由 virtualizer 完成);ResizeObserver 测行高。
 * @failureMode 列数变化时重算行数与并重建;items 为空时上层不进入本组件。
 */
const GalleryVirtualGrid = function GalleryVirtualGrid({
  items,
  columns,
  selectMode,
  selectedIds,
  handleSelect,
  setSelectedId,
  copy,
  gridRef,
}: {
  items: GenerationWithUrl[];
  columns: number;
  selectMode: boolean;
  selectedIds: Set<string>;
  handleSelect: (id: string, event: MouseEvent) => void;
  setSelectedId: (id: string) => void;
  copy: (en: string, zh: string) => string;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  const rowCount = Math.ceil(items.length / columns);

  // 列表挂载/数据变化时批量预热 IndexedDB 连接:预热只提前打开数据库连接(命中即走),
  // 不抓网络;配合虚拟化后可视区 CachedImage effect 共享同一已就绪连接。
  useEffect(() => {
    const srcs = items
      .map((item) => buildStorageThumbnailUrl(item.imageUrl, 640))
      .filter((src): src is string => Boolean(src));
    prefetchLocalImageCache(srcs);
  }, [items]);

  // scrollMargin:offsetTop 是相对 offsetParent 的距离,但 window 虚拟化器需要相对
  // 文档顶的距离。直接用 getBoundingClientRect().top + window.scrollY 实时取值,
  // 在每次 window 滚动 / resize 时由 virtualizer 重新读取 options,故用 getter 让
  // scrollMargin 永远反映当前位置(标题/Tab 区高度变化时自动跟上)。
  const computeScrollMargin = () => {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    return Math.max(0, rect.top + window.scrollY);
  };

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 360,
    overscan: 4,
    scrollMargin: computeScrollMargin(),
    getItemKey: (index) => {
      // 行内取首卡片 id 作为行 key,跨行稳定;列数变化导致重排时仍能复用 DOM。
      const item = items[index * columns];
      return item ? `row-${item.id}` : `row-${index}`;
    },
  });

  return (
    <div
      ref={gridRef}
      className="relative w-full"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const startIndex = virtualRow.index * columns;
        const rowItems = items.slice(startIndex, startIndex + columns);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            className="absolute left-0 top-0 grid w-full grid-cols-2 gap-4 pb-4 md:grid-cols-3 lg:grid-cols-4"
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {rowItems.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                selectMode={selectMode}
                selected={selectMode && selectedIds.has(item.id)}
                handleSelect={handleSelect}
                setSelectedId={setSelectedId}
                copy={copy}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};
