import { z } from "zod";
import type { ActionParameter } from "../types/tool-plugin";

/**
 * Convert a Zod schema to ActionParameter array
 * This utility helps maintain consistency between Zod schemas and parameter definitions
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToParameters(schema: z.ZodSchema<any>): ActionParameter[] {
  const parameters: ActionParameter[] = [];

  // Unwrap ZodEffects (from .refine(), .transform(), etc.)
  let unwrappedSchema: z.ZodTypeAny = schema;
  while (unwrappedSchema instanceof z.ZodEffects) {
    unwrappedSchema = unwrappedSchema._def.schema as z.ZodTypeAny;
  }

  // Handle ZodObject
  if (unwrappedSchema instanceof z.ZodObject) {
    const shape = unwrappedSchema.shape as Record<string, z.ZodTypeAny>;

    for (const [key, value] of Object.entries(shape)) {
      const param = parseZodType(key, value);
      if (param) {
        parameters.push(param);
      }
    }
  }

  return parameters;
}

function parseZodType(
  name: string,
  schema: z.ZodTypeAny,
): ActionParameter | null {
  let baseSchema = schema;
  let required = true;
  let description: string | undefined;
  let defaultValue: unknown;
  let enumValues: string[] | undefined;

  // Unwrap modifiers
  while (
    baseSchema instanceof z.ZodOptional ||
    baseSchema instanceof z.ZodDefault ||
    baseSchema instanceof z.ZodNullable
  ) {
    if (baseSchema instanceof z.ZodOptional) {
      required = false;
      baseSchema = baseSchema._def.innerType as z.ZodTypeAny;
    } else if (baseSchema instanceof z.ZodDefault) {
      defaultValue = baseSchema._def.defaultValue() as unknown;
      baseSchema = baseSchema._def.innerType as z.ZodTypeAny;
    } else if (baseSchema instanceof z.ZodNullable) {
      required = false;
      baseSchema = baseSchema._def.innerType as z.ZodTypeAny;
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

  if (baseSchema instanceof z.ZodString) {
    type = "string";
  } else if (baseSchema instanceof z.ZodNumber) {
    type = "number";
  } else if (baseSchema instanceof z.ZodBoolean) {
    type = "boolean";
  } else if (baseSchema instanceof z.ZodArray) {
    type = "array";
  } else if (baseSchema instanceof z.ZodObject) {
    type = "object";
  } else if (baseSchema instanceof z.ZodEnum) {
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
