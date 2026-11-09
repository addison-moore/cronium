/**
 * What a refused inbound request leaves of its delivery id, through the real route,
 * against real Postgres, real Valkey and a real HTTP receiver.
 *
 * `verifyWebhook` consumes the id before the rest is decided. A request refused after
 * that has done nothing, so sending it again isn't a replay, and a 401 would read as
 * an attack to a sender keeping its id across attempts and stop it retrying. A request
 * that stored a row or queued a delivery is the opposite: its id has to stay used, or a
 * replay repeats what it did. So these count rows and requests at the receiver as well
 * as reading the answers.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { asc, eq } from "drizzle-orm";
import Redis from "ioredis";
import { NextRequest } from "next/server";
import type { PoolClient, QueryConfig } from "pg";
import { POST as postToInboundRoute } from "@/app/api/webhooks/[key]/route";
import { cacheService } from "@/lib/cache/cache-service";
import { RateLimitService } from "@/lib/rate-limit-service";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookQueue } from "@/lib/webhooks/WebhookQueue";
import { WebhookSecurity } from "@/lib/webhooks/WebhookSecurity";
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

// Deliveries go to a real HTTP server on loopback, which the SSRF guard would otherwise
// refuse. The agent is a real one that doesn't pool, like production's.
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

const REPLAYED = "Duplicate or replayed delivery";
const EVENT = "order.created";
/** The endpoint's own row, and the one its deliveries go out on. */
const ROWS_OF_AN_EVENT = [EVENT, `webhook.${EVENT}`];

/** MAX_WEBHOOK_BODY_BYTES in WebhookRouter. */
const INBOUND_CAP_BYTES = 1024 * 1024;

interface SentEvent {
  contentType: string;
  body: string;
  /** What the request's header calls the event. `null` leaves the name to the body. */
  event?: string | null;
}

const AN_EVENT: SentEvent = {
  contentType: "application/json",
  body: JSON.stringify({ order: 1 }),
};

type Webhook = Awaited<ReturnType<typeof webhookAt>>;

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server that takes everything and counts what arrives. */
async function startReceiver() {
  let requests = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests++;
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  openReceivers.push(
    () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );

  return {
    url: `http://127.0.0.1:${port}/hook`,
    get requests() {
      return requests;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
  within = 20_000,
) {
  const deadline = performance.now() + within;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}`);
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

const queueFinished = () =>
  until(
    "the queue to finish",
    () =>
      managerQueue().queue.size === 0 && managerQueue().processing.size === 0,
  );

const deliveryStatuses = async (webhookId: number) =>
  (
    await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(asc(webhookDeliveries.id))
  ).map(({ status }) => status);

const storedEvents = async () =>
  (
    await db
      .select({ event: webhookEvents.event })
      .from(webhookEvents)
      .orderBy(asc(webhookEvents.id))
  ).map(({ event }) => event);

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

async function webhookAt(
  owner: string,
  url: string,
  {
    events = [`webhook.${EVENT}`],
    // Webhook ids start again after each reset, and the rate limit's window doesn't,
    // so a limit a test isn't about shouldn't be one it can reach.
    rateLimit = { requests: 1_000_000, window: 60_000 },
  }: {
    events?: string[];
    rateLimit?: { requests: number; window: number };
  } = {},
) {
  const webhook = await manager.registerWebhook(owner, {
    url,
    events,
    active: true,
    retryConfig: { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 },
  });
  await db
    .update(webhooks)
    .set({ rateLimit })
    .where(eq(webhooks.id, webhook.id));
  return webhook;
}

/** A request signed the way the docs say, kept so its exact bytes can be sent again. */
function signed(
  { key, secret }: { key: string; secret: string },
  { contentType, body, event = EVENT }: SentEvent = AN_EVENT,
  deliveryId: string = randomUUID(),
) {
  const timestamp = new Date().toISOString();
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest("hex");
  return {
    key,
    body,
    headers: {
      "content-type": contentType,
      ...(event !== null && { "x-webhook-event": event }),
      "x-webhook-signature": `sha256=${digest}`,
      "x-webhook-timestamp": timestamp,
      "x-webhook-delivery-id": deliveryId,
    },
  };
}

async function post({ key, body, headers }: ReturnType<typeof signed>) {
  const response = await postToInboundRoute(
    new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({ key }) },
  );
  return {
    status: response.status,
    headers: response.headers,
    answer: (await response.json()) as { success?: true; error?: string },
  };
}

/** A sender signing a new request, as it has to for any change or after 5 minutes. */
const send = (webhook: Webhook, sent?: SentEvent, deliveryId?: string) =>
  post(signed(webhook, sent, deliveryId));

/** What a sender keeping its id should see next: taken once, and then a replay. */
async function expectTakenOnce(
  webhook: Webhook,
  deliveryId: string,
  sent?: SentEvent,
) {
  expect((await send(webhook, sent, deliveryId)).status).toBe(200);
  expect(await send(webhook, sent, deliveryId)).toMatchObject({
    status: 401,
    answer: { error: REPLAYED },
  });
}

/** Everything one accepted event leaves behind, and nothing more. */
async function expectOneEventSent(
  webhook: Webhook,
  receiver: Awaited<ReturnType<typeof startReceiver>>,
) {
  await queueFinished();
  await until(
    "the attempt on record",
    async () => (await deliveryStatuses(webhook.id)).length > 0,
  );
  expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);
  expect(receiver.requests).toBe(1);
  expect(await deliveryStatuses(webhook.id)).toEqual(["success"]);
}

/** Run this inside Postgres for each row going into webhook_events. */
async function onEventRow(body: string) {
  await pool.query(`
    CREATE FUNCTION on_event_row() RETURNS trigger AS $$
    BEGIN
      ${body}
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE TRIGGER on_event_row BEFORE INSERT ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION on_event_row()`);
}

const refuseEventRows = (condition: string) =>
  onEventRow(`IF ${condition} THEN RAISE EXCEPTION 'refused'; END IF;`);

async function allowEventRows() {
  await pool.query("DROP TRIGGER IF EXISTS on_event_row ON webhook_events");
  await pool.query("DROP FUNCTION IF EXISTS on_event_row");
}

/** A ciphertext is bound to its row, so another webhook's can't be read as this one's. */
async function unreadableSecretOn(webhookId: number, other: Webhook) {
  const [row] = await db
    .select({ secret: webhooks.secret })
    .from(webhooks)
    .where(eq(webhooks.id, other.id));
  const [own] = await db
    .select({ secret: webhooks.secret })
    .from(webhooks)
    .where(eq(webhooks.id, webhookId));
  await db
    .update(webhooks)
    .set({ secret: row!.secret })
    .where(eq(webhooks.id, webhookId));
  return () =>
    db
      .update(webhooks)
      .set({ secret: own!.secret })
      .where(eq(webhooks.id, webhookId));
}

let errorLog: jest.SpyInstance;

/** Everything logged, so a test can check the 500 it got is the failure it means. */
const logged = () => errorLog.mock.calls.flat().join("\n");

beforeAll(async () => {
  // The rate limit lets everything through until its client has connected.
  await until("the cache to connect", () => cacheService.isAvailable());
});

beforeEach(async () => {
  await resetDatabase();
  (manager as unknown as { webhookQueue: WebhookQueue }).webhookQueue =
    new WebhookQueue();
  errorLog = jest.spyOn(console, "error").mockImplementation();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await allowEventRows();
  // Nothing from this test may write a row during the next one: ids start again after
  // a reset, so it would land on that test's webhook.
  await queueFinished();
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await closePool();
});

describe("a request refused for its rate limit", () => {
  it("leaves its id free, so coming back when told isn't a replay", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url, {
      rateLimit: { requests: 1, window: 5_000 },
    });
    await RateLimitService.reset(`webhook:${webhook.id}`, "webhook");
    const deliveryId = randomUUID();

    // That's the window's one request.
    expect((await send(webhook)).status).toBe(200);

    const refused = await send(webhook, AN_EVENT, deliveryId);
    expect(refused.status).toBe(429);
    expect(refused.answer.error).toBe("Rate limit exceeded");
    // Back too soon, it's told the same thing, not that it's replaying.
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(429);
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);

    const reset = Date.parse(refused.headers.get("X-RateLimit-Reset")!);
    await until("the window to end", () => Date.now() > reset);

    await expectTakenOnce(webhook, deliveryId);
    await queueFinished();
    expect(await storedEvents()).toEqual([
      ...ROWS_OF_AN_EVENT,
      ...ROWS_OF_AN_EVENT,
    ]);
    expect(receiver.requests).toBe(2);
  });
});

describe("a request refused for its body", () => {
  it("leaves its id free after a 400, for the corrected request", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    const broken = { contentType: "application/json", body: '{"order":' };

    expect(await send(webhook, broken, deliveryId)).toMatchObject({
      status: 400,
      answer: { error: "Invalid request body" },
    });
    // The same bytes are the same mistake, not a replay.
    expect((await send(webhook, broken, deliveryId)).status).toBe(400);
    expect(await storedEvents()).toEqual([]);

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });

  it("leaves its id free after a 413 for an event too long to deliver", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    // All that can take a request's event past the limit: it copies fields.
    await db
      .update(webhooks)
      .set({ transformations: { first: "data", second: "data" } })
      .where(eq(webhooks.id, webhook.id));
    const deliveryId = randomUUID();
    const tooLong = {
      contentType: "text/plain",
      body: '"'.repeat(INBOUND_CAP_BYTES),
    };

    const refused = await send(webhook, tooLong, deliveryId);
    expect(refused.status).toBe(413);
    expect(refused.answer.error).toMatch(/too long to deliver/);
    expect(await storedEvents()).toEqual([]);

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);

    // Each attempt is on record: the refusal, the one taken, and the replay. The
    // refusal's line is no reason to keep its id.
    const logs = await db
      .select({ success: webhookLogs.success })
      .from(webhookLogs)
      .where(eq(webhookLogs.webhookId, webhook.id))
      .orderBy(asc(webhookLogs.id));
    expect(logs.map(({ success }) => success)).toEqual([false, true, false]);
  });
});

describe("a 500 from before the first write", () => {
  /** Another webhook taking the event, whose secret can't be read. */
  async function aSubscriberWithAnUnreadableSecret(webhook: Webhook) {
    const owner = (
      await db
        .select({ userId: webhooks.userId })
        .from(webhooks)
        .where(eq(webhooks.id, webhook.id))
    )[0]!.userId;
    const subscriber = await webhookAt(owner, "http://127.0.0.1:9/never");
    await unreadableSecretOn(subscriber.id, webhook);
    return () => db.delete(webhooks).where(eq(webhooks.id, subscriber.id));
  }

  it.each<{
    name: string;
    refused?: SentEvent;
    breakIt?: (webhook: Webhook) => Promise<() => Promise<unknown>>;
    failure: RegExp;
  }>([
    {
      name: "the event's name can't be read",
      refused: {
        contentType: "application/json",
        body: '{"event":{"toString":null}}',
        event: null,
      },
      failure: /TypeError/,
    },
    {
      name: "a webhook it goes to has a secret that can't be read",
      breakIt: aSubscriberWithAnUnreadableSecret,
      failure: /SecretDecryptionError/,
    },
    {
      name: "Postgres refuses the endpoint's own row",
      breakIt: async () => {
        await refuseEventRows(`NEW.event = '${EVENT}'`);
        return allowEventRows;
      },
      failure: /P0001/,
    },
    {
      name: "Postgres can't store a value in it",
      refused: {
        contentType: "application/json",
        body: '{"note":"\\u0000"}',
      },
      failure: /22P05/,
    },
    {
      name: "its name is too long for the endpoint's own row",
      refused: { ...AN_EVENT, event: "x".repeat(256) },
      failure: /22001/,
    },
  ])("leaves its id free when $name", async ({ refused, breakIt, failure }) => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    const fix = await breakIt?.(webhook);
    expect(await send(webhook, refused, deliveryId)).toMatchObject({
      status: 500,
      answer: { error: "Internal server error" },
    });
    expect(logged()).toMatch(failure);
    expect(await storedEvents()).toEqual([]);
    await fix?.();

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });
});

describe("a 500 once the request may have had an effect", () => {
  it("keeps its id used when the row its deliveries go out on is refused", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    await refuseEventRows(`NEW.event = 'webhook.${EVENT}'`);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/P0001/);
    expect(await storedEvents()).toEqual([EVENT]);

    expect(await send(webhook, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    await allowEventRows();
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    expect(await storedEvents()).toEqual([EVENT]);
    await queueFinished();
    expect(receiver.requests).toBe(0);

    // That event never went out, and a new id is what sends it. All that's repeated
    // is the endpoint's own row, which no delivery is sent from.
    expect((await send(webhook)).status).toBe(200);
    await queueFinished();
    expect(await storedEvents()).toEqual([EVENT, ...ROWS_OF_AN_EVENT]);
    expect(receiver.requests).toBe(1);
  });

  it("keeps its id used when a name fits the endpoint's own row and not the other", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url, {
      events: ["*"],
    });
    const deliveryId = randomUUID();
    // 255 is the column's limit, and the second row's name has `webhook.` in front.
    const longName = { ...AN_EVENT, event: "x".repeat(250) };

    expect((await send(webhook, longName, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/22001/);
    expect(await storedEvents()).toEqual([longName.event]);

    expect((await send(webhook, longName, deliveryId)).status).toBe(401);
    expect(await storedEvents()).toEqual([longName.event]);
    await queueFinished();
    expect(receiver.requests).toBe(0);
  });

  it("keeps its id used when the failure comes after its deliveries are queued", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    // Nothing reachable fails here today, and a replay here is what would send an
    // event twice, so this one failure is made up. The rest is real.
    const prepareEvent = manager.prepareEvent.bind(manager);
    const prepared = jest
      .spyOn(manager, "prepareEvent")
      .mockImplementationOnce(async (...args) => {
        const real = await prepareEvent(...args);
        if (real.refused) return real;
        return {
          ...real,
          send: async () => {
            await real.send();
            throw new Error("after the deliveries were queued");
          },
        };
      });

    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  /**
   * Have Postgres run the next insert into webhook_events and its answer never arrive:
   * the socket stops being read before the statement goes out, and closes once the row
   * is in. A connection lost at that moment looks the same from here as one lost
   * before the statement got there.
   */
  function loseTheAnswerToTheNextEventInsert() {
    const realQuery = pool.query.bind(pool) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const spy = jest.spyOn(pool, "query").mockImplementation(((
      ...args: unknown[]
    ) => {
      const { text } = args[0] as QueryConfig;
      if (text.startsWith('insert into "webhook_events"')) {
        spy.mockRestore();
        pool.once("acquire", (client: PoolClient) => {
          const socket = client.connection.stream;
          socket.pause();
          // Whatever happens, the request gets its answer, and the test says what's wrong.
          void until(
            "the row to go in",
            async () => (await storedEvents()).length > 0,
          )
            .catch(() => undefined)
            .finally(() => socket.destroy());
        });
      }
      return realQuery(...args);
    }) as never);
  }

  it("keeps its id used when the first insert's answer is lost after it went in", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    loseTheAnswerToTheNextEventInsert();
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/Connection terminated unexpectedly/);
    expect(await storedEvents()).toEqual([EVENT]);

    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    expect(await storedEvents()).toEqual([EVENT]);
    await queueFinished();
    expect(receiver.requests).toBe(0);
  });

  it("keeps its id used when the connection ends during the first insert, which can't tell", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    // Postgres says so itself, with a FATAL, but that isn't a refusal of the statement.
    await onEventRow(`
      PERFORM pg_terminate_backend(pg_backend_pid());
      PERFORM pg_sleep(5);`);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/57P01/);
    await allowEventRows();

    // Nothing went in this time, and what Cronium was told doesn't say so.
    expect(await storedEvents()).toEqual([]);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    expect(await storedEvents()).toEqual([]);
    expect(receiver.requests).toBe(0);
  });
});

describe("freeing an id", () => {
  const BROKEN = { contentType: "application/json", body: '{"order":' };

  it("is done by the time the answer comes back, so a retry can't get there first", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    const release = WebhookSecurity.prototype.releaseDeliveryId;
    jest
      .spyOn(WebhookSecurity.prototype, "releaseDeliveryId")
      .mockImplementation(async function (
        this: WebhookSecurity,
        ...args: Parameters<typeof release>
      ) {
        await sleep(300);
        await release.apply(this, args);
      });

    expect((await send(webhook, BROKEN, deliveryId)).status).toBe(400);

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });

  // tests/storage/webhook-delivery-id-outage.test.ts has Valkey really going away here.
  it("leaves the answer as it was when Valkey won't do it, and the next request under the id frees it", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    // The id's check goes through, and giving the id back fails.
    const evaluate = Redis.prototype.eval;
    jest
      .spyOn(Redis.prototype, "eval")
      .mockImplementationOnce(function (
        this: Redis,
        ...args: Parameters<typeof evaluate>
      ) {
        return evaluate.apply(this, args);
      })
      .mockRejectedValueOnce(new Error("Connection is closed."));

    expect((await send(webhook, BROKEN, deliveryId)).status).toBe(400);
    expect(logged()).toMatch(/released when it's next used/);

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });
});

describe("a request that didn't consume the id it names", () => {
  async function acceptedRequest() {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(200);
    return { receiver, webhook, deliveryId };
  }

  it("doesn't free it with a replay's 401", async () => {
    const { receiver, webhook, deliveryId } = await acceptedRequest();

    for (let n = 0; n < 3; n++) {
      expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    }

    await expectOneEventSent(webhook, receiver);
  });

  it("doesn't free it with a bad signature, so a stranger can't", async () => {
    const { receiver, webhook, deliveryId } = await acceptedRequest();
    const stranger = { ...webhook, secret: "not the secret" };

    expect(await send(stranger, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: "Invalid signature" },
    });

    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  it("doesn't free it with a 500 from before the id is checked", async () => {
    const { receiver, webhook, deliveryId } = await acceptedRequest();
    const other = await webhookAt(await tenant(), receiver.url, { events: [] });

    const restore = await unreadableSecretOn(webhook.id, other);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/SecretDecryptionError/);
    await restore();

    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  it("can't use up an id with a refusal from before it's checked", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    // A stranger who has seen the id, a body over the cap, and a disabled webhook.
    const stranger = { ...webhook, secret: "not the secret" };
    expect((await send(stranger, AN_EVENT, deliveryId)).status).toBe(401);
    expect(
      (
        await send(
          webhook,
          {
            contentType: "text/plain",
            body: "x".repeat(INBOUND_CAP_BYTES + 1),
          },
          deliveryId,
        )
      ).status,
    ).toBe(413);
    await db
      .update(webhooks)
      .set({ active: false })
      .where(eq(webhooks.id, webhook.id));
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(403);
    await db
      .update(webhooks)
      .set({ active: true })
      .where(eq(webhooks.id, webhook.id));

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });
});

describe("a captured copy of a refused request", () => {
  /** A request with exact bytes to replay, refused for a reason that goes away. */
  async function refusedRequest() {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    const copy = signed(webhook, AN_EVENT, deliveryId);

    await refuseEventRows(`NEW.event = '${EVENT}'`);
    expect((await post(copy)).status).toBe(500);
    await allowEventRows();

    return { receiver, webhook, deliveryId, copy };
  }

  it("is taken at most once, in place of its sender's own retry", async () => {
    const { receiver, webhook, deliveryId, copy } = await refusedRequest();

    expect((await post(copy)).status).toBe(200);

    // The sender's retry is told the id is used, which is true: its event is in.
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    expect((await post(copy)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  it("is taken once when it races its sender's retry", async () => {
    const { receiver, webhook, deliveryId, copy } = await refusedRequest();

    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        n % 2 === 0 ? post(copy) : send(webhook, AN_EVENT, deliveryId),
      ),
    );

    expect(answers.map(({ status }) => status).sort()).toEqual([
      200, 401, 401, 401, 401, 401, 401, 401,
    ]);
    expect((await post(copy)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  it("can't be taken once a corrected request has used the id", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();
    const copy = signed(
      webhook,
      { contentType: "application/json", body: '{"order":' },
      deliveryId,
    );

    expect((await post(copy)).status).toBe(400);
    await expectTakenOnce(webhook, deliveryId);

    expect((await post(copy)).status).toBe(401);
    await expectOneEventSent(webhook, receiver);
  });

  // The reason docs/WEBHOOKS.md says to keep the id: a retry under a new one leaves
  // the first free until its timestamp is too old.
  it("is taken as well as a retry under a new id", async () => {
    const { receiver, webhook, copy } = await refusedRequest();

    expect((await send(webhook)).status).toBe(200);
    expect((await post(copy)).status).toBe(200);
    expect((await post(copy)).status).toBe(401);

    await queueFinished();
    expect(await storedEvents()).toHaveLength(2 * ROWS_OF_AN_EVENT.length);
    expect(receiver.requests).toBe(2);
  });
});
