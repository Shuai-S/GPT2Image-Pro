/**
 * callback outbox 的 DB-free 单条投递状态机。
 *
 * 职责：投递已领取事件，并用 fencing token 写 sent 或 retry；网络成功但租约已失时
 * 返回 lease_lost，依赖稳定事件 ID 让接收方对 at-least-once 投递去重。
 */

export type AsyncCallbackClaim<TRow> = {
  row: TRow;
  callbackToken: string;
};

export type AsyncCallbackWorkerDependencies<TRow, TPayload> = {
  getTaskId: (row: TRow) => string;
  getCallbackUrl: (row: TRow) => string | null;
  getAttempts: (row: TRow) => number;
  materializePayload: (row: TRow) => TPayload;
  deliver: (callbackUrl: string, payload: TPayload) => Promise<void>;
  complete: (id: string, callbackToken: string) => Promise<boolean>;
  retry: (input: {
    id: string;
    callbackToken: string;
    attempts: number;
    error: string;
  }) => Promise<boolean>;
};

/**
 * 投递一条已领取 callback。
 *
 * 成功响应后条件写 sent；任何投递异常都写指数退避状态。缺失 URL 被视为持久数据损坏，
 * 同样进入有限重试，达到 store 上限后转 permanent_failed。
 */
export async function processAsyncCallbackClaim<TRow, TPayload>(
  claim: AsyncCallbackClaim<TRow>,
  dependencies: AsyncCallbackWorkerDependencies<TRow, TPayload>
): Promise<"sent" | "retry_scheduled" | "lease_lost"> {
  const id = dependencies.getTaskId(claim.row);
  try {
    const callbackUrl = dependencies.getCallbackUrl(claim.row);
    if (!callbackUrl) throw new Error("Persisted callback URL is missing");
    const payload = dependencies.materializePayload(claim.row);
    await dependencies.deliver(callbackUrl, payload);
    return (await dependencies.complete(id, claim.callbackToken))
      ? "sent"
      : "lease_lost";
  } catch (error) {
    const scheduled = await dependencies.retry({
      id,
      callbackToken: claim.callbackToken,
      attempts: dependencies.getAttempts(claim.row),
      error: error instanceof Error ? error.message : "Callback delivery failed",
    });
    return scheduled ? "retry_scheduled" : "lease_lost";
  }
}
