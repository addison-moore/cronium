/**
 * @jest-environment node
 *
 * A proxy set in the environment must not take a guarded request. axios would
 * connect to the proxy rather than the target, and the proxy would resolve the
 * target itself, so guardedLookup would never run and a host resolving to an
 * internal address would be reached through the proxy.
 *
 * Each sender below is a real call path, over real sockets with only DNS stubbed:
 * a suite that mocks axios can't see where the connection goes.
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
jest.mock("../webhooks/WebhookQueue", () => ({
  WebhookQueue: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../webhooks/WebhookSecurity", () => ({
  WebhookSecurity: jest.fn().mockImplementation(() => ({
    generateSignature: () => "signature",
    generateDeliverySignature: () => "signature-v2",
  })),
}));
jest.mock("nanoid", () => ({ nanoid: () => "delivery-id" }));

import { lookup } from "dns/promises";
import http from "http";
import type { AddressInfo } from "net";
import { executeHttpRequest } from "../scheduler/http-executor";
import { ssrfGuardedFetch } from "../ssrf-guard";
import { WebhookManager } from "../webhooks/WebhookManager";
import { isDisallowedIp } from "@/lib/tools/safe-fetch";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockIsDisallowedIp = isDisallowedIp as jest.MockedFunction<
  typeof isDisallowedIp
>;
const realIsDisallowedIp = jest.requireActual<
  typeof import("@/lib/tools/safe-fetch")
>("@/lib/tools/safe-fetch").isDisallowedIp;

type Outcome = { status?: number; error?: string };

const senders: Array<[string, (url: string) => Promise<Outcome>]> = [
  [
    "executeHttpRequest",
    async (url) => {
      const { data, error } = await executeHttpRequest("GET", url);
      return { status: data?.status, error };
    },
  ],
  [
    "webhook delivery",
    async (url) => {
      const { statusCode, error } =
        await WebhookManager.getInstance().processDelivery(
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
      return { status: statusCode, error };
    },
  ],
  [
    "ssrfGuardedFetch",
    async (url) => {
      try {
        return { status: (await ssrfGuardedFetch(url)).status };
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  ],
];

describe("guarded requests with a proxy in the environment", () => {
  let target: http.Server;
  let proxy: http.Server;
  let targetPort: number;
  let targetConnections: number;
  let proxyConnections: number;
  let savedEnv: NodeJS.ProcessEnv;
  let errorSpy: jest.SpyInstance;

  const listen = async (server: http.Server) => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    return (server.address() as AddressInfo).port;
  };

  const close = (server: http.Server) =>
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });

  beforeEach(async () => {
    mockLookup.mockReset();
    mockIsDisallowedIp.mockImplementation(realIsDisallowedIp);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    targetConnections = 0;
    proxyConnections = 0;
    target = http.createServer((_req, res) => {
      res.end("from the target");
    });
    target.on("connection", () => {
      targetConnections += 1;
    });
    proxy = http.createServer((_req, res) => {
      res.end("from the proxy");
    });
    proxy.on("connection", () => {
      proxyConnections += 1;
    });
    // How axios reaches an https target through a proxy. It needs an answer: its
    // tunnel agent waits forever on a closed socket, and a regression should fail
    // on the assertions below, not on a test timeout.
    proxy.on("connect", (_req, socket) => {
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    targetPort = await listen(target);
    const proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;

    // Both spellings, because lowercase wins and a developer's shell may set it.
    savedEnv = process.env;
    process.env = {
      ...savedEnv,
      http_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      no_proxy: "",
      NO_PROXY: "",
    };
  });

  afterEach(async () => {
    process.env = savedEnv;
    errorSpy.mockRestore();
    await Promise.all([close(target), close(proxy)]);
  });

  describe.each(senders)("%s", (_name, send) => {
    it("connects to the target itself, through the guard", async () => {
      mockLookup.mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ] as never);
      mockIsDisallowedIp.mockImplementation(
        (ip) => ip !== "127.0.0.1" && realIsDisallowedIp(ip),
      );

      const { status, error } = await send(`http://public.test:${targetPort}/`);

      expect(proxyConnections).toBe(0);
      expect(mockLookup).toHaveBeenCalledWith("public.test", expect.anything());
      expect(targetConnections).toBe(1);
      expect(error).toBeUndefined();
      expect(status).toBe(200);
    });

    it.each(["http", "https"])(
      "refuses an %s host resolving internally instead of handing it to the proxy",
      async (scheme) => {
        mockLookup.mockResolvedValue([
          { address: "127.0.0.1", family: 4 },
        ] as never);

        const { error } = await send(
          `${scheme}://internal.test:${targetPort}/`,
        );

        expect(proxyConnections).toBe(0);
        expect(targetConnections).toBe(0);
        expect(error).toContain("disallowed address");
      },
    );
  });
});
