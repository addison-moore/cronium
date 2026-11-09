/**
 * What happens to deliveries waiting in WebhookQueue when their webhook is disabled or
 * deleted, through the real inbound route, tRPC procedures and queue, against real
 * Postgres and real HTTP receivers.
 *
 * Real on purpose: what's under test is how many requests reach a receiver after its
 * webhook was disabled, which rows are left to retry from, and whether the owner's other
 * events get through again. Those used to go wrong together. A tenant full of 10 KB
 * events for a receiver that never answered, with its webhooks disabled, still sent each
 * of them 15 requests in the next 95 seconds, held all of its 67 MB, and had its other
 * webhook's events refused. At that rate its backlog would have taken 13 hours to go.
 *
 * Most of these hold requests until the test answers them, which stands in for a
 * receiver that doesn't answer without waiting out the timeout.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as postToInboundRoute } from "@/app/api/webhooks/[key]/route";
import { DROPPED_WHILE_DISABLED_MESSAGE } from "@/lib/webhooks/webhook-errors";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import {
  MAX_RUNNING_PER_WEBHOOK,
  WebhookQueue,
} from "@/lib/webhooks/WebhookQueue";
import { serializePayload } from "@/lib/webhooks/delivery-body";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import {
  UserRole,
  UserStatus,
  webhookDeliveries,
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

// Sessions are built below. The real NextAuth stack needs a request scope.
jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn().mockResolvedValue(null),
}));

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(240_000);

const createCaller = createCallerFactory(
  createTRPCRouter({ webhookSystem: webhookSystemRouter }),
);

function callerFor(userId: string) {
  return createCaller({
    session: {
      user: {
        id: userId,
        email: `${userId}@example.test`,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as never,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

/** The default a webhook gets, which is what a full queue's numbers come from. */
const THREE_ATTEMPTS = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
};
const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };
/** Far longer than any test, the longest `retryDelay` a webhook can be given. */
const AN_HOUR_BETWEEN_ATTEMPTS = {
  maxRetries: 3,
  retryDelay: 3_600_000,
  backoffMultiplier: 1,
};

interface SentEvent {
  contentType: string;
  body: string;
  /** What the request says the event is called. */
  event?: string;
}

const EVENT = "order.created";

const TEN_KB_EVENT: SentEvent = {
  contentType: "application/json",
  body: JSON.stringify({ order: 1, note: "x".repeat(10 * 1024) }),
};

const SHORT_EVENT: SentEvent = {
  contentType: "application/json",
  body: JSON.stringify({ order: 1 }),
};

/** Well under the 30 seconds a stuck delivery holds its slot for. */
const WITHIN = 20_000;

interface ReceiverOptions {
  /** Keep requests unanswered until `answerHeld` is called. */
  holding?: boolean;
  /** Answer every request with this. */
  failingWith?: number;
  /** Never answer at all. */
  silent?: boolean;
  /** Take this long over each answer. */
  answersAfterMs?: number;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server that counts what arrives. It reads every body to its end. */
async function startReceiver(options: ReceiverOptions = {}) {
  const arrivedEventIds: string[] = [];
  const held: http.ServerResponse[] = [];
  let holding = options.holding ?? false;
  let requests = 0;

  const server = http.createServer((req, res) => {
    requests++;
    let start = "";
    req.on("data", (chunk: Buffer) => {
      if (start.length < 64) start += chunk.subarray(0, 64).toString();
    });
    req.on("end", () => {
      arrivedEventIds.push(/"id":"(\d+)"/.exec(start)![1]!);
      if (options.silent) return;
      if (holding) {
        held.push(res);
        return;
      }
      const answer = () =>
        res.writeHead(options.failingWith ?? 200).end("answered");
      if (options.answersAfterMs) setTimeout(answer, options.answersAfterMs);
      else answer();
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
    arrivedEventIds,
    get requests() {
      return requests;
    },
    /** Answer everything held with this, and everything from now on with a 200. */
    answerHeld(status = 200) {
      holding = false;
      for (const res of held.splice(0)) res.writeHead(status).end("answered");
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

/** Long enough for a couple of ticks to start or drop anything they were going to. */
const aFewTicks = () => sleep(2_500);

const manager = WebhookManager.getInstance();

interface QueueInternals {
  queue: Map<string, unknown>;
  processing: Set<string>;
  heldBytes: number;
  heldBytesByWebhook: Map<number, number>;
  heldBytesByOwner: Map<string, number>;
  droppingUnwanted: boolean;
  dropUnwanted: () => Promise<void>;
  reserve: WebhookQueue["reserve"];
}

/** The manager's queue, which each test replaces and waits on. */
const managerQueue = () =>
  (manager as unknown as { webhookQueue: QueueInternals }).webhookQueue;

const waiting = () => managerQueue().queue.size;
const running = () => managerQueue().processing.size;

const queueFinished = () =>
  until(
    "the queue to finish",
    () =>
      waiting() === 0 && running() === 0 && !managerQueue().droppingUnwanted,
  );

/** However it ended, nothing is left counted. A key only stays while it isn't zero. */
function expectNothingHeld() {
  const queue = managerQueue();
  expect(queue.queue.size).toBe(0);
  expect(queue.processing.size).toBe(0);
  expect(queue.heldBytes).toBe(0);
  expect([...queue.heldBytesByWebhook]).toEqual([]);
  expect([...queue.heldBytesByOwner]).toEqual([]);
}

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

const droppedRowsOf = async (webhookId: number) =>
  (await deliveriesOf(webhookId)).filter(
    ({ error }) => error === DROPPED_WHILE_DISABLED_MESSAGE,
  );

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
  return { ...webhook, owner };
}

/** A sender signing the way the docs tell it to, through the real route. */
async function send(
  { key, secret }: { key: string; secret: string },
  { contentType, body, event = EVENT }: SentEvent,
) {
  const timestamp = new Date().toISOString();
  const deliveryId = randomUUID();
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
    answer: (await response.json()) as { success?: true; error?: string },
  };
}

async function sendEvents(webhook: Webhook, count: number) {
  for (let n = 0; n < count; n++) {
    expect((await send(webhook, SHORT_EVENT)).status).toBe(200);
  }
}

/** Keep sending 10 KB events until one is refused, and say how many weren't. */
async function fill(webhook: Webhook, event: string) {
  let accepted = 0;
  let full = false;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (!full) {
        const { status } = await send(webhook, { ...TEN_KB_EVENT, event });
        if (status === 200) {
          accepted++;
        } else {
          expect(status).toBe(503);
          full = true;
        }
      }
    }),
  );
  return accepted;
}

const setEnabled = (webhook: Webhook, active: boolean) =>
  callerFor(webhook.owner).webhookSystem.update({
    id: webhook.id,
    updates: { active },
  });

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
  await until(
    "the queue to stop",
    () => queue.processing.size === 0 && !queue.droppingUnwanted,
  );
  queue.queue.clear();
});

afterAll(async () => {
  await closePool();
});

describe("a backlog for a receiver that really never answers", () => {
  it("stops going out when its webhooks are disabled, and the owner's other events get through", async () => {
    const stuck = await startReceiver({ silent: true });
    const alsoStuck = await startReceiver({ silent: true });
    const healthy = await startReceiver();
    const owner = await tenant();
    const first = await webhookAt(owner, stuck.url, {
      events: ["webhook.first"],
      retryConfig: THREE_ATTEMPTS,
    });
    const second = await webhookAt(owner, alsoStuck.url, {
      events: ["webhook.second"],
      retryConfig: THREE_ATTEMPTS,
    });
    const third = await webhookAt(owner, healthy.url);

    const events = await fill(first, "first");
    const moreEvents = await fill(second, "second");
    expect(events).toBeGreaterThan(2_500);
    expect(moreEvents).toBeGreaterThan(2_500);

    // Together they're at the tenant's limit, so the third has no room of its own.
    const refused = await send(third, TEN_KB_EVENT);
    expect(refused.status).toBe(503);
    expect(refused.answer.error).toMatch(/^This account has too many/);

    const sentAlready = MAX_RUNNING_PER_WEBHOOK;
    expect(stuck.requests).toBe(sentAlready);
    expect(alsoStuck.requests).toBe(sentAlready);

    await setEnabled(first, false);
    await setEnabled(second, false);

    await until(
      "a row for each delivery that was waiting",
      async () =>
        (await droppedRowsOf(first.id)).length === events - sentAlready &&
        (await droppedRowsOf(second.id)).length === moreEvents - sentAlready,
    );
    // Nothing else went out, and what was refused a moment ago isn't now.
    expect(stuck.requests).toBe(sentAlready);
    expect(alsoStuck.requests).toBe(sentAlready);
    expect((await send(third, TEN_KB_EVENT)).status).toBe(200);

    // The attempts already running are the tenant's ten slots, until they time out.
    await until(
      "the running attempts to time out",
      async () =>
        (await deliveriesOf(first.id)).filter(({ error }) =>
          error?.includes("timeout of 30000ms"),
        ).length === sentAlready,
      45_000,
    );
    // Each had two attempts left, and those are dropped too. The third webhook's goes out.
    await until(
      "the rest of it",
      async () =>
        (await droppedRowsOf(first.id)).length === events &&
        (await droppedRowsOf(second.id)).length === moreEvents &&
        healthy.requests === 1,
    );
    await queueFinished();

    expect(stuck.requests).toBe(sentAlready);
    expect(alsoStuck.requests).toBe(sentAlready);
    expectNothingHeld();

    // One row each for all of them, and they're in the form a failed attempt takes.
    const dropped = await droppedRowsOf(first.id);
    expect(new Set(dropped.map((row) => row.webhookEventId)).size).toBe(events);
    expect(new Set(dropped.map((row) => row.deliveryId)).size).toBe(events);
    const now = Date.now();
    for (const row of dropped) {
      expect(row).toMatchObject({
        status: "failed",
        statusCode: null,
        response: null,
        duration: 0,
        headers: {},
      });
      expect(Math.abs(now - row.attemptedAt.getTime())).toBeLessThan(120_000);
    }

    // Enabled again it has all its room, and what was dropped stays dropped.
    await setEnabled(first, true);
    expect(
      (await send(first, { ...TEN_KB_EVENT, event: "first" })).status,
    ).toBe(200);
    await until("the one new event", () => stuck.requests === sentAlready + 1);
    await aFewTicks();
    expect(stuck.requests).toBe(sentAlready + 1);
  });
});

describe("a disabled webhook's waiting deliveries", () => {
  it("are dropped while waiting out a backoff, without waiting for it to end", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    const events = 8;

    await sendEvents(webhook, events);
    await until(
      "a failed attempt for each",
      async () => (await deliveriesOf(webhook.id)).length === events,
    );
    await until("the attempts to end", () => running() === 0);
    expect(waiting()).toBe(events);
    expect(managerQueue().heldBytes).toBeGreaterThan(0);

    await setEnabled(webhook, false);

    await until(
      "a row for each",
      async () => (await droppedRowsOf(webhook.id)).length === events,
    );
    await queueFinished();
    expect(receiver.requests).toBe(events);
    expectNothingHeld();

    // Each event has its failed attempt and the row saying why there were no more.
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(2 * events);
    const byEvent = new Map<number, Array<number | null>>();
    for (const { webhookEventId, statusCode } of rows) {
      byEvent.set(webhookEventId, [
        ...(byEvent.get(webhookEventId) ?? []),
        statusCode,
      ]);
    }
    expect([...byEvent.values()]).toEqual(Array(events).fill([500, null]));
  });

  it("are dropped however the webhook came to be disabled, with nothing telling the queue", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const events = MAX_RUNNING_PER_WEBHOOK + 3;
    await sendEvents(webhook, events);

    // As another replica, a script or a person at psql would.
    await db
      .update(webhooks)
      .set({ active: false })
      .where(eq(webhooks.id, webhook.id));

    await until(
      "the waiting deliveries to go",
      async () => (await droppedRowsOf(webhook.id)).length === 3,
    );
    expect(waiting()).toBe(0);
    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
  });

  it("don't go out if an attempt comes up before the queue next looks through them", async () => {
    // With that look out of the way, all that's left between a disabled webhook and a
    // request is the read before an attempt.
    jest.spyOn(managerQueue(), "dropUnwanted").mockResolvedValue(undefined);
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      // Time to disable it first, even when the machine is busy.
      retryConfig: { maxRetries: 3, retryDelay: 5_000, backoffMultiplier: 1 },
    });
    const events = 3;

    await sendEvents(webhook, events);
    await until(
      "a failed attempt for each",
      async () => (await deliveriesOf(webhook.id)).length === events,
    );
    await setEnabled(webhook, false);

    await until(
      "each retry's turn to come",
      async () => (await droppedRowsOf(webhook.id)).length === events,
    );
    await queueFinished();

    expect(receiver.requests).toBe(events);
    expectNothingHeld();
  });

  it("include an event that was on its way into the queue", async () => {
    const receiver = await startReceiver();
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url);

    const prepared = await manager.prepareEvent(
      `webhook.${EVENT}`,
      { order: 1 },
      owner,
    );
    if (prepared.refused) throw new Error("It had room");
    await setEnabled(webhook, false);
    await prepared.store(db);
    await prepared.send();

    await until(
      "its row",
      async () => (await droppedRowsOf(webhook.id)).length === 1,
    );
    await queueFinished();
    expect(receiver.requests).toBe(0);
    expectNothingHeld();
  });

  it("give back only what's theirs of an event another webhook is still sending", async () => {
    const stuck = await startReceiver({ holding: true });
    const stillGoing = await startReceiver({ holding: true });
    const owner = await tenant();
    const disabled = await webhookAt(owner, stuck.url);
    const other = await webhookAt(owner, stillGoing.url);
    const dropped = 2;
    const events = MAX_RUNNING_PER_WEBHOOK + dropped;

    await sendEvents(disabled, events);
    await until(
      "the slots to fill",
      () => stillGoing.requests === MAX_RUNNING_PER_WEBHOOK,
    );
    const queue = managerQueue();
    const heldBefore = queue.heldBytes;
    const webhookHeldBefore = queue.heldBytesByWebhook.get(disabled.id)!;
    const otherHeldBefore = queue.heldBytesByWebhook.get(other.id)!;

    await setEnabled(disabled, false);
    await until(
      "its waiting deliveries to go",
      async () => (await droppedRowsOf(disabled.id)).length === dropped,
    );

    // All of what the webhook held for them is back, while the tenant and the process
    // only get back what each delivery held itself. The other webhook needs the bodies.
    const eachForWebhook =
      (webhookHeldBefore - queue.heldBytesByWebhook.get(disabled.id)!) /
      dropped;
    const eachForProcess = (heldBefore - queue.heldBytes) / dropped;
    expect(eachForWebhook).toBe(webhookHeldBefore / events);
    expect(eachForProcess).toBeLessThan(eachForWebhook);
    expect(eachForProcess).toBeGreaterThan(0);
    expect(queue.heldBytesByWebhook.get(other.id)).toBe(otherHeldBefore);

    // It gets every event, and the bodies come back with its last attempts.
    stuck.answerHeld();
    stillGoing.answerHeld();
    await until("the rest", () => stillGoing.requests === events);
    await queueFinished();
    expect(new Set(stillGoing.arrivedEventIds).size).toBe(events);
    expect(stuck.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
    expectNothingHeld();
  });
});

describe("an attempt already running when its webhook is disabled", () => {
  it("finishes, and a receiver that takes it has it on record as a success", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: THREE_ATTEMPTS,
    });

    await sendEvents(webhook, 1);
    await until("the request", () => receiver.requests === 1);
    await setEnabled(webhook, false);
    await aFewTicks();
    expect(running()).toBe(1);

    receiver.answerHeld(200);
    await queueFinished();

    expect(
      (await deliveriesOf(webhook.id)).map(({ status }) => status),
    ).toEqual(["success"]);
    expect(receiver.requests).toBe(1);
    expectNothingHeld();
  });

  it("isn't tried again if it fails", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: THREE_ATTEMPTS,
    });

    await sendEvents(webhook, 1);
    await until("the request", () => receiver.requests === 1);
    await setEnabled(webhook, false);

    receiver.answerHeld(500);
    await until(
      "the row saying no more will follow",
      async () => (await droppedRowsOf(webhook.id)).length === 1,
    );
    await queueFinished();
    await aFewTicks();

    expect(
      (await deliveriesOf(webhook.id)).map(({ statusCode }) => statusCode),
    ).toEqual([500, null]);
    expect(receiver.requests).toBe(1);
    expectNothingHeld();
  });

  it("is tried again if the webhook has been enabled by the time it fails", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: THREE_ATTEMPTS,
    });

    await sendEvents(webhook, 1);
    await until("the request", () => receiver.requests === 1);
    await setEnabled(webhook, false);
    await setEnabled(webhook, true);

    receiver.answerHeld(500);
    await until("its retry", () => receiver.requests === 2);
    await queueFinished();

    expect(
      (await deliveriesOf(webhook.id)).map(({ statusCode }) => statusCode),
    ).toEqual([500, 200]);
    expectNothingHeld();
  });
});

describe("enabling a webhook again", () => {
  it("doesn't bring back what was dropped, which can then be retried one at a time", async () => {
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const droppedCount = 3;
    await sendEvents(webhook, MAX_RUNNING_PER_WEBHOOK + droppedCount);
    await until(
      "the slots to fill",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
    );

    await setEnabled(webhook, false);
    await until(
      "the waiting deliveries to go",
      async () => (await droppedRowsOf(webhook.id)).length === droppedCount,
    );
    const [dropped] = await droppedRowsOf(webhook.id);

    // While it's disabled, nothing goes to its URL by any route.
    await expect(
      callerFor(webhook.owner).webhookSystem.retryDelivery({
        deliveryId: dropped!.deliveryId,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Webhook is disabled",
    });

    receiver.answerHeld();
    await queueFinished();
    await setEnabled(webhook, true);
    await aFewTicks();
    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
    expect(await droppedRowsOf(webhook.id)).toHaveLength(droppedCount);

    const retried = await callerFor(webhook.owner).webhookSystem.retryDelivery({
      deliveryId: dropped!.deliveryId,
    });

    expect(retried.success).toBe(true);
    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK + 1);
    expect(receiver.arrivedEventIds.at(-1)).toBe(
      String(dropped!.webhookEventId),
    );
    expect((await deliveriesOf(webhook.id)).at(-1)).toMatchObject({
      webhookEventId: dropped!.webhookEventId,
      status: "success",
      statusCode: 200,
    });

    // And new events go straight out.
    await sendEvents(webhook, 1);
    await until(
      "the new event",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK + 2,
    );
    await queueFinished();
    expectNothingHeld();
  });

  it("before the queue next looks means nothing is dropped", async () => {
    const lookingAway = jest
      .spyOn(managerQueue(), "dropUnwanted")
      .mockResolvedValue(undefined);
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const events = MAX_RUNNING_PER_WEBHOOK + 2;
    await sendEvents(webhook, events);

    await setEnabled(webhook, false);
    await setEnabled(webhook, true);
    lookingAway.mockRestore();
    await aFewTicks();

    receiver.answerHeld();
    await until("all of them", () => receiver.requests === events);
    await queueFinished();

    expect(await droppedRowsOf(webhook.id)).toEqual([]);
    expect(new Set(receiver.arrivedEventIds).size).toBe(events);
    expectNothingHeld();
  });

  it("leaves every delivery sent or on record, however often it's switched", async () => {
    const receiver = await startReceiver({ answersAfterMs: 200 });
    const owner = await tenant();
    const switched = await webhookAt(owner, receiver.url);
    // A disabled webhook's own endpoint refuses events, so they come in through this.
    const doorway = await webhookAt(owner, (await startReceiver()).url);

    const reserve = jest.spyOn(managerQueue(), "reserve");
    let sending = true;
    const switching = (async () => {
      let active = false;
      while (sending) {
        await setEnabled(switched, active);
        active = !active;
        await sleep(400);
      }
      // Ending disabled leaves nothing to wait for: what's left is dropped.
      await setEnabled(switched, false);
    })();
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      expect((await send(doorway, SHORT_EVENT)).status).toBe(200);
      await sleep(5);
    }
    sending = false;
    await switching;
    await queueFinished();

    const sentToIt = reserve.mock.calls.filter(([, , targets]) =>
      targets.some(({ webhookId }) => webhookId === switched.id),
    ).length;
    const rows = await deliveriesOf(switched.id);
    const delivered = rows.filter(({ status }) => status === "success");
    const dropped = rows.filter(
      ({ error }) => error === DROPPED_WHILE_DISABLED_MESSAGE,
    );

    // Otherwise this hasn't shown anything.
    expect(delivered.length).toBeGreaterThan(0);
    expect(dropped.length).toBeGreaterThan(0);

    expect(delivered.length + dropped.length).toBe(sentToIt);
    expect(rows).toHaveLength(sentToIt);
    expect(new Set(rows.map((row) => row.webhookEventId)).size).toBe(sentToIt);
    expect(receiver.requests).toBe(delivered.length);
    expect(receiver.arrivedEventIds.sort()).toEqual(
      delivered.map((row) => String(row.webhookEventId)).sort(),
    );
    expectNothingHeld();
  });
});

describe("a deleted webhook's waiting deliveries", () => {
  it.each([
    [
      "through webhookSystem.delete",
      (webhook: Webhook) =>
        callerFor(webhook.owner).webhookSystem.delete({ id: webhook.id }),
    ],
    [
      "by deleting its owner",
      (webhook: Webhook) => storage.deleteUser(webhook.owner),
    ],
  ])(
    "are dropped when it's deleted %s, and leave no rows",
    async (_how, remove) => {
      const errors = jest.spyOn(console, "error").mockImplementation();
      const receiver = await startReceiver({ holding: true });
      const webhook = await webhookAt(await tenant(), receiver.url, {
        retryConfig: THREE_ATTEMPTS,
      });
      const waitingWhenDeleted = 3;
      await sendEvents(webhook, MAX_RUNNING_PER_WEBHOOK + waitingWhenDeleted);
      await until(
        "the slots to fill",
        () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
      );

      await remove(webhook);

      await until("the waiting deliveries to go", () => waiting() === 0);
      await aFewTicks();
      expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
      expect(console.warn).toHaveBeenCalledWith(
        `[Webhook] Webhook ${webhook.id} was deleted, so deliveries waiting for it were dropped: ${waitingWhenDeleted}.`,
      );

      // What's running can't be recalled, and its row has nowhere to go. Its retry is
      // dropped too, so this is the end of the attempts for a webhook that doesn't exist.
      receiver.answerHeld(500);
      await until("the running attempts to end", () => running() === 0);
      await queueFinished();
      await aFewTicks();

      expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
      expect(await deliveriesOf(webhook.id)).toEqual([]);
      expect(
        errors.mock.calls.filter(([line]) =>
          String(line).includes("wasn't recorded"),
        ),
      ).toHaveLength(MAX_RUNNING_PER_WEBHOOK);
      // Nor does dropping one try to write rows there, which would only fill the log.
      expect(
        errors.mock.calls.filter(([line]) =>
          String(line).includes("weren't recorded"),
        ),
      ).toEqual([]);
      expectNothingHeld();
    },
  );

  it("give the owner's room back straight away", async () => {
    const stuck = await startReceiver({ holding: true });
    const healthy = await startReceiver();
    const owner = await tenant();
    const first = await webhookAt(owner, stuck.url, {
      events: ["webhook.first"],
    });
    const second = await webhookAt(owner, stuck.url, {
      events: ["webhook.second"],
    });
    const third = await webhookAt(owner, healthy.url);
    await fill(first, "first");
    await fill(second, "second");
    expect((await send(third, TEN_KB_EVENT)).status).toBe(503);

    const caller = callerFor(owner);
    await caller.webhookSystem.delete({ id: first.id });
    await caller.webhookSystem.delete({ id: second.id });

    await until("the waiting deliveries to go", () => waiting() === 0);
    expect((await send(third, TEN_KB_EVENT)).status).toBe(200);
  });
});

describe("what the look through the queue costs", () => {
  it("makes no reads while nothing is waiting", async () => {
    const reads = jest.spyOn(manager, "webhooksEnabled");

    await aFewTicks();

    expect(reads).not.toHaveBeenCalled();
  });

  it("makes one read a second however much is waiting, naming each webhook once", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    const other = await webhookAt(owner, receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    const events = 6;
    await sendEvents(webhook, events);
    await until(
      "them all to be waiting for their retries",
      async () =>
        running() === 0 &&
        (await deliveriesOf(webhook.id)).length === events &&
        (await deliveriesOf(other.id)).length === events,
    );
    expect(waiting()).toBe(2 * events);

    const reads = jest.spyOn(manager, "webhooksEnabled");
    const started = performance.now();
    await aFewTicks();

    // Ticks run late on a busy machine, so this goes by how long it really took.
    const seconds = (performance.now() - started) / 1000;
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(Math.ceil(seconds) + 1);
    for (const [ids] of reads.mock.calls) {
      expect([...ids].sort()).toEqual([webhook.id, other.id].sort());
    }
    expect(receiver.requests).toBe(2 * events);
  });

  it("drops a backlog longer than one statement could give a row each by parameters", async () => {
    const receiver = await startReceiver({ holding: true });
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url);
    // Tiny events are what a webhook holds the most of. At eight parameters a row, a
    // list of rows would stop working at 8,192 of them.
    const target = {
      webhookId: webhook.id,
      url: receiver.url,
      secret: "s",
      headers: {},
      retryConfig: ONE_ATTEMPT,
    };
    const { rows: stored } = await pool.query<{ id: number }>(
      `INSERT INTO webhook_events (event, payload, user_id)
       SELECT 'tiny', '{}'::jsonb, $1 FROM generate_series(1, 20000) RETURNING id`,
      [owner],
    );
    const queue = managerQueue();
    let held = 0;
    for (const { id } of stored) {
      const payload = serializePayload({
        id: String(id),
        event: "tiny",
        timestamp: new Date(),
        data: {},
      });
      const reservation = queue.reserve(owner, payload.body.length, [target]);
      if (reservation.refused) break;
      reservation.enqueue(id, payload);
      held++;
    }
    expect(held).toBeGreaterThan(8_192);
    await until(
      "the slots to fill",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
    );

    await setEnabled(webhook, false);

    await until(
      "a row for each",
      async () =>
        (await droppedRowsOf(webhook.id)).length ===
        held - MAX_RUNNING_PER_WEBHOOK,
    );
    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
    receiver.answerHeld();
    await queueFinished();
    expectNothingHeld();
  });
});

describe("when something fails along the way", () => {
  it("keeps delivering if the read fails, because that says nothing about the webhook", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation();
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      // Enough to still be going whenever the test gets to the end of this.
      retryConfig: { maxRetries: 1000, retryDelay: 200, backoffMultiplier: 1 },
    });
    const events = 3;
    await sendEvents(webhook, events);
    await until(
      "a failed attempt for each",
      async () => (await deliveriesOf(webhook.id)).length >= events,
    );

    // The read fails for real, and attempts' rows still go in: a foreign key follows a
    // rename. A disabled webhook would be dropped if this were read as a yes or a no.
    await pool.query("ALTER TABLE webhooks RENAME TO webhooks_moved_aside");
    try {
      const before = receiver.requests;
      await until(
        "more attempts with the read failing",
        () => receiver.requests >= before + 2 * events,
        45_000,
      );
      expect(await droppedRowsOf(webhook.id)).toEqual([]);
    } finally {
      await pool.query("ALTER TABLE webhooks_moved_aside RENAME TO webhooks");
    }

    // However many reads failed, that's one line for whoever runs the server.
    expect(
      errors.mock.calls.filter(([line]) =>
        String(line).includes(
          "Couldn't read whether webhooks are still enabled",
        ),
      ),
    ).toHaveLength(1);

    // It comes right again.
    await setEnabled(webhook, false);
    await until(
      "everything to be dropped",
      async () => (await droppedRowsOf(webhook.id)).length === events,
    );
    await queueFinished();
    expectNothingHeld();
  });

  it("gives the room back if the rows won't go in, and the log says what's missing", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation();
    const receiver = await startReceiver({ holding: true });
    const webhook = await webhookAt(await tenant(), receiver.url);
    const waitingWhenDisabled = 3;
    await sendEvents(webhook, MAX_RUNNING_PER_WEBHOOK + waitingWhenDisabled);
    await until(
      "the slots to fill",
      () => receiver.requests === MAX_RUNNING_PER_WEBHOOK,
    );

    await pool.query(`
      CREATE FUNCTION refuse_dropped_row() RETURNS trigger AS $$
      BEGIN
        IF NEW.status_code IS NULL THEN
          RAISE EXCEPTION 'this row is refused';
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql`);
    await pool.query(`
      CREATE TRIGGER refuse_dropped_row BEFORE INSERT ON webhook_deliveries
      FOR EACH ROW EXECUTE FUNCTION refuse_dropped_row()`);
    try {
      await setEnabled(webhook, false);
      await until("the waiting deliveries to go", () => waiting() === 0);
      await until("the log to say so", () =>
        errors.mock.calls.some(([line]) =>
          String(line).includes(
            `${waitingWhenDisabled} deliveries dropped from webhook ${webhook.id} weren't recorded`,
          ),
        ),
      );
      expect(await deliveriesOf(webhook.id)).toEqual([]);
      receiver.answerHeld();
      await queueFinished();
    } finally {
      await pool.query("DROP TRIGGER refuse_dropped_row ON webhook_deliveries");
      await pool.query("DROP FUNCTION refuse_dropped_row");
    }

    expect(receiver.requests).toBe(MAX_RUNNING_PER_WEBHOOK);
    expectNothingHeld();
  });

  it("gives the room back without waiting for the rows to go in", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const owner = await tenant();
    const webhook = await webhookAt(owner, receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    const events = 3;
    await sendEvents(webhook, events);
    await until(
      "a failed attempt for each",
      async () =>
        running() === 0 && (await deliveriesOf(webhook.id)).length === events,
    );

    // The rows wait on this lock, for as long as a busy or stuck database might take.
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "LOCK TABLE webhook_deliveries IN ACCESS EXCLUSIVE MODE",
    );
    try {
      await setEnabled(webhook, false);
      await until("what's waiting to go", () => waiting() === 0);
      expect(managerQueue().heldBytes).toBe(0);
    } finally {
      await client.query("COMMIT");
      client.release();
    }

    await until(
      "the rows, once they can go in",
      async () => (await droppedRowsOf(webhook.id)).length === events,
    );
    expectNothingHeld();
  });

  it("dates its rows like every other row, whatever the session's time zone", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    await sendEvents(webhook, 1);
    await until(
      "its failed attempt",
      async () =>
        running() === 0 && (await deliveriesOf(webhook.id)).length === 1,
    );

    // Every connection the pool has. It doesn't need new ones for what's left of this.
    const clients = await Promise.all(
      Array.from({ length: pool.totalCount }, () => pool.connect()),
    );
    await Promise.all(
      clients.map((client) => client.query("SET TIME ZONE 'Asia/Tokyo'")),
    );
    clients.forEach((client) => client.release());
    try {
      await setEnabled(webhook, false);
      await until(
        "its row",
        async () => (await droppedRowsOf(webhook.id)).length === 1,
      );
    } finally {
      const again = await Promise.all(
        Array.from({ length: pool.totalCount }, () => pool.connect()),
      );
      await Promise.all(again.map((client) => client.query("RESET TIME ZONE")));
      again.forEach((client) => client.release());
    }

    const [attempt, dropped] = await deliveriesOf(webhook.id);
    expect(
      Math.abs(dropped!.attemptedAt.getTime() - attempt!.attemptedAt.getTime()),
    ).toBeLessThan(60_000);
  });

  it("leaves out an event that's gone, and records the rest", async () => {
    const receiver = await startReceiver({ failingWith: 500 });
    const webhook = await webhookAt(await tenant(), receiver.url, {
      retryConfig: AN_HOUR_BETWEEN_ATTEMPTS,
    });
    const events = 3;
    await sendEvents(webhook, events);
    await until(
      "a failed attempt for each",
      async () =>
        running() === 0 && (await deliveriesOf(webhook.id)).length === events,
    );

    // As retention would remove it, when a delivery has waited longer than it keeps them.
    const [firstRow] = await deliveriesOf(webhook.id);
    await pool.query("DELETE FROM webhook_events WHERE id = $1", [
      firstRow!.webhookEventId,
    ]);

    await setEnabled(webhook, false);

    await until(
      "the others' rows",
      async () => (await droppedRowsOf(webhook.id)).length === events - 1,
    );
    await queueFinished();
    expectNothingHeld();
  });
});
