import type { CanvasNode } from "@/features/infinite-canvas/canvas-state";
import {
  type GenerationResult,
  GENERATION_RESULT_SCHEMA,
  BATCH_GENERATION_RESULT_SCHEMA,
  createCanvasGenerationId,
  delay,
  firstImageUrl,
} from "@/features/infinite-canvas/components/canvas-helpers";

/**
 * 画布异步图片生成函数集合。
 *
 * 使用方：infinite-canvas-client.tsx。
 * 关键约束：本文件不依赖 React，仅包含网络请求/解析/轮询逻辑。
 */

const DEFAULT_IMAGE_SIZE = "1024x1024";
const GENERATION_STATUS_POLL_INTERVAL_MS = 1500;
const GENERATION_STATUS_TIMEOUT_MS = 900_000;
const GENERATION_STATUS_MISSING_GRACE_MS = 15_000;

export {
  type GenerationResult,
  GENERATION_RESULT_SCHEMA,
  BATCH_GENERATION_RESULT_SCHEMA,
};

/**
 * 执行画布生成计划，按提示词是否一致选择批量或逐轮请求。
 *
 * @param params 生成节点、提示词计划、输入图片与预分配生成 ID。
 * @returns 每轮生成结果。
 * @sideEffects 发起同源生成请求并消耗用户积分。
 */
export async function runCanvasGenerationPlan(params: {
  prompts: string[];
  node: CanvasNode;
  imageNodes: CanvasNode[];
  generationIds: string[];
  copy: (en: string, zh: string) => string;
}) {
  const { prompts, node, imageNodes, generationIds, copy } = params;
  const firstPrompt = prompts[0] || "";
  const canUseSingleBatchRequest =
    prompts.length > 1 && prompts.every((prompt) => prompt === firstPrompt);
  if (canUseSingleBatchRequest) {
    try {
      const initialResults =
        imageNodes.length > 0
          ? await runImageEditBatch(
              firstPrompt,
              node,
              imageNodes,
              generationIds
            )
          : await runTextToImageBatch(firstPrompt, node, generationIds);
      return await resolveGenerationResults(
        initialResults,
        generationIds,
        copy
      );
    } catch (requestError) {
      const initialError =
        requestError instanceof Error
          ? requestError.message
          : copy("Generation failed", "生成失败");
      return await settleGenerationResults(
        generationIds.map((generationId) =>
          pollGenerationResult(generationId, initialError, copy, {
            waitForMissing: true,
          })
        ),
        generationIds,
        initialError
      );
    }
  }

  const results: GenerationResult[] = [];
  for (const [index, prompt] of prompts.entries()) {
    const generationId = generationIds[index] || createCanvasGenerationId();
    try {
      results.push(
        await runSingleCanvasGeneration({
          prompt,
          node,
          imageNodes,
          generationId,
          copy,
        })
      );
    } catch (error) {
      results.push(
        createFailedGenerationResult(
          generationId,
          getGenerationErrorMessage(
            error,
            copy("Generation failed", "生成失败")
          )
        )
      );
    }
  }
  return results;
}

/**
 * 执行单张画布生成，并在首请求异常时尝试状态回查。
 *
 * @param params 提示词、节点配置、输入图与生成 ID。
 * @returns 单张生成结果。
 * @sideEffects 发起同源生成请求并消耗用户积分。
 */
export async function runSingleCanvasGeneration(params: {
  prompt: string;
  node: CanvasNode;
  imageNodes: CanvasNode[];
  generationId: string;
  copy: (en: string, zh: string) => string;
}) {
  const { prompt, node, imageNodes, generationId, copy } = params;
  try {
    const initialResult =
      imageNodes.length > 0
        ? await runImageEdit(prompt, node, imageNodes, generationId)
        : await runTextToImage(prompt, node, generationId);
    const result = await resolveGenerationResult(initialResult, copy);
    if (result.error) throw new Error(result.error);
    return result;
  } catch (requestError) {
    const initialError =
      requestError instanceof Error
        ? requestError.message
        : copy("Generation failed", "生成失败");
    return await pollGenerationResult(generationId, initialError, copy, {
      waitForMissing: true,
    });
  }
}

/**
 * 把多张生成结果创建成右侧网格输出节点。
 *
 * @param params 源节点、提示词计划、生成结果与文本函数。
 * @returns 已带图片 URL 的输出节点列表。
 * @sideEffects 生成节点 ID。
 */
export function createCanvasOutputNodes(params: {
  sourceNode: CanvasNode;
  prompts: string[];
  results: GenerationResult[];
  copy: (en: string, zh: string) => string;
  createNode: (
    kind: "output",
    position: { x: number; y: number },
    overrides: Partial<Omit<CanvasNode, "id" | "kind" | "x" | "y">>
  ) => CanvasNode;
}) {
  const { sourceNode, prompts, results, copy, createNode } = params;
  const columns = Math.min(3, Math.max(1, results.length));
  return results.flatMap((result, index) => {
    const imageUrl = firstImageUrl(result);
    if (!imageUrl) return [];
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [
      createNode(
        "output",
        {
          x: sourceNode.x + sourceNode.width + 72 + column * 320,
          y: sourceNode.y + row * 300,
        },
        {
          title:
            results.length > 1
              ? copy(`Generated Image ${index + 1}`, `生成结果 ${index + 1}`)
              : copy("Generated Image", "生成结果"),
          imageUrl,
          prompt: result.revisedPrompt || prompts[index] || prompts[0],
        }
      ),
    ];
  });
}

/**
 * 统计没有可显示图片的生成结果数量。
 *
 * @param results 生成结果列表。
 * @returns 失败、超时或未返回图片的数量。
 * @sideEffects 无。
 */
export function countFailedGenerationResults(results: GenerationResult[]) {
  return results.filter((result) => !firstImageUrl(result)).length;
}

/**
 * 提取批量生成中的第一条错误信息。
 *
 * @param results 生成结果列表。
 * @returns 错误文本或 undefined。
 * @sideEffects 无。
 */
export function firstGenerationResultError(results: GenerationResult[]) {
  return results.find((result) => result.error)?.error;
}

/**
 * 创建完整形状的失败生成结果。
 *
 * @param generationId 本次请求预分配的生成记录 ID。
 * @param error 可展示给用户的错误文本。
 * @returns 与 GENERATION_RESULT_SCHEMA 推导类型一致的失败结果。
 * @sideEffects 无。
 */
export function createFailedGenerationResult(
  generationId: string | undefined,
  error: string
): GenerationResult {
  return {
    error,
    generationId,
    generation_id: generationId,
    status: "failed",
    imageUrl: undefined,
    imageBase64: undefined,
    imageOutputs: undefined,
    revisedPrompt: undefined,
    model: undefined,
    size: undefined,
    creditsConsumed: undefined,
  };
}

/**
 * 将多个生成 Promise 容错收集为结果数组。
 *
 * WHY：后端批量生成可能部分成功、部分仍在重试。画布必须先展示已经
 * 落库成功的图片，不能因为某一张超时而丢掉整批可见结果。
 *
 * @param promises 每个 generationId 对应的状态回查 Promise。
 * @param generationIds 请求预分配 ID，用于失败项保留可定位信息。
 * @param fallbackError 缺省错误文本。
 * @returns 可直接用于创建输出节点的结果数组。
 * @sideEffects 等待所有 Promise 完成。
 */
async function settleGenerationResults(
  promises: Promise<GenerationResult>[],
  generationIds: string[],
  fallbackError: string
) {
  const settled = await Promise.allSettled(promises);
  return settled.map((item, index): GenerationResult => {
    if (item.status === "fulfilled") return item.value;
    return createFailedGenerationResult(
      generationIds[index],
      getGenerationErrorMessage(item.reason, fallbackError)
    );
  });
}

/**
 * 从未知异常中提取可展示的错误文本。
 *
 * @param error 捕获到的未知异常。
 * @param fallback 无法识别时使用的文本。
 * @returns 用户可读错误文本。
 * @sideEffects 无。
 */
function getGenerationErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 运行文生图请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @param generationId 本次请求预分配的生成记录 ID，用于失败后状态回查。
 * @returns 生成接口结果。
 * @sideEffects 发起同源网络请求并消耗用户积分。
 */
export async function runTextToImage(
  prompt: string,
  node: CanvasNode,
  generationId: string
) {
  const response = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationId,
      prompt,
      size: node.size || DEFAULT_IMAGE_SIZE,
      model: node.model || undefined,
    }),
  });
  return parseGenerationResponse(response);
}

/**
 * 运行文生图批量请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @param generationIds 本次批量请求预分配的生成记录 ID。
 * @returns 生成接口结果列表。
 * @sideEffects 发起同源网络请求并按张数消耗用户积分。
 */
export async function runTextToImageBatch(
  prompt: string,
  node: CanvasNode,
  generationIds: string[]
) {
  const response = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationIds,
      count: generationIds.length,
      prompt,
      size: node.size || DEFAULT_IMAGE_SIZE,
      model: node.model || undefined,
    }),
  });
  return parseBatchGenerationResponse(response);
}

/**
 * 运行图生图请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @param imageNodes 输入图片节点。
 * @param generationId 本次请求预分配的生成记录 ID，用于失败后状态回查。
 * @returns 生成接口结果。
 * @sideEffects 抓取图片数据、发起同源网络请求并消耗用户积分。
 */
export async function runImageEdit(
  prompt: string,
  node: CanvasNode,
  imageNodes: CanvasNode[],
  generationId: string
) {
  const formData = new FormData();
  formData.set("generationId", generationId);
  formData.set("prompt", prompt);
  formData.set("size", node.size || DEFAULT_IMAGE_SIZE);
  if (node.model) formData.set("model", node.model);

  for (const [index, imageNode] of imageNodes.entries()) {
    if (!imageNode.imageUrl) continue;
    const file = await imageUrlToFile(
      imageNode.imageUrl,
      `canvas-${index}.png`
    );
    formData.append("image", file);
  }

  const response = await fetch("/api/images/edit", {
    method: "POST",
    body: formData,
  });
  return parseGenerationResponse(response);
}

/**
 * 运行图生图批量请求。
 *
 * @param prompt 合成后的提示词。
 * @param node 生成节点配置。
 * @param imageNodes 输入图片节点。
 * @param generationIds 本次批量请求预分配的生成记录 ID。
 * @returns 生成接口结果列表。
 * @sideEffects 抓取图片数据、发起同源网络请求并按张数消耗用户积分。
 */
export async function runImageEditBatch(
  prompt: string,
  node: CanvasNode,
  imageNodes: CanvasNode[],
  generationIds: string[]
) {
  const formData = new FormData();
  formData.set("generationIds", JSON.stringify(generationIds));
  formData.set("count", String(generationIds.length));
  formData.set("prompt", prompt);
  formData.set("size", node.size || DEFAULT_IMAGE_SIZE);
  if (node.model) formData.set("model", node.model);

  for (const [index, imageNode] of imageNodes.entries()) {
    if (!imageNode.imageUrl) continue;
    const file = await imageUrlToFile(
      imageNode.imageUrl,
      `canvas-${index}.png`
    );
    formData.append("image", file);
  }

  const response = await fetch("/api/images/edit", {
    method: "POST",
    body: formData,
  });
  return parseBatchGenerationResponse(response);
}

/**
 * 将图片 URL 转换为 File。
 *
 * @param imageUrl data URL 或同源图片 URL。
 * @param fallbackName 缺省文件名。
 * @returns 图片文件。
 * @sideEffects 对非 data URL 发起 fetch 请求。
 */
export async function imageUrlToFile(imageUrl: string, fallbackName: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Image fetch failed");
  const blob = await response.blob();
  const type = blob.type || "image/png";
  return new File([blob], fallbackName, { type });
}

/**
 * 解析图片生成响应。
 *
 * @param response fetch 响应。
 * @returns 校验后的响应体。
 * @sideEffects 读取响应体。
 */
export async function parseGenerationResponse(
  response: Response
): Promise<GenerationResult> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const message =
      typeof record.error === "string"
        ? record.error
        : typeof record.message === "string"
          ? record.message
          : "Request failed";
    throw new Error(message);
  }
  const parsed = GENERATION_RESULT_SCHEMA.safeParse(body);
  if (!parsed.success) throw new Error("Invalid generation response");
  return {
    ...parsed.data,
    generationId: parsed.data.generationId || parsed.data.generation_id,
  };
}

/**
 * 解析图片批量生成响应。
 *
 * @param response fetch 响应。
 * @returns 校验后的响应列表。
 * @sideEffects 读取响应体。
 */
export async function parseBatchGenerationResponse(
  response: Response
): Promise<GenerationResult[]> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const message =
      typeof record.error === "string"
        ? record.error
        : typeof record.message === "string"
          ? record.message
          : "Request failed";
    throw new Error(message);
  }

  const batchParsed = BATCH_GENERATION_RESULT_SCHEMA.safeParse(body);
  if (batchParsed.success) {
    const results = batchParsed.data.results || [];
    if (batchParsed.data.error && results.length === 0) {
      throw new Error(batchParsed.data.error);
    }
    return results.map((result) => ({
      ...result,
      generationId: result.generationId || result.generation_id,
    }));
  }

  const singleParsed = GENERATION_RESULT_SCHEMA.safeParse(body);
  if (!singleParsed.success) throw new Error("Invalid generation response");
  return [
    {
      ...singleParsed.data,
      generationId:
        singleParsed.data.generationId || singleParsed.data.generation_id,
    },
  ];
}

/**
 * 等待已提交的生成任务完成。
 *
 * WHY：部分后端会先返回 generationId，图片稍后写入 generation 表。
 * 如果画布端直接要求首个响应带 imageUrl，就会误判失败，但图库稍后能看到成功结果。
 *
 * @param generationId 生成任务 ID。
 * @param initialError 首次响应携带的错误，用于状态记录不存在时快速返回真实错误。
 * @param copy 当前语言文本函数。
 * @param options 轮询行为选项；waitForMissing 会短暂容忍记录尚未创建。
 * @returns 最终生成结果。
 * @sideEffects 轮询同源状态接口。
 */
export async function pollGenerationResult(
  generationId: string,
  initialError: string | undefined,
  copy: (en: string, zh: string) => string,
  options: { timeoutMs?: number; waitForMissing?: boolean } = {}
): Promise<GenerationResult> {
  const deadline =
    Date.now() + (options.timeoutMs || GENERATION_STATUS_TIMEOUT_MS);
  const missingGraceDeadline = Date.now() + GENERATION_STATUS_MISSING_GRACE_MS;
  let lastError = initialError;
  let foundStatusRecord = false;

  while (Date.now() < deadline) {
    await delay(GENERATION_STATUS_POLL_INTERVAL_MS);
    const response = await fetch(
      `/api/images/status/${encodeURIComponent(generationId)}`
    );

    if (response.status === 404 && initialError) {
      if (options.waitForMissing && Date.now() < missingGraceDeadline) {
        lastError = initialError;
        continue;
      }
      throw new Error(initialError);
    }
    if (!response.ok) {
      lastError = `Status request failed: ${response.status}`;
      continue;
    }

    foundStatusRecord = true;
    const result = await parseGenerationResponse(response);
    const imageUrl = firstImageUrl(result);
    if (imageUrl) return result;
    if (result.status === "failed") {
      throw new Error(
        result.error || initialError || copy("Generation failed", "生成失败")
      );
    }
    if (result.error) {
      lastError = result.error;
    }
  }

  if (foundStatusRecord) {
    throw new Error(
      copy(
        "Generation is still running. Check the gallery later.",
        "生成仍在进行中，请稍后到图库查看。"
      )
    );
  }

  throw new Error(
    lastError ||
      copy(
        "Generation is still running. Check the gallery later.",
        "生成仍在进行中，请稍后到图库查看。"
      )
  );
}

/**
 * 将首次生成响应解析为最终可渲染结果。
 *
 * @param result 首次生成响应。
 * @param copy 当前语言文本函数。
 * @returns 带图片地址的最终结果。
 * @sideEffects 必要时轮询状态接口。
 */
export async function resolveGenerationResult(
  result: GenerationResult,
  copy: (en: string, zh: string) => string
) {
  if (firstImageUrl(result)) return result;
  if (!result.generationId) return result;
  return await pollGenerationResult(result.generationId, result.error, copy);
}

/**
 * 将批量首次响应解析为最终可渲染结果。
 *
 * @param results 首次批量响应。
 * @param generationIds 批量请求预分配 ID，用于补查缺失结果。
 * @param copy 当前语言文本函数。
 * @returns 与请求顺序一致的最终结果。
 * @sideEffects 必要时轮询状态接口。
 */
export async function resolveGenerationResults(
  results: GenerationResult[],
  generationIds: string[],
  copy: (en: string, zh: string) => string
) {
  return await settleGenerationResults(
    generationIds.map(async (generationId, index) => {
      const result = results[index];
      if (result) return await resolveGenerationResult(result, copy);
      return await pollGenerationResult(generationId, undefined, copy);
    }),
    generationIds,
    copy("Generation failed", "生成失败")
  );
}
