/**
 * Pure parameter-field logic extracted from TemplateActionParameterForm.
 *
 * Everything the form needs to derive from a tool action's Zod input schema —
 * field enumeration, editor/widget selection, validation-error collection,
 * value parsing and display formatting — with no React / tRPC imports.
 *
 * The implementations intentionally preserve the original in-component
 * behavior exactly, including branches that are dead under Zod v4 (see the
 * notes on getSchemaShape and isEmailField).
 */

import { z } from "zod";

/**
 * Get the object shape from a tool action's input schema.
 *
 * The unwrap loop checks `_def.typeName` ("ZodEffects" / "ZodPipeline"),
 * which only exists in Zod v3. Under Zod v4 `.refine()` keeps the ZodObject
 * identity (so refined objects still work), while `.pipe()` is NOT unwrapped
 * and yields {} — preserved as-is from the original component.
 */
export function getSchemaShape(
  inputSchema: z.ZodTypeAny,
): Record<string, z.ZodTypeAny> {
  let schema: z.ZodTypeAny = inputSchema;

  // Unwrap effects and pipelines to get the base schema
  // In Zod v4, we need to check _def.typeName
  while (schema._def) {
    const def = schema._def as {
      typeName?: string;
      schema?: z.ZodTypeAny;
      in?: z.ZodTypeAny;
    };
    const typeName = def.typeName;
    if (typeName === "ZodEffects" && "schema" in def) {
      schema = def.schema!;
    } else if (typeName === "ZodPipeline" && "in" in def) {
      schema = def.in!;
    } else {
      break;
    }
  }

  if (schema instanceof z.ZodObject) {
    return schema.shape;
  }
  return {};
}

/**
 * Validate parameter values against the action's input schema, returning a
 * `{ "path.to.field": message }` map (empty object when valid).
 */
export function collectParameterErrors(
  inputSchema: z.ZodTypeAny,
  value: Record<string, unknown>,
): Record<string, string> {
  const result = inputSchema.safeParse(value);
  if (!result.success) {
    const newErrors: Record<string, string> = {};
    // In Zod v4, use 'issues' instead of 'errors'
    result.error.issues.forEach((error) => {
      const path = error.path.join(".");
      newErrors[path] = error.message;
    });
    return newErrors;
  }
  return {};
}

/** Check if a field should use the Monaco editor. */
export function shouldUseMonaco(key: string, schema: z.ZodTypeAny): boolean {
  // Check for explicit format hints
  const description =
    (schema as { description?: string }).description?.toLowerCase() ?? "";
  if (description.includes("json") || description.includes("html")) {
    return true;
  }

  // Check field names
  const lowerKey = key.toLowerCase();
  if (
    lowerKey.includes("json") ||
    lowerKey.includes("html") ||
    lowerKey.includes("blocks") || // Slack blocks
    lowerKey.includes("embeds") || // Discord embeds
    (lowerKey.includes("body") && description.includes("html"))
  ) {
    return true;
  }

  // Check if it's an object or array type
  if (schema instanceof z.ZodObject || schema instanceof z.ZodArray) {
    return true;
  }

  return false;
}

/** Determine the language for the Monaco editor. */
export function getMonacoLanguage(
  key: string,
  schema: z.ZodTypeAny,
): "html" | "json" {
  const description =
    (schema as { description?: string }).description?.toLowerCase() ?? "";
  const lowerKey = key.toLowerCase();

  if (
    lowerKey.includes("html") ||
    (lowerKey.includes("body") && description.includes("html"))
  ) {
    return "html";
  }

  return "json";
}

/** Unwrap a top-level ZodOptional, reporting whether the field is optional. */
export function unwrapOptionalSchema(schema: z.ZodTypeAny): {
  baseSchema: z.ZodTypeAny;
  isOptional: boolean;
} {
  if (schema instanceof z.ZodOptional) {
    return {
      baseSchema: schema._def.innerType as z.ZodTypeAny,
      isOptional: true,
    };
  }
  return { baseSchema: schema, isOptional: false };
}

/**
 * Whether a string field should render as an email input.
 *
 * The `_def.checks` probe (`check.kind === "email"`) only matched Zod v3
 * internals; under Zod v4 detection is by field name alone. Preserved as-is.
 */
export function isEmailField(key: string, baseSchema: z.ZodTypeAny): boolean {
  return (
    key.toLowerCase().includes("email") ||
    (baseSchema instanceof z.ZodString &&
      (baseSchema._def.checks?.some(
        (check) => "kind" in check && check.kind === "email",
      ) ??
        false))
  );
}

/** Whether a string field should render as a multiline textarea. */
export function isMultilineField(key: string): boolean {
  return (
    key.toLowerCase().includes("body") ||
    key.toLowerCase().includes("content") ||
    key.toLowerCase().includes("message") ||
    key.toLowerCase().includes("description") ||
    key.toLowerCase().includes("text")
  );
}

/** Enum options for a ZodEnum field (Zod v4 keeps them in `_def.entries`). */
export function getEnumOptions(baseSchema: z.ZodEnum): string[] {
  // In Zod v4, enum values are in _def.entries
  return baseSchema._def.entries
    ? Object.values(baseSchema._def.entries as Record<string, string>)
    : [];
}

/**
 * Format a field value for a plain-text editor: objects are pretty-printed
 * JSON, strings pass through, other non-nullish values are String()-coerced,
 * and nullish values render as "".
 */
export function formatFieldValueForEditor(fieldValue: unknown): string {
  return typeof fieldValue === "object" && fieldValue !== null
    ? JSON.stringify(fieldValue, null, 2)
    : typeof fieldValue === "string"
      ? fieldValue
      : fieldValue != null
        ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
          String(fieldValue)
        : "";
}

/**
 * Parse a Monaco editor value: for "json", parse (empty input counts as
 * "{}"), falling back to the raw string when invalid; "html" passes through.
 * Note scalar JSON like "5" parses to a number — preserved behavior.
 */
export function parseMonacoFieldValue(
  language: "html" | "json",
  newValue: string,
): unknown {
  if (language === "json") {
    try {
      return JSON.parse(newValue || "{}") as Record<string, unknown>;
    } catch {
      return newValue;
    }
  }
  return newValue;
}

/**
 * Parse a fallback-textarea value: JSON when it parses (no empty-string
 * default here — "" throws and stays ""), otherwise the raw string.
 */
export function parseLooseFieldValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Convert snake_case or camelCase to Title Case. */
export function formatFieldName(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Format enum values for display. */
export function formatEnumValue(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
