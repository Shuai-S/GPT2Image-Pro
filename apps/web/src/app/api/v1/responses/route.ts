import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalResponses } from "@/features/external-api/handlers/responses";

export const POST = corsRoute(postExternalResponses);
export const OPTIONS = corsPreflight;
