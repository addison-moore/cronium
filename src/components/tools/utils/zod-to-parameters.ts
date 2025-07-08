import { z } from "zod";
import type { ActionParameter } from "../types/tool-plugin";

/**
 * Convert a Zod schema to ActionParameter array
 * This utility helps maintain consistency between Zod schemas and parameter definitions
 */
export function zodToParameters(schema: z.ZodSchema<any>): ActionParameter[] {
  const parameters: ActionParameter[] = [];

  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    
    for (const [key, value] of Object.entries(shape)) {
      const param = parseZodType(key, value as z.ZodTypeAny);
      if (param) {
        parameters.push(param);
      }
    }
  }

  return parameters;
}

function parseZodType(name: string, schema: z.ZodTypeAny): ActionParameter | null {
  let baseSchema = schema;
  let required = true;
  let description: string | undefined;
  let defaultValue: unknown;
  let enumValues: string[] | undefined;

  // Unwrap modifiers
  while (baseSchema instanceof z.ZodOptional || 
         baseSchema instanceof z.ZodDefault ||
         baseSchema instanceof z.ZodNullable) {
    if (baseSchema instanceof z.ZodOptional) {
      required = false;
      baseSchema = baseSchema._def.innerType;
    } else if (baseSchema instanceof z.ZodDefault) {
      defaultValue = baseSchema._def.defaultValue();
      baseSchema = baseSchema._def.innerType;
    } else if (baseSchema instanceof z.ZodNullable) {
      required = false;
      baseSchema = baseSchema._def.innerType;
    }
  }

  // Get description if available
  if (baseSchema._def.description) {
    description = baseSchema._def.description;
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
    enumValues = baseSchema._def.values;
  }

  return {
    name,
    type,
    required,
    description,
    default: defaultValue,
    enum: enumValues,
  };
}