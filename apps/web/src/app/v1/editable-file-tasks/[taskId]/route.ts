import { corsPreflight, corsRoute } from "@/features/external-api/cors";
import { getExternalEditableFileTask } from "@/features/external-api/handlers/editable-file-tasks";

export const GET = corsRoute(getExternalEditableFileTask);
export const OPTIONS = corsPreflight;
