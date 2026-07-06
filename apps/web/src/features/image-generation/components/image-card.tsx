"use client";

import { buildStorageThumbnailUrl } from "@repo/shared/storage/signed-url";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { Badge } from "@repo/ui/components/badge";
import { Card } from "@repo/ui/components/card";
import { Check, Clock, ImageIcon } from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";

export interface ImageCardProps {
  id: string;
  prompt: string;
  imageUrl: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  badge?: string;
  timeZone?: string;
  onClick?: () => void;
  /** 是否处于多选模式 */
  selectable?: boolean;
  /** 当前卡片是否被选中 */
  selected?: boolean;
  /** 选中/取消选中回调,参数为 generation id 与原始鼠标事件(用于 Shift 范围选) */
  onSelect?: (id: string, event: React.MouseEvent) => void;
}

function formatCreatedDate(
  iso: string,
  locale: string,
  timeZone?: string
): string {
  try {
    return formatDateInTimeZone(
      iso,
      locale,
      {
        month: "short",
        day: "2-digit",
        year: "numeric",
      },
      timeZone
    );
  } catch {
    return iso;
  }
}

export function ImageCard({
  id,
  prompt,
  imageUrl,
  model,
  status,
  createdAt,
  badge,
  timeZone,
  onClick,
  selectable,
  selected,
  onSelect,
}: ImageCardProps) {
  const locale = useLocale();
  const clickable = Boolean(onClick) || Boolean(selectable);
  // 列表缩略图:对同源存储图(/api/storage)请求按需缩放后的小图(w=640),把全分辨率
  // 大图(平均 2.4MB)降到缩略图尺寸,大幅降低列表的下载/解码/内存占用。宽度走"路径段"
  // (而非 ?w= 查询参数),以绕过 Cloudflare 忽略 query 的边缘缓存键——否则会命中并下回
  // 整张原图、挤占 HTTP/2 连接带宽、饿死导航请求。非存储图(外链回退)保持原样。
  const thumbnailUrl = buildStorageThumbnailUrl(imageUrl, 640);

  // 多选模式下点击整张卡片触发选中切换,并传递鼠标事件以支持 Shift 范围选;
  // 非多选模式走原有 onClick
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectable && onSelect) {
      onSelect(id, e);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <Card
      onClick={handleCardClick}
      className={`group overflow-hidden rounded-lg border border-border bg-background shadow-none transition-all duration-200 ${
        clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""
      } ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {thumbnailUrl && status === "completed" ? (
          <Image
            src={thumbnailUrl}
            alt={prompt}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
            // 低优先级:与导航 RSC 共用同一条 HTTP/2 连接时,让浏览器优先把带宽给
            // 用户点击触发的导航请求,避免一屏缩略图把切页/切 Tab 拖住。
            fetchPriority="low"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" strokeWidth={1.2} />
          </div>
        )}
        {/* 多选复选框:多选模式下始终显示,非多选模式下仅 hover 或已选中时显示 */}
        {(selectable || selected) && (
          <div
            className={`absolute left-2 top-2 z-10 ${
              selectable ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } transition-opacity duration-150`}
          >
            <div
              className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                selected
                  ? "border-primary bg-primary"
                  : "border-border bg-background/80"
              }`}
            >
              {selected && (
                <Check className="h-3 w-3 text-primary-foreground" />
              )}
            </div>
          </div>
        )}
        {/* badge 位置:多选模式下移到右上角避免与复选框重叠 */}
        {badge && (
          <div
            className={`absolute top-2 ${selectable ? "right-2" : "left-2"}`}
          >
            <Badge className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
              {badge}
            </Badge>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm leading-snug text-foreground">
          {prompt}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className="rounded-full border-border font-normal text-[10px] uppercase tracking-wide"
          >
            {model}
          </Badge>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatCreatedDate(createdAt, locale, timeZone)}
          </span>
        </div>
      </div>
    </Card>
  );
}
