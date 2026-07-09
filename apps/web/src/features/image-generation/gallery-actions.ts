"use server";

import { z } from "zod";
import { protectedAction } from "@repo/shared/safe-action";
import {
  GALLERY_TABS,
  getGalleryPageData,
  type GalleryTab,
} from "@/features/image-generation/gallery-data";

const galleryTabSchema = z.custom<GalleryTab>(
  (value) =>
    typeof value === "string" && GALLERY_TABS.includes(value as GalleryTab)
);

export const getGalleryPageAction = protectedAction
  .metadata({ action: "image-generation.gallery.page" })
  .schema(
    z.object({
      cursor: z.string().trim().min(1).nullable().optional(),
      tab: galleryTabSchema,
      locale: z.string().trim().min(2).max(8),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    return await getGalleryPageData({
      userId: ctx.userId,
      locale: parsedInput.locale,
      activeTab: parsedInput.tab,
      cursor: parsedInput.cursor ?? null,
    });
  });
