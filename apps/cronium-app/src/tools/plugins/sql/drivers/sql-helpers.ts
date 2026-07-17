/**
 * Pure, driver-agnostic SQL helpers: named-placeholder rewriting, JSON-safe
 * value coercion, and a read-only statement guard.
 *
 * No driver (`pg`/`mysql2`) imports live here, so this stays unit-testable
 * without a database and is safe to include in any bundle.
 */

export type PlaceholderStyle = "dollar" | "question";

export interface RewrittenQuery {
  /** SQL with `:name` rewritten to the driver's positional style. */
  text: string;
  /** Bound values, in the positional order the driver expects. */
  values: unknown[];
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

/**
 * Rewrite `:name` placeholders to the driver's positional style, binding each
 * value from `params` in order. The scan skips string literals (`'...'` with
 * `''` escaping), quoted identifiers (`"..."`, `` `...` ``), line comments
 * (`-- ...`), block comments (`/* ... *​/`), and `::` casts, so a `:name` inside
 * a string or a Postgres cast is never treated as a parameter.
 *
 * Postgres (`dollar`) reuses `$n` for a repeated name; MySQL (`question`) emits
 * a fresh `?` and re-binds the value for each occurrence.
 *
 * Throws if a placeholder has no matching key in `params`.
 */
export function rewriteNamedPlaceholders(
  sql: string,
  params: Record<string, unknown>,
  style: PlaceholderStyle,
): RewrittenQuery {
  const values: unknown[] = [];
  const dollarIndexByName = new Map<string, number>();
  let out = "";
  let i = 0;
  const n = sql.length;

  const copyDelimited = (
    open: string,
    close: string,
    escapeDoubled: boolean,
  ) => {
    out += sql[i];
    i += 1;
    while (i < n) {
      const c = sql[i];
      if (c === close) {
        // Doubled delimiter ('' or "") is an escaped literal, not a close.
        if (escapeDoubled && sql[i + 1] === close) {
          out += c + close;
          i += 2;
          continue;
        }
        out += c;
        i += 1;
        return;
      }
      out += c;
      i += 1;
    }
  };

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === "'") {
      copyDelimited("'", "'", true);
      continue;
    }
    if (ch === '"') {
      copyDelimited('"', '"', true);
      continue;
    }
    if (ch === "`") {
      copyDelimited("`", "`", false);
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out += sql[i];
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "/*";
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += sql[i];
        i += 1;
      }
      out += "*/";
      i += 2;
      continue;
    }
    if (ch === ":" && next === ":") {
      out += "::";
      i += 2;
      continue;
    }
    if (ch === ":" && next !== undefined && IDENT_START.test(next)) {
      let j = i + 1;
      let name = "";
      while (j < n && IDENT_CHAR.test(sql[j]!)) {
        name += sql[j];
        j += 1;
      }
      if (!(name in params)) {
        throw new Error(`Missing value for query parameter ":${name}"`);
      }
      if (style === "dollar") {
        let idx = dollarIndexByName.get(name);
        if (idx === undefined) {
          values.push(params[name]);
          idx = values.length;
          dollarIndexByName.set(name, idx);
        }
        out += `$${idx}`;
      } else {
        values.push(params[name]);
        out += "?";
      }
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return { text: out, values };
}

/**
 * Convert a driver value to a JSON-serializable one so it survives Unified I/O:
 * `Date` → ISO string, `bigint`/`BigInt`-like → string, `Buffer`/`Uint8Array` →
 * base64. Plain objects/arrays (e.g. already-parsed JSON/JSONB) are mapped
 * recursively; primitives pass through.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

/** Map a driver's raw row objects to JSON-safe row objects. */
export function normalizeRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => toJsonSafe(row) as Record<string, unknown>);
}

export interface RowAccumulator {
  /** JSON-safe rows collected so far. */
  readonly rows: Record<string, unknown>[];
  /** True once a row beyond `maxRows` was seen. */
  readonly truncated: boolean;
  /** True once adding a row would have exceeded `maxBytes`. */
  readonly bytesExceeded: boolean;
  /** Accumulated payload size in bytes. */
  readonly bytes: number;
  /** Add a raw driver row. Returns false when the caller must stop reading. */
  push(row: Record<string, unknown>): boolean;
}

/**
 * Collects streamed rows under a row count *and* a byte budget, normalizing each
 * to JSON-safe values as it goes.
 *
 * Both drivers share this so the limits behave identically, and so the decision
 * to stop is made incrementally: the caller stops pulling from the cursor/stream
 * the moment `push` returns false, which is what keeps peak memory bounded by
 * `maxBytes` rather than by the size of the result set.
 */
export function createRowAccumulator(
  maxRows: number,
  maxBytes: number,
): RowAccumulator {
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  let bytesExceeded = false;
  let bytes = 0;

  return {
    get rows() {
      return rows;
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
      if (rows.length >= maxRows) {
        truncated = true;
        return false;
      }
      const row = toJsonSafe(raw) as Record<string, unknown>;
      const size = JSON.stringify(row)?.length ?? 0;
      if (bytes + size > maxBytes) {
        bytesExceeded = true;
        return false;
      }
      rows.push(row);
      bytes += size;
      return true;
    },
  };
}

const READ_ONLY_LEADING = /^(select|with|explain|show|table|values)$/i;

/**
 * Strip comments and leading whitespace, then return the first SQL keyword.
 * Used by the read-only guard and single-statement check.
 */
export function leadingKeyword(sql: string): string {
  // Remove line and block comments so a comment can't hide the real keyword.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  const match = /^([A-Za-z]+)/.exec(stripped);
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Return the number of non-empty top-level statements, ignoring semicolons
 * inside string literals / quoted identifiers / comments. Used to reject
 * stacked queries (`SELECT ...; DROP ...`).
 */
export function countStatements(sql: string): number {
  let count = 0;
  let hasContent = false;
  let i = 0;
  const n = sql.length;
  const skipDelimited = (close: string, escapeDoubled: boolean) => {
    i += 1;
    while (i < n) {
      const c = sql[i];
      if (c === close) {
        if (escapeDoubled && sql[i + 1] === close) {
          i += 2;
          continue;
        }
        i += 1;
        return;
      }
      i += 1;
    }
  };
  while (i < n) {
    const ch = sql[i]!;
    if (ch === "'") {
      hasContent = true;
      skipDelimited("'", true);
      continue;
    }
    if (ch === '"') {
      hasContent = true;
      skipDelimited('"', true);
      continue;
    }
    if (ch === "`") {
      hasContent = true;
      skipDelimited("`", false);
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === ";") {
      if (hasContent) {
        count += 1;
        hasContent = false;
      }
      i += 1;
      continue;
    }
    if (!/\s/.test(ch)) hasContent = true;
    i += 1;
  }
  if (hasContent) count += 1;
  return count;
}

/**
 * Reject anything that isn't a single read-only statement. This is the backstop
 * that keeps a "Run Query" node from mutating data even if a value was
 * interpolated into the query text. Writes go through Execute Statement.
 */
export function assertReadOnlyStatement(sql: string): void {
  assertSingleStatement(sql);
  const kw = leadingKeyword(sql);
  if (!READ_ONLY_LEADING.test(kw)) {
    throw new Error(
      `Run Query only allows read-only statements (SELECT/WITH/EXPLAIN/SHOW); got "${kw || "empty"}". Use Execute Statement for writes.`,
    );
  }
}

/**
 * Normalize the action's `params` into a bind map. The generic action form may
 * store the record as a JSON string, so accept an object or a JSON-object
 * string; anything else (array, non-object JSON, malformed) is a clear error.
 */
export function coerceBindParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Query parameters must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Query parameters must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Query parameters must be a JSON object");
}

/** Reject stacked/multiple statements (single statement, trailing `;` allowed). */
export function assertSingleStatement(sql: string): void {
  if (!sql.trim()) {
    throw new Error("Query is empty");
  }
  if (countStatements(sql) > 1) {
    throw new Error(
      "Only a single SQL statement is allowed; multiple statements (separated by ';') are rejected.",
    );
  }
}
