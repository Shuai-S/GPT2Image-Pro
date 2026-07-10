/**
 * 多 AbortSignal 合并与单次尝试超时辅助。
 *
 * 职责：把"总超时/外部取消(parentSignal)"与"单次尝试超时(perAttemptTimeoutMs)"
 * 组合成一个合并信号，供生图账号池每轮 attempt 透传到上游 fetch。
 * 单次超时被 abort 时调用方可判定为"本次尝试超时"，构造可重试错误交回循环，
 * 而非全局总超时——后者应彻底打破全链。
 *
 * 使用方：image-generation/service.ts 的 generateImage/editImage/generateChatImage
 * 向 retryPoolBackendResult 传入的 run 闭包；用 withPerAttemptTimeout 包装以注入本逻辑。
 * 关键依赖：AbortSignal.any 与 AbortSignal.timeout（Node 20+ 原生支持）。
 */

/** 单次尝试超时被 abort 时返回的固定错误文案。
 * 必须既命中 isRecoverableBackendError（含 "timed out"）又不命中
 * isLocalAbortTimeoutError（不含 "operation was aborted"），使其"可重试、可切换"，
 * 与全局总超时（AbortSignal.timeout 产生的 "The operation was aborted due to
 * timeout" 走 isLocalAbortTimeoutError 不切换）区分开。 */
export const PER_ATTEMPT_TIMEOUT_ERROR = "upstream per-attempt timed out";

/**
 * 合并多个 AbortSignal：任一 abort 即合并信号 abort。
 *
 * Node 20+ 原生支持 AbortSignal.any；若运行时不支持则回退到基于
 * addEventListener 的聚合实现，保证本地开发环境兼容性。传入的 undefined/已
 * abort 信号会被有效剪枝，任一源信号已 abort 时立即返回已 abort 的合并信号。
 *
 * @param signals 0 个或多个 AbortSignal（undefined 被忽略）。
 * @returns 合并后的 AbortSignal；所有源均已 abort 或无效时返回已 abort 信号。
 */
export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const valid = signals.filter(
    (signal): signal is AbortSignal => Boolean(signal)
  );
  const controller = new AbortController();
  if (valid.length === 0) {
    controller.abort();
    return controller.signal;
  }
  const alreadyAborted = valid.find((signal) => signal.aborted);
  if (alreadyAborted) {
    controller.abort(alreadyAborted.reason);
    return controller.signal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(valid);
  }
  // 回退：手动聚合并监听每个源信号。
  const onAbort = (source: AbortSignal) => {
    if (controller.signal.aborted) return;
    const reason =
      typeof (source as { reason?: unknown }).reason === "undefined"
        ? undefined
        : (source as { reason?: unknown }).reason;
    controller.abort(reason);
  };
  for (const signal of valid) {
    signal.addEventListener("abort", () => onAbort(signal), { once: true });
  }
  return controller.signal;
}

/**
 * 判定一个抛出的错误是否为 abort/timeout 类（fetch 被 signal 取消时的形态）。
 *
 * AbortSignal.timeout 抛 TimeoutError，AbortController.abort 抛 AbortError；
 * fetch 取消也可能以 "This operation was aborted" / "fetch failed" 形态出现。
 * 仅作形态判定，是否为"单次尝试 vs 全局总超时"由调用方结合 isPerAttemptAbort 判定。
 *
 * @param error 任意被抛出的值。
 * @returns 是否 abort 类错误。
 */
export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /operation was aborted|aborted due to timeout/i.test(error.message)
    );
  }
  return false;
}
