import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalPsdGenerations } from "@/features/external-api/handlers/editable-file-generations";

export const POST = corsRoute(postExternalPsdGenerations);
export const OPTIONS = corsPreflight;
