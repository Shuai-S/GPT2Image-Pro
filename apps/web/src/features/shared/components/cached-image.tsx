/**
 * 本地缓存图片组件
 *
 * 供图片密集页面替换 next/image 使用，先从浏览器 IndexedDB 读取图片。
 * 关键依赖为 local-image-cache 的稳定键与 Blob URL 解析逻辑。
 */

"use client";

import Image, { type ImageProps } from "next/image";
import {
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  normalizeImageCacheKey,
  resolveLocalCachedImage,
  warmLocalImageCache,
} from "@/features/shared/components/local-image-cache";

export type CachedImageProps = ImageProps & {
  /** 是否启用浏览器 IndexedDB 本地缓存。 */
  cacheLocally?: boolean;
};

/**
 * 渲染带浏览器持久缓存的 Next.js 图片。
 *
 * @param props - next/image 原生参数，并额外支持 cacheLocally 开关。
 * @returns 可直接嵌入现有布局的图片节点；缓存解析期间暂不渲染图片。
 * @sideEffects 可能读取/写入 IndexedDB，并创建与释放 Blob URL。
 * @throws 不抛出异常，缓存失败时自动回退原始 src。
 */
export function CachedImage({
  cacheLocally = true,
  onLoad,
  onError,
  src,
  ...props
}: CachedImageProps) {
  const warmedSrcRef = useRef<string | null>(null);
  const shouldUseCache = useMemo(
    () =>
      cacheLocally &&
      typeof src === "string" &&
      normalizeImageCacheKey(src) !== null,
    [cacheLocally, src]
  );
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);
  const [useFallbackSrc, setUseFallbackSrc] = useState(false);

  useEffect(() => {
    if (!shouldUseCache || typeof src !== "string") {
      setCachedSrc(null);
      setUseFallbackSrc(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setCachedSrc(null);
    setUseFallbackSrc(false);

    resolveLocalCachedImage(src, controller.signal).then((result) => {
      if (!active) {
        if (result?.blobUrl) {
          URL.revokeObjectURL(result.blobUrl);
        }
        return;
      }
      if (!result) {
        setUseFallbackSrc(true);
        return;
      }
      objectUrl = result.blobUrl;
      setCachedSrc(result.blobUrl);
    });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [shouldUseCache, src]);

  const displaySrc = shouldUseCache
    ? cachedSrc || (useFallbackSrc ? src : null)
    : src;
  const shouldBypassOptimizer =
    props.unoptimized ||
    (typeof displaySrc === "string" &&
      (displaySrc.startsWith("blob:") || displaySrc.startsWith("data:")));

  /**
   * 处理 Blob URL 解码失败并回退到原始 URL。
   *
   * @param event - 浏览器图片加载错误事件。
   * @returns void。
   * @sideEffects 可能切换组件状态，并调用上层 onError。
   * @throws 不抛出异常。
   */
  const handleError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    if (shouldUseCache && cachedSrc && !useFallbackSrc) {
      setUseFallbackSrc(true);
    }
    onError?.(event);
  };

  /**
   * 在原始图片完成浏览器懒加载后写入 IndexedDB。
   *
   * @param event - 浏览器图片加载完成事件。
   * @returns void。
   * @sideEffects 可能后台预热本地图片缓存，并调用上层 onLoad。
   * @throws 不抛出异常。
   */
  const handleLoad = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    if (
      shouldUseCache &&
      typeof src === "string" &&
      displaySrc === src &&
      warmedSrcRef.current !== src
    ) {
      warmedSrcRef.current = src;
      void warmLocalImageCache(src);
    }
    onLoad?.(event);
  };

  if (!displaySrc) return null;

  return (
    <Image
      {...props}
      src={displaySrc}
      onError={handleError}
      onLoad={handleLoad}
      unoptimized={shouldBypassOptimizer}
    />
  );
}
