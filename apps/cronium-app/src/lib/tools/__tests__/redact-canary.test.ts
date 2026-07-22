import { redactSecrets } from "@/lib/tools/redact";

/**
 * ME-02 canary regression: a realistically-shaped secret must never survive the
 * log-redaction boundary, regardless of where in a logged structure it appears.
 * We plant a single canary and assert it is absent from the SERIALIZED redacted
 * output for every shape a secret realistically takes when something gets logged
 * (tool params, error objects, nested config, connection strings, arrays).
 *
 * The canary has a real-secret shape (long, high-entropy, letters+digits) so the
 * value-aware redactor catches it even under an innocuous key — mirroring how
 * actual API keys/tokens look. (Redaction cannot mask arbitrary SHORT strings;
 * real credentials are never that short.)
 */
const CANARY = "crnCANARY9A8b7C6d5E4f3G2h1I0jKLMNOPqrstuvwx012345";

function leaks(structure: unknown): boolean {
  return JSON.stringify(redactSecrets(structure)).includes(CANARY);
}

describe("ME-02 log-redaction canary", () => {
  it("never leaks under a sensitive key", () => {
    expect(leaks({ apiKey: CANARY })).toBe(false);
    expect(leaks({ password: CANARY })).toBe(false);
    expect(leaks({ authorization: `Bearer ${CANARY}` })).toBe(false);
    expect(leaks({ client_secret: CANARY })).toBe(false);
  });

  it("never leaks under an innocuous key (value-aware)", () => {
    expect(leaks({ note: CANARY })).toBe(false);
    expect(leaks({ data: { blob: CANARY } })).toBe(false);
  });

  it("never leaks when deeply nested or inside arrays", () => {
    expect(leaks({ a: { b: { c: [{ d: { token: CANARY } }] } } })).toBe(false);
    expect(leaks([{ secret: CANARY }, "ok", { nested: [CANARY] }])).toBe(false);
  });

  it("never leaks inside a connection string / URL credential", () => {
    expect(leaks({ dsn: `postgres://user:${CANARY}@db:5432/app` })).toBe(false);
    expect(leaks({ url: `https://api.example.com/x?token=${CANARY}` })).toBe(
      false,
    );
  });

  it("never leaks from a logged error/tool-action shape", () => {
    const logShape = {
      level: "error",
      message: "tool action failed",
      toolAction: {
        tool: "slack",
        parameters: { webhookUrl: `https://hooks.slack.com/${CANARY}` },
      },
      error: { stack: "Error: boom", context: { oauthToken: CANARY } },
      env: { SOME_KEY: CANARY },
    };
    expect(leaks(logShape)).toBe(false);
  });

  it("still preserves non-secret values around the canary", () => {
    const redacted = redactSecrets({
      keepMe: "hello-world",
      count: 42,
      apiKey: CANARY,
    }) as Record<string, unknown>;
    expect(redacted.keepMe).toBe("hello-world");
    expect(redacted.count).toBe(42);
    expect(redacted.apiKey).toBe("[REDACTED]");
  });
});
