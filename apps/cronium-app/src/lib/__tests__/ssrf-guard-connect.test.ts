/**
 * guardedLookup against a real socket. The contract with net.connect is subtle
 * (`options.all` changes the callback shape) and only breaks at connect time, so
 * asserting on the agent's configuration would not have caught that every request
 * to a hostname was failing with ERR_INVALID_IP_ADDRESS.
 */
import http from "http";
import type { AddressInfo } from "net";
import { lookup as dnsLookup } from "dns/promises";
import { guardedLookup, ssrfHttpAgent } from "../ssrf-guard";

jest.mock("dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("../tools/safe-fetch", () => {
  const actual = jest.requireActual<typeof import("../tools/safe-fetch")>(
    "../tools/safe-fetch",
  );
  return {
    ...actual,
    // Loopback stands in for a public host so the test needs no network; the
    // address filtering itself is covered in ssrf-guard.test.ts. Addresses in
    // 203.0.113.0/24 stay blocked, so rejection can be tested here too.
    isDisallowedIp: (ip: string) => ip.startsWith("203.0.113."),
  };
});

const mockedLookup = dnsLookup as unknown as jest.Mock;

function get(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: "public.example", port, path: "/", agent: ssrfHttpAgent },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += String(chunk)));
          res.on("end", () => resolve(body));
        },
      )
      .on("error", reject);
  });
}

describe("guardedLookup", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("reached"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    ssrfHttpAgent.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it("connects to a hostname through the agent (Node's autoSelectFamily path)", async () => {
    mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(get(port)).resolves.toBe("reached");
  });

  it("refuses the connection when any resolved address is disallowed", async () => {
    mockedLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
      { address: "203.0.113.9", family: 4 },
    ]);
    await expect(get(port)).rejects.toThrow(/disallowed address/);
  });

  it("returns an array only when the caller asked for all addresses", async () => {
    mockedLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
    const lookup = (options: Parameters<typeof guardedLookup>[1]) =>
      new Promise<unknown[]>((resolve) =>
        guardedLookup("public.example", options, (...args) => resolve(args)),
      );

    expect(await lookup({ all: true })).toEqual([
      null,
      [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
    ]);
    expect(await lookup({})).toEqual([null, "127.0.0.1", 4]);
    expect(await lookup({ family: 6 })).toEqual([null, "::1", 6]);
  });

  it("fails rather than connecting when the family filter leaves nothing", async () => {
    mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const [error] = await new Promise<unknown[]>((resolve) =>
      guardedLookup("public.example", { family: 6 }, (...args) =>
        resolve(args),
      ),
    );
    expect(String(error)).toMatch(/Could not resolve host/);
  });
});
