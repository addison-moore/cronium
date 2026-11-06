/**
 * What a webhook delivery reports and records when the database won't take what
 * happened, or when a receiver's answer doesn't arrive whole, through the real tRPC
 * mutation and the real queue, against real Postgres and a real HTTP receiver.
 *
 * Real on purpose: what's under test is how many requests a receiver gets and what
 * Postgres accepts. A mocked insert can't refuse a NUL byte, and its errors don't
 * have Drizzle's wrapper, whose message repeats every value in the query. That
 * message used to reach the mutation's answer and the `error` column, and a 200
 * nobody could record used to be sent again by the queue. So did a 200 whose body
 * ran past the cap or was cut off, because axios rejected the request over it.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import axios from "axios";
import { asc, eq } from "drizzle-orm";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db, pool } from "@/server/db";
import {
  UserRole,
  UserStatus,
  webhookDeliveries,
  webhooks,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// Deliveries go to a real HTTP server on loopback, which the SSRF guard would
// otherwise refuse. Everything after the guard is the real delivery path.
const mockAssertRequestUrlIsPublic = jest.fn();
jest.mock("@/lib/ssrf-guard", () => ({
  ...jest.requireActual<object>("@/lib/ssrf-guard"),
  assertRequestUrlIsPublic: (url: string) => mockAssertRequestUrlIsPublic(url),
  ssrfHttpAgent: undefined,
  ssrfHttpsAgent: undefined,
}));

// The 30 second limits on a receiver, too long for a test to wait out. A test that
// waits one out shortens it here. The body's limit has its own setting so that a test
// stopping on it isn't also racing the request's: on a busy machine, a short limit on
// the request could fire before the status arrives.
let mockRequestTimeoutMs: number | undefined;
let mockBodyTimeoutMs: number | undefined;
jest.mock("@/lib/webhooks/response-body", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/webhooks/response-body")
  >("@/lib/webhooks/response-body");
  return {
    ...actual,
    get WEBHOOK_TIMEOUT_MS() {
      return mockRequestTimeoutMs ?? actual.WEBHOOK_TIMEOUT_MS;
    },
    readResponseBody: (
      ...[body, maxBytes, timeoutMs]: Parameters<typeof actual.readResponseBody>
    ) =>
      actual.readResponseBody(body, maxBytes, mockBodyTimeoutMs ?? timeoutMs),
  };
});

// Sessions are built below. The real NextAuth stack needs a request scope.
jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn().mockResolvedValue(null),
}));

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

const RETRIES = { maxRetries: 3, retryDelay: 100, backoffMultiplier: 1 };

const NOT_RECORDED =
  "It couldn't be recorded, so it won't show in the webhook's history.";

// MAX_WEBHOOK_RESPONSE_BYTES and MAX_RECORDED_RESPONSE_CHARS, which are private.
const CAP_BYTES = 1024 * 1024;
const RECORDED_CHARS = 1000;

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

interface Answer {
  status?: number;
  headers?: http.OutgoingHttpHeaders;
  body?: string | Buffer;
  /** Answers by hand, in place of the three above. */
  respond?: (res: http.ServerResponse) => void;
}

const openReceivers: Array<() => Promise<void>> = [];

/**
 * A real HTTP server. It gives each answer in turn and then repeats the last.
 * `meanwhile` runs after a request has arrived and before it's answered.
 */
async function startReceiver(
  answers: Answer[] = [{}],
  meanwhile?: () => Promise<unknown>,
) {
  const deliveryIds: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const {
        status = 200,
        headers,
        body = "from the receiver",
        respond,
      } = answers[Math.min(deliveryIds.length, answers.length - 1)]!;
      deliveryIds.push(String(req.headers["x-delivery-id"]));
      void Promise.resolve(meanwhile?.()).then(() =>
        respond ? respond(res) : res.writeHead(status, headers).end(body),
      );
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
  return { url: `http://127.0.0.1:${port}/hook`, deliveryIds, close };
}

/**
 * Has Postgres refuse delivery rows the way it would refuse anything else, so the
 * error comes back through the driver and Drizzle like a real one.
 */
async function refuseDeliveryRows(condition = "true") {
  await pool.query(`
    CREATE FUNCTION refuse_delivery_row() RETURNS trigger AS $$
    BEGIN
      IF ${condition} THEN
        RAISE EXCEPTION 'this row is refused';
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE TRIGGER refuse_delivery_row BEFORE INSERT ON webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION refuse_delivery_row()`);
}

/**
 * What Node says about a header name holding a NUL, which it quotes. A delivery now
 * fails before Node sees such a name, so this stands for any error that quotes what it
 * was given. A test can't get it from a real request either: Node's error comes from
 * outside Jest's sandbox, where it isn't `instanceof Error` and so would be recorded as
 * "Unknown error".
 */
function nodeRefusalOfHeaderName(): string {
  try {
    http.request({ host: "127.0.0.1", headers: { "X-Bad\0Name": "value" } });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Node took a header name holding a NUL");
}

/** A status and the start of a body, and then the connection drops. */
const dropsAfter = (
  start: string,
  status = 200,
  headers: http.OutgoingHttpHeaders = { "Content-Length": 5000 },
): Answer => ({
  respond: (res) => {
    res.writeHead(status, headers);
    res.write(start, () => res.destroy());
  },
});

/**
 * An answer that doesn't end by itself, and the promise of seeing its connection
 * closed. `respond` starts it, and its receiver can only stop when that happens.
 */
function untilClosed(respond: (res: http.ServerResponse) => void) {
  let closed!: () => void;
  const connectionClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const answer: Answer = {
    respond: (res) => {
      res.once("close", closed);
      respond(res);
    },
  };
  return {
    answer,
    closedSoon: () =>
      Promise.race([
        connectionClosed,
        sleep(10_000).then(() => {
          throw new Error("The connection stayed open");
        }),
      ]),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

const manager = WebhookManager.getInstance();
let owner: string;

const webhookAt = (url: string) =>
  manager.registerWebhook(owner, {
    url,
    events: ["order.created"],
    active: true,
    retryConfig: RETRIES,
  });

const testWebhook = (webhookId: number) =>
  callerFor(owner).webhookSystem.test({ webhookId });

/** Private, but nothing else can say when the queue has finished with an event. */
const queueState = (
  manager as unknown as {
    webhookQueue: { queue: Map<string, unknown>; processing: Set<string> };
  }
).webhookQueue;

/** Sends a real event through the queue, and waits until it has no attempts left. */
async function sendThroughQueue() {
  await manager.triggerEvent("order.created", { order: 1 }, owner);
  const deadline = Date.now() + 30_000;
  while (queueState.queue.size > 0 || queueState.processing.size > 0) {
    if (Date.now() > deadline) throw new Error("The queue never finished");
    await sleep(25);
  }
}

let errorLog: jest.SpyInstance;
const loggedErrors = () => errorLog.mock.calls.flat().map(String);

beforeEach(async () => {
  mockAssertRequestUrlIsPublic.mockReset();
  mockRequestTimeoutMs = undefined;
  mockBodyTimeoutMs = undefined;
  await resetDatabase();
  owner = await seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await pool.query(`DROP FUNCTION IF EXISTS refuse_delivery_row() CASCADE`);
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await closePool();
});

describe("a receiver that answers with a NUL byte", () => {
  it("reports a 2xx as delivered, and records it without the NUL", async () => {
    const receiver = await startReceiver([{ body: "before\0after" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(receiver.deliveryIds).toHaveLength(1);
    expect(answer).toMatchObject({
      success: true,
      data: {
        id: receiver.deliveryIds[0],
        success: true,
        statusCode: 200,
        response: "beforeafter",
      },
      message: "Test webhook delivered",
    });
    expect(answer.data).not.toHaveProperty("recorded");
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "success",
      statusCode: 200,
      response: "beforeafter",
      error: null,
    });
    expect(loggedErrors()).toEqual([]);

    // So it counts like any other delivery.
    const stats = await callerFor(owner).webhookSystem.getStats({
      webhookId: webhook.id,
    });
    expect(stats.metrics).toMatchObject({
      totalDeliveries: 1,
      successfulDeliveries: 1,
      failedDeliveries: 0,
    });
  });

  it("reports a refusal as refused, and records it without the NUL", async () => {
    const receiver = await startReceiver([{ status: 503, body: "try\0later" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: { success: false, statusCode: 503, response: "trylater" },
      message: "Test webhook failed: HTTP 503",
    });
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      statusCode: 503,
      response: "trylater",
    });
  });

  it("records a body of nothing but NULs as empty", async () => {
    const receiver = await startReceiver([{ body: "\0\0\0" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer.data).toMatchObject({ success: true, response: "" });
    const [row] = await deliveriesOf(webhook.id);
    expect(row).toMatchObject({ status: "success", response: "" });
  });

  it("isn't sent again by the queue after a 2xx", async () => {
    const receiver = await startReceiver([{ body: "before\0after" }]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: receiver.deliveryIds[0],
      status: "success",
      statusCode: 200,
      response: "beforeafter",
    });
  });

  it("is sent again by the queue after a refusal, until a 2xx", async () => {
    const receiver = await startReceiver([
      { status: 503, body: "try\0later" },
      { status: 200, body: "got\0it" },
    ]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(2);
    const rows = await deliveriesOf(webhook.id);
    expect(
      rows.map(({ deliveryId, status, statusCode, response }) => ({
        deliveryId,
        status,
        statusCode,
        response,
      })),
    ).toEqual([
      {
        deliveryId: receiver.deliveryIds[0],
        status: "failed",
        statusCode: 503,
        response: "trylater",
      },
      {
        deliveryId: receiver.deliveryIds[1],
        status: "success",
        statusCode: 200,
        response: "gotit",
      },
    ]);
  });
});

describe("a response cut at the cap", () => {
  it("reports what it records when the cut lands inside an emoji", async () => {
    const receiver = await startReceiver([
      { body: `${"x".repeat(999)}\u{1F600}and the rest` },
    ]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    const expected = `${"x".repeat(999)}\uFFFD`;
    expect(answer.data.response).toBe(expected);
    const [row] = await deliveriesOf(webhook.id);
    expect(row!.response).toBe(expected);
  });
});

describe("an error holding a NUL byte", () => {
  const refusal = nodeRefusalOfHeaderName();
  const refusalWithoutNul = refusal.replaceAll("\0", "");

  it("is what Node says about such a header name", () => {
    expect(refusal).toContain("\0");
  });

  it("reports a failed request, and records it without the NUL", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    jest.spyOn(axios, "request").mockRejectedValue(new Error(refusal));

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: { success: false, error: refusalWithoutNul },
      message: `Test webhook failed: ${refusalWithoutNul}`,
    });
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "failed",
      statusCode: null,
      error: refusalWithoutNul,
    });
  });

  it("is recorded for each attempt the queue makes", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    jest.spyOn(axios, "request").mockRejectedValue(new Error(refusal));

    await sendThroughQueue();

    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ error }) => error)).toEqual([
      refusalWithoutNul,
      refusalWithoutNul,
      refusalWithoutNul,
    ]);
  });

  it("is recorded without the NUL when it's the SSRF guard's", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    mockAssertRequestUrlIsPublic.mockImplementationOnce(() => {
      throw new SsrfBlockedError("Invalid URL: a\0b");
    });

    const answer = await testWebhook(webhook.id);

    expect(receiver.deliveryIds).toHaveLength(0);
    expect(answer).toMatchObject({
      success: false,
      data: { statusCode: 0, error: "Invalid URL: ab" },
      message: "Test webhook failed: Invalid URL: ab",
    });
    const [row] = await deliveriesOf(webhook.id);
    expect(row).toMatchObject({
      status: "failed",
      statusCode: 0,
      error: "Invalid URL: ab",
    });
  });
});

describe("an attempt the database won't record", () => {
  it("stays a success, with no failed row standing in for it", async () => {
    // A failed row would go in, so this shows none is tried: this is how a 200
    // became a failure with Drizzle's message in `error`.
    await refuseDeliveryRows("NEW.status = 'success'");
    const receiver = await startReceiver([{ body: "secret in the body" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(receiver.deliveryIds).toHaveLength(1);
    expect(answer).toMatchObject({
      success: true,
      data: {
        id: receiver.deliveryIds[0],
        success: true,
        recorded: false,
        statusCode: 200,
        response: "secret in the body",
      },
      message: `Test webhook delivered. ${NOT_RECORDED}`,
    });
    expect(answer.data.error).toBeUndefined();
    expect(JSON.stringify(answer)).not.toContain("Failed query");
    expect(await deliveriesOf(webhook.id)).toEqual([]);
  });

  it("logs which delivery it was and why, without the query's values", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver([{ body: "secret in the body" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    const logged = loggedErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`Delivery ${answer.data.id} `);
    expect(logged[0]).toContain(`to webhook ${webhook.id} `);
    expect(logged[0]).toContain("(success, status code 200)");
    expect(logged[0]).toContain("P0001: this row is refused");
    expect(logged[0]).not.toContain("Failed query");
    expect(logged[0]).not.toContain("params");
    expect(logged[0]).not.toContain("secret in the body");
  });

  it("stays a refusal, and says so", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver([{ status: 503, body: "try later" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: {
        success: false,
        recorded: false,
        statusCode: 503,
        response: "try later",
      },
      message: `Test webhook failed: HTTP 503. ${NOT_RECORDED}`,
    });
  });

  it("stays a failed request, and says so", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    await receiver.close();

    const answer = await testWebhook(webhook.id);

    expect(answer.success).toBe(false);
    expect(answer.data.recorded).toBe(false);
    expect(answer.data.error).toBeTruthy();
    expect(answer.data.error).not.toContain("Failed query");
    expect(answer.message).toBe(
      `Test webhook failed: ${answer.data.error}. ${NOT_RECORDED}`,
    );
  });

  it("stays blocked by the SSRF guard, and says so", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    mockAssertRequestUrlIsPublic.mockImplementationOnce(() => {
      throw new SsrfBlockedError("Host is a disallowed (internal) address");
    });

    const answer = await testWebhook(webhook.id);

    expect(receiver.deliveryIds).toHaveLength(0);
    expect(answer).toMatchObject({
      success: false,
      data: { recorded: false, statusCode: 0 },
      message: `Test webhook failed: Host is a disallowed (internal) address. ${NOT_RECORDED}`,
    });
  });

  it("isn't sent again by the queue after a 2xx", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    expect(await deliveriesOf(webhook.id)).toEqual([]);
    expect(loggedErrors()).toHaveLength(1);
  });

  it("is sent again by the queue after a refusal, as any refusal is", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver([{ status: 503 }]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(RETRIES.maxRetries);
    expect(await deliveriesOf(webhook.id)).toEqual([]);
    expect(loggedErrors()).toHaveLength(RETRIES.maxRetries);
  });
});

describe("a webhook deleted while its request is in flight", () => {
  it("reports what the receiver did, with nothing left to record it on", async () => {
    let webhookId = 0;
    const receiver = await startReceiver([{ body: "taken" }], () =>
      db.delete(webhooks).where(eq(webhooks.id, webhookId)),
    );
    webhookId = (await webhookAt(receiver.url)).id;

    const answer = await testWebhook(webhookId);

    expect(answer).toMatchObject({
      success: true,
      data: { recorded: false, statusCode: 200, response: "taken" },
      message: `Test webhook delivered. ${NOT_RECORDED}`,
    });
    expect(loggedErrors()[0]).toContain("23503: insert or update");
  });

  it("isn't sent again by the queue", async () => {
    let webhookId = 0;
    const receiver = await startReceiver([{ body: "taken" }], () =>
      db.delete(webhooks).where(eq(webhooks.id, webhookId)),
    );
    webhookId = (await webhookAt(receiver.url)).id;

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    expect(await deliveriesOf(webhookId)).toEqual([]);
  });
});

describe("an answer past the size cap", () => {
  const recorded = "a".repeat(RECORDED_CHARS);
  const long = `${recorded}${"b".repeat(2 * CAP_BYTES)}`;

  it("reports a 2xx as delivered, and records its status and how it starts", async () => {
    const receiver = await startReceiver([{ body: long }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(receiver.deliveryIds).toHaveLength(1);
    expect(answer).toMatchObject({
      success: true,
      data: {
        id: receiver.deliveryIds[0],
        success: true,
        statusCode: 200,
        response: recorded,
      },
      message: "Test webhook delivered",
    });
    expect(answer.data.error).toBeUndefined();
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "success",
      statusCode: 200,
      response: recorded,
      error: null,
    });
    expect(Object.keys(rows[0]!.headers as object)).toContain("X-Delivery-Id");
  });

  it("isn't sent again by the queue after a 2xx", async () => {
    const receiver = await startReceiver([{ body: long }]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: receiver.deliveryIds[0],
      status: "success",
      statusCode: 200,
      response: recorded,
    });
  });

  it("reports a refusal as refused, and records its status", async () => {
    const receiver = await startReceiver([{ status: 503, body: long }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: { success: false, statusCode: 503, response: recorded },
      message: "Test webhook failed: HTTP 503",
    });
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      statusCode: 503,
      response: recorded,
      error: null,
    });
  });

  it("is sent again by the queue after a refusal, as any refusal is", async () => {
    const receiver = await startReceiver([{ status: 503, body: long }]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(RETRIES.maxRetries);
    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ status, statusCode }) => [status, statusCode])).toEqual([
      ["failed", 503],
      ["failed", 503],
      ["failed", 503],
    ]);
  });

  it("stops reading a body with no end, and closes its connection", async () => {
    let sent = 0;
    const chunk = Buffer.alloc(64 * 1024, "x");
    const endless = untilClosed((res) => {
      res.writeHead(200);
      const send = () => {
        while (!res.destroyed && res.write(chunk)) sent += chunk.length;
        if (!res.destroyed) res.once("drain", send);
      };
      send();
    });
    const receiver = await startReceiver([endless.answer]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer.data).toMatchObject({
      success: true,
      statusCode: 200,
      response: "x".repeat(RECORDED_CHARS),
    });
    await endless.closedSoon();
    // What's past the cap here is in socket buffers, which the machine sizes. Reading
    // to the limit on the whole read would take gigabytes.
    expect(sent).toBeLessThan(64 * CAP_BYTES);
  });

  it("counts what decompression produces, not what was sent", async () => {
    const small = zlib.gzipSync(Buffer.alloc(8 * CAP_BYTES, "z"));
    expect(small.length).toBeLessThan(CAP_BYTES);
    const receiver = await startReceiver([
      { headers: { "Content-Encoding": "gzip" }, body: small },
    ]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const [row] = await deliveriesOf(webhook.id);
    expect(row).toMatchObject({
      status: "success",
      statusCode: 200,
      response: "z".repeat(RECORDED_CHARS),
    });
  });

  it("closes the connection under a compressed body too", async () => {
    const open = untilClosed((res) => {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      const gzip = zlib.createGzip();
      gzip.pipe(res);
      gzip.write(Buffer.alloc(2 * CAP_BYTES, "z"));
      gzip.flush();
    });
    const receiver = await startReceiver([open.answer]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer.data).toMatchObject({
      success: true,
      statusCode: 200,
      response: "z".repeat(RECORDED_CHARS),
    });
    await open.closedSoon();
  });
});

describe("an answer with no body", () => {
  it("is delivered, with an empty response", async () => {
    const receiver = await startReceiver([{ status: 204, body: "" }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: true,
      data: { statusCode: 204, response: "" },
      message: "Test webhook delivered",
    });
  });
});

describe("a 2xx whose connection drops before its body ends", () => {
  const UNFINISHED = "The response didn't finish (aborted)";

  it.each([
    ["a length", { "Content-Length": 5000 }],
    ["chunks", {}],
  ])(
    "reports it as delivered, says the body didn't finish, and records what came, with %s",
    async (_name, headers) => {
      const receiver = await startReceiver([
        dropsAfter("start of the answer", 200, headers),
      ]);
      const webhook = await webhookAt(receiver.url);

      const answer = await testWebhook(webhook.id);

      expect(receiver.deliveryIds).toHaveLength(1);
      expect(answer).toMatchObject({
        success: true,
        data: {
          id: receiver.deliveryIds[0],
          success: true,
          statusCode: 200,
          response: "start of the answer",
          error: UNFINISHED,
        },
        message: `Test webhook delivered. ${UNFINISHED}`,
      });
      const rows = await deliveriesOf(webhook.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        deliveryId: answer.data.id,
        status: "success",
        statusCode: 200,
        response: "start of the answer",
        error: UNFINISHED,
      });
      expect(loggedErrors()).toEqual([]);
    },
  );

  it("isn't sent again by the queue", async () => {
    const receiver = await startReceiver([dropsAfter("start of the answer")]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: receiver.deliveryIds[0],
      status: "success",
      statusCode: 200,
      response: "start of the answer",
      error: UNFINISHED,
    });
  });

  it("counts as a successful delivery", async () => {
    const receiver = await startReceiver([dropsAfter("start of the answer")]);
    const webhook = await webhookAt(receiver.url);

    await testWebhook(webhook.id);

    const stats = await callerFor(owner).webhookSystem.getStats({
      webhookId: webhook.id,
    });
    expect(stats.metrics).toMatchObject({
      totalDeliveries: 1,
      successfulDeliveries: 1,
      failedDeliveries: 0,
    });
  });

  it("records an empty response when only the status arrived", async () => {
    const receiver = await startReceiver([
      {
        respond: (res) => {
          res.writeHead(200, { "Content-Length": 5000 });
          res.flushHeaders();
          setTimeout(() => res.destroy(), 50);
        },
      },
    ]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: true,
      data: { statusCode: 200, response: "", error: UNFINISHED },
    });
  });

  it("says both things when the row won't go in either", async () => {
    await refuseDeliveryRows();
    const receiver = await startReceiver([dropsAfter("start of the answer")]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: true,
      data: { recorded: false, statusCode: 200, error: UNFINISHED },
      message: `Test webhook delivered. ${UNFINISHED}. ${NOT_RECORDED}`,
    });
  });

  it("counts a compressed body the same way", async () => {
    const receiver = await startReceiver([
      {
        respond: (res) => {
          res.writeHead(200, { "Content-Encoding": "gzip" });
          res.flushHeaders();
          const gzip = zlib.createGzip();
          gzip.pipe(res, { end: false });
          gzip.write("start of the answer");
          gzip.flush(() => res.destroy());
        },
      },
    ]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "success", statusCode: 200 });
    expect(rows[0]!.error).toContain("The response didn't finish");
  });
});

describe("a refusal whose connection drops before its body ends", () => {
  const UNFINISHED = "The response didn't finish (aborted)";

  it("reports the status first, and records it", async () => {
    const receiver = await startReceiver([dropsAfter("start of it", 503)]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: {
        success: false,
        statusCode: 503,
        response: "start of it",
        error: UNFINISHED,
      },
      message: `Test webhook failed: HTTP 503. ${UNFINISHED}`,
    });
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      statusCode: 503,
      response: "start of it",
      error: UNFINISHED,
    });
  });

  it("is sent again by the queue, as any refusal is", async () => {
    const receiver = await startReceiver([dropsAfter("start of it", 503)]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(RETRIES.maxRetries);
    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ status, statusCode }) => [status, statusCode])).toEqual([
      ["failed", 503],
      ["failed", 503],
      ["failed", 503],
    ]);
  });
});

describe("a 2xx whose body can't be decompressed", () => {
  it("reports it as delivered, and isn't sent again by the queue", async () => {
    const receiver = await startReceiver([
      { headers: { "Content-Encoding": "gzip" }, body: "this isn't gzip" },
    ]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "success",
      statusCode: 200,
      response: "",
      error: "The response didn't finish (incorrect header check)",
    });
  });
});

describe("a retry whose answer doesn't arrive whole", () => {
  const retry = (deliveryId: string) =>
    callerFor(owner).webhookSystem.retryDelivery({ deliveryId });

  it("reports a 2xx past the cap as delivered", async () => {
    const receiver = await startReceiver([
      { status: 503 },
      { body: "x".repeat(2 * CAP_BYTES) },
    ]);
    const webhook = await webhookAt(receiver.url);
    const first = await testWebhook(webhook.id);

    const answer = await retry(first.data.id);

    expect(receiver.deliveryIds).toHaveLength(2);
    expect(answer).toMatchObject({
      success: true,
      data: {
        statusCode: 200,
        response: "x".repeat(RECORDED_CHARS),
      },
      message: "Webhook delivery retry succeeded",
    });
    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ status, statusCode }) => [status, statusCode])).toEqual([
      ["failed", 503],
      ["success", 200],
    ]);
  });

  it("says a 2xx didn't finish", async () => {
    const receiver = await startReceiver([
      { status: 503 },
      dropsAfter("start of the answer"),
    ]);
    const webhook = await webhookAt(receiver.url);
    const first = await testWebhook(webhook.id);

    const answer = await retry(first.data.id);

    expect(answer).toMatchObject({
      success: true,
      data: { statusCode: 200, response: "start of the answer" },
      message:
        "Webhook delivery retry succeeded. The response didn't finish (aborted)",
    });
  });

  it("puts the status first when a refusal doesn't finish", async () => {
    const receiver = await startReceiver([
      { status: 503 },
      dropsAfter("start of it", 502),
    ]);
    const webhook = await webhookAt(receiver.url);
    const first = await testWebhook(webhook.id);

    const answer = await retry(first.data.id);

    expect(answer).toMatchObject({
      success: false,
      data: { statusCode: 502, response: "start of it" },
      message:
        "Webhook delivery retry failed: HTTP 502. The response didn't finish (aborted)",
    });
  });

  it("says when it couldn't be recorded", async () => {
    const receiver = await startReceiver([{ status: 503 }, {}]);
    const webhook = await webhookAt(receiver.url);
    const first = await testWebhook(webhook.id);
    await refuseDeliveryRows();

    const answer = await retry(first.data.id);

    expect(answer).toMatchObject({
      success: true,
      data: { recorded: false, statusCode: 200 },
      message: `Webhook delivery retry succeeded. ${NOT_RECORDED}`,
    });
  });
});

describe("a receiver that goes quiet", () => {
  const LIMIT_MS = 200;
  const UNFINISHED = "The response didn't finish within 0.2 seconds";

  const quietAfter = (start: string, status = 200) =>
    untilClosed((res) => {
      res.writeHead(status, { "Content-Length": 5000 });
      res.write(start);
    });

  beforeEach(() => {
    mockBodyTimeoutMs = LIMIT_MS;
  });

  it("reports a 2xx as delivered, and closes the connection at the limit", async () => {
    const quiet = quietAfter("start of the answer");
    const receiver = await startReceiver([quiet.answer]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: true,
      data: {
        statusCode: 200,
        response: "start of the answer",
        error: UNFINISHED,
      },
      message: `Test webhook delivered. ${UNFINISHED}`,
    });
    expect(answer.data.duration).toBeGreaterThanOrEqual(LIMIT_MS);
    await quiet.closedSoon();
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "success",
      statusCode: 200,
      response: "start of the answer",
      error: UNFINISHED,
    });
  });

  it("isn't sent again by the queue after a 2xx", async () => {
    const quiet = quietAfter("start of the answer");
    const receiver = await startReceiver([quiet.answer]);
    const webhook = await webhookAt(receiver.url);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows.map(({ status, statusCode }) => [status, statusCode])).toEqual([
      ["success", 200],
    ]);
  });

  it("reports a refusal as refused, and the queue sends it again", async () => {
    const quiet = quietAfter("start of it", 503);
    const receiver = await startReceiver([quiet.answer]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);
    expect(answer.message).toBe(`Test webhook failed: HTTP 503. ${UNFINISHED}`);

    await sendThroughQueue();

    expect(receiver.deliveryIds).toHaveLength(1 + RETRIES.maxRetries);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1 + RETRIES.maxRetries);
    expect(new Set(rows.map(({ statusCode }) => statusCode))).toEqual(
      new Set([503]),
    );
  });

  it("doesn't let a body sent a little at a time outlast the limit", async () => {
    const dribble = untilClosed((res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write("."), 20);
      res.once("close", () => clearInterval(timer));
    });
    const receiver = await startReceiver([dribble.answer]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer.data).toMatchObject({
      success: true,
      statusCode: 200,
      error: UNFINISHED,
    });
    await dribble.closedSoon();
  });

  it("still times out a request that gets no status, and retries it", async () => {
    mockRequestTimeoutMs = LIMIT_MS;
    const timedOut = `timeout of ${LIMIT_MS}ms exceeded`;
    const receiver = await startReceiver([{ respond: () => undefined }]);
    const webhook = await webhookAt(receiver.url);

    const answer = await testWebhook(webhook.id);

    expect(answer).toMatchObject({
      success: false,
      data: { success: false, error: timedOut },
      message: `Test webhook failed: ${timedOut}`,
    });
    expect(answer.data.statusCode).toBeUndefined();

    await sendThroughQueue();

    // By its rows, not its requests: a request this short can time out on a busy
    // machine before the receiver has seen it.
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1 + RETRIES.maxRetries);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "failed",
        statusCode: null,
        error: timedOut,
      });
    }
  });
});
