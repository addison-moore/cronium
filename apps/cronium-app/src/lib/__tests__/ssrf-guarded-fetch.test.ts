/**
 * @jest-environment node
 *
 * ssrfGuardedFetch against a real socket, since an SDK depends on it behaving like
 * fetch: status, headers, body, abort, and no following of redirects.
 */
import http from "http";
import type { AddressInfo } from "net";
import { lookup as dnsLookup } from "dns/promises";
import { assertUrlResolvesPublic, ssrfGuardedFetch } from "../ssrf-guard";
import { SsrfBlockedError } from "../tools/safe-fetch";

jest.mock("dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("../tools/safe-fetch", () => {
  const actual = jest.requireActual<typeof import("../tools/safe-fetch")>(
    "../tools/safe-fetch",
  );
  return {
    ...actual,
    // Loopback stands in for a public host so the test needs no network.
    isDisallowedIp: (ip: string) =>
      ip.startsWith("203.0.113.") || ip === "169.254.169.254",
  };
});

const mockedLookup = dnsLookup as unknown as jest.Mock;

describe("ssrfGuardedFetch", () => {
  let server: http.Server;
  let base: string;
  const received: { method?: string; auth?: string; body?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += String(chunk)));
      req.on("end", () => {
        received.push({
          method: req.method,
          auth: req.headers.authorization,
          body,
        });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://public.example/elsewhere" });
          res.end();
        } else if (req.url === "/empty") {
          res.writeHead(204);
          res.end();
        } else if (req.url === "/error") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end('{"error":"bad key"}');
        } else if (req.url === "/hang") {
          // Never answers; the test aborts it.
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://public.example:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
    mockedLookup.mockReset();
    mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  });

  it("makes the request and returns a working Response", async () => {
    const response = await ssrfGuardedFetch(`${base}/models`, {
      method: "POST",
      headers: new Headers({
        authorization: "Bearer k",
        "content-type": "application/json",
      }),
      body: '{"a":1}',
    });

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(received[0]).toEqual({
      method: "POST",
      auth: "Bearer k",
      body: '{"a":1}',
    });
  });

  it("returns error statuses instead of throwing", async () => {
    const response = await ssrfGuardedFetch(`${base}/error`);
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('{"error":"bad key"}');
  });

  it("handles a response with no body", async () => {
    const response = await ssrfGuardedFetch(`${base}/empty`);
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("does not follow a redirect", async () => {
    const response = await ssrfGuardedFetch(`${base}/redirect`);
    expect(response.status).toBe(302);
    expect(received).toHaveLength(1);
  });

  it("refuses a host resolving to an internal address at connect time", async () => {
    mockedLookup.mockResolvedValue([{ address: "203.0.113.5", family: 4 }]);
    await expect(ssrfGuardedFetch(`${base}/models`)).rejects.toThrow(
      /disallowed address/,
    );
    expect(received).toHaveLength(0);
  });

  it("refuses an internal IP literal before connecting", async () => {
    await expect(
      ssrfGuardedFetch("http://169.254.169.254/latest/meta-data"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("honors an abort signal", async () => {
    const controller = new AbortController();
    const pending = ssrfGuardedFetch(`${base}/hang`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow(/cancel|abort/i);
  });
});

describe("assertUrlResolvesPublic", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it("passes a public host", async () => {
    mockedLookup.mockResolvedValue([{ address: "198.51.100.1", family: 4 }]);
    await expect(
      assertUrlResolvesPublic("https://api.example.com/v1"),
    ).resolves.toBeUndefined();
  });

  it("refuses a host with any internal record", async () => {
    mockedLookup.mockResolvedValue([
      { address: "198.51.100.1", family: 4 },
      { address: "203.0.113.5", family: 4 },
    ]);
    await expect(
      assertUrlResolvesPublic("https://api.example.com/v1"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("refuses an internal literal without a lookup", async () => {
    await expect(
      assertUrlResolvesPublic("http://169.254.169.254/"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("leaves a host that does not resolve to the request itself", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertUrlResolvesPublic("https://nope.example/v1"),
    ).resolves.toBeUndefined();
  });
});
