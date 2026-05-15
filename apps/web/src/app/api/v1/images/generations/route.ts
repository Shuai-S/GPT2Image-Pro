import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  getImageBase64,
  getPublicImageUrl,
  toOpenAIImageData,
} from "@/features/external-api/images";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import type { PartialImageResult } from "@/features/image-generation/types";

const externalImageGenerationSchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  n: z.number().int().min(1).max(10).optional(),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  stream: z.boolean().optional(),
});

function openAIError(message: string, status = 400, code?: string) {
  return NextResponse.json(
    {
      error: {
        message,
        type: "invalid_request_error",
        code: code || null,
      },
    },
    { status }
  );
}

function wantsStreamResponse(request: NextRequest, stream?: boolean) {
  if (stream) return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

type ExternalImageStreamEvent = {
  event?: string;
  data: unknown;
};

function createExternalImageStreamResponse(
  run: (emit: (event: ExternalImageStreamEvent) => Promise<void>) => Promise<void>
) {
  const encoder = new TextEncoder();
  const keepAliveMs = 15_000;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;

  return new Response(
    new ReadableStream({
      async start(controller) {
        let closed = false;

        const write = (chunk: string) => {
          if (closed || cancelled) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        keepAlive = setInterval(() => {
          write(": ping\n\n");
        }, keepAliveMs);

        const emit = async ({ event, data }: ExternalImageStreamEvent) => {
          if (event) write(`event: ${event}\n`);
          write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
        };

        try {
          write(": open\n\n");
          await run(emit);
          await emit({ data: "[DONE]" });
        } catch (error) {
          await emit({
            event: "error",
            data: {
              type: "upstream_error",
              message:
                error instanceof Error ? error.message : "Image stream failed",
            },
          });
        } finally {
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = undefined;
          }
          if (!(closed || cancelled)) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        cancelled = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }
  );
}

async function toStreamCompletedPayload(
  request: Request,
  result: Awaited<ReturnType<typeof runImageGenerationForUser>>,
  responseFormat: "url" | "b64_json",
  index: number
) {
  const image =
    responseFormat === "b64_json"
      ? { b64_json: await getImageBase64(request, result.imageUrl) }
      : { url: getPublicImageUrl(request, result.imageUrl) };

  return {
    type: "image_generation.completed",
    index,
    generation_id: result.generationId,
    generationId: result.generationId,
    model: result.model,
    size: result.size,
    revised_prompt: result.revisedPrompt,
    credits_consumed: result.creditsConsumed,
    ...image,
    data: [
      {
        ...image,
        revised_prompt: result.revisedPrompt,
      },
    ],
  };
}

function toPartialPayload(
  image: PartialImageResult,
  index: number
) {
  return {
    type: "image_generation.partial_image",
    index,
    partial_image_index: image.partialImageIndex,
    b64_json: image.imageBase64,
    url: image.imageUrl,
  };
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const auth = await authenticateExternalApiRequest(request);
  if (!auth) {
    return openAIError("Invalid or missing API key", 401, "invalid_api_key");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return openAIError("Invalid JSON body");
  }

  const parsed = externalImageGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return openAIError(parsed.error.issues[0]?.message || "Invalid request");
  }

  const input = {
    mode: "generate" as const,
    userId: auth.userId,
    prompt: parsed.data.prompt,
    size: parsed.data.size || DEFAULT_IMAGE_SIZE,
    model: parsed.data.model,
    quality: parsed.data.quality,
    moderation: parsed.data.moderation || "auto",
  };
  const count = parsed.data.n || 1;
  const responseFormat = parsed.data.response_format || "url";

  if (wantsStreamResponse(request, parsed.data.stream)) {
    return createExternalImageStreamResponse(async (emit) => {
      for (let index = 0; index < count; index++) {
        const result = await runImageGenerationForUser(input, {
          onPartialImage: async (image) => {
            await emit({
              event: "image_generation.partial_image",
              data: toPartialPayload(image, index),
            });
          },
        });

        if (result.error) {
          await emit({
            event: "error",
            data: {
              type: "upstream_error",
              message: result.error,
              error: { message: result.error },
              generation_id: result.generationId,
              generationId: result.generationId,
              credits_consumed: result.creditsConsumed,
            },
          });
          return;
        }

        await emit({
          event: "image_generation.completed",
          data: await toStreamCompletedPayload(
            request,
            result,
            responseFormat,
            index
          ),
        });
      }
    });
  }

  const data = [];
  const created = Math.floor(Date.now() / 1000);

  for (let index = 0; index < count; index++) {
    const result = await runImageGenerationForUser(input);
    if (result.error) {
      return openAIError(result.error, 400);
    }
    data.push(await toOpenAIImageData(request, result, responseFormat));
  }

  return NextResponse.json({
    created,
    data,
  });
});
