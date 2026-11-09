/**
 * The inbound endpoint's delivery id check while Valkey is away, through the real
 * route, against real Postgres, real Valkey and a real HTTP receiver.
 *
 * Without Valkey, Cronium can't tell a new delivery id from a used one, so it can't
 * accept anything. What it says then matters: `401 Duplicate or replayed delivery`
 * reads as an attack and stops a sender, where a 503 tells it to come back. And
 * whatever an outage interrupts, the id has to work for the same event once Valkey is
 * back, and only once. So these count stored rows and requests at the receiver as
 * well as reading the answers.
 *
 * Valkey goes away behind a proxy, which closes its connections and refuses new ones,
 * as a stopped server does. Valkey keeps what it holds, as it would through a network
 * fault, or a restart from the append-only file the shipped Compose file turns on.
 * Where it loses or refuses something, that's done to the real Valkey directly.
 *
 * The proxy can also pause Valkey, as `docker pause` or a partition does: connections
 * stay open, and what's sent waits until Valkey runs it, once it's resumed.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { asc, eq } from "drizzle-orm";
import Redis from "ioredis";
import { NextRequest } from "next/server";
import { POST as postToInboundRoute } from "@/app/api/webhooks/[key]/route";
import { cacheService } from "@/lib/cache/cache-service";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookQueue } from "@/lib/webhooks/WebhookQueue";
import { WebhookSecurity } from "@/lib/webhooks/WebhookSecurity";
import { ANSWER_TIMEOUT_MS } from "@/lib/webhooks/webhook-replay-store";
import { db } from "@/server/db";
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
const UNAVAILABLE =
  "Delivery ids can't be checked right now, so this event wasn't accepted. Nothing was stored or sent. Send it again later, under the same delivery id.";
const EVENT = "order.created";
/** The endpoint's own row, and the one its deliveries go out on. */
const ROWS_OF_AN_EVENT = [EVENT, `webhook.${EVENT}`];

interface SentEvent {
  contentType: string;
  body: string;
}

const AN_EVENT: SentEvent = {
  contentType: "application/json",
  body: JSON.stringify({ order: 1 }),
};

const BROKEN: SentEvent = {
  contentType: "application/json",
  body: '{"order":',
};

type Webhook = Awaited<ReturnType<typeof webhookAt>>;

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

/** Requests a test stopped waiting for, which have to finish before the next test. */
const unfinished: Array<Promise<unknown>> = [];

/** What the request is answered with, or a failure if that takes longer than `ms`. */
async function answeredWithin<T>(ms: number, request: Promise<T>) {
  unfinished.push(request.catch(() => undefined));
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No answer within ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What Valkey does with the next command that names a delivery id. */
type AfterItRuns =
  /** The connection drops before the answer arrives, and Valkey stays. */
  | "loses-the-answer"
  /** Valkey goes away before answering. */
  | "goes-away-before-answering"
  /** Valkey answers, then goes away. */
  | "answers-and-goes-away"
  /** Valkey answers, then stops answering anything, with its connections left open. */
  | "answers-and-pauses";

/**
 * Valkey behind a proxy that can take it away. Going away closes every connection and
 * refuses new ones. Coming back listens on the same port, so a client reconnects to it
 * the way it would to a restarted server. Pausing holds what's sent on every
 * connection, so Valkey runs none of it until it's resumed.
 */
async function valkeyThatCanGoAway(valkeyUrl: string) {
  const target = new URL(valkeyUrl);
  const links = new Set<{
    client: net.Socket;
    valkey: net.Socket;
    held: Array<string | Buffer>;
  }>();
  let watched: { text: string; then: AfterItRuns } | undefined;
  let closing: Promise<void> | undefined;
  let away = false;
  let paused = false;
  let port = 0;

  const proxy = net.createServer((client) => {
    const valkey = net.connect(Number(target.port), target.hostname);
    const link = { client, valkey, held: [] as Array<string | Buffer> };
    links.add(link);
    let onAnswer: ((answer: Buffer) => void) | undefined;
    const close = () => {
      links.delete(link);
      client.destroy();
      valkey.destroy();
    };
    for (const socket of [client, valkey]) {
      socket.on("error", () => undefined);
      socket.on("close", close);
    }
    client.on("data", (command) => {
      if (watched && command.includes(watched.text)) {
        const { then } = watched;
        watched = undefined;
        onAnswer = (answer) => {
          if (then === "loses-the-answer") client.destroy();
          else if (then === "goes-away-before-answering") void goAway();
          else if (then === "answers-and-pauses") {
            client.write(answer);
            paused = true;
          }
          // Closed once the answer is sent, so the client reads it first.
          else client.end(answer, () => void goAway());
        };
      }
      if (paused) link.held.push(command);
      else valkey.write(command);
    });
    valkey.on("data", (answer) => {
      const handle = onAnswer;
      onAnswer = undefined;
      if (handle) handle(answer);
      else client.write(answer);
    });
  });

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(port, "127.0.0.1", () => {
        proxy.off("error", reject);
        port = (proxy.address() as net.AddressInfo).port;
        resolve();
      });
    });

  function goAway(): Promise<void> {
    if (!away) {
      away = true;
      // What a paused Valkey was holding goes with it.
      paused = false;
      closing = new Promise<void>((resolve) => proxy.close(() => resolve()));
      for (const { client, valkey } of links) {
        client.destroy();
        valkey.destroy();
      }
    }
    return closing!;
  }

  async function comeBack() {
    if (!away) return;
    await closing;
    await listen();
    away = false;
  }

  await listen();

  return {
    url: `redis://127.0.0.1:${port}`,
    goAway,
    comeBack,
    pause: () => {
      paused = true;
    },
    /** Valkey runs everything it was sent while paused, in order, and answers. */
    resume: () => {
      paused = false;
      for (const { valkey, held } of links) {
        for (const command of held.splice(0)) valkey.write(command);
      }
    },
    /** How many times `text` appears in what's waiting for Valkey to resume. */
    held: (text: string) =>
      [...links]
        .flatMap(({ held }) => held)
        .join("")
        .split(text).length - 1,
    /** Valkey runs the next command naming `text`, and then does `then`. */
    whenItRuns: (text: string, then: AfterItRuns) => {
      watched = { text, then };
    },
    get away() {
      return away;
    },
    get paused() {
      return paused;
    },
  };
}

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
  const { port } = server.address() as net.AddressInfo;

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

async function webhookAt(url: string) {
  const owner = await seedUser({
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });
  const webhook = await manager.registerWebhook(owner, {
    url,
    events: [`webhook.${EVENT}`],
    active: true,
    retryConfig: { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 },
  });
  // Webhook ids start again after each reset, and the rate limit's window doesn't, so
  // a limit these tests aren't about shouldn't be one they can reach.
  await db
    .update(webhooks)
    .set({ rateLimit: { requests: 1_000_000, window: 60_000 } })
    .where(eq(webhooks.id, webhook.id));
  return webhook;
}

/** A request signed the way the docs say, kept so its exact bytes can be sent again. */
function signed(
  { key, secret }: { key: string; secret: string },
  { contentType, body }: SentEvent = AN_EVENT,
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
      "x-webhook-event": EVENT,
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

/** What a sender has to be told while Cronium can't check its id. */
function expectUnavailable(answer: Awaited<ReturnType<typeof post>>) {
  expect(answer).toMatchObject({
    status: 503,
    answer: { error: UNAVAILABLE },
  });
  expect(answer.headers.get("Retry-After")).toMatch(/^[1-9][0-9]*$/);
}

/**
 * A sender keeping its id and sending the event again until it's answered, which it
 * should be once Valkey is back. Until then it's only ever told to come back.
 */
async function sendUntilAnswered(
  webhook: Webhook,
  deliveryId: string,
  sent: SentEvent = AN_EVENT,
) {
  const deadline = performance.now() + 20_000;
  for (;;) {
    const answer = await send(webhook, sent, deliveryId);
    if (answer.status !== 503) return answer;
    expectUnavailable(answer);
    if (performance.now() > deadline) throw new Error("Never answered");
    await sleep(50);
  }
}

/** Everything the accepted events leave behind, and nothing more. */
async function expectEventsSent(
  count: number,
  webhook: Webhook,
  receiver: Awaited<ReturnType<typeof startReceiver>>,
) {
  await queueFinished();
  await until(
    "every attempt on record",
    async () => (await deliveryStatuses(webhook.id)).length >= count,
  );
  expect(await storedEvents()).toEqual(
    Array.from({ length: count }, () => ROWS_OF_AN_EVENT).flat(),
  );
  expect(receiver.requests).toBe(count);
  expect(await deliveryStatuses(webhook.id)).toEqual(
    Array.from({ length: count }, () => "success"),
  );
}

const realValkeyUrl = process.env.VALKEY_URL ?? process.env.REDIS_URL!;
let valkey: Awaited<ReturnType<typeof valkeyThatCanGoAway>>;
/** Straight to Valkey, for what the proxy can't do to it. */
let direct: Redis;
let errorLog: jest.SpyInstance;

/** Everything logged, so a test can check a failure is the one it means. */
const logged = () => errorLog.mock.calls.flat().join("\n");

beforeAll(async () => {
  valkey = await valkeyThatCanGoAway(realValkeyUrl);
  // The delivery id check reads this when it first connects, and nothing else here
  // does any more: the cache, which the rate limit uses, connected when it loaded.
  process.env.VALKEY_URL = valkey.url;
  process.env.REDIS_URL = valkey.url;
  direct = new Redis(realValkeyUrl);
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
  await direct.config("SET", "maxmemory", "0");
  if (valkey.paused) valkey.resume();
  if (valkey.away) {
    // A test that failed partway. The next one starts with Valkey back.
    await valkey.comeBack();
    await sleep(2_500);
  }
  await Promise.all(unfinished.splice(0));
  // Nothing from this test may write a row during the next one: ids start again after
  // a reset, so it would land on that test's webhook.
  await queueFinished();
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  process.env.VALKEY_URL = realValkeyUrl;
  process.env.REDIS_URL = realValkeyUrl;
  // Left up: the delivery id check's client can't be closed from here, and it would
  // otherwise keep trying to reconnect through the rest of the run.
  await valkey.comeBack();
  direct.disconnect();
  await closePool();
});

describe("while Valkey is away", () => {
  it("says so with a 503, and takes the same id once it's back", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    await valkey.goAway();
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expect(await storedEvents()).toEqual([]);

    const logs = await db
      .select({ success: webhookLogs.success, error: webhookLogs.error })
      .from(webhookLogs)
      .where(eq(webhookLogs.webhookId, webhook.id));
    expect(logs).toEqual([
      { success: false, error: UNAVAILABLE },
      { success: false, error: UNAVAILABLE },
    ]);

    await valkey.comeBack();
    expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    expect(await send(webhook, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    await expectEventsSent(1, webhook, receiver);
  });

  it("accepts nothing, and an id used before it went away is still used after", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const used = randomUUID();
    const fresh = [randomUUID(), randomUUID(), randomUUID()];

    expect((await send(webhook, AN_EVENT, used)).status).toBe(200);
    await expectEventsSent(1, webhook, receiver);

    await valkey.goAway();
    for (const deliveryId of [used, ...fresh, used]) {
      expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    }
    await queueFinished();
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);
    expect(receiver.requests).toBe(1);

    await valkey.comeBack();
    expect(await sendUntilAnswered(webhook, used)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    for (const deliveryId of fresh) {
      expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(200);
    }
    await expectEventsSent(4, webhook, receiver);
  });
});

describe("a request Valkey goes away on", () => {
  it("isn't called a replay when Valkey took its id and the answer was lost", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    valkey.whenItRuns(deliveryId, "goes-away-before-answering");
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expect(await storedEvents()).toEqual([]);
    // Valkey holds the id, though the request was told nothing was taken.
    expect(await direct.keys(`*:${deliveryId}`)).toHaveLength(1);

    await valkey.comeBack();
    expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectEventsSent(1, webhook, receiver);
  });

  it("isn't called its own replay when the connection drops and the check is sent again", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    // The client sends what was unanswered again once it has reconnected, and Valkey
    // has already run it once.
    valkey.whenItRuns(deliveryId, "loses-the-answer");
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(200);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectEventsSent(1, webhook, receiver);
  });

  it("keeps the answer it was refused with, and its id works once Valkey is back", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    // Taken, and gone before the refusal could give it back.
    valkey.whenItRuns(deliveryId, "answers-and-goes-away");
    expect(await send(webhook, BROKEN, deliveryId)).toMatchObject({
      status: 400,
      answer: { error: "Invalid request body" },
    });
    expect(valkey.away).toBe(true);
    expect(await direct.keys(`*:${deliveryId}`)).toHaveLength(1);

    // The corrected request, while Valkey is still away.
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expect(await storedEvents()).toEqual([]);

    await valkey.comeBack();
    expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectEventsSent(1, webhook, receiver);
  });

  it("is taken once when retries under its id race once Valkey is back", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    valkey.whenItRuns(deliveryId, "goes-away-before-answering");
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    await valkey.comeBack();
    // Another event, until the check works again, so the race starts with it working.
    expect((await sendUntilAnswered(webhook, randomUUID())).status).toBe(200);

    // Each held until all eight are in, so they reach the check together, each carrying
    // the claim Cronium is left holding. The lookups before it would spread them out.
    const verifyWebhook = WebhookSecurity.prototype.verifyWebhook;
    let arrived = 0;
    let allIn!: () => void;
    const together = new Promise<void>((resolve) => (allIn = resolve));
    jest
      .spyOn(WebhookSecurity.prototype, "verifyWebhook")
      .mockImplementation(async function (
        this: WebhookSecurity,
        ...args: Parameters<typeof verifyWebhook>
      ) {
        if (++arrived === 8) allIn();
        await together;
        return verifyWebhook.apply(this, args);
      });
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => send(webhook, AN_EVENT, deliveryId)),
    );
    expect(answers.map(({ status }) => status).sort()).toEqual([
      200, 401, 401, 401, 401, 401, 401, 401,
    ]);
    await expectEventsSent(2, webhook, receiver);
  });
});

describe("a Valkey that loses an id it held", () => {
  it("doesn't let a refused request free the id once another has taken it", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    // The first request holds the id, and waits before it's refused.
    let reached!: () => void;
    const atTheWait = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => (resume = resolve));
    const checkRateLimit = WebhookSecurity.prototype.checkRateLimit;
    jest
      .spyOn(WebhookSecurity.prototype, "checkRateLimit")
      .mockImplementationOnce(async function (
        this: WebhookSecurity,
        ...args: Parameters<typeof checkRateLimit>
      ) {
        reached();
        await waiting;
        return checkRateLimit.apply(this, args);
      });
    const refused = send(webhook, BROKEN, deliveryId);
    await atTheWait;

    // Valkey forgets it, as a crash can before a write reaches the disk, and another
    // request under the same id is accepted.
    const [key] = await direct.keys(`*:${deliveryId}`);
    expect(await direct.del(key!)).toBe(1);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(200);

    resume();
    expect((await refused).status).toBe(400);
    expect(await send(webhook, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    await expectEventsSent(1, webhook, receiver);
  });
});

describe("a Valkey that won't store the id", () => {
  it("says so with a 503, and takes the same id once it can", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    // What a full Valkey with the shipped `noeviction` policy answers every write with.
    await direct.config("SET", "maxmemory", "1");
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expect(logged()).toMatch(/OOM/);
    expect(await storedEvents()).toEqual([]);

    await direct.config("SET", "maxmemory", "0");
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(200);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectEventsSent(1, webhook, receiver);
  });
});

describe("a Valkey that stops answering with its connections open", () => {
  /**
   * How soon a sender hears back, as docs/WEBHOOKS.md says: the time a request waits for
   * Valkey, and room for the rest of the request.
   */
  const A_FEW_SECONDS = 5_000;

  /** The check's client is connected, so the next thing Valkey is sent is a check. */
  async function connected(webhook: Webhook) {
    expect((await sendUntilAnswered(webhook, randomUUID())).status).toBe(200);
  }

  it("says so with a 503 within seconds, and takes the same id once Valkey answers again", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();
    await connected(webhook);

    valkey.pause();
    expectUnavailable(
      await answeredWithin(A_FEW_SECONDS, send(webhook, AN_EVENT, deliveryId)),
    );
    expect(logged()).toContain(
      `Valkey didn't answer within ${ANSWER_TIMEOUT_MS} ms`,
    );
    // The check was sent, and Valkey hasn't run it.
    expect(valkey.held(deliveryId)).toBe(1);
    expect(await direct.keys(`*:${deliveryId}`)).toEqual([]);
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);

    // Valkey runs it once it's resumed, taking the id for a request that was told
    // nothing was taken.
    valkey.resume();
    await until(
      "Valkey to run the check",
      async () => (await direct.keys(`*:${deliveryId}`)).length === 1,
    );
    expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    expect(await send(webhook, AN_EVENT, deliveryId)).toMatchObject({
      status: 401,
      answer: { error: REPLAYED },
    });
    await expectEventsSent(2, webhook, receiver);
  });

  it("answers the requests after the first at once, and sends Valkey nothing more until it answers", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const first = randomUUID();
    const later = Array.from({ length: 5 }, () => randomUUID());
    await connected(webhook);

    valkey.pause();
    expectUnavailable(
      await answeredWithin(A_FEW_SECONDS, send(webhook, AN_EVENT, first)),
    );
    for (const deliveryId of later) {
      const sentAt = performance.now();
      expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
      expect(performance.now() - sentAt).toBeLessThan(1_000);
    }
    // Only the first request's check went to Valkey.
    expect(valkey.held("cronium:webhook:delivery:")).toBe(1);
    expect(await storedEvents()).toEqual(ROWS_OF_AN_EVENT);

    valkey.resume();
    for (const deliveryId of [first, ...later]) {
      expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    }
    await expectEventsSent(2 + later.length, webhook, receiver);
  });

  it("still answers a refusal when Valkey stops before the id is let go of, and the id works once it answers", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const deliveryId = randomUUID();

    valkey.whenItRuns(deliveryId, "answers-and-pauses");
    expect(
      await answeredWithin(A_FEW_SECONDS, send(webhook, BROKEN, deliveryId)),
    ).toMatchObject({ status: 400, answer: { error: "Invalid request body" } });
    expect(valkey.paused).toBe(true);
    // Letting go of the id was sent, and Valkey hasn't run it.
    expect(valkey.held(deliveryId)).toBe(1);
    expect(await direct.keys(`*:${deliveryId}`)).toHaveLength(1);

    // The corrected request, while Valkey still isn't answering.
    expectUnavailable(await send(webhook, AN_EVENT, deliveryId));
    expect(await storedEvents()).toEqual([]);

    valkey.resume();
    expect((await sendUntilAnswered(webhook, deliveryId)).status).toBe(200);
    expect((await send(webhook, AN_EVENT, deliveryId)).status).toBe(401);
    await expectEventsSent(1, webhook, receiver);
  });
});
