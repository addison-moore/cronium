/**
 * @jest-environment node
 */
// Node environment because the agent tests below open real sockets.
jest.mock("@/lib/resolve-host", () => ({ resolveHost: jest.fn() }));
// The guard rightly refuses loopback, but loopback is the only place a hermetic
// test can connect to. Wrap the real check so a test can exempt its own server's
// address with treatAsPublic(); every other address still gets the real check.
jest.mock("@/lib/tools/safe-fetch", () => {
  const actual = jest.requireActual<typeof import("@/lib/tools/safe-fetch")>(
    "@/lib/tools/safe-fetch",
  );
  return { ...actual, isDisallowedIp: jest.fn(actual.isDisallowedIp) };
});

import axios from "axios";
import type { LookupOptions } from "dns";
import http from "http";
import https from "https";
import net from "net";
import {
  assertRequestUrlIsPublic,
  guardedLookup,
  ssrfHttpAgent,
  ssrfHttpsAgent,
} from "../ssrf-guard";
import { executeHttpRequest } from "../scheduler/http-executor";
import { resolveHost } from "@/lib/resolve-host";
import { isDisallowedIp, SsrfBlockedError } from "@/lib/tools/safe-fetch";

const mockResolveHost = resolveHost as jest.MockedFunction<typeof resolveHost>;
const mockIsDisallowedIp = isDisallowedIp as jest.MockedFunction<
  typeof isDisallowedIp
>;
const realIsDisallowedIp = jest.requireActual<
  typeof import("@/lib/tools/safe-fetch")
>("@/lib/tools/safe-fetch").isDisallowedIp;

const records = (addresses: string[]) =>
  addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));

function resolvesTo(...addresses: string[]) {
  mockResolveHost.mockResolvedValue(records(addresses));
}

function treatAsPublic(...exempt: string[]) {
  mockIsDisallowedIp.mockImplementation(
    (ip) => !exempt.includes(ip) && realIsDisallowedIp(ip),
  );
}

beforeEach(() => {
  mockResolveHost.mockReset();
  mockIsDisallowedIp.mockImplementation(realIsDisallowedIp);
});

describe("ssrf-guard", () => {
  describe("assertRequestUrlIsPublic", () => {
    it("allows public http/https URLs (hostname validated later at connect time)", () => {
      expect(() =>
        assertRequestUrlIsPublic("https://api.example.com/v1/data"),
      ).not.toThrow();
      expect(() =>
        assertRequestUrlIsPublic("http://example.com"),
      ).not.toThrow();
    });

    it("rejects the cloud metadata IP literal", () => {
      expect(() =>
        assertRequestUrlIsPublic(
          "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        ),
      ).toThrow(SsrfBlockedError);
    });

    it("rejects localhost and RFC1918 IP literals", () => {
      expect(() => assertRequestUrlIsPublic("http://127.0.0.1:5001")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://10.0.0.5")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://192.168.1.1")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://[::1]/")).toThrow(
        SsrfBlockedError,
      );
    });

    it("rejects non-http(s) schemes", () => {
      expect(() => assertRequestUrlIsPublic("file:///etc/passwd")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("gopher://internal:70/")).toThrow(
        SsrfBlockedError,
      );
    });

    it("rejects malformed URLs", () => {
      expect(() => assertRequestUrlIsPublic("not a url")).toThrow(
        SsrfBlockedError,
      );
    });
  });

  describe("guardedLookup", () => {
    // What Node's net module would receive from the lookup callback.
    const callLookup = (options: LookupOptions) =>
      new Promise<{
        err: NodeJS.ErrnoException | null;
        address: unknown;
        family: unknown;
      }>((resolve) => {
        guardedLookup("host.test", options, (err, address, family) => {
          resolve({ err, address, family });
        });
      });

    it("returns every address as an array when called with all: true", async () => {
      const addresses = ["203.0.113.10", "2001:db8::10", "203.0.113.11"];
      resolvesTo(...addresses);

      const { err, address } = await callLookup({ all: true });

      expect(err).toBeNull();
      expect(address).toEqual(records(addresses));
    });

    it("returns one address and its family when called without all", async () => {
      resolvesTo("203.0.113.10", "203.0.113.11");

      await expect(callLookup({})).resolves.toEqual({
        err: null,
        address: "203.0.113.10",
        family: 4,
      });
    });

    it.each<[string, LookupOptions["family"], LookupOptions["family"]]>([
      ["numbers", 4, 6],
      ["the legacy strings", "IPv4", "IPv6"],
    ])(
      "applies a family filter in both forms, given as %s",
      async (_label, v4, v6) => {
        resolvesTo("2001:db8::10", "203.0.113.10");

        const all = await callLookup({ all: true, family: v4 });
        expect(all.address).toEqual(records(["203.0.113.10"]));

        const single = await callLookup({ family: v6 });
        expect(single.address).toBe("2001:db8::10");
        expect(single.family).toBe(6);
      },
    );

    describe.each<[string, LookupOptions]>([
      ["all: true", { all: true }],
      ["a single address", {}],
    ])("asked for %s", (_form, options) => {
      it.each([
        ["only an internal address", ["169.254.169.254"]],
        [
          "a public address, then an internal one",
          ["203.0.113.10", "10.0.0.5"],
        ],
        [
          "an internal address, then a public one",
          ["10.0.0.5", "203.0.113.10"],
        ],
        ["a public IPv4 and an internal IPv6", ["203.0.113.10", "::1"]],
        ["an IPv4-mapped internal address", ["::ffff:127.0.0.1"]],
      ])("blocks a host resolving to %s", async (_label, addresses) => {
        resolvesTo(...addresses);

        const { err, address } = await callLookup(options);

        expect(err).toBeInstanceOf(SsrfBlockedError);
        expect(err?.message).toContain("disallowed address");
        expect(address).toBe("");
      });

      it("blocks an internal address even when a family filter would drop it", async () => {
        resolvesTo("203.0.113.10", "::1");

        const { err } = await callLookup({ ...options, family: 4 });

        expect(err).toBeInstanceOf(SsrfBlockedError);
      });

      it("errors rather than returning nothing when no address matches", async () => {
        // Node destructures addresses[0], so an empty array would throw there.
        resolvesTo("203.0.113.10");

        const { err } = await callLookup({ ...options, family: 6 });

        expect(err).toBeInstanceOf(SsrfBlockedError);
      });

      it("errors when DNS resolution fails", async () => {
        mockResolveHost.mockRejectedValue(new Error("ETIMEOUT"));

        const { err } = await callLookup(options);

        expect(err).toBeInstanceOf(SsrfBlockedError);
      });
    });
  });

  // The agents have to work with Node's real net module, which is what calls
  // the lookup and rejects the wrong callback shape. Mocked agents can't catch
  // that, so these requests go over real sockets to a local server, with only
  // DNS stubbed. Internal addresses in these tests stay on loopback so that a
  // regression shows up as a connection here, not as traffic to a real host.
  describe("over real sockets", () => {
    let server: http.Server;
    let port: number;
    let connections: number;
    let paths: string[];

    beforeEach(async () => {
      connections = 0;
      paths = [];
      server = http.createServer((req, res) => {
        paths.push(req.url ?? "");
        if (req.url === "/redirect") {
          res.writeHead(302, {
            Location: `http://internal.test:${port}/secret`,
          });
          res.end();
          return;
        }
        res.end("hello");
      });
      server.on("connection", () => {
        connections += 1;
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      port = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    });

    const get = (
      options: http.RequestOptions & { autoSelectFamily?: boolean } = {},
    ) =>
      new Promise<{
        status?: number;
        body: string;
        attempted?: string[];
      }>((resolve, reject) => {
        http
          .get(
            { host: "public.test", port, agent: ssrfHttpAgent, ...options },
            (res) => {
              const attempted = (res.socket as net.Socket)
                .autoSelectFamilyAttemptedAddresses;
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk: string) => {
                body += chunk;
              });
              res.on("end", () => {
                resolve({ status: res.statusCode, body, attempted });
              });
            },
          )
          .on("error", reject);
      });

    describe("ssrfHttpAgent", () => {
      it("completes a request to a hostname when Node asks for all addresses", async () => {
        // The default since Node 20, and what makes http.Agent pass all: true.
        expect(net.getDefaultAutoSelectFamily()).toBe(true);
        resolvesTo("127.0.0.1");
        treatAsPublic("127.0.0.1");

        await expect(get()).resolves.toMatchObject({
          status: 200,
          body: "hello",
        });
      });

      it("hands Node every address so it can fall back from a dead one", async () => {
        // Nothing listens on ::1, so a response can only come from the second
        // address, and only if the lookup returned both.
        resolvesTo("::1", "127.0.0.1");
        treatAsPublic("::1", "127.0.0.1");

        const response = await get();

        expect(response).toMatchObject({ status: 200, body: "hello" });
        expect(response.attempted).toEqual([
          `::1:${port}`,
          `127.0.0.1:${port}`,
        ]);
      });

      it.each([
        ["family: 4", { family: 4 }],
        ["autoSelectFamily: false", { autoSelectFamily: false }],
      ])(
        "still works when Node asks for a single address (%s)",
        async (_label, options) => {
          resolvesTo("127.0.0.1");
          treatAsPublic("127.0.0.1");

          await expect(get(options)).resolves.toMatchObject({
            status: 200,
            body: "hello",
          });
        },
      );

      it.each([
        ["only an internal address", ["127.0.0.1"]],
        [
          "a public address, then an internal one",
          ["203.0.113.10", "127.0.0.1"],
        ],
        [
          "an internal address, then a public one",
          ["127.0.0.1", "203.0.113.10"],
        ],
        ["a public IPv4 and an internal IPv6", ["203.0.113.10", "::1"]],
      ])("blocks a host resolving to %s", async (_label, addresses) => {
        resolvesTo(...addresses);

        await expect(get()).rejects.toThrow(SsrfBlockedError);
        expect(connections).toBe(0);
      });

      it("blocks an internal host when Node asks for a single address", async () => {
        resolvesTo("127.0.0.1");

        await expect(get({ family: 4 })).rejects.toThrow(SsrfBlockedError);
        expect(connections).toBe(0);
      });
    });

    describe("ssrfHttpsAgent", () => {
      let tlsServer: net.Server;
      let tlsPort: number;
      let tlsConnections: number;
      let firstByte: Promise<number | undefined>;

      beforeEach(async () => {
        tlsConnections = 0;
        // A plain TCP server is enough: what's under test is the connect that
        // precedes TLS, and seeing a ClientHello means it succeeded.
        tlsServer = net.createServer();
        firstByte = new Promise((resolve) => {
          tlsServer.on("connection", (socket) => {
            tlsConnections += 1;
            socket.on("error", () => undefined);
            socket.once("data", (chunk: Buffer) => {
              resolve(chunk[0]);
              socket.destroy();
            });
          });
        });
        await new Promise<void>((resolve) => {
          tlsServer.listen(0, "127.0.0.1", resolve);
        });
        tlsPort = (tlsServer.address() as net.AddressInfo).port;
      });

      afterEach(async () => {
        await new Promise((resolve) => {
          tlsServer.close(resolve);
        });
      });

      const requestFailure = () =>
        new Promise<never>((_resolve, reject) => {
          https
            .get({
              host: "public.test",
              port: tlsPort,
              agent: ssrfHttpsAgent,
            })
            .on("error", reject);
        });

      it("reaches the TLS handshake with a hostname when Node asks for all addresses", async () => {
        resolvesTo("127.0.0.1");
        treatAsPublic("127.0.0.1");

        const TLS_HANDSHAKE_RECORD = 0x16;
        await expect(Promise.race([firstByte, requestFailure()])).resolves.toBe(
          TLS_HANDSHAKE_RECORD,
        );
      });

      it("blocks a host resolving to any internal address", async () => {
        resolvesTo("203.0.113.10", "127.0.0.1");

        await expect(requestFailure()).rejects.toThrow(SsrfBlockedError);
        expect(tlsConnections).toBe(0);
      });
    });

    // The path HTTP_REQUEST events take, which http-executor.test.ts mocks out.
    describe("through executeHttpRequest", () => {
      let errorSpy: jest.SpyInstance;

      beforeEach(() => {
        errorSpy = jest
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
      });

      afterEach(() => {
        errorSpy.mockRestore();
      });

      it("succeeds against a hostname", async () => {
        resolvesTo("127.0.0.1");
        treatAsPublic("127.0.0.1");

        const result = await executeHttpRequest(
          "GET",
          `http://public.test:${port}/`,
        );

        expect(result.error).toBeUndefined();
        expect(result.data).toMatchObject({ status: 200, body: "hello" });
      });

      it("reports a block for a host resolving to any internal address", async () => {
        resolvesTo("203.0.113.10", "127.0.0.1");

        const result = await executeHttpRequest(
          "GET",
          `http://public.test:${port}/`,
        );

        expect(result.error).toContain("disallowed address");
        expect(connections).toBe(0);
      });

      it("does not follow a redirect", async () => {
        resolvesTo("127.0.0.1");
        treatAsPublic("127.0.0.1");

        const result = await executeHttpRequest(
          "GET",
          `http://public.test:${port}/redirect`,
        );

        expect(result.data?.status).toBe(302);
        expect(paths).toEqual(["/redirect"]);
        expect(mockResolveHost).toHaveBeenCalledTimes(1);
      });
    });

    it("re-validates a redirect hop if a client does follow redirects", async () => {
      mockResolveHost.mockImplementation(async (hostname) =>
        records(
          hostname === "public.test" ? ["127.0.0.1"] : ["203.0.113.10", "::1"],
        ),
      );
      treatAsPublic("127.0.0.1");

      await expect(
        axios.get(`http://public.test:${port}/redirect`, {
          httpAgent: ssrfHttpAgent,
          httpsAgent: ssrfHttpsAgent,
          proxy: false,
          maxRedirects: 5,
        }),
      ).rejects.toThrow(/resolves to a disallowed address/);

      expect(mockResolveHost).toHaveBeenCalledWith("internal.test");
      expect(paths).toEqual(["/redirect"]);
    });
  });

  describe("isDisallowedIp", () => {
    it("blocks internal ranges", () => {
      expect(isDisallowedIp("169.254.169.254")).toBe(true); // metadata
      expect(isDisallowedIp("127.0.0.1")).toBe(true); // loopback
      expect(isDisallowedIp("10.1.2.3")).toBe(true); // private
      expect(isDisallowedIp("172.16.0.1")).toBe(true); // private
      expect(isDisallowedIp("192.168.0.1")).toBe(true); // private
      expect(isDisallowedIp("100.64.0.1")).toBe(true); // CGNAT
      expect(isDisallowedIp("::1")).toBe(true); // ipv6 loopback
      expect(isDisallowedIp("fd00::1")).toBe(true); // ipv6 ULA
    });

    it("allows public addresses", () => {
      expect(isDisallowedIp("8.8.8.8")).toBe(false);
      expect(isDisallowedIp("1.1.1.1")).toBe(false);
      expect(isDisallowedIp("93.184.216.34")).toBe(false); // example.com
    });

    it("blocks an ipv4-mapped ipv6 pointing at an internal address", () => {
      expect(isDisallowedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:169.254.169.254")).toBe(true);
    });

    // The form that matters: URL parsing serializes mapped addresses in hex, so
    // the dotted spellings above are never what reaches the guard from a URL.
    it.each([
      ["::ffff:7f00:1", "127.0.0.1 mapped, hex"],
      ["::ffff:a9fe:a9fe", "169.254.169.254 mapped, hex"],
      ["0:0:0:0:0:ffff:a00:1", "10.0.0.1 mapped, uncompressed"],
      ["::7f00:1", "127.0.0.1 IPv4-compatible"],
      ["::ffff:0:a9fe:a9fe", "169.254.169.254 translated"],
      ["64:ff9b::a9fe:a9fe", "169.254.169.254 via NAT64"],
      ["64:ff9b:1::1", "local-use NAT64"],
      ["2002:7f00:1::", "127.0.0.1 via 6to4"],
      ["2002:a9fe:a9fe::1", "169.254.169.254 via 6to4"],
      ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo"],
      ["::", "unspecified"],
      ["0:0:0:0:0:0:0:1", "loopback, uncompressed"],
      ["fe80::1", "link-local"],
      ["febf::1", "link-local, top of the /10"],
      ["fe80::1%eth0", "link-local with a zone id"],
      ["fec0::1", "site-local"],
      ["fc00::1", "ULA, low half of the /7"],
      ["fdff::1", "ULA, high half of the /7"],
      ["ff02::1", "multicast"],
      ["100::1", "discard"],
    ])("blocks %s (%s)", (address) => {
      expect(isDisallowedIp(address)).toBe(true);
    });

    it.each([
      ["2606:4700:4700::1111", "Cloudflare DNS"],
      ["2001:4860:4860::8888", "Google DNS"],
      ["::ffff:808:808", "8.8.8.8 mapped"],
      ["64:ff9b::808:808", "8.8.8.8 via NAT64"],
      ["2002:808:808::1", "8.8.8.8 via 6to4"],
    ])("allows public %s (%s)", (address) => {
      expect(isDisallowedIp(address)).toBe(false);
    });

    it("treats anything that is not an IP literal as disallowed", () => {
      expect(isDisallowedIp("not-an-ip")).toBe(true);
      expect(isDisallowedIp("")).toBe(true);
    });
  });

  describe("assertRequestUrlIsPublic with IPv6 spellings of internal hosts", () => {
    it.each([
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:127.0.0.1]:5001/api",
      "http://[0:0:0:0:0:ffff:7f00:1]/",
      "http://[::ffff:a00:1]/",
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[2002:a9fe:a9fe::1]/",
    ])("rejects %s", (url) => {
      expect(() => assertRequestUrlIsPublic(url)).toThrow(SsrfBlockedError);
    });

    it("rejects IPv4 spellings the URL parser normalizes", () => {
      for (const url of [
        "http://2130706433/", // decimal 127.0.0.1
        "http://0x7f.0.0.1/", // hex
        "http://017700000001/", // octal
        "http://127.1/", // short form
      ]) {
        expect(() => assertRequestUrlIsPublic(url)).toThrow(SsrfBlockedError);
      }
    });
  });
});
