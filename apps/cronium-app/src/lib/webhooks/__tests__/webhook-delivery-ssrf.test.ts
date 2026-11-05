/**
 * @jest-environment node
 *
 * A webhook URL is user-supplied, so delivery has to stay behind the SSRF guard.
 * These go over real sockets to a local server with only DNS stubbed: the guard
 * lives in the agents and in the redirect setting passed to axios, so a suite
 * that mocks axios can't tell whether delivery still uses them.
 */
jest.mock("dns/promises", () => ({ lookup: jest.fn() }));
// Same exemption as ssrf-guard.test.ts: the guard refuses loopback, so a test
// exempts its own server's address and everything else gets the real check.
jest.mock("@/lib/tools/safe-fetch", () => {
  const actual = jest.requireActual<typeof import("@/lib/tools/safe-fetch")>(
    "@/lib/tools/safe-fetch",
  );
  return { ...actual, isDisallowedIp: jest.fn(actual.isDisallowedIp) };
});
jest.mock("@/server/storage", () => ({ storage: {} }));
jest.mock("@/server/db", () => ({
  db: { insert: () => ({ values: async () => [] }) },
}));
jest.mock("../WebhookQueue", () => ({
  WebhookQueue: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../WebhookSecurity", () => ({
  WebhookSecurity: jest
    .fn()
    .mockImplementation(() => ({ generateSignature: () => "signature" })),
}));
jest.mock("nanoid", () => ({ nanoid: () => "delivery-id" }));

import { lookup } from "dns/promises";
import http from "http";
import type { AddressInfo } from "net";
import { WebhookManager } from "../WebhookManager";
import { isDisallowedIp } from "@/lib/tools/safe-fetch";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockIsDisallowedIp = isDisallowedIp as jest.MockedFunction<
  typeof isDisallowedIp
>;
const realIsDisallowedIp = jest.requireActual<
  typeof import("@/lib/tools/safe-fetch")
>("@/lib/tools/safe-fetch").isDisallowedIp;

function resolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })) as never,
  );
}

describe("webhook delivery behind the SSRF guard", () => {
  let server: http.Server;
  let port: number;
  let connections: number;
  let paths: string[];

  const deliver = (url: string) =>
    WebhookManager.getInstance().processDelivery(
      1,
      2,
      url,
      "secret",
      {},
      {
        id: "payload-id",
        event: "test.event",
        timestamp: new Date(0),
        data: {},
      },
    );

  beforeEach(async () => {
    mockLookup.mockReset();
    mockIsDisallowedIp.mockImplementation(realIsDisallowedIp);
    connections = 0;
    paths = [];
    server = http.createServer((req, res) => {
      paths.push(req.url ?? "");
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: `http://public.test:${port}/next` });
        res.end();
        return;
      }
      res.end("received");
    });
    server.on("connection", () => {
      connections += 1;
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });

  it("delivers to a hostname", async () => {
    resolvesTo("127.0.0.1");
    mockIsDisallowedIp.mockImplementation(
      (ip) => ip !== "127.0.0.1" && realIsDisallowedIp(ip),
    );

    const result = await deliver(`http://public.test:${port}/hook`);

    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(paths).toEqual(["/hook"]);
  });

  it.each(["http", "https"])(
    "blocks an %s URL whose host resolves to any internal address",
    async (scheme) => {
      resolvesTo("203.0.113.10", "127.0.0.1");

      const result = await deliver(`${scheme}://public.test:${port}/hook`);

      expect(result.success).toBe(false);
      expect(result.error).toContain("disallowed address");
      expect(connections).toBe(0);
    },
  );

  it("does not follow a redirect", async () => {
    resolvesTo("127.0.0.1");
    mockIsDisallowedIp.mockImplementation(
      (ip) => ip !== "127.0.0.1" && realIsDisallowedIp(ip),
    );

    const result = await deliver(`http://public.test:${port}/redirect`);

    expect(result).toMatchObject({ success: false, statusCode: 302 });
    expect(paths).toEqual(["/redirect"]);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});
