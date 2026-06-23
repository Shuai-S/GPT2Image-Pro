import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { getExternalVideoTask } from "@/features/external-api/handlers/video-tasks";

export const GET = corsRoute(getExternalVideoTask);
export const OPTIONS = corsPreflight;
