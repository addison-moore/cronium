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

  // Unwrap ZodEffects (from .refine(), .transform(), etc.)
  let unwrappedSchema: z.ZodTypeAny = schema;
  while (
    unwrappedSchema?._def?.typeName === z.ZodFirstPartyTypeKind.ZodEffects
  ) {
    const nextSchema = unwrappedSchema._def?.schema;
    if (!nextSchema) break;
    unwrappedSchema = nextSchema as z.ZodTypeAny;
  }

  // Handle ZodObject
  if (unwrappedSchema?._def?.typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = unwrappedSchema.shape as Record<string, z.ZodTypeAny>;

    if (shape) {
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

  let baseSchema = schema;
  let required = true;
  let description: string | undefined;
  let defaultValue: unknown;
  let enumValues: string[] | undefined;

  // Unwrap modifiers
  while (
    baseSchema?._def?.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    baseSchema?._def?.typeName === z.ZodFirstPartyTypeKind.ZodDefault ||
    baseSchema?._def?.typeName === z.ZodFirstPartyTypeKind.ZodNullable
  ) {
    if (baseSchema._def?.typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      required = false;
      const nextSchema = baseSchema._def?.innerType;
      if (!nextSchema) break;
      baseSchema = nextSchema as z.ZodTypeAny;
    } else if (
      baseSchema._def?.typeName === z.ZodFirstPartyTypeKind.ZodDefault
    ) {
      if (baseSchema._def?.defaultValue) {
        defaultValue = baseSchema._def.defaultValue() as unknown;
      }
      const nextSchema = baseSchema._def?.innerType;
      if (!nextSchema) break;
      baseSchema = nextSchema as z.ZodTypeAny;
    } else if (
      baseSchema._def?.typeName === z.ZodFirstPartyTypeKind.ZodNullable
    ) {
      required = false;
      const nextSchema = baseSchema._def?.innerType;
      if (!nextSchema) break;
      baseSchema = nextSchema as z.ZodTypeAny;
    }
  }

  // Get description if available
  if (
    baseSchema._def &&
    typeof baseSchema._def === "object" &&
    "description" in baseSchema._def
  ) {
    // Use a type assertion to tell TypeScript that baseSchema._def has a description property
    description = (baseSchema._def as { description: string }).description;
  }

  // Determine type
  let type = "string";
  const typeName = baseSchema._def?.typeName;

  if (typeName === z.ZodFirstPartyTypeKind.ZodString) {
    type = "string";
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) {
    type = "number";
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) {
    type = "boolean";
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    type = "array";
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    type = "object";
  } else if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    type = "string";
    enumValues = baseSchema._def.values as string[];
  }

  const param: ActionParameter = {
    name,
    type,
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
