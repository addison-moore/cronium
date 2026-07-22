import { redactSecrets } from "@/lib/tools/redact";

const CANARY_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("redactSecrets — key-aware", () => {
  it("masks obviously secret keys", () => {
    const out = redactSecrets({
      password: "hunter2",
      apiKey: "abc",
      authorization: "Bearer xyz",
      channel: "#general",
    }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.channel).toBe("#general");
  });

  it("masks client_secret / refresh_token / access_key variants", () => {
    const out = redactSecrets({
      client_secret: "s",
      refresh_token: "r",
      accessKey: "a",
    }) as Record<string, unknown>;
    expect(out.client_secret).toBe("[REDACTED]");
    expect(out.refresh_token).toBe("[REDACTED]");
    expect(out.accessKey).toBe("[REDACTED]");
  });
});

describe("redactSecrets — value-aware (ME-02)", () => {
  it("masks a JWT stored under an innocuous key", () => {
    const out = redactSecrets({ note: CANARY_JWT }) as Record<string, unknown>;
    expect(out.note).toBe("[REDACTED]");
  });

  it("masks a Bearer value under an innocuous key", () => {
    const out = redactSecrets({ header: "Bearer abcdef1234567890" }) as Record<
      string,
      unknown
    >;
    expect(out.header).toBe("[REDACTED]");
  });

  it("masks a URL carrying an embedded token or userinfo credential", () => {
    const out = redactSecrets({
      url: "https://hook.example.com/x?token=SECRETVALUE123",
      db: "postgres://user:passw0rd@host/db",
    }) as Record<string, unknown>;
    expect(out.url).toBe("[REDACTED]");
    expect(out.db).toBe("[REDACTED]");
  });

  it("leaves ordinary values intact", () => {
    const out = redactSecrets({
      subject: "Hello world",
      count: 5,
      url: "https://example.com/webhooks/receive",
    }) as Record<string, unknown>;
    expect(out.subject).toBe("Hello world");
    expect(out.count).toBe(5);
    expect(out.url).toBe("https://example.com/webhooks/receive");
  });
});

describe("redactSecrets — deep nesting (no depth cutoff)", () => {
  it("masks a secret nested deeper than 8 levels", () => {
    let node: Record<string, unknown> = { token: CANARY_JWT };
    for (let i = 0; i < 12; i++) node = { child: node };
    const serialized = JSON.stringify(redactSecrets(node));
    expect(serialized).not.toContain(CANARY_JWT);
    expect(serialized).toContain("[REDACTED]");
  });

  it("handles cycles without infinite recursion", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = JSON.stringify(redactSecrets(a));
    expect(out).toContain("[Circular]");
  });
});
