import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalPptGenerations } from "@/features/external-api/handlers/editable-file-generations";

export const POST = corsRoute(postExternalPptGenerations);
export const OPTIONS = corsPreflight;
