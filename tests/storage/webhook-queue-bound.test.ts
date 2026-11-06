/**
 * What WebhookQueue does when what it holds reaches a limit, through the real inbound
 * route and the real queue, against real Postgres and real HTTP receivers.
 *
 * Real on purpose: what's under test is how much a process holds for a receiver that
 * doesn't answer, what a sender is told, how many requests reach a receiver, and which
 * rows are left to retry from. Nothing used to bound that: 60 events of 6 MiB to a hung
 * receiver took the heap from 54 MB to 442 MB, and 30 requests of 1 MB holding nothing
 * but `{}` took it to 702 MB, all of them answered with a success.
 *
 * Most of these hold requests until the test answers them, which stands in for a
 * receiver that doesn't answer without waiting out the timeout.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import vm from "node:vm";
import { asc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as postToInboundRoute } from "@/app/api/webhooks/[key]/route";
import {
  NOT_QUEUED_MESSAGE,
  WebhookQueueFullError,
} from "@/lib/webhooks/webhook-errors";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import {
  MAX_HELD_BYTES,
  MAX_HELD_BYTES_PER_OWNER,
  MAX_HELD_BYTES_PER_WEBHOOK,
  MAX_RUNNING_PER_WEBHOOK,
  WebhookQueue,
} from "@/lib/webhooks/WebhookQueue";
import { db, pool } from "@/server/db";
import {
  UserRole,
  UserStatus,
  webhookDeliveries,
  webhookEvents,
  webhookLogs,
  webhooks,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// Deliveries go to real HTTP servers on loopback, which the SSRF guard would
// otherwise refuse. The agent is a real one that doesn't pool, like production's.
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
jest.setTimeout(240_000);

const MiB = 1024 * 1024;
// MAX_WEBHOOK_BODY_BYTES in WebhookRouter.
const INBOUND_CAP_BYTES = 1024 * 1024;

const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };

interface SentEvent {
  contentType: string;
  body: string;
  /** What the request says the event is called. */
  event?: string;
}

const EVENT = "order.created";

/**
 * The longest event one request can make: in plain text `"` becomes `&quot;`, so its
 * delivery has a body of a little over 6 MiB.
 */
const LONG_EVENT: SentEvent = {
  contentType: "text/plain",
  body: '"'.repeat(INBOUND_CAP_BYTES),
};
const LONG_EVENT_BYTES = 6 * MiB;
const LONG_EVENTS_PER_WEBHOOK = Math.floor(
  MAX_HELD_BYTES_PER_WEBHOOK / LONG_EVENT_BYTES,
);

/** Short enough to fit in whatever long events leave. */
const SHORT_EVENT: SentEvent = {
  contentType: "application/json",
  body: JSON.stringify({ order: 1 }),
};

const WEBHOOKS_FILLING_A_TENANT =
  MAX_HELD_BYTES_PER_OWNER / MAX_HELD_BYTES_PER_WEBHOOK;
const TENANTS_FILLING_THE_QUEUE = MAX_HELD_BYTES / MAX_HELD_BYTES_PER_OWNER;

/** Well under the 30 seconds a stuck delivery holds its slot for. */
const WITHIN = 20_000;

interface ReceiverOptions {
  /** Keep requests unanswered until `stopHolding` is called. */
  holding?: boolean;
  /** Answer every request with this until `recover` is called. */
  failingWith?: number;
  /** Never answer at all. */
  silent?: boolean;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server that records what arrives. It reads every body to its end. */
async function startReceiver(options: ReceiverOptions = {}) {
  const takenEventIds: string[] = [];
  const held: http.ServerResponse[] = [];
  let holding = options.holding ?? false;
  let failingWith = options.failingWith;
  let requests = 0;

  const server = http.createServer((req, res) => {
    let start = "";
    req.on("data", (chunk: Buffer) => {
      if (start.length < 64) start += chunk.subarray(0, 64).toString();
    });
    req.on("end", () => {
      requests++;
      if (options.silent) return;
      if (failingWith !== undefined) {
        res.writeHead(failingWith).end("no");
        return;
      }
      takenEventIds.push(/"id":"(\d+)"/.exec(start)![1]!);
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
    get requests() {
      return requests;
    },
    /** Answer everything held, and whatever arrives from now on. */
    stopHolding() {
      holding = false;
      for (const res of held.splice(0)) res.writeHead(200).end("ok");
    },
    /** Take whatever arrives from now on. */
    recover() {
      failingWith = undefined;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
  within = WITHIN,
) {
  const deadline = performance.now() + within;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}`);
    await sleep(25);
  }
}

/** Long enough for a couple of ticks to start anything they were going to. */
const aFewTicks = () => sleep(2_500);

const manager = WebhookManager.getInstance();

/** The manager's queue, which each test replaces and waits on. */
const managerQueue = () =>
  (
    manager as unknown as {
      webhookQueue: { queue: Map<string, unknown>; processing: Set<string> };
    }
  ).webhookQueue;

const queueFinished = () =>
  until(
    "the queue to finish",
    () =>
      managerQueue().queue.size === 0 && managerQueue().processing.size === 0,
  );

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

const statusesOf = async (webhookId: number) =>
  (await deliveriesOf(webhookId)).map(({ status }) => status);

const logsOf = (webhookId: number) =>
  db.select().from(webhookLogs).where(eq(webhookLogs.webhookId, webhookId));

async function eventsStored(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEvents);
  return row!.count;
}

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

type Webhook = Awaited<ReturnType<typeof webhookAt>>;

async function webhookAt(
  owner: string,
  url: string,
  {
    events = [`webhook.${EVENT}`],
    retryConfig = ONE_ATTEMPT,
  }: {
    events?: string[];
    retryConfig?: {
      maxRetries: number;
      retryDelay: number;
      backoffMultiplier: number;
    };
  } = {},
) {
  const webhook = await manager.registerWebhook(owner, {
    url,
    events,
    active: true,
    retryConfig,
  });
  // Webhook ids start again after each reset, and the rate limit's window doesn't, so
  // the default of 100 a minute would be shared across tests.
  await db
    .update(webhooks)
    .set({ rateLimit: { requests: 1_000_000, window: 60_000 } })
    .where(eq(webhooks.id, webhook.id));
  return webhook;
}

/** A sender signing the way the docs tell it to, through the real route. */
async function send(
  { key, secret }: { key: string; secret: string },
  { contentType, body, event = EVENT }: SentEvent,
  deliveryId: string = randomUUID(),
) {
  const timestamp = new Date().toISOString();
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest("hex");
  const response = await postToInboundRoute(
    new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-webhook-event": event,
        "x-webhook-signature": `sha256=${digest}`,
        "x-webhook-timestamp": timestamp,
        "x-webhook-delivery-id": deliveryId,
      },
      body,
    }),
    { params: Promise.resolve({ key }) },
  );
  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    answer: (await response.json()) as { success?: true; error?: string },
  };
}

/** Take a webhook as close to its limit as long events go. */
async function fill(webhook: Webhook, event?: string) {
  for (let n = 0; n < LONG_EVENTS_PER_WEBHOOK; n++) {
    const { status } = await send(webhook, {
      ...LONG_EVENT,
      ...(event !== undefined && { event }),
    });
    expect(status).toBe(200);
  }
}

beforeEach(async () => {
  await resetDatabase();
  // Nothing held, whatever the last test left behind.
  (manager as unknown as { webhookQueue: WebhookQueue }).webhookQueue =
    new WebhookQueue();
  jest.spyOn(console, "warn").mockImplementation();
});

afterEach(async () => {
  jest.restoreAllMocks();
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

describe("a webhook whose receiver really never answers", () => {
  it("gets its room back when the last attempts time out, and only then", async () => {
    const receiver = await startReceiver({ silent: true });
    const webhook = await webhookAt(await tenant(), receiver.url);

    await fill(webhook);
    expect((await send(webhook, LONG_EVENT)).status).toBe(503);

    await until(
      "the attempts to time out",
      async () =>
        (await deliveriesOf(webhook.id)).length === LONG_EVENTS_PER_WEBHOOK,
      45_000,
    );
    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ status }) => status)).toEqual(
      Array(LONG_EVENTS_PER_WEBHOOK).fill("failed"),
    );
    expect(rows[0]!.error).toMatch(/timeout of 30000ms/);
    expect(receiver.requests).toBe(LONG_EVENTS_PER_WEBHOOK);

    expect((await send(webhook, LONG_EVENT)).status).toBe(200);
    await until(
      "the event that's been let in",
      () => receiver.requests === LONG_EVENTS_PER_WEBHOOK + 1,
    );
  });
});

describe("a webhook whose receiver doesn't answer", () => {
  it("takes what fits, and refuses the rest with a 503 and nothing stored", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);

    await fill(webhook);
    // The endpoint's own row and the one its deliveries go out on, for each.
    expect(await eventsStored()).toBe(2 * LONG_EVENTS_PER_WEBHOOK);

    const refused = await send(webhook, LONG_EVENT);

    expect(refused.status).toBe(503);
    expect(refused.retryAfter).toBe("60");
    expect(refused.answer.success).toBeUndefined();
    expect(refused.answer.error).toBe(
      "The webhooks this event goes to have too many deliveries waiting, so this event wasn't accepted. Nothing was stored or sent. Send it again later.",
    );
    expect(await eventsStored()).toBe(2 * LONG_EVENTS_PER_WEBHOOK);
    expect(await deliveriesOf(webhook.id)).toEqual([]);
    expect(
      (await logsOf(webhook.id))
        .filter(({ success }) => !success)
        .map(({ error }) => error),
    ).toEqual([refused.answer.error]);

    await until(
      "the slots to fill",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
    );
    await aFewTicks();
    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);

    // That event was too long for what's left. A short one still fits in it.
    expect((await send(webhook, SHORT_EVENT)).status).toBe(200);
  });

  it("delivers everything it took once the receiver answers, and has room again", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);

    await fill(webhook);
    expect((await send(webhook, LONG_EVENT)).status).toBe(503);

    receiver.stopHolding();
    await queueFinished();
    await until(
      "every attempt on record",
      async () =>
        (await deliveriesOf(webhook.id)).length === LONG_EVENTS_PER_WEBHOOK,
    );

    expect(await statusesOf(webhook.id)).toEqual(
      Array(LONG_EVENTS_PER_WEBHOOK).fill("success"),
    );
    expect(receiver.requests).toBe(LONG_EVENTS_PER_WEBHOOK);
    expect(new Set(receiver.takenEventIds).size).toBe(LONG_EVENTS_PER_WEBHOOK);

    expect((await send(webhook, LONG_EVENT)).status).toBe(200);
    await queueFinished();
    expect(receiver.requests).toBe(LONG_EVENTS_PER_WEBHOOK + 1);
  });

  it("takes a refused request again under the same delivery id, once and only once", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    await fill(webhook);
    expect((await send(webhook, LONG_EVENT, deliveryId)).status).toBe(503);

    receiver.stopHolding();
    await queueFinished();

    expect((await send(webhook, LONG_EVENT, deliveryId)).status).toBe(200);
    expect((await send(webhook, LONG_EVENT, deliveryId)).status).toBe(401);
    await queueFinished();
    expect(receiver.requests).toBe(LONG_EVENTS_PER_WEBHOOK + 1);
  });

  it("holds bytes, so what a sender puts in an event can't multiply what it costs", async () => {
    v8.setFlagsFromString("--expose-gc");
    const collect = vm.runInNewContext("gc") as () => void;
    const heapUsed = () => {
      collect();
      return process.memoryUsage().heapUsed;
    };

    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    // About 350,000 objects from 1 MB, which took 21 MB each on the heap while waiting.
    const objects = Math.floor(INBOUND_CAP_BYTES / 3) - 1;
    const manyObjects: SentEvent = {
      contentType: "application/json",
      body: `[${"{},".repeat(objects)}{}]`,
    };
    const events = 10;

    const before = heapUsed();
    for (let n = 0; n < events; n++) {
      expect((await send(webhook, manyObjects)).status).toBe(200);
    }

    expect(heapUsed() - before).toBeLessThan(50 * MiB);
    expect(managerQueue().queue.size).toBeGreaterThan(0);
  });

  it("can't have all of simultaneous requests take the last of its room", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const requests = LONG_EVENTS_PER_WEBHOOK + 5;

    const results = await Promise.all(
      Array.from({ length: requests }, () => send(webhook, LONG_EVENT)),
    );

    expect(results.filter(({ status }) => status === 200)).toHaveLength(
      LONG_EVENTS_PER_WEBHOOK,
    );
    expect(results.filter(({ status }) => status === 503)).toHaveLength(5);
    expect(await eventsStored()).toBe(2 * LONG_EVENTS_PER_WEBHOOK);
  });

  it("tells a caller of triggerEvent, with nothing stored", async () => {
    const receiver = await startReceiver({ holding: true });
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url);

    await fill(webhook);
    const stored = await eventsStored();

    await expect(
      manager.triggerEvent(
        `webhook.${EVENT}`,
        { padding: "x".repeat(LONG_EVENT_BYTES) },
        owner,
      ),
    ).rejects.toBeInstanceOf(WebhookQueueFullError);
    expect(await eventsStored()).toBe(stored);
  });

  it("still sends a test event, which doesn't use the queue", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);

    await fill(webhook);
    expect((await send(webhook, LONG_EVENT)).status).toBe(503);
    await until(
      "the slots to fill",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
    );

    const [row] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, webhook.id));
    const test = manager.sendTestEvent(row!, { test: true }, {});
    await until(
      "the test event",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK + 1,
    );

    receiver.stopHolding();
    expect((await test).success).toBe(true);
  });

  it("doesn't refuse an event that nobody subscribes to", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);

    await fill(webhook);

    const answered = await send(webhook, { ...LONG_EVENT, event: "other" });
    expect(answered.status).toBe(200);
    expect(receiver.requests).toBeLessThanOrEqual(MAX_RUNNING_PER_WEBHOOK);
  });
});

describe("one tenant's receivers not answering", () => {
  it("doesn't use up another tenant's room", async () => {
    const stuck = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const stuckOwner = await tenant();
    const otherOwner = await tenant();

    for (let w = 0; w < WEBHOOKS_FILLING_A_TENANT; w++) {
      const event = `stuck.${w}`;
      await fill(
        await webhookAt(stuckOwner, stuck.url, {
          events: [`webhook.${event}`],
        }),
        event,
      );
    }

    // The tenant's next webhook has room of its own, but the tenant has none.
    const sibling = await webhookAt(stuckOwner, healthy.url);
    const refused = await send(sibling, LONG_EVENT);
    expect(refused.status).toBe(503);
    expect(refused.answer.error).toMatch(/^This account has too many/);
    expect(healthy.requests).toBe(0);

    // Someone else's long event still fits, and goes straight out.
    const other = await webhookAt(otherOwner, healthy.url);
    expect((await send(other, LONG_EVENT)).status).toBe(200);
    await until(
      "the other tenant's delivery",
      async () => (await deliveriesOf(other.id)).length === 1,
    );
    expect(await statusesOf(other.id)).toEqual(["success"]);
    expect(healthy.requests).toBe(1);
  });
});

describe("the whole process's limit", () => {
  it("refuses everyone once it's reached, and takes events again when there's room", async () => {
    const stuck = await startReceiver({ holding: true });

    for (let t = 0; t < TENANTS_FILLING_THE_QUEUE; t++) {
      const owner = await tenant();
      for (let w = 0; w < WEBHOOKS_FILLING_A_TENANT; w++) {
        const event = `stuck.${w}`;
        await fill(
          await webhookAt(owner, stuck.url, { events: [`webhook.${event}`] }),
          event,
        );
      }
    }

    // What's left is less than a tenant's limit, and this tenant holds nothing yet.
    const lateOwner = await tenant();
    const late = await webhookAt(lateOwner, stuck.url);
    const statuses: number[] = [];
    let refused: Awaited<ReturnType<typeof send>> | undefined;
    while (!refused && statuses.length < LONG_EVENTS_PER_WEBHOOK) {
      const answered = await send(late, LONG_EVENT);
      statuses.push(answered.status);
      if (answered.status !== 200) refused = answered;
    }

    expect(refused?.status).toBe(503);
    expect(refused?.answer.error).toMatch(/^This server has too many/);
    // Fewer than a webhook could otherwise hold, so it was this limit that stopped it.
    expect(statuses.length).toBeLessThan(LONG_EVENTS_PER_WEBHOOK);

    stuck.stopHolding();
    await queueFinished();
    expect((await send(late, LONG_EVENT)).status).toBe(200);
  });
});

describe("a tenant's webhooks sharing an event", () => {
  it("sends it to one with room, and the other's history says what it missed", async () => {
    const stuck = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const owner = await tenant();
    const full = await webhookAt(owner, stuck.url, {
      events: ["webhook.stuck.only", `webhook.${EVENT}`],
    });
    const sibling = await webhookAt(owner, healthy.url);

    await fill(full, "stuck.only");

    const answered = await send(sibling, LONG_EVENT);
    expect(answered.status).toBe(200);
    await until(
      "the sibling's delivery",
      async () => (await deliveriesOf(sibling.id)).length === 1,
    );
    expect(await statusesOf(sibling.id)).toEqual(["success"]);

    const [missed, ...others] = await deliveriesOf(full.id);
    expect(others).toEqual([]);
    expect(missed).toMatchObject({
      status: "failed",
      statusCode: null,
      error: NOT_QUEUED_MESSAGE,
    });
    expect(String(missed!.webhookEventId)).toBe(healthy.takenEventIds[0]);

    // It made no request, and the row is enough to send it later.
    await aFewTicks();
    expect(stuck.takenEventIds).not.toContain(healthy.takenEventIds[0]);
    stuck.stopHolding();
    await queueFinished();

    const retried = await manager.retryDelivery(missed!.deliveryId);

    expect(retried.success).toBe(true);
    expect(
      stuck.takenEventIds.filter((id) => id === healthy.takenEventIds[0]),
    ).toHaveLength(1);
    expect(healthy.requests).toBe(1);
    expect((await deliveriesOf(full.id)).at(-1)!.status).toBe("success");
  });

  it("is refused when none of them has room, with no rows on either", async () => {
    const stuck = await startReceiver({ holding: true });
    const owner = await tenant();
    const first = await webhookAt(owner, stuck.url);
    const second = await webhookAt(owner, stuck.url);

    // They share these bodies, so one tenant can do this without reaching its limit.
    await fill(first);
    const stored = await eventsStored();

    const refused = await send(first, LONG_EVENT);

    expect(refused.status).toBe(503);
    expect(refused.answer.error).toMatch(/^The webhooks this event goes to/);
    expect(await eventsStored()).toBe(stored);
    expect(await deliveriesOf(first.id)).toEqual([]);
    expect(await deliveriesOf(second.id)).toEqual([]);
  });
});

describe("retries", () => {
  it("keep their place while new events are refused, and none is lost", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      // Enough to still be going whenever the test gets to the end of this.
      retryConfig: { maxRetries: 1000, retryDelay: 200, backoffMultiplier: 1 },
    });

    await fill(webhook);
    await until(
      "a failed attempt for each",
      async () =>
        (await deliveriesOf(webhook.id)).length >= LONG_EVENTS_PER_WEBHOOK,
    );

    // Every event has failed by now, and has its retries still to come.
    const refused = await send(webhook, LONG_EVENT);
    expect(refused.status).toBe(503);
    expect(managerQueue().queue.size + managerQueue().processing.size).toBe(
      LONG_EVENTS_PER_WEBHOOK,
    );

    receiver.recover();
    await queueFinished();
    await until(
      "a success for each",
      () => receiver.takenEventIds.length === LONG_EVENTS_PER_WEBHOOK,
    );

    expect(new Set(receiver.takenEventIds).size).toBe(LONG_EVENTS_PER_WEBHOOK);
    await until(
      "every success on record",
      async () =>
        (await statusesOf(webhook.id)).filter((s) => s === "success").length ===
        LONG_EVENTS_PER_WEBHOOK,
    );

    // Their room came back only then.
    expect((await send(webhook, LONG_EVENT)).status).toBe(200);
  });
});

describe("an event that can't be stored", () => {
  async function refuseEventRows(condition: string) {
    await pool.query(`
      CREATE FUNCTION refuse_event_row() RETURNS trigger AS $$
      BEGIN
        IF ${condition} THEN
          RAISE EXCEPTION 'this row is refused';
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql`);
    await pool.query(`
      CREATE TRIGGER refuse_event_row BEFORE INSERT ON webhook_events
      FOR EACH ROW EXECUTE FUNCTION refuse_event_row()`);
  }

  async function allowEventRows() {
    await pool.query("DROP TRIGGER refuse_event_row ON webhook_events");
    await pool.query("DROP FUNCTION refuse_event_row");
  }

  it.each([
    ["the endpoint's own row", `NEW.event = '${EVENT}'`],
    ["the row its deliveries go out on", `NEW.event = 'webhook.${EVENT}'`],
  ])("gives its room back when %s won't go in", async (_row, condition) => {
    jest.spyOn(console, "error").mockImplementation();
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);

    await refuseEventRows(condition);
    try {
      for (let n = 0; n <= LONG_EVENTS_PER_WEBHOOK; n++) {
        expect((await send(webhook, LONG_EVENT)).status).toBe(500);
      }
    } finally {
      await allowEventRows();
    }

    expect((await send(webhook, LONG_EVENT)).status).toBe(200);
    await queueFinished();
    expect(receiver.requests).toBe(1);
  });
});
