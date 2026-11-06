/**
 * How WebhookQueue shares its slots between webhooks and tenants, through the real
 * `triggerEvent`, against real Postgres and real HTTP receivers.
 *
 * Real on purpose: what's under test is how long a delivery holds its slot, and
 * that ends with a socket and a row, not with a promise a mock chooses to settle.
 * One webhook whose receiver took the request and never answered used to hold up
 * every tenant's deliveries, for 30 seconds per five attempts.
 *
 * Most of these hold requests until the test answers them, which stands in for a
 * receiver that doesn't answer without waiting out the timeout. Each checks what a
 * healthy receiver got while requests were held, so none depends on how fast this
 * machine is. The first has a receiver that really never answers.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { asc, eq } from "drizzle-orm";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import {
  MAX_RUNNING_DELIVERIES,
  MAX_RUNNING_PER_OWNER,
  MAX_RUNNING_PER_WEBHOOK,
  WebhookQueue,
} from "@/lib/webhooks/WebhookQueue";
import { db } from "@/server/db";
import { UserRole, UserStatus, webhookDeliveries } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// Deliveries go to real HTTP servers on loopback, which the SSRF guard would
// otherwise refuse. The agent is a real one that doesn't pool, like production's:
// `undefined` would be Node's keep-alive pool, and how long a connection stays
// busy is the point here.
jest.mock("@/lib/ssrf-guard", () => ({
  ...jest.requireActual<object>("@/lib/ssrf-guard"),
  assertRequestUrlIsPublic: () => undefined,
  ssrfHttpAgent: new (jest.requireActual<typeof import("node:http")>(
    "node:http",
  ).Agent)(),
  ssrfHttpsAgent: undefined,
}));

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const EVENT = "order.created";
const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };

/** Well under the 30 seconds a stuck delivery holds its slot for. */
const WITHIN = 15_000;

interface ReceiverOptions {
  /** Keep requests unanswered until `answer` or `stopHolding` is called. */
  holding?: boolean;
  /** Never answer at all. */
  silent?: boolean;
  /** Answer every request with this. */
  status?: number;
  /** Take one request per this many milliseconds, and refuse the rest with a 429. */
  takesOnePer?: number;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server that records what arrives, when, and how many at once. */
async function startReceiver(options: ReceiverOptions = {}) {
  const takenEventIds: string[] = [];
  const arrivals: number[] = [];
  const held: http.ServerResponse[] = [];
  let holding = options.holding ?? false;
  let inFlight = 0;
  let mostInFlight = 0;
  let lastTaken = -Infinity;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      arrivals.push(performance.now());
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      res.on("close", () => inFlight--);

      if (options.silent) return;
      if (options.status !== undefined) {
        res.writeHead(options.status).end("no");
        return;
      }
      if (options.takesOnePer !== undefined) {
        if (performance.now() - lastTaken < options.takesOnePer) {
          res.writeHead(429).end("slow down");
          return;
        }
        lastTaken = performance.now();
      }
      takenEventIds.push((JSON.parse(body) as { id: string }).id);
      if (holding) held.push(res);
      else res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  };
  openReceivers.push(close);

  return {
    url: `http://127.0.0.1:${port}/hook`,
    takenEventIds,
    arrivals,
    get inFlight() {
      return inFlight;
    },
    get mostInFlight() {
      return mostInFlight;
    },
    /** Answer this many of the held requests, oldest first. */
    answer(count: number) {
      for (const res of held.splice(0, count)) res.writeHead(200).end("ok");
    },
    /** Answer everything held, and whatever arrives from now on. */
    stopHolding() {
      holding = false;
      for (const res of held.splice(0)) res.writeHead(200).end("ok");
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, within = WITHIN) {
  const deadline = performance.now() + within;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}`);
    await sleep(10);
  }
}

/** Long enough for a couple of ticks to start anything they were going to. */
const aFewTicks = () => sleep(2_500);

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

/** Wait for this many attempts to be on record. The receiver sees a request
 * slightly before its row is written. */
async function recordedAttempts(
  webhookId: number,
  count: number,
  within = WITHIN,
) {
  const deadline = performance.now() + within;
  for (;;) {
    const rows = await deliveriesOf(webhookId);
    if (rows.length >= count) return rows;
    if (performance.now() > deadline) {
      throw new Error(`Recorded ${rows.length} of ${count} attempts`);
    }
    await sleep(25);
  }
}

const manager = WebhookManager.getInstance();

/** The manager's queue, which each test replaces and waits on. */
const managerQueue = () =>
  (
    manager as unknown as {
      webhookQueue: { queue: Map<string, unknown>; processing: Set<string> };
    }
  ).webhookQueue;

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

const webhookAt = (
  owner: string,
  url: string,
  {
    event = EVENT,
    retryConfig = ONE_ATTEMPT,
  }: {
    event?: string;
    retryConfig?: {
      maxRetries: number;
      retryDelay: number;
      backoffMultiplier: number;
    };
  } = {},
) =>
  manager.registerWebhook(owner, {
    url,
    events: [event],
    active: true,
    retryConfig,
  });

const trigger = (owner: string, times = 1, event = EVENT) =>
  Promise.all(
    Array.from({ length: times }, (_, n) =>
      manager.triggerEvent(event, { n }, owner),
    ),
  );

beforeEach(async () => {
  await resetDatabase();
  // Every slot free, whatever the last test left behind.
  (manager as unknown as { webhookQueue: WebhookQueue }).webhookQueue =
    new WebhookQueue();
});

afterEach(async () => {
  // Nothing from this test may write a row during the next one: ids start again
  // after a reset, so it would land on that test's webhook.
  const queue = managerQueue();
  queue.queue.clear();
  await Promise.all(openReceivers.splice(0).map((close) => close()));
  await until("the queue to stop", () => queue.processing.size === 0);
  queue.queue.clear();
});

afterAll(async () => {
  await closePool();
});

describe("a receiver that never answers", () => {
  it("doesn't hold up another tenant, and its slots come back at the timeout", async () => {
    const hanging = await startReceiver({ silent: true });
    const healthy = await startReceiver();
    const stuckOwner = await tenant();
    const otherOwner = await tenant();
    const stuck = await webhookAt(stuckOwner, hanging.url);
    const other = await webhookAt(otherOwner, healthy.url);

    await trigger(stuckOwner, MAX_RUNNING_PER_WEBHOOK + 1);
    await until(
      "the hanging receiver's requests",
      () => hanging.arrivals.length === MAX_RUNNING_PER_WEBHOOK,
    );

    await trigger(otherOwner);
    const [delivered] = await recordedAttempts(other.id, 1);

    // It got through with none of the stuck deliveries over.
    expect(delivered!.status).toBe("success");
    expect(await deliveriesOf(stuck.id)).toEqual([]);
    expect(hanging.inFlight).toBe(MAX_RUNNING_PER_WEBHOOK);

    // The timeout ends them, and the event waiting behind them goes out.
    const timedOut = await recordedAttempts(
      stuck.id,
      MAX_RUNNING_PER_WEBHOOK,
      45_000,
    );
    expect(timedOut.map(({ status }) => status)).toEqual(
      Array(MAX_RUNNING_PER_WEBHOOK).fill("failed"),
    );
    expect(timedOut[0]!.error).toMatch(/timeout of 30000ms/);
    await until(
      "the event waiting behind them",
      () => hanging.arrivals.length === MAX_RUNNING_PER_WEBHOOK + 1,
    );
    expect(hanging.mostInFlight).toBe(MAX_RUNNING_PER_WEBHOOK);
  });
});

describe("a webhook whose requests are held", () => {
  it("keeps to its limit, and everything queued behind it is delivered once", async () => {
    const receiver = await startReceiver({ holding: true });
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url);
    const events = MAX_RUNNING_PER_WEBHOOK + 3;

    await trigger(owner, events);
    await until(
      "its requests",
      () => receiver.arrivals.length === MAX_RUNNING_PER_WEBHOOK,
    );
    await aFewTicks();
    expect(receiver.arrivals).toHaveLength(MAX_RUNNING_PER_WEBHOOK);

    // A slot coming free goes to the next event.
    receiver.answer(1);
    await until(
      "the next event",
      () => receiver.arrivals.length === MAX_RUNNING_PER_WEBHOOK + 1,
    );

    receiver.stopHolding();
    const rows = await recordedAttempts(webhook.id, events);

    expect(rows.map(({ status }) => status)).toEqual(
      Array(events).fill("success"),
    );
    expect(receiver.takenEventIds).toHaveLength(events);
    expect(new Set(receiver.takenEventIds).size).toBe(events);
    expect(receiver.mostInFlight).toBe(MAX_RUNNING_PER_WEBHOOK);
  });

  it("leaves the tenant's other webhooks alone", async () => {
    const stuckReceiver = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const owner = await tenant();
    const stuck = await webhookAt(owner, stuckReceiver.url, {
      event: "stuck.event",
    });
    const sibling = await webhookAt(owner, healthy.url);

    await trigger(owner, MAX_RUNNING_PER_WEBHOOK * 2, "stuck.event");
    await until(
      "the stuck webhook's requests",
      () => stuckReceiver.arrivals.length === MAX_RUNNING_PER_WEBHOOK,
    );

    await trigger(owner);
    const [delivered] = await recordedAttempts(sibling.id, 1);

    expect(delivered!.status).toBe("success");
    expect(await deliveriesOf(stuck.id)).toEqual([]);
  });
});

describe("a webhook whose attempts fail", () => {
  it("keeps its retries to the limit and gives every slot back", async () => {
    const failing = await startReceiver({ status: 500 });
    const owner = await tenant();
    const webhook = await webhookAt(owner, failing.url, {
      retryConfig: { maxRetries: 2, retryDelay: 100, backoffMultiplier: 1 },
    });
    const events = MAX_RUNNING_PER_WEBHOOK + 2;

    await trigger(owner, events);
    const rows = await recordedAttempts(webhook.id, events * 2, 30_000);

    expect(rows.map(({ status }) => status)).toEqual(
      Array(events * 2).fill("failed"),
    );
    expect(failing.mostInFlight).toBeLessThanOrEqual(MAX_RUNNING_PER_WEBHOOK);
    await until(
      "the last slot to come back",
      () => managerQueue().processing.size === 0,
    );
  });
});

describe("a tenant with many webhooks' requests held", () => {
  it("stops at the tenant's limit, and another tenant still gets through", async () => {
    const stuckReceiver = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const stuckOwner = await tenant();
    const otherOwner = await tenant();
    const webhooks = MAX_RUNNING_PER_OWNER / MAX_RUNNING_PER_WEBHOOK + 1;
    const stuck: Array<{ id: number }> = [];
    for (let i = 0; i < webhooks; i++) {
      stuck.push(await webhookAt(stuckOwner, stuckReceiver.url));
    }
    const other = await webhookAt(otherOwner, healthy.url);
    const events = MAX_RUNNING_PER_WEBHOOK;

    await trigger(stuckOwner, events);
    await until(
      "the tenant's requests",
      () => stuckReceiver.arrivals.length === MAX_RUNNING_PER_OWNER,
    );
    await aFewTicks();
    expect(stuckReceiver.arrivals).toHaveLength(MAX_RUNNING_PER_OWNER);

    await trigger(otherOwner);
    const [delivered] = await recordedAttempts(other.id, 1);
    expect(delivered!.status).toBe("success");

    // What was left out still goes, once there's room.
    stuckReceiver.stopHolding();
    for (const { id } of stuck) await recordedAttempts(id, events);
    expect(stuckReceiver.mostInFlight).toBe(MAX_RUNNING_PER_OWNER);
  });

  it("gives its next slot to its webhook with nothing running, ahead of its backlog", async () => {
    const stuckReceiver = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const owner = await tenant();
    const stuckWebhooks = MAX_RUNNING_PER_OWNER / MAX_RUNNING_PER_WEBHOOK;
    for (let i = 0; i < stuckWebhooks; i++) {
      await webhookAt(owner, stuckReceiver.url, { event: "stuck.event" });
    }
    const sibling = await webhookAt(owner, healthy.url);

    await trigger(owner, MAX_RUNNING_PER_WEBHOOK + 1, "stuck.event");
    await until(
      "the tenant's requests",
      () => stuckReceiver.arrivals.length === MAX_RUNNING_PER_OWNER,
    );

    await trigger(owner);
    await aFewTicks();
    expect(await deliveriesOf(sibling.id)).toEqual([]);

    stuckReceiver.answer(1);
    const [delivered] = await recordedAttempts(sibling.id, 1);
    expect(delivered!.status).toBe("success");

    // Whatever has started since, the sibling went first.
    const firstOfTheBacklog = stuckReceiver.arrivals[MAX_RUNNING_PER_OWNER];
    if (firstOfTheBacklog !== undefined) {
      expect(healthy.arrivals[0]).toBeLessThan(firstOfTheBacklog);
    }
  });
});

describe("every slot held", () => {
  it("gives the next one to a tenant with nothing running, ahead of older backlogs", async () => {
    const stuckReceiver = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const stuckOwners = MAX_RUNNING_DELIVERIES / MAX_RUNNING_PER_OWNER;
    const webhooksEach = MAX_RUNNING_PER_OWNER / MAX_RUNNING_PER_WEBHOOK;

    const owners: string[] = [];
    for (let t = 0; t < stuckOwners; t++) {
      const owner = await tenant();
      owners.push(owner);
      for (let w = 0; w < webhooksEach; w++) {
        await webhookAt(owner, stuckReceiver.url);
      }
    }
    // One more event each than can run, which leaves a backlog older than the
    // quiet tenant's event.
    for (const owner of owners) {
      await trigger(owner, MAX_RUNNING_PER_WEBHOOK + 1);
    }
    await until(
      "every slot held",
      () => stuckReceiver.arrivals.length === MAX_RUNNING_DELIVERIES,
      30_000,
    );

    const quietOwner = await tenant();
    const quiet = await webhookAt(quietOwner, healthy.url);
    await trigger(quietOwner);
    await aFewTicks();
    expect(await deliveriesOf(quiet.id)).toEqual([]);
    expect(stuckReceiver.mostInFlight).toBe(MAX_RUNNING_DELIVERIES);

    stuckReceiver.answer(1);
    const [delivered] = await recordedAttempts(quiet.id, 1);
    expect(delivered!.status).toBe("success");

    // Whatever has started since, the quiet tenant went first.
    const firstOfTheBacklog = stuckReceiver.arrivals[MAX_RUNNING_DELIVERIES];
    if (firstOfTheBacklog !== undefined) {
      expect(healthy.arrivals[0]).toBeLessThan(firstOfTheBacklog);
    }
  });
});

describe("a healthy receiver with a backlog", () => {
  it("doesn't hold up another tenant", async () => {
    const busy = await startReceiver();
    const healthy = await startReceiver();
    const busyOwner = await tenant();
    const otherOwner = await tenant();
    const events = 30;
    await webhookAt(busyOwner, busy.url);
    const other = await webhookAt(otherOwner, healthy.url);

    await trigger(busyOwner, events);
    await trigger(otherOwner);
    await recordedAttempts(other.id, 1);

    expect(busy.arrivals.length).toBeLessThan(events);
  });

  it("goes out slowly enough for a receiver that limits its rate", async () => {
    const limited = await startReceiver({ takesOnePer: 500 });
    const owner = await tenant();
    const events = MAX_RUNNING_PER_WEBHOOK * 2;
    // The defaults, which give an event three attempts within about three seconds
    // of its first. A backlog sent as fast as it's answered would use those up.
    const webhook = await webhookAt(owner, limited.url, {
      retryConfig: { maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2 },
    });

    await trigger(owner, events);
    await until(
      "every event taken",
      () => new Set(limited.takenEventIds).size === events,
      60_000,
    );
    await until(
      "the last attempt to end",
      () => managerQueue().processing.size === 0,
    );

    const rows = await deliveriesOf(webhook.id);
    expect(rows.filter(({ status }) => status === "success")).toHaveLength(
      events,
    );
  });
});
