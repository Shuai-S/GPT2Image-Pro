import { createHash } from "node:crypto";
import type { ApiConfig } from "./types";

export type OpenAIPromptCacheKeyOptions = {
  scope: string;
  model?: string;
  imageModel?: string;
  agentMode?: boolean;
  promptOptimization?: boolean;
  toolSignature?: string;
  // 本次请求【实际输入】的内容签名(prompt 文本 + 参考图等)。必须并入 key——否则同后端/
  // 同 model 但不同 prompt / 不同参考图的请求会得到相同 prompt_cache_key,若上游中转把
  // prompt_cache_key 误当结果缓存键,就会对不同输入返回同一张缓存图(实测 700/1000 串图)。
  // 调用方对已构造的请求 input 取哈希后传入即可(见各 build*Request)。
  inputSignature?: string;
};

function backendScope(config: ApiConfig) {
  const backend = config.backend;
  if (!backend?.id) return backend?.type || "direct";
  return [
    backend.type,
    backend.id,
    backend.accountBackend,
    backend.apiInterfaceMode,
    backend.imagesUpstreamMode,
    backend.chatCompletionsUpstreamMode,
  ]
    .filter(Boolean)
    .join(":");
}

export function buildOpenAIPromptCacheKey(
  config: ApiConfig,
  options: OpenAIPromptCacheKeyOptions
) {
  const digest = createHash("sha256")
    .update("gpt2image:openai-prompt-cache:v2")
    .update("\n")
    .update(backendScope(config))
    .update("\n")
    .update(options.scope)
    .update("\n")
    .update(options.model || "")
    .update("\n")
    .update(options.imageModel || "")
    .update("\n")
    .update(options.agentMode ? "agent" : "standard")
    .update("\n")
    .update(options.promptOptimization === false ? "original" : "optimized")
    .update("\n")
    .update(options.toolSignature || "")
    .update("\n")
    // 关键:并入本次请求实际输入的签名,使不同 prompt / 不同参考图得到不同 key,杜绝上游
    // 中转误把 prompt_cache_key 当结果缓存键时的串图。
    .update(options.inputSignature || "")
    .digest("hex")
    .slice(0, 32);

  return `g2i_${digest}`;
}

/**
 * 对【已构造好的请求 input】(messages / content 数组,含 prompt 文本与参考图 URL/base64)
 * 取稳定哈希,作为 buildOpenAIPromptCacheKey 的 inputSignature。
 *
 * 同输入 → 同签名(合法缓存命中);不同 prompt 或不同参考图 → 不同签名 → 不同 key。
 */
export function buildRequestInputSignature(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex")
    .slice(0, 32);
}
