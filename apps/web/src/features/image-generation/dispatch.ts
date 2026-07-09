/**
 * 渠道并发竞赛调度：把一次生图请求同时转发到 N 个上游渠道，先成功者胜出并
 * 中止其它渠道；全部失败才返错。竞赛成功语义：先返回错误不中止其它渠道，
 * 继续保持设定的渠道并发数，直到任一渠道成功或所有渠道不可用。
 *
 * 职责：在 runImageGenerationForUser 的 attemptGeneration 之下插入并发调度，
 * 不改变 generate/edit/chat 函数签名，由传入的 attemptOne 渠道闭包承载每条
 * 渠道独立"取候选 + 跑 + 换号"语义。
 *
 * 关键不变量：
 * - 扣费幂等键 $(generationId):charge 单一：所有渠道共用 generationId，重复
 *   扣费被幂等命中撤销（operations 层 consumeResult.alreadyConsumed）。
 * - generation 行 isPendingGeneration WHERE 子句天然保护：B 失败分支的 UPDATE
 *   no-op（A 已 completed）。
 * - lease 清理：失败方 abort 抛错后由 attemptOne catch 翻成 fake-result 走
 *   reportPoolBackendResult，保证池调度器正确统计。
 * - 流式事件：屏蔽迟到渠道的 partial_images 等事件，仅胜出渠道事件被透传。
 * - 池成员互斥：调用方在进入本调度器前为每条 channel 预租不同成员，并通过稳定
 *   channelIndex 绑定配置；后续换号由请求级协调器统一排除已尝试成员。
 *
 * 不适用：Agent 多轮流式（事件乱序风险高），由调用方直接走串行路径。
 */

import { logWarn } from "@repo/shared/logger";

/** 单条渠道的执行闭包，由 operations 传入；返回与 generateImage 同义的结果。 */
export type AttemptChannelFn<TResult> = (options: {
  /** 稳定的渠道序号，供调用方绑定预先租用的独立后端配置。 */
  channelIndex: number;
  /** 本渠道单独的 AbortSignal：胜出方触发其它渠道 abort 即用本信号。 */
  signal: AbortSignal;
}) => Promise<TResult>;

/** 判定是否为成功结果：与 GenerateImageResult 兼容，靠 error 字段判成败。 */
export type IsSuccessFn<TResult> = (result: TResult) => boolean;

/** 把单条渠道的失败错误收集起来，全失败时返回给调用方。 */
export type FailureCollector<TResult> = (
  errors: Array<TResult | undefined>
) => TResult;

interface DispatchOptions<TResult> {
  /** 并发渠道数；1 即串行（不进并发分支）。 */
  channels: number;
  /** 单条渠道执行闭包。 */
  attemptOne: AttemptChannelFn<TResult>;
  /** 判定是否成功（默认 result.error == null）。 */
  isSuccess?: IsSuccessFn<TResult>;
  /** 全部渠道失败时构造最终返回值。 */
  buildAllFailed: FailureCollector<TResult>;
  /** 每条渠道的总超时兜底信号（外层 IMAGE_TOTAL_TIMEOUT_MS）。 */
  parentSignal: AbortSignal;
  /** 调度上下文，仅用于日志。 */
  context?: Record<string, unknown>;
}

/**
 * 工具：阻塞直到给定 promise 完成（无论成功失败），用于让 abort 后的渠道
 * 的 promise 都落到完成态再返回主流程，避免孤儿 promise。
 */
async function settled<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}

/**
 * 发起 N 个渠道的并发竞赛。
 *
 * - N=1 时直接串行 await attemptOne，不引入额外开销。
 * - N>1 时同时启动 N 条 attemptOne（每条带 abortSignal），任一渠道成功即调用
 *   winnerController.abort() 中止其它渠道，等待它们 settle 后返回胜出结果；
 *   全失败时返回 buildAllFailed(...)。
 * - 渠道失败时不会主动中止其它渠道（竞赛成功语义）。
 */
export async function dispatchConcurrentChannels<TResult>({
  channels,
  attemptOne,
  isSuccess = (result) =>
    Boolean(result) && !(result as { error?: unknown }).error,
  buildAllFailed,
  parentSignal,
  context,
}: DispatchOptions<TResult>): Promise<TResult> {
  if (channels <= 1) {
    return attemptOne({ channelIndex: 0, signal: parentSignal });
  }

  const channelAbortControllers: AbortController[] = [];
  // 为每条渠道构造独立 abort signal，并跟随 parentSignal。
  const getChannelSignal = () => {
    const controller = new AbortController();
    channelAbortControllers.push(controller);
    // parentSignal 被外层 abort 时同步中止该渠道。
    if (parentSignal.aborted) controller.abort();
    else
      parentSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    return controller.signal;
  };

  // 各渠道 promise：失败/胜出时通过 settled 收集最终态。
  const inFlight: Array<Promise<TResult>> = [];
  const pending = new Map<
    number,
    Promise<{ channelIndex: number; result: TResult | undefined }>
  >();
  const results: Array<TResult | undefined> = [];

  // 启动 channels 条渠道。
  for (let i = 0; i < channels; i += 1) {
    const signal = getChannelSignal();
    const p = (async () => {
      try {
        return await attemptOne({ channelIndex: i, signal });
      } catch (error) {
        // catch 后转译为 undefined 由调用方的 buildAllFailed 收集；上游 fetch
        // abort 已被 attemptOne 内部 retryPoolBackendResult 处理（见 P0 注入
        // 逻辑），这里不抛错避免污染一次 Promise 等待。
        logWarn("生图渠道并发：单条渠道抛出错误", {
          ...(context ?? {}),
          channelIndex: i,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined as unknown as TResult;
      }
    })();
    inFlight.push(p);
    pending.set(
      i,
      settled(p).then((result) => ({ channelIndex: i, result }))
    );
  }

  // 每轮只等待当前最先完成的渠道，不能按数组顺序 await；否则序号较小的慢
  // 渠道会阻塞已经成功的后续渠道，违背“先成功者胜出”的竞赛语义。
  while (pending.size > 0) {
    const { channelIndex, result } = await Promise.race(pending.values());
    pending.delete(channelIndex);
    results[channelIndex] = result;
    if (result && isSuccess(result)) {
      // 胜出：中止其它渠道。
      for (let j = 0; j < channelAbortControllers.length; j += 1) {
        if (j !== channelIndex) channelAbortControllers[j]?.abort();
      }
      // 等待其它渠道 settle，避免孤儿 promise 与未释放的 lease。
      const losers = inFlight.filter((_, idx) => idx !== channelIndex);
      await Promise.allSettled(losers.map((p) => settled(p)));
      logWarn("生图渠道并发：有渠道胜出", {
        ...(context ?? {}),
        winnerChannelIndex: channelIndex,
      });
      return result;
    }
    // 失败渠道不中止其它：竞赛成功语义要求继续等其它渠道成功。
  }

  // 全部渠道失败：返回给调用方最后一条有意义的结果或全失败构造。
  logWarn("生图渠道并发：所有渠道均失败", {
    ...(context ?? {}),
    channelCount: channels,
    errors: results.map((r) => (r as { error?: string } | undefined)?.error),
  });
  return buildAllFailed(results);
}
