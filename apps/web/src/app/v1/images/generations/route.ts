import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalImageGenerations } from "@/features/external-api/handlers/image-generations";

export const POST = corsRoute(postExternalImageGenerations);
export const OPTIONS = corsPreflight;
