import type { ImageGenerationOperationResult } from "@/features/image-generation/operations";

type OpenAIImageData = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

export function getPublicImageUrl(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  const publicBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    new URL(request.url).origin;

  return new URL(imageUrl, publicBaseUrl).toString();
}

export async function getImageBase64(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;

  const publicBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    new URL(request.url).origin;
  const url =
    imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
      ? imageUrl
      : publicBaseUrl
        ? new URL(imageUrl, publicBaseUrl).toString()
        : imageUrl;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load generated image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

export async function toOpenAIImageData(
  request: Request,
  result: ImageGenerationOperationResult,
  responseFormat: "url" | "b64_json"
): Promise<OpenAIImageData> {
  const data: OpenAIImageData = {};

  if (responseFormat === "b64_json") {
    data.b64_json = await getImageBase64(request, result.imageUrl);
  } else {
    data.url = getPublicImageUrl(request, result.imageUrl);
  }

  if (result.revisedPrompt) {
    data.revised_prompt = result.revisedPrompt;
  }

  return data;
}
