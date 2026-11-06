/**
 * @jest-environment node
 *
 * resolveHostWithSearch and lookupWithSearch against a real name server on a real socket:
 * only where c-ares sends its queries, and which files it reads, are changed. What matters
 * here is which names get asked for and what happens when a reply doesn't come.
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
let mockResolvConf: string | undefined = "";
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (args[0] === "/etc/hosts") return mockHostsFile;
      if (args[0] === "/etc/resolv.conf") {
        if (mockResolvConf === undefined) throw new Error("ENOENT");
        return mockResolvConf;
      }
      return actual.readFileSync(...args);
    },
  };
});

import crypto from "crypto";
import type { LookupAddress } from "dns";
import { lookupWithSearch, resolveHostWithSearch } from "../resolve-host";
import {
  NEVER,
  startNameServer,
  type FakeNameServer,
} from "./helpers/fake-name-server";

// jest-circus only reads a global testTimeout, and the default of 5 seconds is less than a
// name server that never answers takes to give up on.
jest.setTimeout(60_000);

const IP = "10.0.0.5";
const IP_2 = "10.0.0.6";
const IP6 = "fd00::5";
const KUBERNETES = `nameserver 10.96.0.10
search ns.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
`;

/** c-ares's clock ticks once a second, so these take a second or two, not 6 to 8. */
const QUICKLY = { timeout: 100, tries: 1 };

let nameServer: FakeNameServer;

beforeEach(async () => {
  nameServer = await startNameServer();
  mockNameServerPort = nameServer.port;
  mockResolverOptions = undefined;
  mockHostsFile = "";
  mockResolvConf = "";
});

afterEach(async () => {
  await nameServer.close();
});

const v4 = (address: string) => ({ address, family: 4 });
const v6 = (address: string) => ({ address, family: 6 });
/** Each name asked about, in the order they were first asked about. */
const namesAsked = () => [...new Set(nameServer.queries.map((q) => q.name))];

describe("resolveHostWithSearch", () => {
  describe("which names it asks for, and in what order", () => {
    it.each([
      [
        "Kubernetes, a short name",
        KUBERNETES,
        "db",
        [
          "db.ns.svc.cluster.local",
          "db.svc.cluster.local",
          "db.cluster.local",
          "db",
        ],
      ],
      [
        "Kubernetes, a public name, which has fewer than 5 dots",
        KUBERNETES,
        "db.example.com",
        [
          "db.example.com.ns.svc.cluster.local",
          "db.example.com.svc.cluster.local",
          "db.example.com.cluster.local",
          "db.example.com",
        ],
      ],
      [
        "Kubernetes, a name with enough dots goes first",
        KUBERNETES,
        "a.b.c.d.e.f",
        [
          "a.b.c.d.e.f",
          "a.b.c.d.e.f.ns.svc.cluster.local",
          "a.b.c.d.e.f.svc.cluster.local",
          "a.b.c.d.e.f.cluster.local",
        ],
      ],
      [
        "the default ndots, a short name",
        "search corp.test\n",
        "db",
        ["db.corp.test", "db"],
      ],
      [
        "the default ndots, a name with a dot",
        "search corp.test\n",
        "db.dc1",
        ["db.dc1", "db.dc1.corp.test"],
      ],
      [
        "compose's ndots:0",
        "nameserver 127.0.0.11\nsearch corp.test\noptions ndots:0\n",
        "db",
        ["db", "db.corp.test"],
      ],
      ["no search list", "nameserver 10.0.0.1\n", "db", ["db"]],
      ["an empty file", "", "db", ["db"]],
      ["no file", undefined, "db", ["db"]],
      ["a trailing dot", KUBERNETES, "db.", ["db"]],
      ["`domain`", "domain corp.test\n", "db", ["db.corp.test", "db"]],
      [
        "the last of `search` and `domain`, one way",
        "search a.test\ndomain b.test\n",
        "db",
        ["db.b.test", "db"],
      ],
      [
        "the last of `search` and `domain`, the other way",
        "domain b.test\nsearch a.test\n",
        "db",
        ["db.a.test", "db"],
      ],
      [
        "comments",
        "# search no.test\n; search nor.test\nsearch yes.test # nor.this\n",
        "db",
        ["db.yes.test", "db"],
      ],
      ["`search .`", "search .\n", "db", ["db"]],
      [
        "a search domain with a trailing dot",
        "search corp.test.\n",
        "db",
        ["db.corp.test", "db"],
      ],
      [
        "tabs and extra spaces",
        "search \t a.test   b.test \n",
        "db",
        ["db.a.test", "db.b.test", "db"],
      ],
      [
        "ndots among other options",
        "search a.test\noptions timeout:1 ndots:2 attempts:1\n",
        "x.y",
        ["x.y.a.test", "x.y"],
      ],
      [
        "ndots past the 15 both libraries cap it at",
        "search a.test\noptions ndots:20\n",
        "1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16",
        [
          "1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16",
          "1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.a.test",
        ],
      ],
    ])("%s", async (_what, resolvConf, name, expected) => {
      mockResolvConf = resolvConf;

      await expect(resolveHostWithSearch(name)).resolves.toEqual([]);

      expect(namesAsked()).toEqual(expected);
    });

    it("stops at the first name with an address", async () => {
      mockResolvConf = KUBERNETES;
      nameServer.zone.set("db.svc.cluster.local", { A: [IP] });
      nameServer.zone.set("db.cluster.local", { A: [IP_2] });
      nameServer.zone.set("db", { A: [IP_2] });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP)]);

      expect(namesAsked()).toEqual([
        "db.ns.svc.cluster.local",
        "db.svc.cluster.local",
      ]);
    });

    it("asks for each family of each name once", async () => {
      mockResolvConf = "search corp.test\n";
      nameServer.zone.set("db", { A: [IP] });

      await resolveHostWithSearch("db");

      expect(nameServer.queries).toHaveLength(4);
      expect(nameServer.queries).toEqual(
        expect.arrayContaining([
          { name: "db.corp.test", type: "A" },
          { name: "db.corp.test", type: "AAAA" },
          { name: "db", type: "A" },
          { name: "db", type: "AAAA" },
        ]),
      );
    });

    it("finds a name that's only in the last place it looks", async () => {
      mockResolvConf = KUBERNETES;
      nameServer.zone.set("db.example.com", { A: [IP] });

      await expect(resolveHostWithSearch("db.example.com")).resolves.toEqual([
        v4(IP),
      ]);
    });

    it("sends an international name in its ASCII form, search domain included", async () => {
      mockResolvConf = "search corp.test\n";
      nameServer.zone.set("xn--bcher-kva.corp.test", { A: [IP] });

      await expect(resolveHostWithSearch("bücher")).resolves.toEqual([v4(IP)]);
    });
  });

  describe("when a name has nothing, or the name server can't say", () => {
    it("moves on from a name that doesn't exist", async () => {
      mockResolvConf = "search a.test b.test\n";
      nameServer.zone.set("db.b.test", { A: [IP] });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP)]);
    });

    it("moves on from a name with no addresses, as glibc does", async () => {
      mockResolvConf = "search a.test b.test\n";
      nameServer.zone.set("db.a.test", {});
      nameServer.zone.set("db.b.test", { A: [IP] });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP)]);
    });

    it.each([
      ["fails", "SERVFAIL" as const],
      ["refuses", "REFUSED" as const],
    ])(
      "stops where the name server %s, though a later name would answer",
      async (_what, failure) => {
        mockResolvConf = "search a.test b.test\n";
        nameServer.zone.set("db.a.test", failure);
        nameServer.zone.set("db.b.test", { A: [IP] });

        await expect(resolveHostWithSearch("db")).rejects.toMatchObject({
          code: "EAI_AGAIN",
        });

        expect(namesAsked()).toEqual(["db.a.test"]);
      },
    );

    it("stops where the name server never answers, and doesn't wait for the rest", async () => {
      mockResolverOptions = QUICKLY;
      mockResolvConf = "search a.test b.test\n";
      nameServer.zone.set("db.a.test", NEVER);
      nameServer.zone.set("db.b.test", { A: [IP] });

      await expect(resolveHostWithSearch("db")).rejects.toMatchObject({
        code: "EAI_AGAIN",
      });

      expect(namesAsked()).toEqual(["db.a.test"]);
    });

    it("gives up on a name server that never answers in the time it's meant to", async () => {
      nameServer.zone.set("hung.test", NEVER);

      const started = performance.now();
      await expect(resolveHostWithSearch("hung.test")).rejects.toMatchObject({
        code: "EAI_AGAIN",
        syscall: "getaddrinfo",
        hostname: "hung.test",
      });
      const took = performance.now() - started;

      // 6 to 8 seconds, with room for a loaded machine. Failing here means someone
      // changed the tries or timeouts, which also moves what the PR and docs say.
      expect(took).toBeGreaterThan(5_000);
      expect(took).toBeLessThan(15_000);
    });

    it("gives each name the full time, however fast the ones before it were", async () => {
      // c-ares cuts a server's timeout to about what its recent answers took, once it
      // has seen 3. Four instant "no such name"s on one Resolver would leave this name
      // about a quarter of a second, and it would fail in 2 seconds where getaddrinfo
      // has 5. Recursing to a public name's servers can easily take this long.
      mockResolvConf = "search a.test b.test\noptions ndots:5\n";
      nameServer.zone.set("slow.example.test", { A: [IP], delayMs: 2_000 });

      await expect(resolveHostWithSearch("slow.example.test")).resolves.toEqual(
        [v4(IP)],
      );
    });
  });

  describe("with half an answer", () => {
    it.each([
      [
        "AAAA never answered",
        { A: [IP], AAAA: NEVER as typeof NEVER },
        [v4(IP)],
      ],
      [
        "A never answered",
        { A: NEVER as typeof NEVER, AAAA: [IP6] },
        [v6(IP6)],
      ],
      ["AAAA failed", { A: [IP], AAAA: "SERVFAIL" as const }, [v4(IP)]],
      ["A was refused", { A: "REFUSED" as const, AAAA: [IP6] }, [v6(IP6)]],
    ])("connects to what answered, with %s", async (_what, entry, expected) => {
      mockResolverOptions = QUICKLY;
      nameServer.zone.set("half.test", entry);

      await expect(resolveHostWithSearch("half.test")).resolves.toEqual(
        expected,
      );
    });

    it("doesn't treat one family failing as the name having nothing", async () => {
      mockResolverOptions = QUICKLY;
      mockResolvConf = "search a.test\n";
      nameServer.zone.set("db.a.test", { A: [], AAAA: NEVER });
      nameServer.zone.set("db", { A: [IP] });

      await expect(resolveHostWithSearch("db")).rejects.toMatchObject({
        code: "EAI_AGAIN",
      });
    });
  });

  it("returns both families, IPv4 first", async () => {
    nameServer.zone.set("dual.test", { A: [IP, IP_2], AAAA: [IP6] });

    await expect(resolveHostWithSearch("dual.test")).resolves.toEqual([
      v4(IP),
      v4(IP_2),
      v6(IP6),
    ]);
  });

  describe("and /etc/hosts", () => {
    it("reads it first, and asks no name server", async () => {
      mockResolvConf = KUBERNETES;
      mockHostsFile = `127.0.0.1 localhost\n${IP} db db.local\n`;
      nameServer.zone.set("db", { A: [IP_2] });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP)]);

      expect(nameServer.queries).toEqual([]);
    });

    it("looks for the name as typed, not with a search domain, as libc does", async () => {
      mockResolvConf = "search corp.test\n";
      mockHostsFile = `${IP} db.corp.test\n`;
      nameServer.zone.set("db", { A: [IP_2] });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP_2)]);
    });
  });

  describe("with a name c-ares won't ask about", () => {
    it("says there's nothing", async () => {
      await expect(resolveHostWithSearch("a..b")).resolves.toEqual([]);
      await expect(resolveHostWithSearch("a b")).resolves.toEqual([]);
      await expect(
        resolveHostWithSearch(`${"x".repeat(64)}.test`),
      ).resolves.toEqual([]);
      expect(nameServer.queries).toEqual([]);
    });

    it("skips a search domain that makes the name too long, as musl does", async () => {
      const longName = Array.from({ length: 4 }, () => "y".repeat(60)).join(
        ".",
      );
      mockResolvConf = `search ${"z".repeat(20)}.test\noptions ndots:5\n`;
      nameServer.zone.set(longName, { A: [IP] });

      await expect(resolveHostWithSearch(longName)).resolves.toEqual([v4(IP)]);

      expect(namesAsked()).toEqual([longName]);
    });
  });

  describe("and libuv's thread pool", () => {
    const pbkdf2 = (iterations: number) =>
      new Promise<void>((resolve, reject) => {
        crypto.pbkdf2("x", "y", iterations, 32, "sha512", (error) =>
          error ? reject(error) : resolve(),
        );
      });

    it("searches while every thread is busy", async () => {
      mockResolvConf = KUBERNETES;
      nameServer.zone.set("db.cluster.local", { A: [IP] });
      const order: string[] = [];

      const threads = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
      const busy = Array.from({ length: threads }, () => pbkdf2(2_000_000));
      // Can't start until a thread is free, so it marks the first moment one is.
      const queuedBehindThem = pbkdf2(1).then(() => order.push("pool work"));

      await resolveHostWithSearch("db");
      order.push("lookup");

      await Promise.all([...busy, queuedBehindThem]);
      expect(order).toEqual(["lookup", "pool work"]);
    });

    it("answers for one host however many others never get an answer", async () => {
      mockResolverOptions = QUICKLY;
      mockResolvConf = "search a.test b.test\n";
      nameServer.zone.set("db.b.test", { A: [IP] });
      let settled = 0;
      const hung = Array.from({ length: 50 }, (_, index) => {
        nameServer.zone.set(`host${index}.a.test`, NEVER);
        return resolveHostWithSearch(`host${index}`).then(
          () => (settled += 1),
          () => (settled += 1),
        );
      });

      await expect(resolveHostWithSearch("db")).resolves.toEqual([v4(IP)]);
      expect(settled).toBe(0);

      await Promise.all(hung);
      expect(settled).toBe(50);
    });
  });
});

describe("lookupWithSearch", () => {
  type LookupOptions = Parameters<typeof lookupWithSearch>[1];

  function lookup(hostname: string, options: LookupOptions) {
    return new Promise<{
      error: NodeJS.ErrnoException | null;
      address: string | LookupAddress[];
      family: number | undefined;
    }>((resolve) => {
      lookupWithSearch(hostname, options, (error, address, family) =>
        resolve({ error, address, family }),
      );
    });
  }

  beforeEach(() => {
    nameServer.zone.set("dual.test", { A: [IP], AAAA: [IP6] });
    nameServer.zone.set("v6only.test", { AAAA: [IP6] });
  });

  it("gives every address when asked for all, as net.connect does", async () => {
    await expect(lookup("dual.test", { all: true })).resolves.toMatchObject({
      error: null,
      address: [v4(IP), v6(IP6)],
    });
  });

  it("gives one address and its family when it isn't", async () => {
    await expect(lookup("dual.test", {})).resolves.toEqual({
      error: null,
      address: IP,
      family: 4,
    });
    await expect(lookup("v6only.test", {})).resolves.toEqual({
      error: null,
      address: IP6,
      family: 6,
    });
  });

  it.each([
    ["IPv4 as a number", { family: 4 }, IP, 4],
    ["IPv6 as a number", { family: 6 }, IP6, 6],
    ["IPv4 by name", { family: "IPv4" }, IP, 4],
    ["IPv6 by name", { family: "IPv6" }, IP6, 6],
  ])("keeps to a family: %s", async (_what, options, address, family) => {
    await expect(
      lookup("dual.test", options as LookupOptions),
    ).resolves.toEqual({ error: null, address, family });
  });

  it("keeps to a family when asked for all", async () => {
    await expect(
      lookup("dual.test", { all: true, family: 6 }),
    ).resolves.toMatchObject({ error: null, address: [v6(IP6)] });
  });

  // The same error as dns.lookup's, because ssh.ts reads the message and
  // error-categorization.ts reads the code out of it.
  it("says a name doesn't exist the way dns.lookup does", async () => {
    const { error } = await lookup("nope.test", { all: true });

    expect(error).toMatchObject({
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "nope.test",
      message: "getaddrinfo ENOTFOUND nope.test",
    });
  });

  it("says the same of a family the host doesn't have", async () => {
    const { error } = await lookup("v6only.test", { family: 4 });

    expect(error).toMatchObject({ code: "ENOTFOUND" });
  });

  it("says a name server didn't answer the way dns.lookup does", async () => {
    mockResolverOptions = QUICKLY;
    nameServer.zone.set("hung.test", NEVER);

    const { error } = await lookup("hung.test", { all: true });

    expect(error).toMatchObject({
      code: "EAI_AGAIN",
      syscall: "getaddrinfo",
      hostname: "hung.test",
      message: "getaddrinfo EAI_AGAIN hung.test",
    });
  });
});
