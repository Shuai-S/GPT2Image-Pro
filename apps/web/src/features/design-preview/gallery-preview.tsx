"use client";

// 私人图库原型。展示等高行作品浏览、搜索和全屏聚焦操作，不读取用户真实资产。

import { Search, SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArtworkFocus,
  type ArtworkFocusRect,
  getArtworkFocusOrigin,
} from "./artwork-focus";
import { artworks, getArtwork } from "./mock-data";
import styles from "./design-preview.module.css";

/**
 * 将作品列表切分为适合等高行展示的稳定分组。
 *
 * @param ids 筛选后的作品 ID。
 * @returns 每行 2 至 4 幅作品的二维数组。
 */
function buildRows(ids: string[]) {
  const rows: string[][] = [];
  let cursor = 0;
  const pattern = [3, 4, 3, 2];
  let patternIndex = 0;
  while (cursor < ids.length) {
    const size = pattern[patternIndex % pattern.length] ?? 3;
    rows.push(ids.slice(cursor, cursor + size));
    cursor += size;
    patternIndex += 1;
  }
  return rows;
}

/**
 * 渲染私人图库与全屏作品聚焦层。
 *
 * @param props.onUseAsReference 模拟从图库返回基础创作并带入参考图。
 * @returns 等高行图库、搜索控件和聚焦层。
 */
export function GalleryPreview({
  onUseAsReference,
}: {
  onUseAsReference: () => void;
}) {
  const [query, setQuery] = useState("");
  const [focusedArtwork, setFocusedArtwork] = useState<{
    artworkId: string;
    originRect: ArtworkFocusRect;
  } | null>(null);
  const filteredIds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return artworks.map((artwork) => artwork.id);
    return artworks
      .filter((artwork) =>
        `${artwork.title} ${artwork.category}`
          .toLowerCase()
          .includes(normalized)
      )
      .map((artwork) => artwork.id);
  }, [query]);
  const rows = useMemo(() => buildRows(filteredIds), [filteredIds]);

  useEffect(() => {
    if (!focusedArtwork || filteredIds.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const currentIndex = filteredIds.indexOf(focusedArtwork.artworkId);
      if (currentIndex < 0) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex =
        (currentIndex + direction + filteredIds.length) % filteredIds.length;
      const nextArtworkId = filteredIds[nextIndex];
      if (!nextArtworkId) return;
      setFocusedArtwork((current) =>
        current ? { ...current, artworkId: nextArtworkId } : null
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredIds, focusedArtwork]);

  return (
    <main className={styles.galleryView}>
      <header className={styles.galleryHeader}>
        <div className={styles.galleryTools}>
          <label className={styles.controlGroup}>
            <Search
              size={14}
              aria-hidden="true"
              style={{ position: "absolute", left: 10, top: 10 }}
            />
            <input
              className={styles.searchInput}
              style={{ paddingLeft: 32 }}
              aria-label="搜索私人图库"
              placeholder="搜索提示词、模型或时间"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className={styles.controlButton}>
            <SlidersHorizontal size={13} aria-hidden="true" />
            筛选
          </button>
        </div>
      </header>

      <section className={styles.galleryRows} aria-label="私人作品">
        {rows.map((row) => (
          <div className={styles.galleryRow} key={row.join("|")}>
            {row.map((artworkId) => {
              const artwork = getArtwork(artworkId);
              return (
                <button
                  type="button"
                  className={styles.galleryItem}
                  style={{ flexGrow: artwork.width / artwork.height }}
                  key={artwork.id}
                  onClick={(event) =>
                    setFocusedArtwork({
                      artworkId: artwork.id,
                      originRect: getArtworkFocusOrigin(
                        event.currentTarget,
                        artwork.width,
                        artwork.height
                      ),
                    })
                  }
                >
                  <Image
                    src={artwork.src}
                    alt={artwork.alt}
                    width={artwork.width}
                    height={artwork.height}
                    unoptimized
                  />
                  <span className={styles.galleryItemMeta}>
                    <span>{artwork.title}</span>
                    <span>{artwork.category}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </section>

      {focusedArtwork && (
        <ArtworkFocus
          artworkId={focusedArtwork.artworkId}
          originRect={focusedArtwork.originRect}
          prompt={`“${getArtwork(focusedArtwork.artworkId).title}”私人作品，可继续作为参考图或进入局部重绘。`}
          modelName="GPT Image 2"
          generatedAt="今天"
          onClose={() => setFocusedArtwork(null)}
          onUseAsReference={onUseAsReference}
        />
      )}
    </main>
  );
}
