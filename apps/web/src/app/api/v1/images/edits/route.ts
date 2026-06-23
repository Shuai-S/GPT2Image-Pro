import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { postExternalImageEdits } from "@/features/external-api/handlers/image-edits";

export const POST = corsRoute(postExternalImageEdits);
export const OPTIONS = corsPreflight;
