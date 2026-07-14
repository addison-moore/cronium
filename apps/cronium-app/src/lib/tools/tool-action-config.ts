/**
 * Parse a stored `events.toolActionConfig` value into an object, regardless of
 * how it was encoded.
 *
 * The column is `jsonb`, but the form historically submitted a `JSON.stringify`
 * string, which Drizzle then JSON-encoded again — so existing rows read back as
 * a JSON string (sometimes double-encoded), while newer rows are real objects.
 * Every reader must tolerate all three shapes, so they share this helper instead
 * of each re-implementing (inconsistently) the string-vs-object handling.
 */
export interface ToolActionConfigShape {
  toolType?: string;
  toolId?: number;
  actionId?: string;
  parameters?: Record<string, unknown>;
  outputMapping?: Record<string, string>;
  [key: string]: unknown;
}

export function parseToolActionConfig(
  raw: unknown,
): ToolActionConfigShape | null {
  let value = raw;

  // Unwrap up to two layers of JSON-string encoding (single or double-encoded).
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ToolActionConfigShape;
  }
  return null;
}
