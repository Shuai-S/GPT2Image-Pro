"use server";

import { protectedAction } from "@repo/shared/safe-action";
import { z } from "zod";
import {
  type ExportLayeredPsdResult,
  exportLayeredPsdForUser,
} from "./orchestrator";
import { MAX_PSD_ELEMENT_PROMPT, MAX_PSD_EXTRA_LAYERS } from "./plan";

/**
 * 导出分层 PSD 的 Server Action。
 *
 * 薄接:校验输入 → 委托 exportLayeredPsdForUser(归属/扣费/组装/存储在编排内完成)。
 * 归属校验在编排内按 generation.userId 比对 ctx.userId 完成。
 */
const exportPsdSchema = z.object({
  generationId: z.string().min(1),
  isolateSubject: z.boolean().optional(),
  elements: z
    .array(
      z.object({
        name: z.string().max(64).optional(),
        prompt: z.string().min(1).max(MAX_PSD_ELEMENT_PROMPT),
      })
    )
    .max(MAX_PSD_EXTRA_LAYERS)
    .optional(),
});

export const exportPsdAction = protectedAction
  .metadata({ action: "psd-export.export" })
  .schema(exportPsdSchema)
  .action(async ({ parsedInput, ctx }): Promise<ExportLayeredPsdResult> => {
    return exportLayeredPsdForUser({
      userId: ctx.userId,
      generationId: parsedInput.generationId,
      ...(parsedInput.isolateSubject !== undefined
        ? { isolateSubject: parsedInput.isolateSubject }
        : {}),
      ...(parsedInput.elements ? { elements: parsedInput.elements } : {}),
    });
  });
