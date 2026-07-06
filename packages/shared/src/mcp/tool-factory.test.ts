import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Principal } from "../uol/principal";
import { bindExecute, clearRegistry, defineOperation } from "../uol/registry";
import type { AccessRequirement, OperationDefinition } from "../uol/types";
import {
  buildAdminMcpTools,
  operationNameToToolName,
  toolNameToOperationName,
} from "./tool-factory";
import { buildUserMcpTools } from "./user-tool-factory";
import { zodToSimpleJsonSchema } from "./zod-json-schema";

const apiKeyPrincipal = {
  type: "apiKey",
  userId: "user-1",
  apiKeyId: "key-1",
  plan: "pro",
  relayOnly: false,
} satisfies Principal;

const adminPrincipal = {
  type: "user",
  userId: "admin-1",
  role: "super_admin",
} satisfies Principal;

function registerOperation(
  overrides: Partial<OperationDefinition> & {
    name: string;
    access: AccessRequirement;
  }
) {
  return defineOperation({
    name: overrides.name,
    domain: overrides.domain ?? "image-generation",
    title: overrides.title ?? "Test Operation",
    description: overrides.description ?? "A test operation",
    input: overrides.input ?? z.object({}),
    output: overrides.output ?? z.object({ ok: z.boolean() }),
    access: overrides.access,
    readOnly: overrides.readOnly ?? false,
    destructive: overrides.destructive ?? false,
    idempotency: overrides.idempotency ?? { kind: "natural" },
    sideEffects: overrides.sideEffects ?? [],
    execute:
      overrides.execute ??
      (async () => {
        throw new Error(`Not yet wired: ${overrides.name}`);
      }),
  });
}

describe("MCP tool factories", () => {
  beforeEach(() => {
    clearRegistry();
    delete process.env.MCP_DENIED_OPS;
    delete process.env.MCP_READ_ONLY;
  });

  it("hides user tools until their UOL operation is bound", () => {
    registerOperation({
      name: "image.generate",
      access: { kind: "protected" },
    });

    expect(buildUserMcpTools(apiKeyPrincipal)).toHaveLength(0);

    bindExecute("image.generate", async () => ({ ok: true }));

    expect(buildUserMcpTools(apiKeyPrincipal).map((tool) => tool.name)).toEqual(
      ["image.generate"]
    );
  });

  it("hides admin tools until their UOL operation is bound", () => {
    registerOperation({
      name: "pool.getAdminPool",
      domain: "image-backend-pool",
      access: { kind: "imageBackendPoolViewer" },
      readOnly: true,
    });

    expect(buildAdminMcpTools(adminPrincipal)).toHaveLength(0);

    bindExecute("pool.getAdminPool", async () => ({ ok: true }));

    expect(buildAdminMcpTools(adminPrincipal).map((tool) => tool.name)).toEqual(
      ["pool_getAdminPool"]
    );
  });

  it("round-trips multi-segment admin operation names", () => {
    const operationName = "admin.referral.listProfiles";
    const toolName = operationNameToToolName(operationName);

    expect(toolName).toBe("admin_referral_listProfiles");
    expect(toolNameToOperationName(toolName)).toBe(operationName);
  });

  it("converts common Zod v4 inputs to JSON Schema", () => {
    const schema = z.object({
      prompt: z.string().describe("Prompt text"),
      count: z.number(),
      stream: z.boolean(),
      mode: z.enum(["fast", "safe"]),
      tags: z.array(z.string()),
      nested: z.object({
        enabled: z.boolean(),
      }),
      optionalNote: z.string().optional(),
      defaulted: z.boolean().default(true),
    });

    expect(zodToSimpleJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt text" },
        count: { type: "number" },
        stream: { type: "boolean" },
        mode: { type: "string", enum: ["fast", "safe"] },
        tags: { type: "array", items: { type: "string" } },
        nested: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
          },
          additionalProperties: false,
          required: ["enabled"],
        },
        optionalNote: { type: "string" },
        defaulted: { type: "boolean", default: true },
      },
      additionalProperties: false,
      required: ["prompt", "count", "stream", "mode", "tags", "nested"],
    });
  });

  it("uses the shared JSON Schema converter for user tools", () => {
    registerOperation({
      name: "image.generate",
      access: { kind: "protected" },
      input: z.object({
        prompt: z.string(),
        count: z.number().optional(),
        stream: z.boolean().default(false),
      }),
    });
    bindExecute("image.generate", async () => ({ ok: true }));

    const [tool] = buildUserMcpTools(apiKeyPrincipal);

    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        prompt: { type: "string" },
        count: { type: "number" },
        stream: { type: "boolean", default: false },
      },
      required: ["prompt"],
    });
  });

  it("uses the shared JSON Schema converter for admin tools", () => {
    registerOperation({
      name: "pool.updateWeight",
      domain: "image-backend-pool",
      access: { kind: "admin" },
      input: z.object({
        backendId: z.string(),
        weight: z.number(),
        enabled: z.boolean().optional(),
      }),
    });
    bindExecute("pool.updateWeight", async () => ({ ok: true }));

    const [tool] = buildAdminMcpTools(adminPrincipal);

    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        backendId: { type: "string" },
        weight: { type: "number" },
        enabled: { type: "boolean" },
      },
      required: ["backendId", "weight"],
    });
  });
});
