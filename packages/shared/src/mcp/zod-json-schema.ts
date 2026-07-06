/**
 * MCP Zod 到 JSON Schema 转换器。
 *
 * 职责：把 UOL operation 的 Zod 输入 schema 转为 MCP tools/list 可消费的
 * 简化 JSON Schema，供 admin/user 两类 MCP tool factory 共享。
 *
 * 使用方：tool-factory.ts、user-tool-factory.ts、tool-factory.test.ts
 * 关键依赖：Zod v4 内部 def 结构；保留 Zod v3 typeName 兼容分支。
 */

type JsonSchema = Record<string, unknown>;
type ZodDef = Record<string, unknown>;

type ZodLike = {
  _zod?: { def?: ZodDef };
  _def?: ZodDef;
  def?: ZodDef;
  description?: string;
};

/**
 * 判断值是否为普通对象记录。
 *
 * @param value - 待检查值。
 * @returns value 可作为对象记录读取时返回 true。
 * @sideEffects 无。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取 Zod v4/v3 的内部 def。
 *
 * @param schema - Zod schema 或未知值。
 * @returns 可识别的 def；无法识别时返回 undefined。
 * @sideEffects 无。
 */
function getZodDef(schema: unknown): ZodDef | undefined {
  if (!isRecord(schema)) return undefined;
  const zodLike = schema as ZodLike;
  return zodLike._zod?.def ?? zodLike._def ?? zodLike.def;
}

/**
 * 读取 Zod schema 的 description。
 *
 * @param schema - Zod schema 或未知值。
 * @returns 字符串描述或 undefined。
 * @sideEffects 无。
 */
function getDescription(schema: unknown) {
  if (!isRecord(schema)) return undefined;
  const description = (schema as ZodLike).description;
  return typeof description === "string" && description ? description : undefined;
}

/**
 * 归一化 Zod v3 typeName 与 Zod v4 type。
 *
 * @param def - Zod 内部 def。
 * @returns 简化后的类型名。
 * @sideEffects 无。
 */
function getDefType(def: ZodDef) {
  const v4Type = def.type;
  if (typeof v4Type === "string") return v4Type;

  const typeName = def.typeName;
  if (typeof typeName !== "string") return undefined;
  return typeName.replace(/^Zod/, "").toLowerCase();
}

/**
 * 给 JSON Schema 附加 Zod description。
 *
 * @param schema - 已转换的 JSON Schema。
 * @param zodSchema - 原始 Zod schema。
 * @returns 带 description 的 JSON Schema。
 * @sideEffects 无。
 */
function withDescription(schema: JsonSchema, zodSchema: unknown): JsonSchema {
  const description = getDescription(zodSchema);
  return description ? { ...schema, description } : schema;
}

/**
 * 读取对象 schema 的 shape。
 *
 * @param def - Zod object def。
 * @returns 字段映射；无法读取时返回空对象。
 * @sideEffects 无。
 */
function readShape(def: ZodDef): Record<string, unknown> {
  const shape = def.shape;
  const resolved = typeof shape === "function" ? shape() : shape;
  return isRecord(resolved) ? resolved : {};
}

/**
 * 判断字段是否不应进入 required。
 *
 * @param schema - 字段 Zod schema。
 * @returns optional/default 字段返回 true。
 * @sideEffects 无。
 */
function isOptionalLike(schema: unknown) {
  const def = getZodDef(schema);
  const type = def ? getDefType(def) : undefined;
  return type === "optional" || type === "default";
}

/**
 * 读取 enum 值。
 *
 * @param def - Zod enum def。
 * @returns enum 值数组。
 * @sideEffects 无。
 */
function readEnumValues(def: ZodDef) {
  const values = def.values;
  if (Array.isArray(values)) return values;

  const entries = def.entries;
  if (isRecord(entries)) return Object.values(entries);

  return [];
}

/**
 * 判断默认值是否适合写入 JSON Schema。
 *
 * @param value - Zod defaultValue。
 * @returns 可序列化默认值返回 true。
 * @sideEffects 无。
 */
function isJsonDefaultValue(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isRecord(value)
  );
}

/**
 * 从 Zod schema 生成 MCP 可用的简化 JSON Schema。
 *
 * 覆盖基础输入形态：string、number、boolean、enum、array、object、
 * optional、default、record、nullable。未知复杂结构回退为宽松 object。
 *
 * @param zodSchema - Zod schema。
 * @returns JSON Schema 对象。
 * @sideEffects 无。
 */
export function zodToSimpleJsonSchema(zodSchema: unknown): JsonSchema {
  const def = getZodDef(zodSchema);
  if (!def) {
    return { type: "object", properties: {}, additionalProperties: true };
  }

  const type = getDefType(def);
  switch (type) {
    case "string":
      return withDescription({ type: "string" }, zodSchema);

    case "number":
      return withDescription({ type: "number" }, zodSchema);

    case "boolean":
      return withDescription({ type: "boolean" }, zodSchema);

    case "enum": {
      const enumValues = readEnumValues(def);
      return withDescription(
        {
          type: enumValues.every((value) => typeof value === "number")
            ? "number"
            : "string",
          enum: enumValues,
        },
        zodSchema
      );
    }

    case "array": {
      const itemSchema = def.element ?? def.type;
      return withDescription(
        {
          type: "array",
          items: itemSchema ? zodToSimpleJsonSchema(itemSchema) : {},
        },
        zodSchema
      );
    }

    case "object": {
      const shape = readShape(def);
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        properties[key] = zodToSimpleJsonSchema(fieldSchema);
        if (!isOptionalLike(fieldSchema)) {
          required.push(key);
        }
      }

      const result: JsonSchema = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) {
        result.required = required;
      }
      return withDescription(result, zodSchema);
    }

    case "record": {
      const valueSchema = def.valueType;
      return withDescription(
        {
          type: "object",
          additionalProperties: valueSchema
            ? zodToSimpleJsonSchema(valueSchema)
            : true,
        },
        zodSchema
      );
    }

    case "optional": {
      const innerType = def.innerType;
      return innerType ? zodToSimpleJsonSchema(innerType) : {};
    }

    case "default": {
      const innerType = def.innerType;
      const schema = innerType ? zodToSimpleJsonSchema(innerType) : {};
      const defaultValue = def.defaultValue;
      return isJsonDefaultValue(defaultValue)
        ? { ...schema, default: defaultValue }
        : schema;
    }

    case "nullable": {
      const innerType = def.innerType;
      const schema = innerType ? zodToSimpleJsonSchema(innerType) : {};
      return { ...schema, nullable: true };
    }

    default:
      return withDescription(
        { type: "object", additionalProperties: true },
        zodSchema
      );
  }
}
