import { TOOL_HOSTS, hostAllowed, isAllowedWebhookUrl } from "../tool-hosts";

describe("hostAllowed", () => {
  it("matches an exact host", () => {
    expect(hostAllowed("hooks.slack.com", TOOL_HOSTS.slack)).toBe(true);
    expect(hostAllowed("api.notion.com", TOOL_HOSTS.notion)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hostAllowed("HOOKS.SLACK.COM", TOOL_HOSTS.slack)).toBe(true);
  });

  it("rejects a non-listed host", () => {
    expect(hostAllowed("evil.com", TOOL_HOSTS.slack)).toBe(false);
    expect(hostAllowed("hooks.slack.com.evil.com", TOOL_HOSTS.slack)).toBe(
      false,
    );
  });

  it("does not treat an exact entry as a suffix match", () => {
    // "hooks.slack.com" must not match "evilhooks.slack.com".
    expect(hostAllowed("evilhooks.slack.com", TOOL_HOSTS.slack)).toBe(false);
  });

  it("matches a leading-dot entry as domain-or-subdomain (teams)", () => {
    // TOOL_HOSTS.teams includes ".webhook.office.com"
    expect(hostAllowed("abc.webhook.office.com", TOOL_HOSTS.teams)).toBe(true);
    expect(hostAllowed("webhook.office.com", TOOL_HOSTS.teams)).toBe(true);
    expect(hostAllowed("outlook.office.com", TOOL_HOSTS.teams)).toBe(true);
  });

  it("rejects a lookalike of a leading-dot entry", () => {
    expect(hostAllowed("webhook.office.com.evil.com", TOOL_HOSTS.teams)).toBe(
      false,
    );
  });
});

describe("isAllowedWebhookUrl", () => {
  it("accepts an https URL on an allowed host", () => {
    expect(
      isAllowedWebhookUrl(
        "https://hooks.slack.com/services/T/B/xxx",
        TOOL_HOSTS.slack,
      ),
    ).toBe(true);
  });

  it("rejects http (non-TLS)", () => {
    expect(
      isAllowedWebhookUrl(
        "http://hooks.slack.com/services/x",
        TOOL_HOSTS.slack,
      ),
    ).toBe(false);
  });

  it("rejects an allowed-looking host that is not listed", () => {
    expect(
      isAllowedWebhookUrl("https://example.com/hook", TOOL_HOSTS.slack),
    ).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isAllowedWebhookUrl("not a url", TOOL_HOSTS.slack)).toBe(false);
    expect(isAllowedWebhookUrl("", TOOL_HOSTS.slack)).toBe(false);
  });
});
