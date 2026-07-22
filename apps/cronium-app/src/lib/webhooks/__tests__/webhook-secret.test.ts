import {
  encryptWebhookSecret,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  decryptWebhookHeaders,
} from "@/lib/webhooks/webhook-secret";
import { __resetSecretVaultForTests } from "@/lib/security/secret-vault";

const KEY = "4444444444444444444444444444444444444444444444444444444444444444";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  __resetSecretVaultForTests();
});
afterAll(() => __resetSecretVaultForTests());

describe("webhook secret encryption (HI-09)", () => {
  it("round-trips a secret bound to (webhookKey, userId)", () => {
    const env = encryptWebhookSecret("hmac-secret", "wh_abc", "user-1");
    expect(env.startsWith("crn.1.")).toBe(true);
    expect(decryptWebhookSecret(env, "wh_abc", "user-1")).toBe("hmac-secret");
  });

  it("fails closed when the webhook key or tenant does not match", () => {
    const env = encryptWebhookSecret("hmac-secret", "wh_abc", "user-1");
    expect(() => decryptWebhookSecret(env, "wh_other", "user-1")).toThrow();
    expect(() => decryptWebhookSecret(env, "wh_abc", "user-2")).toThrow();
  });

  it("passes a legacy plaintext secret through unchanged", () => {
    expect(decryptWebhookSecret("plainsecret", "wh_abc", "user-1")).toBe(
      "plainsecret",
    );
  });
});

describe("webhook custom-header encryption (HI-09)", () => {
  it("round-trips credential headers bound to the webhook", () => {
    const headers = { Authorization: "Bearer sk-live-123", "X-Tenant": "acme" };
    const stored = encryptWebhookHeaders(headers, "wh_abc", "user-1");
    // Ciphertext at rest — the raw secret must not be visible.
    expect(JSON.stringify(stored)).not.toContain("sk-live-123");
    expect("__enc" in stored).toBe(true);
    expect(decryptWebhookHeaders(stored, "wh_abc", "user-1")).toEqual(headers);
  });

  it("stores empty headers as a plain empty object (nothing to protect)", () => {
    const stored = encryptWebhookHeaders({}, "wh_abc", "user-1");
    expect(stored).toEqual({});
    expect(decryptWebhookHeaders(stored, "wh_abc", "user-1")).toEqual({});
  });

  it("fails closed when headers are read under the wrong binding", () => {
    const stored = encryptWebhookHeaders(
      { Authorization: "Bearer x" },
      "wh_abc",
      "user-1",
    );
    expect(() => decryptWebhookHeaders(stored, "wh_abc", "user-2")).toThrow();
  });

  it("passes legacy plaintext header objects through unchanged", () => {
    const legacy = { "X-Api-Key": "legacy-value" };
    expect(decryptWebhookHeaders(legacy, "wh_abc", "user-1")).toEqual(legacy);
  });
});
