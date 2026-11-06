import {
  MAX_AUDIT_ENTRY_CHARS,
  quotedForLog,
  serializeEntry,
  storableEntry,
} from "@/lib/security/audit-entry";
import type { AuditLogEntry } from "@/lib/security/audit-logger";

const entryWith = (
  fields: Partial<AuditLogEntry>,
  context: Partial<AuditLogEntry["context"]> = {},
): AuditLogEntry => ({
  action: "tool.execute",
  success: false,
  ...fields,
  context: { userId: "user-1", ...context },
});

/** Too deep to walk or stringify recursively. */
const tooDeep = (): Record<string, unknown> =>
  JSON.parse(`${'{"a":'.repeat(50_000)}1${"}".repeat(50_000)}`) as Record<
    string,
    unknown
  >;

const token = `eyJ${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;

describe("storableEntry", () => {
  it("leaves an ordinary entry as it was", () => {
    const entry = entryWith(
      { errorMessage: "boom", details: { actionId: "send", duration: 12 } },
      { toolId: 7, ipAddress: "203.0.113.7", userAgent: "curl/8" },
    );

    expect(storableEntry(entry)).toEqual(entry);
  });

  it("doesn't change what the caller passed in", () => {
    const details = { actionId: "a\u0000b" };

    storableEntry(entryWith({ details }));

    expect(details.actionId).toBe("a\u0000b");
  });

  it.each([
    ["an error message", { errorMessage: "a\u0000b" }, {}],
    ["a detail", { details: { x: "a\u0000b" } }, {}],
    ["a nested detail", { details: { x: [{ y: "a\u0000b" }] } }, {}],
    ["a detail's key", { details: { "a\u0000b": 1 } }, {}],
    ["an IP address", {}, { ipAddress: "a\u0000b" }],
    ["a user agent", {}, { userAgent: "a\u0000b" }],
    ["additional data", {}, { additionalData: { x: "a\u0000b" } }],
    ["a tool id", {}, { toolId: "a\u0000b" as unknown as number }],
  ])("strips a NUL byte from %s", (_name, fields, context) => {
    const stored = storableEntry(entryWith(fields, context));

    expect(JSON.stringify(stored)).not.toContain("\\u0000");
    expect(JSON.stringify(stored)).toMatch(/ab/);
  });

  it("replaces a lone surrogate but keeps a real pair", () => {
    const stored = storableEntry(
      entryWith({ details: { lone: "a\ud800b", pair: "a\u{1F600}b" } }),
    );

    expect(stored.details).toEqual({ lone: "a\uFFFDb", pair: "a\u{1F600}b" });
  });

  it("doesn't split a surrogate pair when it truncates", () => {
    const stored = storableEntry(
      entryWith(
        {},
        { ipAddress: `${"x".repeat(43)}\u{1F600}${"y".repeat(10)}` },
      ),
    );

    expect(stored.context.ipAddress).toBe(`${"x".repeat(43)}\uFFFD…`);
  });

  it("marks a value it cuts short", () => {
    const stored = storableEntry(entryWith({}, { ipAddress: "x".repeat(100) }));

    expect(stored.context.ipAddress).toBe(`${"x".repeat(44)}…`);
  });

  it("keeps the rest of the details when one value is circular", () => {
    const details: Record<string, unknown> = { actionId: "send" };
    details.self = details;

    expect(storableEntry(entryWith({ details })).details).toEqual({
      actionId: "send",
      self: "[Circular]",
    });
  });

  it("turns a BigInt into text", () => {
    expect(
      storableEntry(entryWith({ details: { n: BigInt(5) } })).details,
    ).toEqual({ n: "5" });
  });

  it("cuts off nesting too deep to store, keeping the rest", () => {
    const stored = storableEntry(
      entryWith({ errorMessage: "boom", details: { actionId: tooDeep() } }),
    );

    expect(stored.errorMessage).toBe("boom");
    expect(JSON.stringify(stored.details)).toContain("[Too deep]");
  });

  it("cuts a tool id down to text that fits, whatever it was", () => {
    const stored = storableEntry(
      entryWith({}, { toolId: tooDeep() as unknown as number }),
    );

    expect(typeof stored.context.toolId).toBe("string");
    expect(String(stored.context.toolId).length).toBeLessThanOrEqual(100);
  });

  it("keeps a numeric tool id", () => {
    expect(storableEntry(entryWith({}, { toolId: 7 })).context.toolId).toBe(7);
  });

  it("bounds every field, so a full buffer can't hold much", () => {
    const huge = "x".repeat(1_000_000);

    const stored = storableEntry(
      entryWith(
        { errorMessage: huge, details: { a: huge, b: [huge, huge] } },
        {
          toolId: huge as unknown as number,
          ipAddress: huge,
          userAgent: huge,
          additionalData: { c: huge },
        },
      ),
    );

    expect(JSON.stringify(stored).length).toBeLessThan(MAX_AUDIT_ENTRY_CHARS);
  });

  it("bounds details made of many small values", () => {
    const details = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, i) => [`key${i}`, i]),
    );

    const stored = storableEntry(entryWith({ details }));

    expect(Object.keys(stored.details ?? {})).toEqual(["detailsTruncated"]);
    expect(JSON.stringify(stored).length).toBeLessThan(MAX_AUDIT_ENTRY_CHARS);
  });

  it("leaves the user id exactly as given, so a record can't move to someone else", () => {
    const stored = storableEntry(
      entryWith({}, { userId: `adm\u0000in${"x".repeat(500)}` }),
    );

    expect(stored.context.userId).toBe(`adm\u0000in${"x".repeat(500)}`);
  });

  it("keeps who did what when reading the details throws", () => {
    const details = {
      get x(): string {
        throw new Error("no");
      },
    };

    expect(storableEntry(entryWith({ details }))).toEqual({
      action: "tool.execute",
      success: false,
      context: { userId: "user-1" },
      details: { detailsUnreadable: true },
    });
  });
});

describe("serializeEntry", () => {
  it("writes the entry as one line of JSON", () => {
    const line = serializeEntry(
      entryWith({
        errorMessage: "first\nsecond",
        details: { actionId: "send" },
      }),
    );

    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      action: "tool.execute",
      errorMessage: "first\nsecond",
      details: { actionId: "send" },
    });
  });

  it("masks a secret by its key, by its look, and inside free text", () => {
    const bearer = "a1b2c3d4".repeat(6);

    const line = serializeEntry(
      entryWith({
        errorMessage: `provider said Bearer ${bearer} was bad`,
        details: { apiKey: "not-for-the-logs", actionId: `x ${token}` },
      }),
    );

    expect(line).toContain('"apiKey":"[REDACTED]"');
    expect(line).not.toContain("not-for-the-logs");
    expect(line).not.toContain(token);
    expect(line).toContain("provider said Bearer [REDACTED] was bad");
    expect(line).not.toContain(bearer);
  });

  it("is bounded", () => {
    const line = serializeEntry(
      entryWith({}, { userId: "x y".repeat(100_000) }),
    );

    expect(line.length).toBeLessThanOrEqual(MAX_AUDIT_ENTRY_CHARS);
  });

  it.each([
    ["too deep to walk", tooDeep()],
    ["a BigInt", BigInt(5)],
  ])("falls back to a fixed text for a user id that is %s", (_name, userId) => {
    const line = serializeEntry(
      entryWith({}, { userId: userId as unknown as string }),
    );

    expect(line).toBe('"[this entry could not be serialized]"');
  });
});

describe("quotedForLog", () => {
  it("keeps to one line", () => {
    expect(quotedForLog("first\nsecond\r\n\tthird")).toBe("first second third");
  });

  it("masks a secret", () => {
    expect(quotedForLog(`value ${token}`)).not.toContain(token);
  });

  it("is short", () => {
    expect(quotedForLog("x y".repeat(10_000)).length).toBeLessThanOrEqual(500);
  });

  it("masks a secret that a shorter cut would have left half visible", () => {
    const text = `${"x ".repeat(245)}${token}`;

    expect(quotedForLog(text)).not.toContain("eyJaaaa");
  });
});
