/**
 * @jest-environment node
 */
jest.mock("dns/promises", () => ({ lookup: jest.fn() }));

import { lookup } from "dns/promises";
import { safeFetch, SsrfBlockedError, TOOL_HOSTS } from "../safe-fetch";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

// A routable public address the resolution check should accept.
const PUBLIC = [{ address: "203.0.113.10", family: 4 }];

function resolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })) as never,
  );
}

let fetchMock: jest.Mock;

beforeEach(() => {
  mockLookup.mockReset();
  fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("safeFetch — scheme and allowlist", () => {
  it("rejects a non-https URL before any DNS or fetch", async () => {
    await expect(
      safeFetch("http://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(SsrfBlockedError);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    await expect(
      safeFetch("not-a-url", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(/Invalid URL/);
  });

  it("rejects a host outside the tool allowlist (before DNS)", async () => {
    await expect(
      safeFetch("https://evil.example.com/x", {
        allowHosts: TOOL_HOSTS.slack,
      }),
    ).rejects.toThrow(/not an allowed destination/);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("safeFetch — DNS/IP defense in depth", () => {
  it("blocks an allowlisted host that resolves to the cloud-metadata IP", async () => {
    resolvesTo("169.254.169.254");
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(/disallowed address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks resolution to loopback (DNS-rebind style)", async () => {
    resolvesTo("127.0.0.1");
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it.each([
    ["10.0.0.5", "private 10/8"],
    ["172.16.9.9", "private 172.16/12"],
    ["192.168.1.10", "private 192.168/16"],
    ["100.64.1.1", "CGNAT 100.64/10"],
    ["0.0.0.0", "unspecified"],
  ])("blocks resolution to %s (%s)", async (ip) => {
    resolvesTo(ip);
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks IPv6 loopback and IPv4-mapped loopback", async () => {
    resolvesTo("::1");
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(SsrfBlockedError);

    resolvesTo("::ffff:127.0.0.1");
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks when ANY resolved address is disallowed", async () => {
    resolvesTo("203.0.113.10", "127.0.0.1");
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(/disallowed address/);
  });

  it("rejects a host that fails to resolve", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      safeFetch("https://hooks.slack.com/x", { allowHosts: TOOL_HOSTS.slack }),
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe("safeFetch — allowed request", () => {
  it("fetches when host is allowlisted and resolves public, with redirects disabled", async () => {
    resolvesTo(...PUBLIC.map((a) => a.address));
    const res = await safeFetch("https://hooks.slack.com/services/x", {
      allowHosts: TOOL_HOSTS.slack,
      method: "POST",
      body: "hi",
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeDefined();
  });
});
