/**
 * @jest-environment node
 */
// Slack/Discord/Teams connection tests go through safeFetch, which resolves DNS;
// pin every host to a public IP so only the fetch behaviour under test matters.
jest.mock("dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]),
}));

import { testToolConnection } from "../tool-registry";

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("testToolConnection — Notion (fetchWithTimeout path)", () => {
  it("succeeds on a 200 from the users endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "Acme Workspace" }), { status: 200 }),
    );
    const result = await testToolConnection("notion", { apiKey: "secret_x" });
    expect(result.success).toBe(true);
    expect(result.details?.workspace).toBe("Acme Workspace");
  });

  it("fails on a 401 without throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const result = await testToolConnection("notion", { apiKey: "bad" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/401/);
  });

  it("fails fast when the api key is missing (no network call)", async () => {
    const result = await testToolConnection("notion", {});
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("testToolConnection — Slack (safeFetch path)", () => {
  it("succeeds when the webhook returns the literal ok body", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await testToolConnection("slack", {
      webhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    });
    expect(result.success).toBe(true);
  });

  it("fails when the webhook returns an error body", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_token", { status: 403 }));
    const result = await testToolConnection("slack", {
      webhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a webhook URL off the allowlist as a failed test (SSRF guard)", async () => {
    const result = await testToolConnection("slack", {
      webhookUrl: "https://evil.example.com/hook",
    });
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("testToolConnection — registry-level behaviour", () => {
  it("returns a failure (never throws) for an unknown tool type", async () => {
    const result = await testToolConnection("does-not-exist", {});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No connection test available/);
  });

  it("converts a thrown provider error into an honest failure result", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const result = await testToolConnection("notion", { apiKey: "x" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/socket hang up/);
  });

  it("reports a timed-out test distinctly", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const result = await testToolConnection("notion", { apiKey: "x" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timed out/);
  });
});
