import { db } from "@repo/database";
import { generation, videoGeneration } from "@repo/database/schema";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { unstable_cache } from "next/cache";
import { and, count, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  extractGenerationReferenceImages,
  extractPromptRepairNotice,
} from "@/features/image-generation/generation-metadata";
import { galleryCountsCacheTag } from "@/features/image-generation/gallery-cache";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";

export const GALLERY_PAGE_SIZE = 20;
export const GALLERY_TABS = [
  "final",
  "agent-drafts",
  "uploads",
  "videos",
] as const;

export type GalleryOutputRole = "final" | "agent_draft" | "upload" | "video";
export type GalleryTab = (typeof GALLERY_TABS)[number];
type GalleryReferenceImage = ReturnType<
  typeof extractGenerationReferenceImages
>[number];

type GalleryCursorPayload = {
  createdAt: string;
  id: string;
};

export interface GalleryGenerationItem {
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
  videoUrl?: string | null;
  outputRole?: GalleryOutputRole;
  referenceImages?: GalleryReferenceImage[];
  isLayered?: boolean;
}

export interface GalleryPageData {
  items: GalleryGenerationItem[];
  totalCount: number;
  finalCount: number;
  draftCount: number;
  uploadCount: number;
  videoCount: number;
  nextCursor: string | null;
}

interface GalleryCounts {
  finalCount: number;
  draftCount: number;
  uploadCount: number;
  videoCount: number;
}

interface GalleryQueryOptions {
  userId: string;
  locale: string;
  activeTab: GalleryTab;
  cursor?: string | null;
  legacyPage?: number;
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({
      createdAt: createdAt.toISOString(),
      id,
    } satisfies GalleryCursorPayload)
  ).toString("base64url");
}

function decodeCursor(cursor?: string | null): GalleryCursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<GalleryCursorPayload>;
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function parseGalleryLimit(legacyPage?: number) {
  if (!legacyPage || !Number.isFinite(legacyPage) || legacyPage <= 1) {
    return GALLERY_PAGE_SIZE;
  }
  return Math.max(
    GALLERY_PAGE_SIZE,
    Math.floor(legacyPage) * GALLERY_PAGE_SIZE
  );
}

function withGenerationCursor(
  baseCondition: ReturnType<typeof and>,
  cursor: GalleryCursorPayload | null
) {
  if (!cursor) return baseCondition;
  const cursorDate = new Date(cursor.createdAt);
  return and(
    baseCondition,
    or(
      lt(generation.createdAt, cursorDate),
      and(eq(generation.createdAt, cursorDate), lt(generation.id, cursor.id))
    )
  );
}

function withVideoCursor(
  baseCondition: ReturnType<typeof and>,
  cursor: GalleryCursorPayload | null
) {
  if (!cursor) return baseCondition;
  const cursorDate = new Date(cursor.createdAt);
  return and(
    baseCondition,
    or(
      lt(videoGeneration.createdAt, cursorDate),
      and(
        eq(videoGeneration.createdAt, cursorDate),
        lt(videoGeneration.id, cursor.id)
      )
    )
  );
}

function buildGalleryConditions(userId: string) {
  const completedStorageCondition = and(
    eq(generation.userId, userId),
    eq(generation.status, "completed"),
    isNotNull(generation.storageKey)
  );
  const finalCondition = and(
    completedStorageCondition,
    sql`NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(${generation.metadata}::jsonb->'outputImage'->'imageOutputs', '[]'::jsonb)) AS output
      WHERE output->>'role' = 'agent_draft' AND output->>'primary' = 'true'
    )`
  );
  const draftPrimaryCondition = and(
    completedStorageCondition,
    sql`(${generation.metadata}::jsonb) @? '$.outputImage.imageOutputs[*] ? (@.role == "agent_draft" && @.primary == true)'`
  );
  const draftCondition = and(
    eq(generation.userId, userId),
    eq(generation.status, "completed"),
    isNotNull(generation.storageKey),
    isNotNull(generation.metadata),
    sql`(${generation.metadata}::jsonb) @? '$.outputImage.imageOutputs[*] ? (@.role == "agent_draft" || @.primary == false)'`
  );
  const uploadCondition = and(
    eq(generation.userId, userId),
    isNotNull(generation.metadata),
    sql`(${generation.metadata}::jsonb) @? '$.inputImages.images[0]'`
  );
  const videoCondition = and(
    eq(videoGeneration.userId, userId),
    eq(videoGeneration.status, "completed"),
    isNotNull(videoGeneration.storageKey)
  );

  return {
    completedStorageCondition,
    finalCondition,
    draftPrimaryCondition,
    draftCondition,
    uploadCondition,
    videoCondition,
  };
}

async function queryGalleryCounts(userId: string): Promise<GalleryCounts> {
  const {
    completedStorageCondition,
    draftPrimaryCondition,
    draftCondition,
    uploadCondition,
    videoCondition,
  } = buildGalleryConditions(userId);
  const [
    completedStorageCountResult,
    draftPrimaryCountResult,
    draftCountResult,
    uploadCountResult,
    videoCountResult,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(generation)
      .where(completedStorageCondition),
    db.select({ count: count() }).from(generation).where(draftPrimaryCondition),
    db.select({ count: count() }).from(generation).where(draftCondition),
    db.select({ count: count() }).from(generation).where(uploadCondition),
    db.select({ count: count() }).from(videoGeneration).where(videoCondition),
  ]);

  return {
    finalCount:
      (completedStorageCountResult[0]?.count ?? 0) -
      (draftPrimaryCountResult[0]?.count ?? 0),
    draftCount: draftCountResult[0]?.count ?? 0,
    uploadCount: uploadCountResult[0]?.count ?? 0,
    videoCount: videoCountResult[0]?.count ?? 0,
  };
}

export async function getGalleryCounts(userId: string) {
  return unstable_cache(
    () => queryGalleryCounts(userId),
    ["gallery-counts", userId],
    { revalidate: 120, tags: [galleryCountsCacheTag(userId)] }
  )();
}

function extractAgentDraftGenerations(
  rows: Array<typeof generation.$inferSelect>
) {
  return rows.flatMap((g) => {
    const referenceImages = extractGenerationReferenceImages(g.metadata);
    const outputImage =
      g.metadata &&
      typeof g.metadata === "object" &&
      !Array.isArray(g.metadata) &&
      g.metadata.outputImage &&
      typeof g.metadata.outputImage === "object" &&
      !Array.isArray(g.metadata.outputImage)
        ? (g.metadata.outputImage as Record<string, unknown>)
        : null;
    const outputs = Array.isArray(outputImage?.imageOutputs)
      ? outputImage.imageOutputs
      : [];
    return outputs.flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const output = item as Record<string, unknown>;
      if (output.role !== "agent_draft" && output.primary !== false) return [];
      const storageKey =
        typeof output.storageKey === "string" ? output.storageKey : null;
      const storedImageUrl = buildSignedStorageImageUrl(
        storageKey,
        g.storageBucket
      );
      const fallbackImageUrl =
        typeof output.imageUrl === "string" ? output.imageUrl : null;
      if (!storedImageUrl && !fallbackImageUrl) return [];
      const generationId =
        typeof output.generationId === "string"
          ? output.generationId
          : `${g.id}-${index + 1}`;
      return [
        {
          id: generationId,
          parentId: g.id,
          prompt: g.prompt,
          revisedPrompt:
            typeof output.revisedPrompt === "string"
              ? output.revisedPrompt
              : g.revisedPrompt,
          promptRepairNotice: extractPromptRepairNotice(g.metadata),
          model: g.model,
          size: typeof output.size === "string" ? output.size : g.size,
          status: g.status,
          creditsConsumed: 0,
          storageKey,
          storageBucket: g.storageBucket,
          imageUrl: storedImageUrl || fallbackImageUrl,
          createdAt: g.createdAt.toISOString(),
          outputRole: "agent_draft" as const,
          referenceImages,
        } satisfies GalleryGenerationItem,
      ];
    });
  });
}

function formatUploadedImageSize(
  image: GalleryReferenceImage,
  copy: (en: string, zh: string) => string
) {
  if (image.sizeBytes && image.sizeBytes > 0) {
    const megabytes = image.sizeBytes / 1024 / 1024;
    return `${megabytes >= 0.1 ? megabytes.toFixed(1) : "<0.1"} MB`;
  }
  return copy("Uploaded", "上传图");
}

function extractUploadedImageGenerations(
  rows: Array<typeof generation.$inferSelect>,
  copy: (en: string, zh: string) => string
) {
  return rows.flatMap((g) => {
    const referenceImages = extractGenerationReferenceImages(g.metadata);
    return referenceImages.map(
      (image, index) =>
        ({
          id: `${g.id}-upload-${image.id || index + 1}`,
          parentId: g.id,
          prompt: g.prompt,
          revisedPrompt: g.revisedPrompt,
          promptRepairNotice: extractPromptRepairNotice(g.metadata),
          model: image.type || copy("User upload", "用户上传"),
          size: formatUploadedImageSize(image, copy),
          status: "completed",
          creditsConsumed: 0,
          storageKey: image.storageKey,
          storageBucket: image.storageBucket,
          imageUrl: image.imageUrl,
          createdAt: g.createdAt.toISOString(),
          outputRole: "upload",
          referenceImages,
        }) satisfies GalleryGenerationItem
    );
  });
}

function mapFinalRows(rows: Array<typeof generation.$inferSelect>) {
  return rows.map(
    (g) =>
      ({
        id: g.id,
        parentId: g.id,
        prompt: g.prompt,
        revisedPrompt: g.revisedPrompt,
        promptRepairNotice: extractPromptRepairNotice(g.metadata),
        model: g.model,
        size: g.size,
        status: g.status,
        creditsConsumed: g.creditsConsumed,
        storageKey: g.storageKey,
        storageBucket: g.storageBucket,
        imageUrl: buildSignedStorageImageUrl(g.storageKey, g.storageBucket),
        createdAt: g.createdAt.toISOString(),
        outputRole: "final",
        referenceImages: extractGenerationReferenceImages(g.metadata),
        isLayered: hasLayeredMeta(g.metadata),
      }) satisfies GalleryGenerationItem
  );
}

function mapVideoRows(rows: Array<typeof videoGeneration.$inferSelect>) {
  return rows.map(
    (v) =>
      ({
        id: v.id,
        parentId: v.id,
        prompt: v.prompt,
        revisedPrompt: null,
        promptRepairNotice: null,
        model: v.model,
        size: `${v.durationSeconds}s · ${v.aspectRatio} · ${v.resolution}`,
        status: v.status as "pending" | "completed" | "failed",
        creditsConsumed: Number(v.creditsConsumed) || 0,
        storageKey: v.storageKey,
        storageBucket: null,
        imageUrl: null,
        videoUrl: buildSignedStorageImageUrl(v.storageKey, null),
        createdAt: v.createdAt.toISOString(),
        outputRole: "video",
        referenceImages: [],
      }) satisfies GalleryGenerationItem
  );
}

export async function getGalleryPageData({
  userId,
  locale,
  activeTab,
  cursor,
  legacyPage,
}: GalleryQueryOptions): Promise<GalleryPageData> {
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const decodedCursor = decodeCursor(cursor);
  const limit = parseGalleryLimit(legacyPage);
  const { finalCondition, draftCondition, uploadCondition, videoCondition } =
    buildGalleryConditions(userId);
  const isFinalTab = activeTab === "final";
  const isVideosTab = activeTab === "videos";

  const [
    counts,
    finalRows,
    draftParentRows,
    uploadParentRows,
    videoRows,
  ] = await Promise.all([
    getGalleryCounts(userId),
    isFinalTab
      ? db
          .select()
          .from(generation)
          .where(withGenerationCursor(finalCondition, decodedCursor))
          .orderBy(desc(generation.createdAt), desc(generation.id))
          .limit(limit)
      : Promise.resolve([] as Array<typeof generation.$inferSelect>),
    activeTab === "agent-drafts"
      ? db
          .select()
          .from(generation)
          .where(withGenerationCursor(draftCondition, decodedCursor))
          .orderBy(desc(generation.createdAt), desc(generation.id))
          .limit(limit)
      : Promise.resolve([] as Array<typeof generation.$inferSelect>),
    activeTab === "uploads"
      ? db
          .select()
          .from(generation)
          .where(withGenerationCursor(uploadCondition, decodedCursor))
          .orderBy(desc(generation.createdAt), desc(generation.id))
          .limit(limit)
      : Promise.resolve([] as Array<typeof generation.$inferSelect>),
    isVideosTab
      ? db
          .select()
          .from(videoGeneration)
          .where(withVideoCursor(videoCondition, decodedCursor))
          .orderBy(desc(videoGeneration.createdAt), desc(videoGeneration.id))
          .limit(limit)
      : Promise.resolve([] as Array<typeof videoGeneration.$inferSelect>),
  ]);

  const allDraftItems = extractAgentDraftGenerations(draftParentRows);
  const allUploadItems = extractUploadedImageGenerations(
    uploadParentRows,
    copy
  );
  const videoItems = mapVideoRows(videoRows);
  const displayedItems =
    activeTab === "videos"
      ? videoItems
      : activeTab === "agent-drafts"
        ? allDraftItems.slice(0, limit)
        : activeTab === "uploads"
          ? allUploadItems.slice(0, limit)
          : mapFinalRows(finalRows);

  const totalCount =
    activeTab === "videos"
      ? counts.videoCount
      : activeTab === "agent-drafts"
        ? counts.draftCount
        : activeTab === "uploads"
          ? counts.uploadCount
          : counts.finalCount;

  const nextCursorSource =
    activeTab === "videos"
      ? videoRows[videoRows.length - 1]
      : activeTab === "agent-drafts"
        ? draftParentRows[draftParentRows.length - 1]
        : activeTab === "uploads"
          ? uploadParentRows[uploadParentRows.length - 1]
          : finalRows[finalRows.length - 1];
  const fetchedCount =
    activeTab === "videos"
      ? videoRows.length
      : activeTab === "agent-drafts"
        ? draftParentRows.length
        : activeTab === "uploads"
          ? uploadParentRows.length
          : finalRows.length;
  const nextCursor =
    fetchedCount === limit && nextCursorSource
      ? encodeCursor(nextCursorSource.createdAt, nextCursorSource.id)
      : null;

  return {
    items: displayedItems,
    totalCount,
    finalCount: counts.finalCount,
    draftCount: counts.draftCount,
    uploadCount: counts.uploadCount,
    videoCount: counts.videoCount,
    nextCursor,
  };
}
