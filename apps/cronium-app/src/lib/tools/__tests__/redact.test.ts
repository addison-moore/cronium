import { redactSecrets, redactText } from "../redact";

describe("redactSecrets", () => {
  it("masks secret-keyed fields with a placeholder", () => {
    const out = redactSecrets({
      channel: "#ops",
      webhookUrl: "https://hooks.slack.com/services/x",
      oauthToken: "ya29.abc",
    }) as Record<string, unknown>;
    expect(out.channel).toBe("#ops");
    expect(out.webhookUrl).toBe("[REDACTED]");
    expect(out.oauthToken).toBe("[REDACTED]");
  });

  it("never emits a real secret value anywhere in the output", () => {
    const out = redactSecrets({
      params: { authorization: "Bearer sk-live-123", subject: "Hi" },
      list: [{ apiKey: "secret_zzz" }],
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("sk-live-123");
    expect(serialized).not.toContain("secret_zzz");
    expect(serialized).toContain("Hi");
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactSecrets({
      outer: { inner: { password: "p" }, items: [{ token: "t" }] },
    }) as {
      outer: { inner: { password: string }; items: { token: string }[] };
    };
    expect(out.outer.inner.password).toBe("[REDACTED]");
    expect(out.outer.items[0]?.token).toBe("[REDACTED]");
  });

  it("does not mask an empty secret value", () => {
    const out = redactSecrets({ token: "" }) as Record<string, unknown>;
    expect(out.token).toBe("");
  });

  it("passes primitives through unchanged", () => {
    expect(redactSecrets("hello")).toBe("hello");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});

const CANARY_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("redactSecrets — value-aware (ME-02)", () => {
  it("masks a JWT stored under an innocuous key", () => {
    const out = redactSecrets({ note: CANARY_JWT }) as Record<string, unknown>;
    expect(out.note).toBe("[REDACTED]");
  });

  it("masks a Bearer value and a URL with an embedded credential", () => {
    const out = redactSecrets({
      header: "Bearer abcdef1234567890",
      hook: "https://hook.example.com/x?token=SECRETVALUE123",
      db: "postgres://user:passw0rd@host/db",
    }) as Record<string, unknown>;
    expect(out.header).toBe("[REDACTED]");
    expect(out.hook).toBe("[REDACTED]");
    expect(out.db).toBe("[REDACTED]");
  });

  it("masks client_secret / refresh_token / access_key key variants", () => {
    const out = redactSecrets({
      client_secret: "s",
      refresh_token: "r",
      accessKey: "a",
    }) as Record<string, unknown>;
    expect(out.client_secret).toBe("[REDACTED]");
    expect(out.refresh_token).toBe("[REDACTED]");
    expect(out.accessKey).toBe("[REDACTED]");
  });

  it("leaves an ordinary URL and text intact", () => {
    const out = redactSecrets({
      url: "https://example.com/webhooks/receive",
      subject: "Hello world",
    }) as Record<string, unknown>;
    expect(out.url).toBe("https://example.com/webhooks/receive");
    expect(out.subject).toBe("Hello world");
  });
});

describe("redactSecrets — deep nesting + cycles", () => {
  it("masks a secret nested deeper than the old depth cutoff", () => {
    let node: Record<string, unknown> = { token: CANARY_JWT };
    for (let i = 0; i < 12; i++) node = { child: node };
    const serialized = JSON.stringify(redactSecrets(node));
    expect(serialized).not.toContain(CANARY_JWT);
    expect(serialized).toContain("[REDACTED]");
  });

  it("handles cycles without infinite recursion", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(JSON.stringify(redactSecrets(a))).toContain("[Circular]");
  });
});

describe("redactText — span-level redaction in free text", () => {
  it("masks a JWT mid-sentence but keeps the surrounding text", () => {
    const out = redactText(`auth failed for token ${CANARY_JWT}, retrying`);
    expect(out).not.toContain(CANARY_JWT);
    expect(out).toContain("auth failed for token");
    expect(out).toContain("retrying");
  });

  it("masks a Bearer credential", () => {
    const out = redactText(
      "401 from provider: Bearer sk-live-1234567890abcd rejected",
    );
    expect(out).not.toContain("sk-live-1234567890abcd");
    expect(out).toContain("401 from provider");
  });

  it("masks a Slack-style webhook URL via its high-entropy path segment", () => {
    const url =
      "https://hooks.slack.com/services/T0001/B0001/XXXXyyyyZZZZ12345678wwww";
    const out = redactText(`POST ${url} returned 404`);
    expect(out).not.toContain("XXXXyyyyZZZZ12345678wwww");
    expect(out).toContain("returned 404");
  });

  it("masks URLs carrying secret query params or userinfo credentials", () => {
    expect(
      redactText("GET https://api.example.com/v1?api_key=abc123 failed"),
    ).not.toContain("abc123");
    expect(
      redactText("connect to https://user:hunter2@db.example.com failed"),
    ).not.toContain("hunter2");
  });

  it("masks a standalone high-entropy blob", () => {
    const blob = "xoxb1234abcd5678efgh9012ijkl3456mnop7890qrst";
    const out = redactText(`provider echoed ${blob} in its error`);
    expect(out).not.toContain(blob);
    expect(out).toContain("provider echoed");
  });

  it("leaves an ordinary error message completely intact", () => {
    const msg =
      "ECONNREFUSED to slack: connect to https://slack.com/api/chat.postMessage timed out after 30000ms";
    expect(redactText(msg)).toBe(msg);
  });

  it("returns empty input unchanged", () => {
    expect(redactText("")).toBe("");
  });
});
