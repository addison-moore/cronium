/**
 * What a refused inbound request leaves of its delivery id, through the real route,
 * against real Postgres, real Valkey and a real HTTP receiver.
 *
 * `verifyWebhook` consumes the id before the rest is decided. A request refused after
 * that has done nothing, so sending it again isn't a replay, and a 401 would read as
 * an attack to a sender keeping its id across attempts and stop it retrying. A request
 * that stored its event or queued a delivery is the opposite: its id has to stay used, or
 * a replay repeats what it did. So these count rows and requests at the receiver as well
 * as reading the answers.
 *
 * An event's two `webhook_events` rows go in one transaction, so until its COMMIT nothing
 * can have been stored, and only a COMMIT with no answer leaves Cronium unable to tell.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { asc, eq } from "drizzle-orm";
import Redis from "ioredis";
import { NextRequest } from "next/server";
import { Client, type QueryConfig } from "pg";
import { POST as postToInboundRoute } from "@/app/api/webhooks/[key]/route";
import { cacheService } from "@/lib/cache/cache-service";
import { RateLimitService } from "@/lib/rate-limit-service";
import {
  MAX_INBOUND_EVENT_NAME_CHARS,
  MAX_INBOUND_JSON_DEPTH,
} from "@/lib/webhooks/storable-event";
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

/** A real HTTP server that takes everything and keeps what arrives. */
async function startReceiver() {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
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
      return bodies.length;
    },
    bodies,
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
      webhookQueue: {
        queue: Map<string, unknown>;
        processing: Set<string>;
        heldBytes: number;
      };
    }
  ).webhookQueue;

const queueFinished = () =>
  until(
    "the queue to finish",
    () =>
      managerQueue().queue.size === 0 && managerQueue().processing.size === 0,
  );

/** Room `prepareEvent` claimed has to come back when nothing is queued after all. */
const expectNoRoomHeld = () => expect(managerQueue().heldBytes).toBe(0);

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

/** What the endpoint's log says about each request to this webhook, in order. */
const loggedRequests = async (webhookId: number) =>
  db
    .select({ success: webhookLogs.success, error: webhookLogs.error })
    .from(webhookLogs)
    .where(eq(webhookLogs.webhookId, webhookId))
    .orderBy(asc(webhookLogs.id));

const json = (body: string): SentEvent => ({
  contentType: "application/json",
  body,
});

const tenant = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

/** Webhooks this test made, whose rate-limit windows it has to clear. */
const webhooksMade: number[] = [];

async function webhookAt(
  owner: string,
  url: string,
  {
    events = [`webhook.${EVENT}`],
    // Webhook ids start again after each reset, and a window another file left for
    // the same id can still be open, so a limit a test isn't about shouldn't be one
    // it can reach.
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
  webhooksMade.push(webhook.id);
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

/** Run this inside Postgres for each new webhook_events row, as its COMMIT runs. */
async function atCommit(body: string) {
  await pool.query(`
    CREATE FUNCTION at_commit() RETURNS trigger AS $$
    BEGIN
      ${body}
      RETURN NULL;
    END
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE CONSTRAINT TRIGGER at_commit AFTER INSERT ON webhook_events
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION at_commit()`);
}

/** A FATAL, so the connection ends, and then time for it to take effect. */
const KILL_OWN_CONNECTION = `
  PERFORM pg_terminate_backend(pg_backend_pid());
  PERFORM pg_sleep(5);`;

async function allowEventRows() {
  await pool.query("DROP TRIGGER IF EXISTS on_event_row ON webhook_events");
  await pool.query("DROP FUNCTION IF EXISTS on_event_row");
  await pool.query("DROP TRIGGER IF EXISTS at_commit ON webhook_events");
  await pool.query("DROP FUNCTION IF EXISTS at_commit");
}

/**
 * Have Postgres run the next statement `matches` picks and its answer never arrive: the
 * socket stops being read before the statement goes out, and closes once `ran` says
 * Postgres has run it. A connection lost at that moment looks the same from here as one
 * lost before the statement got there. A transaction's statements go through its own
 * client, so this watches every client.
 */
function loseTheAnswerToTheNext(
  matches: (text: string) => boolean,
  ran: (backendPid: number) => Promise<boolean>,
) {
  const realQuery = Client.prototype.query as (...args: unknown[]) => unknown;
  const spy = jest
    .spyOn(Client.prototype, "query")
    .mockImplementation(function (this: Client, ...args: unknown[]) {
      const config = args[0] as QueryConfig | string;
      if (typeof config === "object" && matches(config.text)) {
        spy.mockRestore();
        const client = this as Client & {
          connection: { stream: Socket };
          processID: number;
        };
        const socket = client.connection.stream;
        socket.pause();
        // Whatever happens, the request gets its answer, and the test says what's wrong.
        void until("the statement to run", () => ran(client.processID))
          .catch(() => undefined)
          .finally(() => socket.destroy());
      }
      return realQuery.apply(this, args);
    } as never);
}

/** Whether that connection's last statement was this one, and it's waiting for the next. */
async function ranAndWaiting(backendPid: number, statement: string) {
  const { rows } = await pool.query<{ state: string; query: string }>(
    "SELECT state, query FROM pg_stat_activity WHERE pid = $1",
    [backendPid],
  );
  return (
    rows[0]?.state === "idle in transaction" &&
    rows[0].query.startsWith(statement)
  );
}

const EVENT_INSERT = 'insert into "webhook_events"';

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
  // The next test's webhooks, and the next file's, get these ids again, and would
  // carry on in these windows. This file sends nearly 100 requests to webhook 1 within
  // a minute, and a suite run straight after it with the default limit of 100 got 429s.
  await Promise.all(
    webhooksMade
      .splice(0)
      .map((id) => RateLimitService.reset(`webhook:${id}`, "webhook")),
  );
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

describe("a 500 before anything is committed", () => {
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
      // The endpoint's own row went in first, and goes with it.
      name: "Postgres refuses the row its deliveries go out on",
      breakIt: async () => {
        await refuseEventRows(`NEW.event = 'webhook.${EVENT}'`);
        return allowEventRows;
      },
      failure: /P0001/,
    },
    {
      // Postgres's own answer to the COMMIT, which says nothing went in. Only for the
      // endpoint's own row, so the other is left if it was written outside the
      // transaction.
      name: "Postgres refuses the COMMIT",
      breakIt: async () => {
        await atCommit(
          `IF NEW.event = '${EVENT}' THEN RAISE EXCEPTION 'refused at commit'; END IF;`,
        );
        return allowEventRows;
      },
      failure: /P0001/,
    },
    {
      // Which says nothing about the statement, but its transaction ends with it.
      name: "the connection ends during the endpoint's own insert",
      breakIt: async () => {
        await onEventRow(
          `IF NEW.event = '${EVENT}' THEN ${KILL_OWN_CONNECTION} END IF;`,
        );
        return allowEventRows;
      },
      failure: /not queryable|terminated/,
    },
    {
      name: "the connection ends during the insert of the row its deliveries go out on",
      breakIt: async () => {
        await onEventRow(
          `IF NEW.event = 'webhook.${EVENT}' THEN ${KILL_OWN_CONNECTION} END IF;`,
        );
        return allowEventRows;
      },
      failure: /not queryable|terminated/,
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
    expectNoRoomHeld();
    await fix?.();

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });

  it("leaves its id free when the answer to the endpoint's own insert is lost after it ran", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    // Outside a transaction this row could be in, with only the answer lost. In one,
    // Postgres rolls it back once the connection's gone, because nothing committed it.
    loseTheAnswerToTheNext(
      (text) => text.startsWith(EVENT_INSERT),
      (backendPid) => ranAndWaiting(backendPid, EVENT_INSERT),
    );
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/not queryable|terminated/);
    expect(await storedEvents()).toEqual([]);
    expectNoRoomHeld();

    await expectTakenOnce(webhook, deliveryId);
    await expectOneEventSent(webhook, receiver);
  });
});

describe("a 500 once the request may have had an effect", () => {
  it("keeps its id used when the COMMIT's answer is lost after it went in", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    loseTheAnswerToTheNext(
      (text) => text === "commit",
      async () => (await storedEvents()).length > 0,
    );
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/not queryable|terminated/);

    // Both rows are in, and Cronium couldn't tell, so it queued nothing and gave the
    // room back.
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);
    expectNoRoomHeld();
    await queueFinished();
    expect(receiver.requests).toBe(0);
    expect(await deliveryStatuses(webhook.id)).toEqual([]);

    // A replay can't store it again.
    expect(await send(webhook, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);

    // Its history has nothing for it, which is what tells its sender to use a new id.
    expect((await send(webhook)).status).toBe(200);
    await queueFinished();
    expect(await storedEvents()).toEqual([
      ...ROWS_OF_AN_EVENT,
      ...ROWS_OF_AN_EVENT,
    ]);
    expect(receiver.requests).toBe(1);
    expect(await deliveryStatuses(webhook.id)).toEqual(["success"]);
  });

  it("keeps its id used when the connection ends during the COMMIT, which can't tell", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);
    const deliveryId = randomUUID();

    // Postgres says so itself, with a FATAL, but a COMMIT can have gone through before
    // one of those.
    await atCommit(KILL_OWN_CONNECTION);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(500);
    expect(logged()).toMatch(/not queryable|terminated/);
    await allowEventRows();

    // Nothing went in this time, and what Cronium was told doesn't say so.
    expect(await storedEvents()).toEqual([]);
    expectNoRoomHeld();
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    expect(await storedEvents()).toEqual([]);
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
});

describe("a request Postgres could never store", () => {
  /** One character, though it's two of a string's `length`. */
  const EMOJI = "\u{1F600}";
  const NUL = /it has a NUL character \(U\+0000\)/;
  const halfAPair = (codeUnit: string) =>
    new RegExp(
      `half of a UTF-16 surrogate pair \\(U\\+${codeUnit}\\) on its own`,
    );

  it.each<{ name: string; refused: SentEvent; error: RegExp }>([
    {
      name: "a NUL in a JSON value",
      refused: json('{"note":"\\u0000"}'),
      error: NUL,
    },
    {
      name: "a NUL in a JSON key",
      refused: json('{"a\\u0000":1}'),
      error: NUL,
    },
    {
      name: "a NUL nested in an array",
      refused: json('{"notes":[["fine","\\u0000"]]}'),
      error: NUL,
    },
    {
      name: "a NUL byte in a plain-text body",
      refused: { contentType: "text/plain", body: "a\u0000b" },
      error: NUL,
    },
    {
      name: "a NUL in a form",
      refused: {
        contentType: "application/x-www-form-urlencoded",
        body: "note=%00",
      },
      error: NUL,
    },
    {
      name: "a NUL in its name",
      refused: { ...json('{"event":"order\\u0000created"}'), event: null },
      error: NUL,
    },
    {
      name: "half a surrogate pair in a JSON value",
      refused: json('{"note":"\\ud83d"}'),
      error: halfAPair("D83D"),
    },
    {
      name: "half a surrogate pair in a JSON key",
      refused: json('{"\\ude00":1}'),
      error: halfAPair("DE00"),
    },
    {
      name: "half a surrogate pair in its name",
      refused: { ...json('{"event":"order\\ud83d"}'), event: null },
      error: halfAPair("D83D"),
    },
  ])(
    "is refused with a 400 before anything is written when it has $name, and its id stays free",
    async ({ refused, error }) => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url, {
        events: ["*"],
      });
      const deliveryId = randomUUID();

      const answer = await send(webhook, refused, deliveryId);
      expect(answer.status).toBe(400);
      expect(answer.answer.error).toMatch(error);
      // The same bytes are the same mistake, not a replay.
      expect((await send(webhook, refused, deliveryId)).status).toBe(400);
      expect(await storedEvents()).toEqual([]);
      expectNoRoomHeld();
      // Said where the webhook's owner can see it, as a 413 is.
      expect(await loggedRequests(webhook.id)).toEqual([
        { success: false, error: answer.answer.error },
        { success: false, error: answer.answer.error },
      ]);

      await expectTakenOnce(webhook, deliveryId);
      await expectOneEventSent(webhook, receiver);
    },
  );

  it("takes what only looks like those", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(await tenant(), receiver.url);

    // A whole pair is one character, spelled out in escapes or not. `\\u0000` is a
    // backslash and the letters `u0000`. Only NUL is refused of the control characters.
    const body = `{"escapedPair":"\\ud83d\\ude00","pair":"${EMOJI}","written":"\\\\u0000","control":"\\u0001","last":"\\uffff","${EMOJI}":"in a key"}`;
    expect((await send(webhook, json(body))).status).toBe(200);
    await expectOneEventSent(webhook, receiver);

    const [stored] = await db
      .select({ payload: webhookEvents.payload })
      .from(webhookEvents)
      .where(eq(webhookEvents.event, EVENT));
    expect(stored!.payload).toMatchObject({
      escapedPair: EMOJI,
      pair: EMOJI,
      written: "\\u0000",
      control: "\u0001",
      last: "\uffff",
      [EMOJI]: "in a key",
    });
  });

  describe("its name", () => {
    const named = (event: string): SentEvent => ({ ...AN_EVENT, event });
    const longest = "x".repeat(MAX_INBOUND_EVENT_NAME_CHARS);
    const tooLong = "x".repeat(MAX_INBOUND_EVENT_NAME_CHARS + 1);

    it("can be as long as `webhook.<name>` fits in `webhook_events.event`", async () => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url, {
        events: ["*"],
      });

      expect(MAX_INBOUND_EVENT_NAME_CHARS).toBe(247);
      expect((await send(webhook, named(longest))).status).toBe(200);
      await queueFinished();
      expect(await storedEvents()).toEqual([longest, `webhook.${longest}`]);
      expect(`webhook.${longest}`).toHaveLength(255);
      expect(receiver.requests).toBe(1);
    });

    it("is refused with a 400 before anything is written when it's longer, and its id stays free", async () => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url, {
        events: ["*"],
      });
      const deliveryId = randomUUID();

      expect(await send(webhook, named(tooLong), deliveryId)).toMatchObject({
        status: 400,
        answer: {
          error:
            "This event's name is too long: it has 248 characters, and the limit is 247.",
        },
      });
      expect(await storedEvents()).toEqual([]);
      expectNoRoomHeld();
      await queueFinished();
      expect(receiver.requests).toBe(0);

      expect((await send(webhook, named(longest), deliveryId)).status).toBe(
        200,
      );
      expect(await send(webhook, named(longest), deliveryId)).toMatchObject({
        status: 401,
        answer: { error: REPLAYED },
      });
      await queueFinished();
      expect(await storedEvents()).toEqual([longest, `webhook.${longest}`]);
      expect(receiver.requests).toBe(1);
    });

    it("is refused when it's longer whether or not anything subscribes to it", async () => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url, {
        events: ["something.else"],
      });

      // Only the endpoint's own row would go in, and that would fit, but the answer
      // shouldn't change when a webhook subscribes to everything.
      expect((await send(webhook, named(tooLong))).status).toBe(400);
      expect(await storedEvents()).toEqual([]);

      expect((await send(webhook, named(longest))).status).toBe(200);
      expect(await storedEvents()).toEqual([longest]);
      await queueFinished();
      expect(receiver.requests).toBe(0);
    });

    it("is counted in characters, as Postgres counts them", async () => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url, {
        events: ["*"],
      });
      // Each is two of a string's `length`. Headers can't carry these, so the body does.
      const inBody = (characters: number): SentEvent => ({
        ...json(JSON.stringify({ event: EMOJI.repeat(characters) })),
        event: null,
      });

      expect((await send(webhook, inBody(248))).status).toBe(400);
      expect(await storedEvents()).toEqual([]);

      const longestInEmoji = EMOJI.repeat(MAX_INBOUND_EVENT_NAME_CHARS);
      expect((await send(webhook, inBody(247))).status).toBe(200);
      await queueFinished();
      expect(await storedEvents()).toEqual([
        longestInEmoji,
        `webhook.${longestInEmoji}`,
      ]);
      expect(receiver.requests).toBe(1);
    });
  });
});

describe("a request nested too deep to process", () => {
  /** `depth` arrays, one inside the next. */
  const arrays = (depth: number) => `${"[".repeat(depth)}1${"]".repeat(depth)}`;
  /** `depth` objects, one inside the next. */
  const objects = (depth: number) =>
    `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
  const tooDeep = (depth: number) =>
    `This event is nested too deeply: it has arrays and objects ${depth.toLocaleString("en-US")} levels deep, and the limit is ${MAX_INBOUND_JSON_DEPTH}.`;

  /** Each as deep as it's told, and what the endpoint's own row keeps of it. */
  const shapes: Array<{
    name: string;
    body: (depth: number) => string;
    stored: (body: string) => object;
  }> = [
    {
      // Anything but an object goes under `data`.
      name: "in arrays",
      body: arrays,
      stored: (body) => ({ data: JSON.parse(body) as unknown }),
    },
    {
      // An object's fields are merged into the event's.
      name: "in objects",
      body: objects,
      stored: (body) => JSON.parse(body) as object,
    },
    {
      name: "in arrays in a field",
      body: (depth) => `{"a":${arrays(depth - 1)}}`,
      stored: (body) => JSON.parse(body) as object,
    },
  ];

  it.each(shapes)(
    "is taken as deep as the limit, $name, and delivered whole",
    async ({ body: nested, stored }) => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url);
      const body = nested(MAX_INBOUND_JSON_DEPTH);

      expect(MAX_INBOUND_JSON_DEPTH).toBe(256);
      expect((await send(webhook, json(body))).status).toBe(200);
      await expectOneEventSent(webhook, receiver);

      const [row] = await db
        .select({ payload: webhookEvents.payload })
        .from(webhookEvents)
        .where(eq(webhookEvents.event, EVENT));
      expect(row!.payload).toMatchObject(stored(body));
      const delivered = JSON.parse(receiver.bodies[0]!) as { data: unknown };
      expect(delivered.data).toMatchObject(stored(body));
    },
  );

  it.each(shapes)(
    "is refused with a 400 one level deeper, $name, before anything is claimed or written, and its id stays free",
    async ({ body: nested }) => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url);
      const deliveryId = randomUUID();
      const refused = json(nested(MAX_INBOUND_JSON_DEPTH + 1));

      expect(await send(webhook, refused, deliveryId)).toMatchObject({
        status: 400,
        answer: { error: tooDeep(MAX_INBOUND_JSON_DEPTH + 1) },
      });
      // The same bytes are the same mistake, not a replay.
      expect((await send(webhook, refused, deliveryId)).status).toBe(400);
      expect(await storedEvents()).toEqual([]);
      expectNoRoomHeld();
      // Said where the webhook's owner can see it, as the other 400s are.
      expect(await loggedRequests(webhook.id)).toEqual([
        { success: false, error: tooDeep(MAX_INBOUND_JSON_DEPTH + 1) },
        { success: false, error: tooDeep(MAX_INBOUND_JSON_DEPTH + 1) },
      ]);

      // Corrected under the same id, it's taken once.
      await expectTakenOnce(
        webhook,
        deliveryId,
        json(nested(MAX_INBOUND_JSON_DEPTH)),
      );
      await expectOneEventSent(webhook, receiver);
    },
  );

  /** The most arrays a request can nest: a `[` and a `]` each, around a `1`. */
  const DEEPEST_A_REQUEST_HOLDS = (INBOUND_CAP_BYTES - 2) / 2;

  // Each of these was a 500 on every attempt, when the endpoint's own walk through the
  // event ran out of stack.
  it.each<{ name: string; refused: SentEvent; depth: number }>([
    {
      name: "3,000 levels deep",
      refused: json(arrays(3_000)),
      depth: 3_000,
    },
    {
      name: "as deep as a request can hold",
      refused: json(arrays(DEEPEST_A_REQUEST_HOLDS)),
      depth: DEEPEST_A_REQUEST_HOLDS,
    },
    {
      // `String` gives out on this too, and the name is read with it.
      name: "deep in the field its name is read from",
      refused: { ...json(`{"event":${arrays(3_000)}}`), event: null },
      depth: 3_001,
    },
  ])(
    "is refused the same way $name, and its id stays free",
    async ({ refused, depth }) => {
      const receiver = await startReceiver();
      const webhook = await webhookAt(await tenant(), receiver.url);
      const deliveryId = randomUUID();

      expect(await send(webhook, refused, deliveryId)).toMatchObject({
        status: 400,
        answer: { error: tooDeep(depth) },
      });
      expect(await storedEvents()).toEqual([]);
      expectNoRoomHeld();

      await expectTakenOnce(webhook, deliveryId);
      await expectOneEventSent(webhook, receiver);
    },
  );
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
