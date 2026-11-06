/**
 * @jest-environment node
 *
 * resolveHost against a real name server on a real socket: only where c-ares sends its
 * queries is changed. The whole point of it is what it does when a reply doesn't come,
 * and a mock can only say what the test already believes about that.
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

let mockHostsFile: (() => string) | undefined;
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      args[0] === "/etc/hosts" && mockHostsFile
        ? mockHostsFile()
        : actual.readFileSync(...args),
  };
});

import crypto from "crypto";
import { resolveHost } from "../resolve-host";
import {
  NEVER,
  startNameServer,
  type FakeNameServer,
} from "./helpers/fake-name-server";

// jest-circus only reads a global testTimeout, and the default of 5 seconds is less
// than a name server that never answers takes to give up on.
jest.setTimeout(60_000);

const PUBLIC_A = "203.0.113.10";
const PUBLIC_AAAA = "2001:db8::10";

/** c-ares's clock ticks once a second, so these take a second or two, not 6 to 8. */
const QUICKLY = { timeout: 100, tries: 1 };

let nameServer: FakeNameServer;

beforeEach(async () => {
  nameServer = await startNameServer();
  mockNameServerPort = nameServer.port;
  mockResolverOptions = undefined;
  mockHostsFile = () => "";
});

afterEach(async () => {
  await nameServer.close();
});

const v4 = (address: string) => ({ address, family: 4 });
const v6 = (address: string) => ({ address, family: 6 });

describe("resolveHost", () => {
  describe("with a name server that answers", () => {
    it("returns both families, IPv4 first", async () => {
      nameServer.zone.set("dual.test", {
        A: [PUBLIC_A, "203.0.113.11"],
        AAAA: [PUBLIC_AAAA],
      });

      await expect(resolveHost("dual.test")).resolves.toEqual([
        v4(PUBLIC_A),
        v4("203.0.113.11"),
        v6(PUBLIC_AAAA),
      ]);
    });

    it("asks for each family once", async () => {
      nameServer.zone.set("dual.test", { A: [PUBLIC_A], AAAA: [PUBLIC_AAAA] });

      await resolveHost("dual.test");

      expect(nameServer.queries).toEqual(
        expect.arrayContaining([
          { name: "dual.test", type: "A" },
          { name: "dual.test", type: "AAAA" },
        ]),
      );
      expect(nameServer.queries).toHaveLength(2);
    });

    it.each([
      ["only A records", { A: [PUBLIC_A] }, [v4(PUBLIC_A)]],
      ["only AAAA records", { AAAA: [PUBLIC_AAAA] }, [v6(PUBLIC_AAAA)]],
      [
        "an alias",
        { CNAME: "target.test", A: [PUBLIC_A], AAAA: [PUBLIC_AAAA] },
        [v4(PUBLIC_A), v6(PUBLIC_AAAA)],
      ],
      [
        "an alias with one family",
        { CNAME: "t.test", A: [PUBLIC_A] },
        [v4(PUBLIC_A)],
      ],
    ])(
      "returns the addresses of a name with %s",
      async (_label, entry, expected) => {
        nameServer.zone.set("name.test", entry);

        await expect(resolveHost("name.test")).resolves.toEqual(expected);
      },
    );

    it("returns nothing for a name that doesn't exist", async () => {
      await expect(resolveHost("nope.test")).resolves.toEqual([]);
    });

    it("returns nothing for a name with no address records", async () => {
      nameServer.zone.set("empty.test", {});

      await expect(resolveHost("empty.test")).resolves.toEqual([]);
    });
  });

  describe("with a name server that can't answer", () => {
    it.each([
      ["refuses", "REFUSED"],
      ["fails", "SERVFAIL"],
    ] as const)("rejects when it %s", async (_label, rcode) => {
      nameServer.zone.set("bad.test", rcode);

      await expect(resolveHost("bad.test")).rejects.toMatchObject({
        code: `E${rcode}`,
      });
    });

    it.each([
      ["IPv6", { A: [PUBLIC_A], AAAA: "SERVFAIL" }],
      ["IPv4", { A: "SERVFAIL", AAAA: [PUBLIC_AAAA] }],
    ] as const)(
      "rejects rather than give half an answer when %s fails",
      async (_label, entry) => {
        nameServer.zone.set("half.test", entry as never);

        await expect(resolveHost("half.test")).rejects.toMatchObject({
          code: "ESERVFAIL",
        });
      },
    );

    it.each([
      ["IPv6", { A: [PUBLIC_A], AAAA: NEVER }],
      ["IPv4", { A: NEVER, AAAA: [PUBLIC_AAAA] }],
    ] as const)(
      "rejects rather than give half an answer when %s never comes",
      async (_label, entry) => {
        mockResolverOptions = QUICKLY;
        nameServer.zone.set("half.test", entry as never);

        await expect(resolveHost("half.test")).rejects.toMatchObject({
          code: "ETIMEOUT",
        });
      },
    );

    it("rejects well inside a request's 30 seconds when no answer ever comes", async () => {
      nameServer.zone.set("hung.test", NEVER);

      const start = performance.now();
      await expect(resolveHost("hung.test")).rejects.toMatchObject({
        code: "ETIMEOUT",
      });

      // Measured at 6 to 8 seconds. c-ares's own default is about 27.
      expect(performance.now() - start).toBeLessThan(15_000);
      // Two tries for each family.
      expect(nameServer.queries).toHaveLength(4);
    });
  });

  describe("and libuv's thread pool", () => {
    it("answers while every thread is busy", async () => {
      nameServer.zone.set("public.test", { A: [PUBLIC_A] });
      const order: string[] = [];
      const pbkdf2 = (iterations: number) =>
        new Promise<void>((resolve, reject) => {
          crypto.pbkdf2("x", "y", iterations, 32, "sha512", (error) =>
            error ? reject(error) : resolve(),
          );
        });

      const threads = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
      const busy = Array.from({ length: threads }, () => pbkdf2(2_000_000));
      // Can't start until a thread is free, so it marks the first moment one is.
      const queuedBehindThem = pbkdf2(1).then(() => order.push("pool work"));

      await resolveHost("public.test");
      order.push("lookup");

      await Promise.all([...busy, queuedBehindThem]);
      expect(order).toEqual(["lookup", "pool work"]);
    });

    it("answers for one host however many others never get an answer", async () => {
      mockResolverOptions = QUICKLY;
      nameServer.zone.set("public.test", { A: [PUBLIC_A] });
      let settled = 0;
      const hung = Array.from({ length: 50 }, (_, index) => {
        nameServer.zone.set(`host${index}.hung.test`, NEVER);
        return resolveHost(`host${index}.hung.test`).then(
          () => (settled += 1),
          () => (settled += 1),
        );
      });

      await expect(resolveHost("public.test")).resolves.toEqual([v4(PUBLIC_A)]);
      expect(settled).toBe(0);

      await Promise.all(hung);
      expect(settled).toBe(50);
    });
  });

  describe("with an /etc/hosts entry", () => {
    const hostsFile = (text: string) => {
      mockHostsFile = () => text;
    };

    it("uses it without asking the name server", async () => {
      hostsFile("203.0.113.40 pinned.test\n");

      await expect(resolveHost("pinned.test")).resolves.toEqual([
        v4("203.0.113.40"),
      ]);
      expect(nameServer.queries).toEqual([]);
    });

    it("prefers it to what the name server would say", async () => {
      hostsFile("203.0.113.40 pinned.test\n");
      nameServer.zone.set("pinned.test", { A: [PUBLIC_A] });

      await expect(resolveHost("pinned.test")).resolves.toEqual([
        v4("203.0.113.40"),
      ]);
    });

    it("returns every line for the name, in both families", async () => {
      hostsFile("203.0.113.40 two.test\n2001:db8::40 two.test\n");

      await expect(resolveHost("two.test")).resolves.toEqual([
        v4("203.0.113.40"),
        v6("2001:db8::40"),
      ]);
    });

    it.each([
      ["an alias on the line", "203.0.113.40 first.test pinned.test last.test"],
      ["tabs between the fields", "203.0.113.40\t\tpinned.test"],
      ["a comment after the name", "203.0.113.40 pinned.test # for the demo"],
      ["leading space", "   203.0.113.40 pinned.test"],
      ["other letter case", "203.0.113.40 PINNED.Test"],
    ])("finds a name with %s", async (_label, line) => {
      hostsFile(`127.0.0.1 localhost\n\n# a comment\n${line}\n`);

      await expect(resolveHost("pinned.test")).resolves.toEqual([
        v4("203.0.113.40"),
      ]);
    });

    it("finds it when the URL has the name in other letter case", async () => {
      hostsFile("203.0.113.40 pinned.test\n");

      await expect(resolveHost("PINNED.TEST")).resolves.toEqual([
        v4("203.0.113.40"),
      ]);
    });

    it("asks the name server for a name with a trailing dot, as getaddrinfo does", async () => {
      hostsFile("203.0.113.40 public.test\n");
      nameServer.zone.set("public.test", { A: [PUBLIC_A] });

      await expect(resolveHost("public.test.")).resolves.toEqual([
        v4(PUBLIC_A),
      ]);
    });

    it.each([
      ["a line for another name", "203.0.113.40 other.test\n"],
      ["a part of a longer name", "203.0.113.40 sub.public.test\n"],
      ["a commented-out line", "# 203.0.113.40 public.test\n"],
      ["a name in a comment", "203.0.113.40 other.test # public.test\n"],
      ["something that isn't an address", "not-an-address public.test\n"],
    ])("asks the name server despite %s", async (_label, text) => {
      hostsFile(text);
      nameServer.zone.set("public.test", { A: [PUBLIC_A] });

      await expect(resolveHost("public.test")).resolves.toEqual([v4(PUBLIC_A)]);
    });

    it("asks the name server when the file can't be read", async () => {
      mockHostsFile = () => {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      };
      nameServer.zone.set("public.test", { A: [PUBLIC_A] });

      await expect(resolveHost("public.test")).resolves.toEqual([v4(PUBLIC_A)]);
    });
  });
});
