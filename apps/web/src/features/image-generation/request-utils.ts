import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type { ImageInputFile } from "./types";

export const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MODERATION_UPLOAD_URL_EXPIRES = 600;
export const VALID_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ModerationUploadedImage = {
  bucket: string;
  key: string;
  url: string;
};

export function formatMegabytes(bytes: number) {
  return `${bytes / 1024 / 1024}MB`;
}

export function validateImageFile(
  file: File,
  options?: {
    mask?: boolean;
    maxImageBytes?: number;
    label?: string;
    invalidTypeMessage?: string;
  }
) {
  const label = options?.label || file.name || (options?.mask ? "Mask" : "Image");
  if (file.size <= 0) {
    throw new Error(`${label} is empty.`);
  }

  const maxImageBytes = options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (file.size > maxImageBytes) {
    throw new Error(
      `${label} exceeds the ${formatMegabytes(maxImageBytes)} limit.`
    );
  }

  if (options?.mask) {
    if (file.type !== "image/png") {
      throw new Error(options.invalidTypeMessage || "Mask must be a PNG file.");
    }
    return;
  }

  if (!VALID_IMAGE_TYPES.has(file.type)) {
    throw new Error(
      options?.invalidTypeMessage ||
        "Source images must be PNG, JPEG, or WebP files."
    );
  }
}

export function getTotalUploadSize(files: File[], maskFile?: File) {
  return (
    files.reduce((total, file) => total + file.size, 0) + (maskFile?.size || 0)
  );
}

export async function toImageInput(
  file: File,
  options?: { publicUrl?: string }
): Promise<ImageInputFile> {
  return {
    data: Buffer.from(await file.arrayBuffer()),
    name: file.name || "image.png",
    type: file.type || "image/png",
    url: options?.publicUrl,
  };
}

export async function uploadModerationImages(
  userId: string,
  generationId: string,
  files: File[]
): Promise<ModerationUploadedImage[] | undefined> {
  if (files.length === 0) return undefined;

  const publicBaseUrl =
    (await getRuntimeSettingString("ALIYUN_MODERATION_PUBLIC_BASE_URL")) ||
    (await getRuntimeSettingString("CONTENT_MODERATION_PUBLIC_BASE_URL")) ||
    (await getRuntimeSettingString("NEXT_PUBLIC_APP_URL")) ||
    (await getRuntimeSettingString("BETTER_AUTH_URL"));
  if (!(await getRuntimeSettingString("STORAGE_ENDPOINT")) && !publicBaseUrl) {
    return undefined;
  }

  const storage = await getStorageProvider();
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";

  return Promise.all(
    files.map(async (file, index) => {
      const extension =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/webp"
            ? "webp"
            : "png";
      const key = `${userId}/moderation/${generationId}-${index}.${extension}`;
      await storage.putObject(
        key,
        bucket,
        Buffer.from(await file.arrayBuffer()),
        file.type || "image/png"
      );
      const url = await storage.getSignedUrl(
        key,
        bucket,
        MODERATION_UPLOAD_URL_EXPIRES
      );
      return {
        bucket,
        key,
        url: url.startsWith("http")
          ? url
          : `${publicBaseUrl?.replace(/\/$/, "")}${url}`,
      };
    })
  );
}

export async function deleteModerationImages(
  images: ModerationUploadedImage[] | undefined
) {
  if (!images?.length) return;

  const storage = await getStorageProvider();
  await Promise.allSettled(
    images.map((image) => storage.deleteObject(image.key, image.bucket))
  );
}

export async function filesToImageInputs(
  files: File[],
  moderationImages?: ModerationUploadedImage[]
) {
  return await Promise.all(
    files.map((file, index) =>
      toImageInput(file, { publicUrl: moderationImages?.[index]?.url })
    )
  );
}
