"use client";

// 作品聚焦共享组件。供基础创作结果与私人图库复用同一套曲线放大、信息和操作体验。

import {
  Brush,
  Download,
  ImagePlus,
  Images,
  PanelTopOpen,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import Image from "next/image";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./design-preview.module.css";
import { getArtwork } from "./mock-data";

export type ArtworkFocusRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FocusPhase = "entering" | "focused" | "exiting";

type ArtworkMotionFrames = {
  x: number[];
  y: number[];
  scale: number[];
};

/**
 * 在给定容器中计算完整显示图片的实际区域。
 *
 * @param container 容器在视口中的位置和尺寸。
 * @param artworkWidth 图片原始宽度，必须大于零。
 * @param artworkHeight 图片原始高度，必须大于零。
 * @returns 等效于 `object-fit: contain` 的视口矩形；非法尺寸时回退容器矩形。
 */
function fitArtworkRect(
  container: ArtworkFocusRect,
  artworkWidth: number,
  artworkHeight: number
): ArtworkFocusRect {
  if (artworkWidth <= 0 || artworkHeight <= 0) return container;

  const artworkRatio = artworkWidth / artworkHeight;
  const containerRatio = container.width / container.height;
  const width =
    artworkRatio > containerRatio
      ? container.width
      : container.height * artworkRatio;
  const height =
    artworkRatio > containerRatio
      ? container.width / artworkRatio
      : container.height;

  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * 记录卡片中完整图片的真实可见区域，作为共享聚焦动画的起点。
 *
 * @param element 被点击的作品卡片元素。
 * @param artworkWidth 图片原始宽度。
 * @param artworkHeight 图片原始高度。
 * @returns 可序列化的视口矩形，不保留易失效的 DOMRect 引用。
 */
export function getArtworkFocusOrigin(
  element: HTMLElement,
  artworkWidth: number,
  artworkHeight: number
): ArtworkFocusRect {
  const rect = element.getBoundingClientRect();
  return fitArtworkRect(
    {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    artworkWidth,
    artworkHeight
  );
}

/**
 * 创建开合共用的 GPU 变换曲线路径。
 *
 * @param origin 原图可见区域。
 * @param target 中央聚焦区域。
 * @param reverse 为 true 时反向缩回原图位置。
 * @returns 经过贝塞尔采样的位移与缩放关键帧，不触发布局重排。
 */
function createArtworkMotionFrames(
  origin: ArtworkFocusRect,
  target: ArtworkFocusRect,
  reverse: boolean
): ArtworkMotionFrames {
  const originCenter = {
    x: origin.left + origin.width / 2,
    y: origin.top + origin.height / 2,
  };
  const targetCenter = {
    x: target.left + target.width / 2,
    y: target.top + target.height / 2,
  };
  const originOffset = {
    x: originCenter.x - targetCenter.x,
    y: originCenter.y - targetCenter.y,
  };
  const distance = Math.hypot(originOffset.x, originOffset.y);
  let normalX = distance > 0 ? -originOffset.y / distance : 0;
  let normalY = distance > 0 ? originOffset.x / distance : -1;
  if (normalY > 0) {
    normalX *= -1;
    normalY *= -1;
  }
  const curvature = Math.min(120, Math.max(36, distance * 0.18));
  const controlPoint = {
    x: originOffset.x / 2 + normalX * curvature,
    y: originOffset.y / 2 + normalY * curvature,
  };
  const originScale = origin.width / target.width;
  const frames: ArtworkMotionFrames = { x: [], y: [], scale: [] };

  // 多点采样二次贝塞尔，并把时间映射为对称缓动，消除三段关键帧的折角。
  for (let index = 0; index < 13; index += 1) {
    const rawProgress = index / 12;
    const progress =
      rawProgress < 0.5
        ? 4 * rawProgress ** 3
        : 1 - (-2 * rawProgress + 2) ** 3 / 2;
    const inverseProgress = 1 - progress;
    frames.x.push(
      inverseProgress ** 2 * originOffset.x +
        2 * inverseProgress * progress * controlPoint.x
    );
    frames.y.push(
      inverseProgress ** 2 * originOffset.y +
        2 * inverseProgress * progress * controlPoint.y
    );
    frames.scale.push(originScale + (1 - originScale) * progress);
  }

  if (!reverse) return frames;
  return {
    x: [...frames.x].reverse(),
    y: [...frames.y].reverse(),
    scale: [...frames.scale].reverse(),
  };
}

/**
 * 读取聚焦舞台的实时区域，并在视口变化时保持图片完整居中。
 *
 * @param stageRef 聚焦舞台元素引用。
 * @param artworkWidth 图片原始宽度。
 * @param artworkHeight 图片原始高度。
 * @returns 当前图片在聚焦舞台内的实际矩形；舞台尚未挂载时为 null。
 */
function useFocusedArtworkRect(
  stageRef: RefObject<HTMLDivElement | null>,
  artworkWidth: number,
  artworkHeight: number
) {
  const [targetRect, setTargetRect] = useState<ArtworkFocusRect | null>(null);

  useLayoutEffect(() => {
    const updateTargetRect = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      setTargetRect(
        fitArtworkRect(
          {
            left: rect.left + 1,
            top: rect.top + 1,
            width: Math.max(0, rect.width - 2),
            height: Math.max(0, rect.height - 2),
          },
          artworkWidth,
          artworkHeight
        )
      );
    };

    updateTargetRect();
    window.addEventListener("resize", updateTargetRect);
    return () => window.removeEventListener("resize", updateTargetRect);
  }, [artworkHeight, artworkWidth, stageRef]);

  return targetRect;
}

/**
 * 渲染结果页与图库共用的作品聚焦层。
 *
 * @param props.artworkId 当前作品 ID。
 * @param props.originRect 用户点击时原图在视口中的位置。
 * @param props.prompt 作品提示词或描述。
 * @param props.modelName 生成模型名称。
 * @param props.generatedAt 生成时间。
 * @param props.onClose 反向动画完成后卸载聚焦层。
 * @param props.onUseAsReference 将当前作品用作参考图。
 * @param props.onInpaint 进入局部重绘。
 * @param props.onOpenCanvas 将作品加入无限画布。
 * @param props.onOpenGallery 从结果页进入私人图库；图库内可省略。
 * @returns 共享的曲线转场、完整图片、元信息与继续创作操作。
 */
export function ArtworkFocus({
  artworkId,
  originRect,
  prompt,
  modelName,
  generatedAt,
  onClose,
  onUseAsReference,
  onInpaint,
  onOpenCanvas,
  onOpenGallery,
}: {
  artworkId: string;
  originRect: ArtworkFocusRect;
  prompt: string;
  modelName: string;
  generatedAt: string;
  onClose: () => void;
  onUseAsReference: () => void;
  onInpaint?: () => void;
  onOpenCanvas?: () => void;
  onOpenGallery?: () => void;
}) {
  const artwork = getArtwork(artworkId);
  const stageRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<FocusPhase>("entering");
  const targetRect = useFocusedArtworkRect(
    stageRef,
    artwork.width,
    artwork.height
  );
  const orientation =
    artwork.width === artwork.height
      ? "方形"
      : artwork.width > artwork.height
        ? "横版"
        : "竖版";
  const openingFrames = targetRect
    ? createArtworkMotionFrames(originRect, targetRect, false)
    : null;
  const motionFrames = targetRect
    ? phase === "focused"
      ? { x: 0, y: 0, scale: 1 }
      : phase === "exiting"
        ? createArtworkMotionFrames(originRect, targetRect, true)
        : openingFrames
    : null;

  /**
   * 先切换到退出动画，动画完成后再通知父级卸载，确保原页面不会提前跳回。
   */
  const requestClose = useCallback(() => {
    setPhase((currentPhase) =>
      currentPhase === "exiting" ? currentPhase : "exiting"
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  return (
    <section
      className={styles.artworkFocus}
      role="dialog"
      aria-modal="true"
      aria-label="作品聚焦查看器"
      data-phase={phase}
    >
      <motion.div
        className={styles.artworkFocusBackdrop}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === "exiting" ? 0 : 1 }}
        transition={{ duration: 0.2 }}
        onClick={requestClose}
      />
      <div className={styles.artworkFocusLayout}>
        <motion.div
          ref={stageRef}
          className={styles.artworkFocusStage}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "exiting" ? 0 : 1 }}
          transition={{
            duration: 0.16,
            delay: phase === "entering" ? 0.12 : 0,
          }}
        />
        <motion.aside
          className={styles.artworkFocusInfo}
          initial={{ opacity: 0, x: 18 }}
          animate={
            phase === "exiting" ? { opacity: 0, x: 12 } : { opacity: 1, x: 0 }
          }
          transition={{
            duration: 0.22,
            delay: phase === "entering" ? 0.14 : 0,
          }}
        >
          <button
            type="button"
            className={styles.artworkFocusClose}
            aria-label="关闭作品聚焦"
            title="关闭"
            onClick={requestClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
          <div className={styles.sectionEyebrow}>Focused artwork</div>
          <h2>{artwork.title}</h2>
          <p>{prompt}</p>
          <dl className={styles.artworkFocusMeta}>
            <div>
              <dt>模型</dt>
              <dd>{modelName}</dd>
            </div>
            <div>
              <dt>画幅</dt>
              <dd>{orientation}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>
                {artwork.width} × {artwork.height}
              </dd>
            </div>
            <div>
              <dt>生成时间</dt>
              <dd>{generatedAt}</dd>
            </div>
          </dl>
          <div className={styles.artworkFocusActions}>
            <button type="button" onClick={onUseAsReference}>
              <ImagePlus size={14} aria-hidden="true" />
              用作参考
            </button>
            <button type="button" onClick={onInpaint}>
              <Brush size={14} aria-hidden="true" />
              局部重绘
            </button>
            <button type="button" onClick={onOpenCanvas}>
              <PanelTopOpen size={14} aria-hidden="true" />
              加入无限画布
            </button>
            {onOpenGallery && (
              <button type="button" onClick={onOpenGallery}>
                <Images size={14} aria-hidden="true" />
                打开图库
              </button>
            )}
            <a href={artwork.src} download>
              <Download size={14} aria-hidden="true" />
              下载
            </a>
          </div>
        </motion.aside>
      </div>
      {motionFrames && (
        <motion.div
          className={styles.artworkFocusMovingImage}
          style={{
            left: targetRect?.left,
            top: targetRect?.top,
            width: targetRect?.width,
            height: targetRect?.height,
          }}
          initial={
            openingFrames
              ? {
                  x: openingFrames.x[0],
                  y: openingFrames.y[0],
                  scale: openingFrames.scale[0],
                }
              : false
          }
          animate={motionFrames}
          transition={{
            duration: 0.48,
            ease: "linear",
          }}
          onAnimationComplete={() => {
            if (phase === "entering") setPhase("focused");
            if (phase === "exiting") onClose();
          }}
        >
          <Image
            src={artwork.src}
            alt={artwork.alt}
            width={artwork.width}
            height={artwork.height}
            unoptimized
          />
        </motion.div>
      )}
    </section>
  );
}
