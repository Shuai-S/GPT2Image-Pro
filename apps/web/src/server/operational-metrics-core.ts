/**
 * 运维指标的鉴权与 Prometheus 编码核心。
 *
 * 职责：恒定时间校验只读抓取密钥，并把已校验的队列/租约聚合结果编码为
 * Prometheus text format。使用方：/api/metrics 路由与 DB-free 单元测试。
 * 关键依赖：node:crypto；不导入数据库，避免测试和构建阶段建立连接。
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type OperationalMetricAggregate =
  | {
      metric: "job_status";
      status: "running" | "success" | "error";
      value: number;
    }
  | { metric: "job_expired"; value: number }
  | {
      metric: "task_status";
      taskType: "image" | "video" | "editable_file";
      status: "queued" | "running" | "completed" | "failed";
      value: number;
    }
  | { metric: "task_lease_expired"; value: number }
  | {
      metric: "callback_status";
      status:
        | "none"
        | "waiting"
        | "sending"
        | "retry"
        | "sent"
        | "permanent_failed";
      value: number;
    }
  | { metric: "callback_lease_expired"; value: number }
  | {
      metric: "slot_state";
      scope: "global" | "user" | "invalid";
      state: "free" | "leased" | "expired" | "invalid";
      value: number;
    };

export type OperationalMetricsAuthorization =
  | "disabled"
  | "unauthorized"
  | "authorized";

type PrometheusSample = {
  name: string;
  labels: Readonly<Record<string, string>>;
  value: number;
};

const METRIC_HELP = [
  {
    name: "gpt2image_internal_job_leases",
    help: "Internal background job leases by status.",
  },
  {
    name: "gpt2image_internal_job_expired_leases",
    help: "Running internal job leases whose deadline has expired.",
  },
  {
    name: "gpt2image_external_async_tasks",
    help: "Persisted external asynchronous tasks by type and status.",
  },
  {
    name: "gpt2image_external_async_task_expired_leases",
    help: "Running asynchronous tasks whose worker lease has expired.",
  },
  {
    name: "gpt2image_external_async_callbacks",
    help: "Persisted callback outbox entries by status.",
  },
  {
    name: "gpt2image_external_async_callback_expired_leases",
    help: "Sending callbacks whose delivery lease has expired.",
  },
  {
    name: "gpt2image_image_generation_concurrency_slots",
    help: "Cluster image generation semaphore slots by scope and state.",
  },
] as const;

/**
 * 校验 Prometheus 抓取请求。
 *
 * @param request 待校验 HTTP 请求。
 * @param configuredToken 独立的运维抓取密钥；空值表示端点关闭。
 * @returns disabled、unauthorized 或 authorized；不修改请求且不记录密钥。
 */
export function authorizeOperationalMetricsRequest(
  request: Request,
  configuredToken: string | undefined
): OperationalMetricsAuthorization {
  if (!configuredToken) return "disabled";

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const candidate = match?.[1]?.trim() ?? "";
  const candidateHash = createHash("sha256").update(candidate).digest();
  const configuredHash = createHash("sha256").update(configuredToken).digest();

  return timingSafeEqual(candidateHash, configuredHash)
    ? "authorized"
    : "unauthorized";
}

/** 转义 Prometheus 标签值，防止引号、反斜杠或换行破坏文本格式。 */
function escapePrometheusLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

/**
 * 把一条受限聚合结果映射到公开指标。
 *
 * @param aggregate 数据库层已经过 Zod 校验的有限枚举与非负计数。
 * @returns 不含用户、任务或错误内容的 Prometheus 样本。
 */
function toPrometheusSample(
  aggregate: OperationalMetricAggregate
): PrometheusSample {
  switch (aggregate.metric) {
    case "job_status":
      return {
        name: "gpt2image_internal_job_leases",
        labels: { status: aggregate.status },
        value: aggregate.value,
      };
    case "job_expired":
      return {
        name: "gpt2image_internal_job_expired_leases",
        labels: {},
        value: aggregate.value,
      };
    case "task_status":
      return {
        name: "gpt2image_external_async_tasks",
        labels: {
          task_type: aggregate.taskType,
          status: aggregate.status,
        },
        value: aggregate.value,
      };
    case "task_lease_expired":
      return {
        name: "gpt2image_external_async_task_expired_leases",
        labels: {},
        value: aggregate.value,
      };
    case "callback_status":
      return {
        name: "gpt2image_external_async_callbacks",
        labels: { status: aggregate.status },
        value: aggregate.value,
      };
    case "callback_lease_expired":
      return {
        name: "gpt2image_external_async_callback_expired_leases",
        labels: {},
        value: aggregate.value,
      };
    case "slot_state":
      return {
        name: "gpt2image_image_generation_concurrency_slots",
        labels: { scope: aggregate.scope, state: aggregate.state },
        value: aggregate.value,
      };
  }
}

/**
 * 编码完整 Prometheus 文本响应正文。
 *
 * @param aggregates 单次数据库快照产生的聚合结果。
 * @returns 带 HELP/TYPE 声明的稳定文本，末尾保留换行；无副作用。
 */
export function encodeOperationalMetrics(
  aggregates: readonly OperationalMetricAggregate[]
): string {
  const samples = aggregates.map(toPrometheusSample);
  const lines: string[] = [];

  for (const definition of METRIC_HELP) {
    lines.push(`# HELP ${definition.name} ${definition.help}`);
    lines.push(`# TYPE ${definition.name} gauge`);
    for (const sample of samples) {
      if (sample.name !== definition.name) continue;
      const labelEntries = Object.entries(sample.labels);
      const labels =
        labelEntries.length === 0
          ? ""
          : `{${labelEntries
              .map(([key, value]) => `${key}="${escapePrometheusLabel(value)}"`)
              .join(",")}}`;
      lines.push(`${sample.name}${labels} ${sample.value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
