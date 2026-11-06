/**
 * What an audit entry may hold. Its contents can come from an event's unvalidated
 * config or a provider's error message, so they are cleaned when the entry is
 * logged: the buffer never holds more than fits, and one bad value can't cost a
 * row its other fields.
 */
import { pgStorableText } from "@/lib/pg-text";
import { redactSecrets, redactText } from "@/lib/tools/redact";
import type { AuditContext, AuditLogEntry } from "./audit-logger";

const MAX_IP_ADDRESS_CHARS = 45; // The column's length.
const MAX_TOOL_ID_CHARS = 100;
const MAX_USER_AGENT_CHARS = 1000;
const MAX_ERROR_MESSAGE_CHARS = 4000;
const MAX_DETAILS_CHARS = 4000;
const MAX_DETAILS_DEPTH = 16;
const MAX_QUOTED_CHARS = 500;

/**
 * The longest an entry gets in the server log. A cleaned entry holds less than
 * this, which with 1,000 entries bounds the buffer's memory at about 32MB.
 */
export const MAX_AUDIT_ENTRY_CHARS = 16_000;

function storableText(value: string, limit: number): string {
  const kept = value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  return pgStorableText(kept);
}

function storableValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return storableText(value, MAX_DETAILS_CHARS);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  if (depth === MAX_DETAILS_DEPTH) return "[Too deep]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => storableValue(item, depth + 1, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      storableText(key, MAX_DETAILS_CHARS),
      storableValue(item, depth + 1, seen),
    ]),
  );
}

function storableDetails(details: Record<string, unknown>) {
  const clean = storableValue(details) as Record<string, unknown>;
  const json = JSON.stringify(clean);
  return json.length <= MAX_DETAILS_CHARS
    ? clean
    : { detailsTruncated: storableText(json, MAX_DETAILS_CHARS) };
}

/**
 * Typed as a number, but an event's config isn't validated, so it can be anything
 * that came out of JSON. Only a number can reference a credential; the rest just
 * has to fit in the details once the reference is rejected.
 */
function storableToolId(toolId: unknown): number {
  if (typeof toolId === "number") return toolId;
  const text =
    typeof toolId === "string" ? toolId : JSON.stringify(storableValue(toolId));
  return storableText(text, MAX_TOOL_ID_CHARS) as unknown as number;
}

/**
 * A copy of the entry that fits. The user id is the one value left as given: it
 * comes from a session or an event's owner, and changing it could attribute the
 * record to someone else. If it can't be stored, the entry is dropped and logged.
 */
export function storableEntry(entry: AuditLogEntry): AuditLogEntry {
  try {
    const { toolId, ipAddress, userAgent, additionalData } = entry.context;
    const { errorMessage, details } = entry;

    const context: AuditContext = { ...entry.context };
    if (toolId !== undefined && toolId !== null) {
      context.toolId = storableToolId(toolId);
    }
    if (typeof ipAddress === "string") {
      context.ipAddress = storableText(ipAddress, MAX_IP_ADDRESS_CHARS);
    }
    if (typeof userAgent === "string") {
      context.userAgent = storableText(userAgent, MAX_USER_AGENT_CHARS);
    }
    if (additionalData)
      context.additionalData = storableDetails(additionalData);

    const stored: AuditLogEntry = { ...entry, context };
    if (typeof errorMessage === "string") {
      stored.errorMessage = storableText(errorMessage, MAX_ERROR_MESSAGE_CHARS);
    }
    if (details) stored.details = storableDetails(details);
    return stored;
  } catch {
    // Details with a getter or proxy that throws. Who did what still counts.
    return {
      action: entry.action,
      context: { userId: entry.context.userId },
      success: entry.success,
      details: { detailsUnreadable: true },
    };
  }
}

/**
 * The whole entry on one line, so the server log can stand in for its row. Never
 * throws: this runs after a row is written and while entries are being dropped,
 * where a failure would write the row again or lose the others.
 */
export function serializeEntry(entry: AuditLogEntry): string {
  try {
    const json = JSON.stringify(redactSecrets(entry));
    return redactText(json).slice(0, MAX_AUDIT_ENTRY_CHARS);
  } catch {
    return '"[this entry could not be serialized]"';
  }
}

/**
 * Text quoting something rejected, such as Postgres's error message: masked,
 * short, and on one line so a value can't forge a line in the log, which is the
 * only record of a dropped entry.
 */
export function quotedForLog(text: string): string {
  return redactText(text.replace(/\s+/g, " ")).slice(0, MAX_QUOTED_CHARS);
}
