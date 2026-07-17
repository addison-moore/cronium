/**
 * Pure MongoDB helpers: JSON input coercion, BSON→JSON-safe conversion, the
 * bounded document accumulator, pipeline/filter guards, and URI building.
 *
 * No `mongodb` import lives here (BSON values are handled by `_bsontype` duck
 * typing), so this stays unit-testable without a database and is safe to
 * include in any bundle.
 */
import type { MongoCredentials } from "./schemas";
import { DEFAULT_MONGO_PORT } from "./schemas";

/**
 * Normalize a JSON-object action field. The generic action form may store the
 * value as a JSON string, so accept an object or a JSON-object string;
 * undefined/blank means "not provided" and yields undefined. Anything else
 * (array, non-object JSON, malformed) is a clear error naming the field.
 */
export function coerceJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${label} must be a JSON object`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalize the `documents` field of Insert Documents: a single object becomes
 * a one-element array; an array must contain only objects.
 */
export function coerceJsonDocuments(value: unknown): Record<string, unknown>[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Documents is required");
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Documents must be a JSON object or array of objects");
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return [parsed as Record<string, unknown>];
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error("Documents must contain at least one document");
    }
    for (const doc of parsed) {
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error("Documents must be a JSON object or array of objects");
      }
    }
    return parsed as Record<string, unknown>[];
  }
  throw new Error("Documents must be a JSON object or array of objects");
}

/** Normalize the `pipeline` field: a JSON array of stage objects. */
export function coercePipeline(value: unknown): Record<string, unknown>[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Pipeline is required");
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Pipeline must be a JSON array of aggregation stages");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Pipeline must be a JSON array of aggregation stages");
  }
  for (const stage of parsed) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new Error("Pipeline must be a JSON array of aggregation stages");
    }
  }
  return parsed as Record<string, unknown>[];
}

const WRITE_STAGES = ["$out", "$merge"] as const;

/**
 * Reject pipelines containing write stages. This is the backstop that keeps
 * the Aggregate Documents read path from mutating data; writes go through the
 * explicit insert/update/delete actions.
 */
export function assertReadOnlyPipeline(
  pipeline: Record<string, unknown>[],
): void {
  for (const stage of pipeline) {
    for (const writeStage of WRITE_STAGES) {
      if (writeStage in stage) {
        throw new Error(
          `Aggregate Documents is read-only; the ${writeStage} stage is not allowed. Use the write actions (or a Script event) to modify data.`,
        );
      }
    }
  }
}

/**
 * Refuse a mass write with an empty filter. `many: true` with `{}` would
 * update/delete the entire collection — almost always a template that rendered
 * to nothing rather than an intent. Whole-collection maintenance belongs in a
 * Script event where that intent is explicit.
 */
export function assertNonEmptyFilterForMany(
  filter: Record<string, unknown> | undefined,
  action: string,
): void {
  if (!filter || Object.keys(filter).length === 0) {
    throw new Error(
      `${action} with "many" enabled requires a non-empty filter — an empty filter would affect every document in the collection. Use a Script event for whole-collection maintenance.`,
    );
  }
}

/**
 * The generic action form can persist boolean fields as "true"/"false" strings;
 * normalize those (and blanks) before schema validation.
 */
export function normalizeBooleanFields(
  params: unknown,
  fields: string[],
): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return params;
  }
  const out = { ...(params as Record<string, unknown>) };
  for (const field of fields) {
    const v = out[field];
    if (v === "true") out[field] = true;
    else if (v === "false") out[field] = false;
    else if (v === "" || v === null) delete out[field];
  }
  return out;
}

/**
 * Convert a driver value to a JSON-serializable one so it survives Unified
 * I/O. BSON types are recognized by `_bsontype` duck typing (no bson import):
 * ObjectId → hex string, Decimal128/Long/others → string via toString(),
 * Binary → base64. `Date` → ISO string, `bigint` → string, binary → base64;
 * plain objects/arrays are mapped recursively.
 */
export function toJsonSafeBson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) return value.map(toJsonSafeBson);
  if (typeof value === "object") {
    const bsonType = (value as { _bsontype?: unknown })._bsontype;
    if (typeof bsonType === "string") {
      return bsonValueToJson(value, bsonType);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafeBson(v);
    }
    return out;
  }
  return value;
}

interface BsonLike {
  toHexString?: () => string;
  toJSON?: () => unknown;
  toString: () => string;
  value?: () => unknown;
  buffer?: Uint8Array;
}

function bsonValueToJson(value: BsonLike, bsonType: string): unknown {
  switch (bsonType) {
    case "ObjectId":
    case "ObjectID":
      return value.toHexString ? value.toHexString() : value.toString();
    case "Binary":
      return value.buffer
        ? Buffer.from(value.buffer).toString("base64")
        : value.toString();
    case "Long": {
      // Preserve exact integers where JSON can; fall back to string.
      const str = value.toString();
      const num = Number(str);
      return Number.isSafeInteger(num) ? num : str;
    }
    case "Double":
    case "Int32": {
      const v = typeof value.value === "function" ? value.value() : undefined;
      return typeof v === "number" ? v : Number(value.toString());
    }
    default:
      // Decimal128, Timestamp, BSONRegExp, ... — a string beats data loss.
      return value.toString();
  }
}

export interface DocumentAccumulator {
  /** JSON-safe documents collected so far. */
  readonly documents: Record<string, unknown>[];
  /** True once a document beyond `maxDocuments` was seen. */
  readonly truncated: boolean;
  /** True once adding a document would have exceeded `maxBytes`. */
  readonly bytesExceeded: boolean;
  /** Accumulated payload size in bytes. */
  readonly bytes: number;
  /** Add a raw driver document. Returns false when the caller must stop reading. */
  push(doc: Record<string, unknown>): boolean;
}

/**
 * Collects streamed documents under a count *and* a byte budget, normalizing
 * each to JSON-safe values as it goes. The caller stops pulling from the
 * cursor the moment `push` returns false, which is what keeps peak memory
 * bounded by `maxBytes` rather than by the size of the result set. (Same
 * design as the SQL tool's row accumulator.)
 */
export function createDocumentAccumulator(
  maxDocuments: number,
  maxBytes: number,
): DocumentAccumulator {
  const documents: Record<string, unknown>[] = [];
  let truncated = false;
  let bytesExceeded = false;
  let bytes = 0;

  return {
    get documents() {
      return documents;
    },
    get truncated() {
      return truncated;
    },
    get bytesExceeded() {
      return bytesExceeded;
    },
    get bytes() {
      return bytes;
    },
    push(raw: Record<string, unknown>): boolean {
      if (documents.length >= maxDocuments) {
        truncated = true;
        return false;
      }
      const doc = toJsonSafeBson(raw) as Record<string, unknown>;
      const size = JSON.stringify(doc)?.length ?? 0;
      if (bytes + size > maxBytes) {
        bytesExceeded = true;
        return false;
      }
      documents.push(doc);
      bytes += size;
      return true;
    },
  };
}

/**
 * Build the connection URI from structured credentials. User and password are
 * URI-encoded; the host is used verbatim so replica-set lists
 * (`h1:27017,h2:27017`) work. The port applies only to a plain single host
 * without an explicit port (SRV forbids ports).
 */
export function buildMongoUri(credentials: MongoCredentials): string {
  const auth = credentials.user
    ? `${encodeURIComponent(credentials.user)}${
        credentials.password
          ? `:${encodeURIComponent(credentials.password)}`
          : ""
      }@`
    : "";

  const host =
    credentials.scheme === "mongodb+srv" ||
    credentials.host.includes(":") ||
    credentials.host.includes(",")
      ? credentials.host
      : `${credentials.host}:${credentials.port ?? DEFAULT_MONGO_PORT}`;

  const query = new URLSearchParams();
  if (credentials.authSource) query.set("authSource", credentials.authSource);
  if (credentials.tls === "enable") query.set("tls", "true");
  if (credentials.tls === "disable") query.set("tls", "false");
  const queryString = query.toString();

  return `${credentials.scheme}://${auth}${host}/${encodeURIComponent(
    credentials.database,
  )}${queryString ? `?${queryString}` : ""}`;
}
