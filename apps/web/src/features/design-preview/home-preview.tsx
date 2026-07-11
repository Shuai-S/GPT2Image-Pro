"use client";

// 原型首页视图。组合 Three.js 作品群与真实 DOM 定价、文档信息画布。

import { ArrowRight, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { previewPromise, previewTitle } from "./mock-data";
import styles from "./design-preview.module.css";

const GalleryScene = dynamic(
  () => import("./gallery-scene").then((module) => module.GalleryScene),
  { ssr: false }
);

export type HomeSection = "gallery" | "pricing" | "docs";

const planOptions = [
  { id: "free", label: "免费版", price: "0", credits: "每月基础积分" },
  { id: "starter", label: "入门版", price: "29", credits: "适合轻量创作" },
  { id: "pro", label: "专业版", price: "79", credits: "推荐 · 高频创作" },
  { id: "ultra", label: "旗舰版", price: "169", credits: "高额度与高级模型" },
  {
    id: "enterprise",
    label: "企业版",
    price: "定制",
    credits: "团队与业务接入",
  },
];

/**
 * 渲染首页三个固定镜头对应的内容状态。
 *
 * @param props.section 当前空间场景。
 * @param props.onStartCreation 进入最近使用功能页。
 * @returns 全屏 3D 场景及其 HTML 信息层。
 */
export function HomePreview({
  section,
  onStartCreation,
}: {
  section: HomeSection;
  onStartCreation: () => void;
}) {
  return (
    <main className={styles.homeScene} data-section={section}>
      <div className={styles.sceneFallback} />
      <GalleryScene section={section} />
      <div className={styles.sceneVignette} />
      {section === "gallery" && (
        <section className={styles.homeCopy}>
          <div className={styles.eyebrow}>Spatial creation platform</div>
          <h1>{previewTitle}</h1>
          <p>{previewPromise}</p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onStartCreation}
          >
            开始创作
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      )}
      <AnimatePresence mode="wait">
        {section !== "gallery" && (
          <div className={styles.spatialPanelPortal}>
            <motion.div
              key={section}
              className={styles.spatialPanelStage}
              initial={{
                opacity: 0,
                scale: 0.58,
                y: 44,
                filter: "blur(16px)",
              }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              exit={{
                opacity: 0,
                scale: 0.76,
                y: -18,
                filter: "blur(10px)",
              }}
              transition={{
                type: "spring",
                stiffness: 118,
                damping: 22,
                mass: 1.05,
              }}
            >
              {section === "pricing" ? <PricingPanel /> : <DocsPanel />}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

/**
 * 渲染套餐轨道加单套餐详情的定价场景原型。
 *
 * @returns 可切换套餐的空间信息画布。
 */
function PricingPanel() {
  const [activePlan, setActivePlan] = useState("pro");
  const selectedPlan =
    planOptions.find((plan) => plan.id === activePlan) ?? planOptions[2];

  return (
    <section className={styles.spatialPanel}>
      <header className={styles.spatialPanelHeader}>
        <div>
          <div className={styles.sectionEyebrow}>Pricing space</div>
          <h1>选择适合你的创作节奏</h1>
          <p>套餐轨道只展示当前选择，价格与权益在正式版本中读取后台配置。</p>
        </div>
        <button type="button" className={styles.secondaryButton}>
          完整能力对比
        </button>
      </header>
      <div className={styles.planTrack}>
        {planOptions.map((plan) => (
          <button
            type="button"
            key={plan.id}
            data-active={plan.id === activePlan}
            onClick={() => setActivePlan(plan.id)}
          >
            {plan.label}
          </button>
        ))}
      </div>
      <div className={styles.planDetail}>
        <div className={styles.planPrice}>
          <span>{selectedPlan?.label}</span>
          <strong>
            {selectedPlan?.price === "定制"
              ? "定制"
              : `¥${selectedPlan?.price}`}
          </strong>
          <span>{selectedPlan?.credits}</span>
          <button type="button" className={styles.primaryButton}>
            选择此套餐
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.planFeatures}>
          {[
            "文生图与图生图",
            "单次最多生成 4 张",
            "无限画布自动保存",
            "私人创作图库",
            "多模型与透明定价",
            "高级修复与输出设置",
          ].map((feature) => (
            <div key={feature} className={styles.planFeature}>
              {feature}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * 渲染创作指南优先的文档空间入口。
 *
 * @returns 搜索框与六个创作指南入口。
 */
function DocsPanel() {
  const docs = [
    ["快速开始", "从第一条提示词到生成第一张作品"],
    ["文生图", "模型、比例、数量与预计积分"],
    ["参考图", "添加图片并控制图生图方向"],
    ["局部重绘", "蒙版、提示词与非破坏式迭代"],
    ["无限画布", "节点、连接、缩放与自动保存"],
    ["图库", "查找、聚焦与继续创作"],
  ];

  return (
    <section className={styles.spatialPanel}>
      <header className={styles.spatialPanelHeader}>
        <div>
          <div className={styles.sectionEyebrow}>Creator guide</div>
          <h1>创作指南</h1>
          <p>
            首版只展示普通用户真正需要的创作路径，开发者文档继续保留原地址。
          </p>
        </div>
      </header>
      <label className={styles.docsSearch}>
        <Search size={15} aria-hidden="true" />
        <input aria-label="搜索创作指南" placeholder="搜索创作指南" />
      </label>
      <div className={styles.docsGrid}>
        {docs.map(([title, description]) => (
          <button type="button" className={styles.docsLink} key={title}>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
