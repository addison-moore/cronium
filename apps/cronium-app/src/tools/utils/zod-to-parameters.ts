import { z } from "zod";
import type { ActionParameter } from "../types/tool-plugin";

/**
 * Safely convert a Zod schema to ActionParameter array
 * Wraps zodToParameters with error handling for use in module initialization
 */
export function safeZodToParameters(
  schema: z.ZodSchema<any>,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToParameters(schema: z.ZodSchema<any>): ActionParameter[] {
  const parameters: ActionParameter[] = [];

  // Check if schema is undefined or null
  if (!schema) {
    console.warn("zodToParameters: schema is undefined or null");
    return parameters;
  }

  // Get the definition
  const def = (schema as any)._def;
  if (!def) {
    console.warn("zodToParameters: schema._def is undefined");
    return parameters;
  }

  // Unwrap ZodEffects (from .refine(), .transform(), etc.)
  let unwrappedSchema = schema;
  let currentDef = def;

  while (
    currentDef?.type === "effects" ||
    currentDef?.typeName === "ZodEffects"
  ) {
    const innerSchema =
      (unwrappedSchema as any)._def?.schema || currentDef.schema;
    if (!innerSchema) break;
    unwrappedSchema = innerSchema;
    currentDef = innerSchema._def;
  }

  // Handle ZodObject
  if (currentDef?.type === "object" || currentDef?.typeName === "ZodObject") {
    // Try to get shape from multiple possible locations
    const shape =
      currentDef.shape ||
      (unwrappedSchema as any).shape ||
      (unwrappedSchema as any)._shape;

    if (shape && typeof shape === "object") {
      for (const [key, value] of Object.entries(shape)) {
        const param = parseZodType(key, value as any);
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

  let baseSchema = schema;
  let required = true;
  let description: string | undefined;
  let defaultValue: unknown;
  let enumValues: string[] | undefined;

  // Unwrap modifiers - check both old and new formats
  while (baseSchema && (baseSchema as any)._def) {
    const def = (baseSchema as any)._def;
    const type = def.type || def.typeName;

    if (type === "optional" || type === "ZodOptional") {
      required = false;
      const innerType =
        def.innerType || def.unwrap?.() || (baseSchema as any).unwrap?.();
      if (!innerType) break;
      baseSchema = innerType;
    } else if (type === "default" || type === "ZodDefault") {
      if (def.defaultValue) {
        defaultValue =
          typeof def.defaultValue === "function"
            ? def.defaultValue()
            : def.defaultValue;
      }
      const innerType =
        def.innerType || def.unwrap?.() || (baseSchema as any).unwrap?.();
      if (!innerType) break;
      baseSchema = innerType;
    } else if (type === "nullable" || type === "ZodNullable") {
      required = false;
      const innerType =
        def.innerType || def.unwrap?.() || (baseSchema as any).unwrap?.();
      if (!innerType) break;
      baseSchema = innerType;
    } else {
      break;
    }
  }

  // Get description if available
  const baseDef = (baseSchema as any)._def;
  if (baseDef && typeof baseDef === "object") {
    if ("description" in baseDef) {
      description = baseDef.description;
    } else if ((baseSchema as any).description) {
      description = (baseSchema as any).description;
    }
  }

  // Determine type - check both old and new formats
  let paramType = "string";

  if (baseDef) {
    const defType = baseDef.type || baseDef.typeName;

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
      if (baseDef.values) {
        enumValues = baseDef.values as string[];
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
