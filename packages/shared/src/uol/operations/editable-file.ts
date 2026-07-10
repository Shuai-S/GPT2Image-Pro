/**
 * UOL Operations - 可编辑文件(PPT/PSD)生成
 *
 * 职责:把"对话式生成可编辑文件"注册为统一接口层操作(file.generatePpt / file.generatePsd),
 * 供任意传输(v1 API / 站内 chat(web) 路由 / MCP / 内置 agent)统一调用。归属 image-generation 域。
 *
 * 机制:model=gpt-5-5-thinking + 代码解释器产出 .pptx/.psd(+素材 zip),只调付费级 web 账号,
 * 按任务固定价扣费(幂等键 sourceRef=editable-file:{clientRequestId})。
 *
 * 使用方:operations/index.ts 副作用导入触发注册;execute 为 STUB,真实委托在
 * apps/web/src/server/uol-bindings.ts 用 bindExecute 接到 runEditableFileForUser。
 * 注意:本文件为纯定义,不从 apps/web 或 @repo/database 导入任何内容。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

const MAX_EDITABLE_IMAGE_BASE64_CHARACTERS =
  Math.ceil((25 * 1024 * 1024) / 3) * 4 + 256;

const editableFileTaskOutput = z.object({
  taskId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  kind: z.enum(["ppt", "psd"]),
  createdAt: z.string(),
});

const editableFileTaskStatusOutput = z
  .object({
    id: z.string(),
    object: z.literal("editable_file_task"),
    kind: z.enum(["ppt", "psd"]),
    client_task_id: z.string().optional(),
    status: z.enum(["processing", "completed", "failed"]),
    created: z.number().int().optional(),
    created_at: z.string(),
    completed: z.number().int().optional(),
    completed_at: z.string().optional(),
    result: z
      .object({
        conversation_id: z.string(),
        primary_url: z.string(),
        zip_url: z.string().nullable(),
      })
      .optional(),
    credits_charged: z.number().nonnegative().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// file.generatePpt - 生成可编辑 PPT(.pptx + 可选素材 zip)
// ---------------------------------------------------------------------------
defineOperation({
  name: "file.generatePpt",
  domain: "image-generation",
  title: "生成可编辑 PPT",
  description:
    "对话式驱动 ChatGPT 代码解释器生成可编辑 .pptx(+素材 zip),存储并返回签名下载链接。" +
    "仅调付费级 web 账号(Plus/Pro,代码解释器),按任务固定价扣费。参考图可选。",
  input: z.object({
    clientRequestId: z.string().min(1).max(200),
    prompt: z.string().min(1).max(8000),
    base64Images: z
      .array(z.string().max(MAX_EDITABLE_IMAGE_BASE64_CHARACTERS))
      .max(4)
      .optional(),
  }),
  output: editableFileTaskOutput,
  access: { kind: "protected" },
  capabilities: [{ capability: "export.ppt" }],
  readOnly: false,
  destructive: false,
  idempotency: {
    kind: "required",
    keyField: "clientRequestId",
    scope: "per-user",
  },
  sideEffects: ["storage", "queue"],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: file.generatePpt");
  },
});

// ---------------------------------------------------------------------------
// file.generatePsd - 生成可编辑分层 PSD(.psd + 可选素材 zip),必须传参考图
// ---------------------------------------------------------------------------
defineOperation({
  name: "file.generatePsd",
  domain: "image-generation",
  title: "生成可编辑 PSD",
  description:
    "对话式驱动 ChatGPT 代码解释器,基于参考图生成可编辑分层 .psd(+素材 zip),存储并返回签名" +
    "下载链接。仅调付费级 web 账号,按任务固定价扣费。base64Images 必须非空。" +
    "与 image.exportPsd(把分层生成产物组装成 PSD)是并列的两条 PSD 路径,互不替代。",
  input: z.object({
    clientRequestId: z.string().min(1).max(200),
    prompt: z.string().min(1).max(8000),
    base64Images: z
      .array(z.string().max(MAX_EDITABLE_IMAGE_BASE64_CHARACTERS))
      .min(1, "base64Images is empty")
      .max(4),
  }),
  output: editableFileTaskOutput,
  access: { kind: "protected" },
  capabilities: [{ capability: "export.psd" }],
  readOnly: false,
  destructive: false,
  idempotency: {
    kind: "required",
    keyField: "clientRequestId",
    scope: "per-user",
  },
  sideEffects: ["storage", "queue"],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: file.generatePsd");
  },
});

// ---------------------------------------------------------------------------
// file.getEditableTask - 查询当前用户的持久可编辑文件任务
// ---------------------------------------------------------------------------
defineOperation({
  name: "file.getEditableTask",
  domain: "image-generation",
  title: "查询可编辑文件任务",
  description:
    "按 taskId 查询当前用户的 PPT/PSD 持久任务状态与下载结果。" +
    "服务端必须校验用户和 API Key 归属。",
  input: z.object({
    taskId: z.string().min(1).max(128),
  }),
  output: editableFileTaskStatusOutput,
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: file.getEditableTask");
  },
});
