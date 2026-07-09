import { getCurrentUser } from "@repo/shared/auth/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { GalleryClient } from "@/features/image-generation/components/gallery-client";
import {
  GALLERY_TABS,
  getGalleryPageData,
  type GalleryTab,
} from "@/features/image-generation/gallery-data";

interface GalleryPageProps {
  searchParams: Promise<{ cursor?: string; page?: string; tab?: string }>;
}

function parseGalleryTab(tab?: string): GalleryTab {
  return GALLERY_TABS.find((item) => item === tab) ?? "final";
}

export default async function GalleryPage({ searchParams }: GalleryPageProps) {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  const params = await searchParams;
  const activeTab = parseGalleryTab(params.tab);
  const pageParam = Number(params.page);
  const legacyPage =
    Number.isFinite(pageParam) && pageParam > 1 ? pageParam : 1;
  const gallery = await getGalleryPageData({
    userId: user.id,
    locale,
    activeTab,
    cursor: params.cursor,
    legacyPage,
  });
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("Gallery", "图库")}
        </h1>
        <p className="text-muted-foreground">
          {copy("Your generated images", "你生成的图片")}
        </p>
      </div>
      <GalleryClient
        key={`${activeTab}-${params.cursor || "root"}-${legacyPage}`}
        initialGenerations={gallery.items}
        totalCount={gallery.totalCount}
        finalCount={gallery.finalCount}
        draftCount={gallery.draftCount}
        uploadCount={gallery.uploadCount}
        videoCount={gallery.videoCount}
        activeTab={activeTab}
        nextCursor={gallery.nextCursor}
      />
    </div>
  );
}
