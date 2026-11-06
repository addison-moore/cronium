/**
 * A webhook at a host whose name server never answers, through the real `triggerEvent`,
 * queue, `processDelivery`, SSRF guard and c-ares, against real Postgres and a real name
 * server on a real socket. Only where c-ares sends its queries is changed.
 *
 * `dns.lookup` holds a thread from libuv's pool for each of these, and only 2 of its 4
 * threads take lookups. Every other delivery's lookup waited behind them, along with
 * the process's own connections to Postgres, and no queue limit can stop a wait that's
 * below the queue. So the healthy delivery here has to finish while all the others are
 * still waiting on their name server.
 */
let mockNameServerPort = 0;
jest.mock("dns/promises", () => {
  const actual =
    jest.requireActual<typeof import("dns/promises")>("dns/promises");
  return {
    ...actual,
    Resolver: class extends actual.Resolver {
      constructor(options?: { timeout?: number; tries?: number }) {
        super(options);
        this.setServers([`127.0.0.1:${mockNameServerPort}`]);
      }
    },
  };
});

// The guard refuses loopback, which is the only place a hermetic test can connect to,
// so this test's receiver is exempted and every other address gets the real check.
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

import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { eq, inArray } from "drizzle-orm";
import {
  NEVER,
  startNameServer,
  type FakeNameServer,
} from "@/lib/__tests__/helpers/fake-name-server";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookQueue } from "@/lib/webhooks/WebhookQueue";
import { db } from "@/server/db";
import { UserRole, UserStatus, webhookDeliveries } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const EVENT = "order.created";
const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };
const WEBHOOKS = 5;
const EVENTS_EACH = 2;
const STUCK_DELIVERIES = WEBHOOKS * EVENTS_EACH;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, within = 30_000) {
  const deadline = performance.now() + within;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}`);
    await sleep(10);
  }
}

const manager = WebhookManager.getInstance();
const managerQueue = () =>
  (
    manager as unknown as {
      webhookQueue: { queue: Map<string, unknown>; processing: Set<string> };
    }
  ).webhookQueue;

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

const webhookAt = (owner: string, url: string) =>
  manager.registerWebhook(owner, {
    url,
    events: [EVENT],
    active: true,
    retryConfig: ONE_ATTEMPT,
  });

const deliveriesOf = (ids: number[]) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, ids));

let nameServer: FakeNameServer;
let receiver: http.Server;
let port: number;
let received: number;

beforeEach(async () => {
  await resetDatabase();
  (manager as unknown as { webhookQueue: WebhookQueue }).webhookQueue =
    new WebhookQueue();
  nameServer = await startNameServer({ "receiver.test": { A: ["127.0.0.1"] } });
  mockNameServerPort = nameServer.port;
  received = 0;
  receiver = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      received += 1;
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  port = (receiver.address() as AddressInfo).port;
});

afterEach(async () => {
  const queue = managerQueue();
  queue.queue.clear();
  await until("the queue to stop", () => queue.processing.size === 0);
  await new Promise((resolve) => {
    receiver.close(resolve);
    receiver.closeAllConnections();
  });
  await nameServer.close();
});

afterAll(async () => {
  await closePool();
});

describe("a host whose name server never answers", () => {
  it("costs only its own deliveries, which fail in good time", async () => {
    const stuckOwner = await tenant();
    const otherOwner = await tenant();
    const stuck: number[] = [];
    for (let index = 0; index < WEBHOOKS; index++) {
      nameServer.zone.set(`stuck${index}.hung.test`, NEVER);
      const { id } = await webhookAt(
        stuckOwner,
        `http://stuck${index}.hung.test:${port}/hook`,
      );
      stuck.push(id);
    }
    const other = await webhookAt(
      otherOwner,
      `http://receiver.test:${port}/hook`,
    );

    const start = performance.now();
    await Promise.all(
      Array.from({ length: EVENTS_EACH }, (_, n) =>
        manager.triggerEvent(EVENT, { n }, stuckOwner),
      ),
    );
    // Every one of them asking, for both families, and nobody answered.
    await until(
      "all their queries",
      () =>
        nameServer.queries.filter(({ name }) => name.endsWith(".hung.test"))
          .length >=
        STUCK_DELIVERIES * 2,
    );

    await manager.triggerEvent(EVENT, { n: "other" }, otherOwner);
    await until("the other tenant's delivery", () => received === 1, 10_000);

    // It got through with all of theirs still waiting.
    expect(await deliveriesOf(stuck)).toEqual([]);
    expect(managerQueue().processing.size).toBeGreaterThanOrEqual(
      STUCK_DELIVERIES,
    );
    await until(
      "the other tenant's row",
      () => managerQueue().processing.size === STUCK_DELIVERIES,
    );
    const [delivered] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, other.id));
    expect(delivered!.status).toBe("success");

    await until(
      "theirs to fail",
      () => managerQueue().processing.size === 0,
      30_000,
    );
    // A receiver gets 30 seconds. A name server shouldn't cost anywhere near that.
    expect(performance.now() - start).toBeLessThan(20_000);

    const failed = await deliveriesOf(stuck);
    expect(failed).toHaveLength(STUCK_DELIVERIES);
    for (const row of failed) {
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(
        /^Could not resolve host "stuck\d\.hung\.test"$/,
      );
    }
    expect(received).toBe(1);
  });
});
