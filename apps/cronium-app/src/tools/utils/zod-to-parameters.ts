import { type z } from "zod";
import type { ActionParameter } from "../types/tool-plugin";

// Type definitions for Zod internal structures
interface ZodDef {
  typeName?: string;
  type?: string;
  schema?: z.ZodTypeAny;
  shape?: Record<string, z.ZodTypeAny>;
  innerType?: z.ZodTypeAny;
  unwrap?: () => z.ZodTypeAny;
  defaultValue?: (() => unknown) | string | number | boolean | null;
  description?: string;
  values?: unknown[];
}

interface ZodSchemaWithDef extends z.ZodTypeAny {
  _def: ZodDef;
  shape?: Record<string, z.ZodTypeAny>;
  _shape?: Record<string, z.ZodTypeAny>;
  description?: string;
  unwrap?: () => z.ZodTypeAny;
}

/**
 * Safely convert a Zod schema to ActionParameter array
 * Wraps zodToParameters with error handling for use in module initialization
 */
export function safeZodToParameters(
  schema: z.ZodSchema<unknown>,
): ActionParameter[] {
  try {
    return zodToParameters(schema);
  } catch (error) {
    console.warn("Failed to convert Zod schema to parameters:", error);
    return [];
  }
}

/**
 * Convert a Zod schema to ActionParameter array
 * This utility helps maintain consistency between Zod schemas and parameter definitions
 */
export function zodToParameters(
  schema: z.ZodSchema<unknown>,
): ActionParameter[] {
  const parameters: ActionParameter[] = [];

  // Check if schema is undefined or null
  if (!schema) {
    console.warn("zodToParameters: schema is undefined or null");
    return parameters;
  }

  const schemaWithDef = schema as ZodSchemaWithDef;

  // Get the definition
  const def = schemaWithDef._def;
  if (!def) {
    console.warn("zodToParameters: schema._def is undefined");
    return parameters;
  }

  // Unwrap ZodEffects (from .refine(), .transform(), etc.)
  let unwrappedSchema: ZodSchemaWithDef = schemaWithDef;
  let currentDef: ZodDef = def;

  while (
    currentDef?.type === "effects" ||
    currentDef?.typeName === "ZodEffects"
  ) {
    const innerSchema = currentDef.schema ?? unwrappedSchema._def?.schema;
    if (!innerSchema) break;
    unwrappedSchema = innerSchema as ZodSchemaWithDef;
    currentDef = unwrappedSchema._def;
  }

  // Handle ZodObject
  if (currentDef?.type === "object" || currentDef?.typeName === "ZodObject") {
    // Try to get shape from multiple possible locations
    const shape =
      currentDef.shape ?? unwrappedSchema.shape ?? unwrappedSchema._shape;

    if (shape && typeof shape === "object") {
      for (const [key, value] of Object.entries(shape)) {
        const param = parseZodType(key, value);
        if (param) {
          parameters.push(param);
        }
      }
    }
  }

  return parameters;
}

function parseZodType(
  name: string,
  schema: z.ZodTypeAny,
): ActionParameter | null {
  if (!schema) {
    console.warn(`parseZodType: schema is undefined for field "${name}"`);
    return null;
  }

  let baseSchema = schema as ZodSchemaWithDef;
  let required = true;
  let description: string | undefined;
  let defaultValue: unknown;
  let enumValues: string[] | undefined;

  // Unwrap modifiers - check both old and new formats
  while (baseSchema?._def) {
    const def = baseSchema._def;
    const type = def.type ?? def.typeName;

    if (type === "optional" || type === "ZodOptional") {
      required = false;
      const innerType =
        def.innerType ??
        (def.unwrap ? def.unwrap() : undefined) ??
        (baseSchema.unwrap ? baseSchema.unwrap() : undefined);
      if (!innerType) break;
      baseSchema = innerType as ZodSchemaWithDef;
    } else if (type === "default" || type === "ZodDefault") {
      if (def.defaultValue !== undefined) {
        defaultValue =
          typeof def.defaultValue === "function"
            ? (def.defaultValue as () => unknown)()
            : def.defaultValue;
      }
      const innerType =
        def.innerType ??
        (def.unwrap ? def.unwrap() : undefined) ??
        (baseSchema.unwrap ? baseSchema.unwrap() : undefined);
      if (!innerType) break;
      baseSchema = innerType as ZodSchemaWithDef;
    } else if (type === "nullable" || type === "ZodNullable") {
      required = false;
      const innerType =
        def.innerType ??
        (def.unwrap ? def.unwrap() : undefined) ??
        (baseSchema.unwrap ? baseSchema.unwrap() : undefined);
      if (!innerType) break;
      baseSchema = innerType as ZodSchemaWithDef;
    } else {
      break;
    }
  }

  // Get description if available
  const baseDef = baseSchema._def;
  if (baseDef && typeof baseDef === "object") {
    if (baseDef.description !== undefined) {
      description = baseDef.description;
    } else if (baseSchema.description !== undefined) {
      description = baseSchema.description;
    }
  }

  // Determine type - check both old and new formats
  let paramType = "string";

  if (baseDef) {
    const defType = baseDef.type ?? baseDef.typeName;

    if (defType === "string" || defType === "ZodString") {
      paramType = "string";
    } else if (defType === "number" || defType === "ZodNumber") {
      paramType = "number";
    } else if (defType === "boolean" || defType === "ZodBoolean") {
      paramType = "boolean";
    } else if (defType === "array" || defType === "ZodArray") {
      paramType = "array";
    } else if (defType === "object" || defType === "ZodObject") {
      paramType = "object";
    } else if (defType === "enum" || defType === "ZodEnum") {
      paramType = "string";
      if (baseDef.values && Array.isArray(baseDef.values)) {
        enumValues = baseDef.values.map((v) => String(v));
      }
    }
  }

  const param: ActionParameter = {
    name,
    type: paramType,
    required,
  };

  if (description !== undefined) {
    param.description = description;
  }

  if (defaultValue !== undefined) {
    param.default = defaultValue;
  }

  if (enumValues !== undefined) {
    param.enum = enumValues;
  }

  return param;
}
