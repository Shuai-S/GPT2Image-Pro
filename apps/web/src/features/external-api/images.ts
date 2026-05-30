import { logWarn } from "@repo/shared/logger";
import type { ImageGenerationOperationResult } from "@/features/image-generation/operations";
import type { GeneratedImageOutput } from "@/features/image-generation/types";

type OpenAIImageData = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

type GenerationBillingResult = Pick<
  ImageGenerationOperationResult,
  "creditsConsumed" | "generationId"
>;

export type ExternalImageStreamEvent = {
  event?: string;
  data: unknown;
};

type JsonKeepAliveOptions = {
  keepAliveMs?: number;
  initialWaitMs?: number;
  status?: number;
};

type StorageImageReference = {
  bucket: string;
  key: string;
};

export type ExternalFinalImageOutput = Pick<
  GeneratedImageOutput,
  "imageUrl" | "imageBase64" | "revisedPrompt" | "generationId" | "outputRole"
>;

export type ExternalApiErrorOptions = {
  type?: string;
  code?: string | null;
  status?: number;
  generationId?: string;
  creditsConsumed?: number;
};

const DEFAULT_JSON_KEEP_ALIVE_INITIAL_WAIT_MS = 2_000;
const DEFAULT_JSON_KEEP_ALIVE_INTERVAL_MS = 10_000;
const JSON_KEEP_ALIVE_PADDING = `${" ".repeat(2048)}\n`;

function getRequestBaseUrl(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    new URL(request.url).origin
  );
}

function parseLocalStorageImageUrl(
  request: Request,
  imageUrl?: string
): StorageImageReference | null {
  if (!imageUrl) return null;

  try {
    const baseUrl = getRequestBaseUrl(request);
    const parsed = new URL(imageUrl, baseUrl);
    const isRelativeStorageUrl = imageUrl.startsWith("/api/storage/");
    const isOwnStorageUrl =
      parsed.origin === new URL(baseUrl).origin &&
      parsed.pathname.startsWith("/api/storage/");

    if (!(isRelativeStorageUrl || isOwnStorageUrl)) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const storageIndex = segments.indexOf("storage");
    const bucket = segments[storageIndex + 1];
    const keySegments = segments.slice(storageIndex + 2);
    if (storageIndex < 0 || !bucket || keySegments.length === 0) return null;

    const key = keySegments
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
      return null;
    }

    return {
      bucket: decodeURIComponent(bucket),
      key,
    };
  } catch {
    return null;
  }
}

export function getPublicImageUrl(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  return new URL(imageUrl, getRequestBaseUrl(request)).toString();
}

export async function getImageBase64(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;

  const storageReference = parseLocalStorageImageUrl(request, imageUrl);
  if (storageReference) {
    const { getStorageProvider } = await import(
      "@repo/shared/storage/providers"
    );
    const storage = await getStorageProvider();
    const data = await storage.getObject(
      storageReference.key,
      storageReference.bucket
    );
    return Buffer.from(data).toString("base64");
  }

  const url =
    imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
      ? imageUrl
      : new URL(imageUrl, getRequestBaseUrl(request)).toString();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load generated image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

export async function toOpenAIImageData(
  request: Request,
  result: Pick<
    ImageGenerationOperationResult,
    "imageUrl" | "revisedPrompt"
  > & { imageBase64?: string },
  responseFormat: "url" | "b64_json"
): Promise<OpenAIImageData> {
  const data: OpenAIImageData = {};

  if (responseFormat === "b64_json") {
    data.b64_json =
      result.imageBase64 || (await getImageBase64(request, result.imageUrl));
  } else {
    data.url = getPublicImageUrl(request, result.imageUrl);
  }

  if (result.revisedPrompt) {
    data.revised_prompt = result.revisedPrompt;
  }

  return data;
}

export function getExternalFinalImageOutputs(
  result: Pick<
    ImageGenerationOperationResult,
    | "imageUrl"
    | "imageOutputs"
    | "revisedPrompt"
    | "generationId"
    | "responseText"
    | "responseAgent"
  >
): ExternalFinalImageOutput[] {
  const outputs = (result.imageOutputs || []).filter(
    (output) => output.imageUrl || output.imageBase64
  );
  const choices = outputs.filter((output) => output.outputRole === "choice");
  if (choices.length > 0) return choices;

  const finals = outputs.filter((output) => output.outputRole === "final");
  if (finals.length > 0) return finals;

  const nonDrafts = outputs.filter(
    (output) => output.outputRole !== "agent_draft"
  );
  if (nonDrafts.length > 0) {
    const last = nonDrafts[nonDrafts.length - 1]!;
    return [{ ...last, outputRole: last.outputRole || "final" }];
  }

  if (result.imageUrl) {
    return [
      {
        imageUrl: result.imageUrl,
        revisedPrompt: result.revisedPrompt,
        generationId: result.generationId,
        outputRole: "final",
      },
    ];
  }

  if (outputs.length > 0) {
    const last = outputs[outputs.length - 1]!;
    return [{ ...last, outputRole: "final" }];
  }

  return [];
}

export async function toOpenAIImagesResponse(
  request: Request,
  results: readonly ImageGenerationOperationResult[],
  responseFormat: "url" | "b64_json",
  created = Math.floor(Date.now() / 1000),
  logContext?: Record<string, unknown>
) {
  const data = [];

  for (const [index, result] of results.entries()) {
    if (result.error) {
      const options = {
        generationId: result.generationId,
        creditsConsumed: result.creditsConsumed,
      };
      if (logContext) {
        return toLoggedOpenAIErrorPayload(
          result.error,
          { ...logContext, resultIndex: index },
          options
        );
      }
      return toOpenAIErrorPayload(result.error, options);
    }
    const outputs = getExternalFinalImageOutputs(result);
    if (outputs.length === 0) {
      const message =
        result.responseText?.trim() ||
        result.responseAgent?.trim() ||
        "Image generation completed without an image output";
      const options = {
        generationId: result.generationId,
        creditsConsumed: result.creditsConsumed,
      };
      if (logContext) {
        return toLoggedOpenAIErrorPayload(
          message,
          { ...logContext, resultIndex: index },
          options
        );
      }
      return toOpenAIErrorPayload(message, options);
    }
    for (const output of outputs) {
      data.push(
        await toOpenAIImageData(
          request,
          {
            imageBase64: output.imageBase64,
            imageUrl: output.imageUrl,
            revisedPrompt: output.revisedPrompt || result.revisedPrompt,
          },
          responseFormat
        )
      );
    }
  }

  return {
    created,
    data,
    ...toExternalGenerationUsage(results),
    usage: null,
  };
}

export function toExternalGenerationUsage(
  results: readonly GenerationBillingResult[]
) {
  const generationIds = results
    .map((result) => result.generationId)
    .filter((id): id is string => Boolean(id));
  const creditsConsumed = Math.round(
    results.reduce(
      (total, result) => total + Math.max(0, result.creditsConsumed || 0),
      0
    ) * 100
  ) / 100;

  return {
    ...(generationIds.length === 1
      ? {
          generation_id: generationIds[0],
          generationId: generationIds[0],
        }
      : generationIds.length > 1
        ? {
            generation_ids: generationIds,
            generationIds,
          }
        : {}),
    credits_consumed: creditsConsumed,
  };
}

export function openAIImageError(message: string, status = 400, code?: string) {
  return Response.json(
    toOpenAIErrorPayload(message, {
      type: "invalid_request_error",
      code: code ?? null,
      status,
    }),
    { status }
  );
}

export function wantsImageStreamResponse(request: Request, stream?: boolean) {
  if (stream) return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

export function toOpenAIResponseImageItem(params: {
  id: string;
  b64Json: string;
  revisedPrompt?: string;
}) {
  return {
    id: params.id,
    type: "image_generation_call",
    status: "completed",
    result: params.b64Json,
    ...(params.revisedPrompt ? { revised_prompt: params.revisedPrompt } : {}),
  };
}

export function toOpenAIResponseTextItem(params: { id: string; text: string }) {
  return {
    id: params.id,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: params.text,
        annotations: [],
      },
    ],
  };
}

export function createExternalImageStreamResponse(
  run: (emit: (event: ExternalImageStreamEvent) => Promise<void>) => Promise<void>
) {
  const encoder = new TextEncoder();
  const keepAliveMs = 5_000;
  const flushPadding = `: ${" ".repeat(2048)}\n\n`;
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
          write(`: ping ${Date.now()}\n\n${flushPadding}`);
        }, keepAliveMs);

        const emit = async ({ event, data }: ExternalImageStreamEvent) => {
          if (event) write(`event: ${event}\n`);
          write(
            `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n: flush ${Date.now()}\n\n${flushPadding}`
          );
        };

        try {
          write(`: open ${Date.now()}\n\n${flushPadding}`);
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
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    }
  );
}

function classifyExternalApiError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("content failed moderation") ||
    normalized.includes("content blocked")
  ) {
    return {
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    };
  }

  if (
    normalized.includes("moderation") ||
    normalized.includes("aliyun") ||
    normalized.includes("green-cip") ||
    normalized.includes("readtimeout") ||
    normalized.includes("connecttimeout")
  ) {
    return {
      type: "upstream_error",
      code: "content_moderation_failed",
      status: 502,
    };
  }

  if (
    normalized.includes("unsupported model") ||
    normalized.includes("unsupported chat model") ||
    normalized.includes("unsupported gpt model") ||
    normalized.includes("unsupported image_model") ||
    normalized.includes("use a gpt-image") ||
    normalized.includes("use a non-image model")
  ) {
    return {
      type: "invalid_request_error",
      code: "unsupported_model",
      status: 400,
    };
  }

  if (normalized.includes("insufficient credits")) {
    return {
      type: "insufficient_quota",
      code: "insufficient_credits",
      status: 402,
    };
  }

  if (
    normalized.includes("api key quota exceeded") ||
    normalized.includes("api key credit limit")
  ) {
    return {
      type: "insufficient_quota",
      code: "api_key_quota_exceeded",
      status: 402,
    };
  }

  if (
    normalized.includes("not enabled for this plan") ||
    normalized.includes("requires pro plan") ||
    normalized.includes("requires ultra plan") ||
    normalized.includes("requires enterprise plan")
  ) {
    return {
      type: "invalid_request_error",
      code: "insufficient_plan",
      status: 403,
    };
  }

  if (
    normalized.includes("must be between") ||
    normalized.includes("must be no more than") ||
    normalized.includes("no more than") ||
    normalized.includes("exceeds the") ||
    normalized.includes("character limit") ||
    normalized.includes("context must be")
  ) {
    return {
      type: "invalid_request_error",
      code: "plan_limit_exceeded",
      status: 400,
    };
  }

  if (
    normalized.includes("不支持当前请求类型") ||
    normalized.includes("not support current request type")
  ) {
    return {
      type: "invalid_request_error",
      code: "unsupported_backend_request_type",
      status: 400,
    };
  }

  if (
    normalized.includes("选择的生图后端分组不可用") ||
    normalized.includes("当前套餐不可用")
  ) {
    return {
      type: "invalid_request_error",
      code: "backend_group_unavailable",
      status: 403,
    };
  }

  if (
    normalized.includes("当前生图后端分组没有可用账号或 api") ||
    normalized.includes("没有可用账号或 api") ||
    normalized.includes("no available image backend") ||
    normalized.includes("no available backend") ||
    normalized.includes("no available image quota")
  ) {
    return {
      type: "server_error",
      code: "no_available_image_backend",
      status: 503,
    };
  }

  if (
    normalized.includes("concurrency limit reached") ||
    normalized.includes("queue is busy")
  ) {
    return {
      type: "rate_limit_error",
      code: "image_generation_queue_busy",
      status: 429,
    };
  }

  return {
    type: "upstream_error",
    code: "image_generation_failed",
    status: 502,
  };
}

export function toOpenAIErrorPayload(
  message: string,
  options?: ExternalApiErrorOptions
) {
  const classification = classifyExternalApiError(message);
  const status = options?.status ?? classification.status;
  const code =
    options && "code" in options ? options.code : classification.code;
  const generationId = options?.generationId;
  const creditsConsumed = options?.creditsConsumed;

  return {
    error: {
      message,
      type: options?.type ?? classification.type,
      code,
      status,
      ...(generationId ? { generation_id: generationId, generationId } : {}),
      ...(creditsConsumed !== undefined
        ? { credits_consumed: creditsConsumed }
        : {}),
    },
    ...(generationId ? { generation_id: generationId, generationId } : {}),
    ...(creditsConsumed !== undefined
      ? { credits_consumed: creditsConsumed }
      : {}),
  };
}

export function toLoggedOpenAIErrorPayload(
  message: string,
  context: Record<string, unknown>,
  options?: ExternalApiErrorOptions
) {
  const payload = toOpenAIErrorPayload(message, options);
  logWarn("External API image request failed", {
    ...context,
    errorType: payload.error.type,
    errorCode: payload.error.code,
    status: payload.error.status,
    generationId: payload.generation_id,
    creditsConsumed: payload.credits_consumed,
    message,
  });
  return payload;
}

function isErrorPayload(data: unknown) {
  return Boolean(data && typeof data === "object" && "error" in data);
}

function getJsonStatus(data: unknown, fallback = 200) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { status?: unknown } }).error;
    if (typeof error?.status === "number") return error.status;
  }
  if (isErrorPayload(data)) return 400;
  return fallback;
}

export async function createJsonKeepAliveResponse(
  run: () => Promise<unknown>,
  options?: JsonKeepAliveOptions
) {
  const runResult = run().then(
    (data) => data ?? null,
    (error) =>
      toOpenAIErrorPayload(
        error instanceof Error ? error.message : "Image request failed"
      )
  );

  const initialWaitMs =
    options?.initialWaitMs ?? DEFAULT_JSON_KEEP_ALIVE_INITIAL_WAIT_MS;
  const initialResult = await Promise.race([
    runResult,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), initialWaitMs)
    ),
  ]);

  if (initialResult !== undefined) {
    return Response.json(initialResult, {
      status: getJsonStatus(initialResult, options?.status ?? 200),
      headers: {
        "Cache-Control": "no-store, no-transform",
      },
    });
  }

  const encoder = new TextEncoder();
  const keepAliveMs = options?.keepAliveMs ?? DEFAULT_JSON_KEEP_ALIVE_INTERVAL_MS;
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

        write(JSON_KEEP_ALIVE_PADDING);
        keepAlive = setInterval(() => {
          write(JSON_KEEP_ALIVE_PADDING);
        }, keepAliveMs);

        try {
          const data = await runResult;
          write(JSON.stringify(data));
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
      status: options?.status ?? 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    }
  );
}
