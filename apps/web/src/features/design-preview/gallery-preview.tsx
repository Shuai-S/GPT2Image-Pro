"use client";

// 私人图库原型。展示等高行作品浏览、搜索和全屏聚焦操作，不读取用户真实资产。

import {
  Brush,
  Download,
  ImagePlus,
  PanelTopOpen,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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
  const [selectedArtworkId, setSelectedArtworkId] = useState<string | null>(
    null
  );
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
    if (!selectedArtworkId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedArtworkId(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const currentIndex = artworks.findIndex(
        (artwork) => artwork.id === selectedArtworkId
      );
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex =
        (currentIndex + direction + artworks.length) % artworks.length;
      setSelectedArtworkId(artworks[nextIndex]?.id ?? null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedArtworkId]);

  return (
    <main className={styles.galleryView}>
      <header className={styles.galleryHeader}>
        <div>
          <div className={styles.sectionEyebrow}>Private library</div>
          <h1>图库</h1>
          <p>
            所有生成图片和上传素材都保持私人状态，点击作品可继续生成或进入局部重绘。
          </p>
        </div>
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
                  onClick={() => setSelectedArtworkId(artwork.id)}
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

      {selectedArtworkId && (
        <GalleryLightbox
          artworkId={selectedArtworkId}
          onClose={() => setSelectedArtworkId(null)}
          onUseAsReference={onUseAsReference}
        />
      )}
    </main>
  );
}

/**
 * 渲染私人作品的全屏聚焦层和核心继续创作动作。
 */
function GalleryLightbox({
  artworkId,
  onClose,
  onUseAsReference,
}: {
  artworkId: string;
  onClose: () => void;
  onUseAsReference: () => void;
}) {
  const artwork = getArtwork(artworkId);
  return (
    <div className={styles.lightbox} role="dialog" aria-modal="true">
      <div className={styles.lightboxImage}>
        <Image
          src={artwork.src}
          alt={artwork.alt}
          width={artwork.width}
          height={artwork.height}
          unoptimized
        />
      </div>
      <aside className={styles.lightboxInfo}>
        <button
          type="button"
          className={styles.lightboxClose}
          aria-label="关闭作品聚焦层"
          title="关闭"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
        <div className={styles.sectionEyebrow}>{artwork.category}</div>
        <h2>{artwork.title}</h2>
        <p>
          一张用于高保真原型的私人作品。正式版本将在这里展示原提示词、模型、尺寸、
          积分和生成时间。
        </p>
        <div className={styles.lightboxActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onUseAsReference}
          >
            <ImagePlus size={14} aria-hidden="true" />
            用作参考
          </button>
          <button type="button" className={styles.secondaryButton}>
            <Brush size={14} aria-hidden="true" />
            局部重绘
          </button>
          <button type="button" className={styles.secondaryButton}>
            <PanelTopOpen size={14} aria-hidden="true" />
            加入无限画布
          </button>
          <button type="button" className={styles.secondaryButton}>
            <Download size={14} aria-hidden="true" />
            下载
          </button>
        </div>
      </aside>
    </div>
  );
}
