import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { getExternalImageTask } from "@/features/external-api/handlers/image-tasks";

export const GET = corsRoute(getExternalImageTask);
export const OPTIONS = corsPreflight;
