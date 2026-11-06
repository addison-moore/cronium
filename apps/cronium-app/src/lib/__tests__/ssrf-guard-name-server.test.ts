/**
 * @jest-environment node
 *
 * The SSRF guard against a real name server and a real receiver, over real sockets, so
 * the rule that every resolved address is checked is tested on replies off the wire.
 * c-ares asks for each family separately, so a reply for one has to be held to the same
 * rule as a reply for both. `ssrf-guard.test.ts` covers the rule with the resolver stubbed.
 */
let mockNameServerPort = 0;
let mockResolverOptions: { timeout: number; tries: number } | undefined;
jest.mock("dns/promises", () => {
  const actual =
    jest.requireActual<typeof import("dns/promises")>("dns/promises");
  return {
    ...actual,
    Resolver: class extends actual.Resolver {
      constructor(options?: { timeout?: number; tries?: number }) {
        super(mockResolverOptions ?? options);
        this.setServers([`127.0.0.1:${mockNameServerPort}`]);
      }
    },
  };
});

let mockHostsFile = "";
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      args[0] === "/etc/hosts" ? mockHostsFile : actual.readFileSync(...args),
  };
});

// Same exemption as ssrf-guard.test.ts: the guard refuses loopback, so the test's own
// receiver is exempted and every other address gets the real check.
jest.mock("@/lib/tools/safe-fetch", () => {
  const actual = jest.requireActual<typeof import("@/lib/tools/safe-fetch")>(
    "@/lib/tools/safe-fetch",
  );
  return {
    ...actual,
    isDisallowedIp: (ip: string) =>
      ip !== "127.0.0.1" && actual.isDisallowedIp(ip),
  };
});

import http from "http";
import https from "https";
import type { AddressInfo } from "net";
import { executeHttpRequest } from "../scheduler/http-executor";
import {
  assertUrlResolvesPublic,
  guardedLookup,
  ssrfHttpAgent,
  ssrfHttpsAgent,
} from "../ssrf-guard";
import { SsrfBlockedError } from "../tools/safe-fetch";
import {
  NEVER,
  startNameServer,
  type FakeNameServer,
  type ZoneEntry,
} from "./helpers/fake-name-server";

// jest-circus only reads a global testTimeout, and the default of 5 seconds is less
// than a name server that never answers takes to give up on.
jest.setTimeout(60_000);

const PUBLIC_A = "203.0.113.10";
const PUBLIC_AAAA = "2001:db8::10";
const QUICKLY = { timeout: 100, tries: 1 };

let nameServer: FakeNameServer;
let receiver: http.Server;
let port: number;
let connections: number;

beforeEach(async () => {
  nameServer = await startNameServer();
  mockNameServerPort = nameServer.port;
  mockResolverOptions = undefined;
  mockHostsFile = "";
  connections = 0;
  receiver = http.createServer((_req, res) => res.end("reached"));
  receiver.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  port = (receiver.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((resolve) => {
    receiver.close(resolve);
    receiver.closeAllConnections();
  });
  await nameServer.close();
});

const get = (host: string, options: http.RequestOptions = {}) =>
  new Promise<string>((resolve, reject) => {
    http
      .get({ host, port, agent: ssrfHttpAgent, ...options }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += String(chunk)));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });

describe("guarded requests with a real name server", () => {
  it("connects to the address the name server gives", async () => {
    nameServer.zone.set("public.test", { A: ["127.0.0.1"] });

    await expect(get("public.test")).resolves.toBe("reached");
  });

  describe("refuses, and makes no connection", () => {
    it.each<[string, ZoneEntry, RegExp]>([
      ["an internal A record", { A: ["10.0.0.5"] }, /disallowed address/],
      ["an internal AAAA record", { AAAA: ["fd00::5"] }, /disallowed address/],
      ["metadata's address", { A: ["169.254.169.254"] }, /disallowed address/],
      [
        "a public A record beside an internal AAAA",
        { A: ["127.0.0.1"], AAAA: ["fd00::5"] },
        /disallowed address/,
      ],
      [
        "an internal A record beside a public AAAA",
        { A: ["10.0.0.5"], AAAA: [PUBLIC_AAAA] },
        /disallowed address/,
      ],
      [
        "a public A record beside an internal one",
        { A: ["127.0.0.1", "10.0.0.5"] },
        /disallowed address/,
      ],
      [
        "an alias of an internal address",
        { CNAME: "inside.test", A: ["10.0.0.5"] },
        /disallowed address/,
      ],
      [
        "an IPv4-mapped internal AAAA",
        { AAAA: ["::ffff:a00:5"] },
        /disallowed address/,
      ],
      ["no address records", {}, /Could not resolve host/],
      [
        "a failed A query",
        { A: "SERVFAIL", AAAA: [] },
        /Could not resolve host/,
      ],
      [
        "a usable A record and a failed AAAA query",
        { A: ["127.0.0.1"], AAAA: "SERVFAIL" },
        /Could not resolve host/,
      ],
      [
        "a usable AAAA record and a failed A query",
        { A: "SERVFAIL", AAAA: [PUBLIC_AAAA] },
        /Could not resolve host/,
      ],
    ])("a host with %s", async (_label, entry, message) => {
      nameServer.zone.set("host.test", entry);

      const failure = get("host.test");

      await expect(failure).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(failure).rejects.toThrow(message);
      expect(connections).toBe(0);
    });

    it("a host whose AAAA query never gets an answer, however good its A record", async () => {
      mockResolverOptions = QUICKLY;
      nameServer.zone.set("host.test", { A: ["127.0.0.1"], AAAA: NEVER });

      await expect(get("host.test")).rejects.toThrow(/Could not resolve host/);
      expect(connections).toBe(0);
    });

    it("a host with an internal AAAA record, when Node only asks for IPv4", async () => {
      nameServer.zone.set("host.test", {
        A: ["127.0.0.1"],
        AAAA: ["fd00::5"],
      });

      await expect(get("host.test", { family: 4 })).rejects.toThrow(
        /disallowed address/,
      );
      expect(connections).toBe(0);
    });

    it("a host /etc/hosts points inward, whatever the name server says", async () => {
      mockHostsFile = "10.0.0.5 host.test\n";
      nameServer.zone.set("host.test", { A: ["127.0.0.1"] });

      await expect(get("host.test")).rejects.toThrow(/disallowed address/);
      expect(connections).toBe(0);
    });

    it("localhost, from /etc/hosts, when the name server has never heard of it", async () => {
      mockHostsFile = "::1 localhost\n";

      await expect(get("localhost")).rejects.toThrow(/disallowed address/);
    });

    it("an https host resolving internally", async () => {
      nameServer.zone.set("host.test", { A: ["10.0.0.5"] });

      await expect(
        new Promise((_resolve, reject) => {
          https
            .get({ host: "host.test", port, agent: ssrfHttpsAgent })
            .on("error", reject);
        }),
      ).rejects.toThrow(/disallowed address/);
      expect(connections).toBe(0);
    });
  });

  it("still hands back one address when Node asks for one", async () => {
    nameServer.zone.set("dual.test", { A: [PUBLIC_A], AAAA: [PUBLIC_AAAA] });

    const lookup = (options: Parameters<typeof guardedLookup>[1]) =>
      new Promise<unknown[]>((resolve) => {
        guardedLookup("dual.test", options, (...args) => resolve(args));
      });

    await expect(lookup({})).resolves.toEqual([null, PUBLIC_A, 4]);
    await expect(lookup({ family: 6 })).resolves.toEqual([
      null,
      PUBLIC_AAAA,
      6,
    ]);
    await expect(lookup({ all: true })).resolves.toEqual([
      null,
      [
        { address: PUBLIC_A, family: 4 },
        { address: PUBLIC_AAAA, family: 6 },
      ],
    ]);
  });

  it("a request reports a name server that never answers well before its own timeout", async () => {
    nameServer.zone.set("hung.test", NEVER);
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const start = performance.now();
    const result = await executeHttpRequest("GET", `http://hung.test:${port}/`);

    expect(result.error).toContain('Could not resolve host "hung.test"');
    expect(performance.now() - start).toBeLessThan(15_000);
    expect(connections).toBe(0);
    errors.mockRestore();
  });

  describe("assertUrlResolvesPublic", () => {
    it("refuses a host with an internal record in either family", async () => {
      nameServer.zone.set("a.test", { A: [PUBLIC_A], AAAA: ["fd00::5"] });

      await expect(
        assertUrlResolvesPublic("https://a.test/v1"),
      ).rejects.toThrow(/disallowed address/);
    });

    it("passes a public host", async () => {
      nameServer.zone.set("a.test", { A: [PUBLIC_A], AAAA: [PUBLIC_AAAA] });

      await expect(
        assertUrlResolvesPublic("https://a.test/v1"),
      ).resolves.toBeUndefined();
    });

    it("leaves a host it can't get an answer for to the request itself", async () => {
      mockResolverOptions = QUICKLY;
      nameServer.zone.set("hung.test", NEVER);

      await expect(
        assertUrlResolvesPublic("https://hung.test/v1"),
      ).resolves.toBeUndefined();
    });
  });
});
