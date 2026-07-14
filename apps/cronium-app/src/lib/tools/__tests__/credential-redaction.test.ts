import {
  isSecretKey,
  redactCredentialValues,
  mergeCredentials,
} from "../credential-redaction";

describe("isSecretKey", () => {
  it("flags secret-bearing keys", () => {
    for (const key of [
      "token",
      "apiToken",
      "apiKey",
      "api_key",
      "password",
      "smtpPassword",
      "webhookUrl",
      "clientSecret",
      "authorization",
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it("leaves non-secret keys alone", () => {
    for (const key of ["name", "channel", "smtpHost", "fromEmail", "scope"]) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe("redactCredentialValues", () => {
  it("blanks secret values but keeps non-secret ones", () => {
    const out = redactCredentialValues({
      smtpHost: "smtp.example.com",
      smtpUser: "me@example.com",
      smtpPassword: "hunter2",
      webhookUrl: "https://hooks.slack.com/services/x",
    });
    expect(out.smtpHost).toBe("smtp.example.com");
    expect(out.smtpUser).toBe("me@example.com");
    expect(out.smtpPassword).toBe("");
    expect(out.webhookUrl).toBe("");
  });

  it("never emits the real secret value", () => {
    const out = redactCredentialValues({ apiKey: "secret_abc123" });
    expect(JSON.stringify(out)).not.toContain("secret_abc123");
  });

  it("leaves an already-empty secret as empty", () => {
    expect(redactCredentialValues({ apiKey: "" }).apiKey).toBe("");
  });
});

describe("mergeCredentials", () => {
  it("restores a blank secret from the existing value (leave-blank-to-keep)", () => {
    const merged = mergeCredentials(
      { apiKey: "", name: "updated" },
      { apiKey: "stored-secret", name: "old" },
    );
    expect(merged.apiKey).toBe("stored-secret");
    expect(merged.name).toBe("updated");
  });

  it("keeps a newly provided secret", () => {
    const merged = mergeCredentials(
      { apiKey: "new-secret" },
      { apiKey: "stored-secret" },
    );
    expect(merged.apiKey).toBe("new-secret");
  });

  it("does not fabricate a non-secret field from existing", () => {
    const merged = mergeCredentials({ channel: "" }, { channel: "#general" });
    // channel is not a secret, so a blank submission is honored as-is.
    expect(merged.channel).toBe("");
  });

  it("leaves a blank secret blank when there is no stored value", () => {
    const merged = mergeCredentials({ apiKey: "" }, {});
    expect(merged.apiKey).toBe("");
  });
});
