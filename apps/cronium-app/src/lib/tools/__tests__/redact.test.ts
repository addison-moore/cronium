import { redactSecrets } from "../redact";

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
