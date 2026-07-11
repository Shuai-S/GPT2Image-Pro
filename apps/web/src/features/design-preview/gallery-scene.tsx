"use client";

// 首页原型的 Three.js 场景。只渲染本地策展图片与轻微视差，不承载业务交互。

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { Suspense, useRef } from "react";
import type { Group } from "three";
import { MathUtils, TextureLoader } from "three";
import { artworks, type Artwork } from "./mock-data";
import type { HomeSection } from "./home-preview";
import styles from "./design-preview.module.css";

/**
 * 渲染单幅带真实比例的空间作品。
 *
 * @param props.artwork 作品纹理、空间位置、旋转与层级配置。
 * @returns 一块带细边缘背板的 Three.js 作品平面。
 */
function ArtworkPlane({ artwork }: { artwork: Artwork }) {
  const texture = useLoader(TextureLoader, artwork.src);
  const aspect = artwork.width / artwork.height;
  const height = 1.75 * artwork.scale;
  const width = height * aspect;

  return (
    <group
      position={artwork.position}
      rotation={artwork.rotation}
      scale={artwork.depth === "near" ? 1.04 : 1}
    >
      <mesh position={[0, 0, -0.018]}>
        <planeGeometry args={[width + 0.06, height + 0.06]} />
        <meshBasicMaterial color="#bdbab4" />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * 管理作品群的低频呼吸运动和鼠标视差。
 *
 * @returns 由 12 幅作品组成的空间组。
 * @sideEffects 每帧根据指针位置更新组旋转与位移；减少动态效果时保持静止。
 */
function ArtworkField({ section }: { section: HomeSection }) {
  const groupRef = useRef<Group>(null);
  const reducedMotion = useReducedMotion();

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const panelVisible = section !== "gallery";
    const targetScale = panelVisible ? 0.72 : 1;
    const targetZ = panelVisible ? -2.8 : 0;
    group.scale.setScalar(MathUtils.lerp(group.scale.x, targetScale, 0.045));
    group.position.z = MathUtils.lerp(group.position.z, targetZ, 0.045);
    if (reducedMotion) return;
    const time = state.clock.getElapsedTime();
    const parallaxStrength = panelVisible ? 0.012 : 0.035;
    const targetRotationY = state.pointer.x * parallaxStrength;
    const targetRotationX = -state.pointer.y * parallaxStrength * 0.63;
    group.rotation.y = MathUtils.lerp(group.rotation.y, targetRotationY, 0.035);
    group.rotation.x = MathUtils.lerp(group.rotation.x, targetRotationX, 0.035);
    group.position.y = Math.sin(time * 0.22) * 0.045;
    group.position.x = Math.cos(time * 0.16) * 0.035;
  });

  return (
    <group ref={groupRef} position={[1.1, -0.05, 0]}>
      {artworks.map((artwork) => (
        <ArtworkPlane key={artwork.id} artwork={artwork} />
      ))}
    </group>
  );
}

/**
 * 渲染首页 3D 画廊 Canvas。
 *
 * @returns 带静态背景、透视相机、雾效与作品群的全屏画布。
 * @failureMode 纹理未完成时 Suspense 保留父层静态石墨背景，不阻塞标题与按钮。
 */
export function GalleryScene({
  section,
  theme,
}: {
  section: HomeSection;
  theme: "dark" | "light";
}) {
  const backgroundColor = theme === "light" ? "#e8e8e6" : "#0e0e0e";
  return (
    <Canvas
      className={styles.sceneCanvas}
      camera={{ position: [0, 0, 10], fov: 44, near: 0.1, far: 60 }}
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
    >
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[backgroundColor, 9, 22]} />
      <Suspense fallback={null}>
        <ArtworkField section={section} />
      </Suspense>
    </Canvas>
  );
}
