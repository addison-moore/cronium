/**
 * Testing a webhook, through the real tRPC mutation, against real Postgres and a
 * real HTTP receiver.
 *
 * Real on purpose: what's under test is which URLs get a request and whether the
 * answer says what happened. Nothing short of a receiver shows that. This mutation
 * used to answer "Test webhook sent" before anything was sent, and it sent to every
 * webhook of the owner subscribed to `webhook.test` or `*`, not the one it was given.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq } from "drizzle-orm";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
  UserRole,
  UserStatus,
  webhookDeliveries,
  webhookEvents,
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

// Sessions are built below. The real NextAuth stack needs a request scope.
jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn().mockResolvedValue(null),
}));

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

/** Long enough for the queue, which looks every second, to have sent anything it
 * was given. */
const QUEUE_WAIT_MS = 1_500;

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

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server. It answers with each of `statuses` in turn, then 200s. */
async function startReceiver(
  statuses: number[] = [],
  body = "from the receiver",
) {
  const received: ReceivedRequest[] = [];
  const remaining = [...statuses];
  const server = http.createServer((req, res) => {
    let requestBody = "";
    req.on("data", (chunk) => (requestBody += String(chunk)));
    req.on("end", () => {
      received.push({ headers: req.headers, body: requestBody });
      res.writeHead(remaining.shift() ?? 200).end(body);
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
  return { url: `http://127.0.0.1:${port}/hook`, received, close };
}

const signatureOf = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

const allDeliveries = () => db.select().from(webhookDeliveries);

const eventRows = () =>
  db.select().from(webhookEvents).orderBy(asc(webhookEvents.id));

/** The delivery body a stored event comes to, built from nothing but its row. This
 * is what `retryDelivery` has to work with. */
const bodyFromRow = (row: typeof webhookEvents.$inferSelect) => ({
  id: String(row.id),
  event: row.event,
  timestamp: row.createdAt.toISOString(),
  ...(row.payload as Record<string, unknown>),
});

const manager = WebhookManager.getInstance();
let owner: string;

const seedActiveUser = () =>
  seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });

/** A webhook subscribed to something a test event isn't. */
const webhookAt = (
  url: string,
  overrides: Partial<Parameters<typeof manager.registerWebhook>[1]> = {},
) =>
  manager.registerWebhook(owner, {
    url,
    events: ["order.created"],
    active: true,
    ...overrides,
  });

let errorLog: jest.SpyInstance | undefined;
/** The router logs each error it passes on, which is expected noise here. */
function expectErrorLog() {
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
}

beforeEach(async () => {
  mockAssertRequestUrlIsPublic.mockReset();
  await resetDatabase();
  owner = await seedActiveUser();
});

afterEach(async () => {
  errorLog?.mockRestore();
  errorLog = undefined;
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await closePool();
});

describe("which webhook a test reaches", () => {
  it("reaches the one it names and no other, whatever each subscribes to", async () => {
    const named = [];
    for (const events of [["order.created"], [], ["*"], ["webhook.test"]]) {
      const receiver = await startReceiver();
      const webhook = await webhookAt(receiver.url, { events });
      named.push({ webhook, receiver });
    }
    // Another owner's, subscribed to everything this test event could match.
    const stranger = await seedActiveUser();
    const strangers = await startReceiver();
    for (const events of [["*"], ["webhook.test"]]) {
      await manager.registerWebhook(stranger, {
        url: strangers.url,
        events,
        active: true,
      });
    }
    const requests = () =>
      named.map(({ receiver }) => receiver.received.length);

    const expected = [0, 0, 0, 0];
    for (const [index, { webhook }] of named.entries()) {
      const answer = await callerFor(owner).webhookSystem.test({
        webhookId: webhook.id,
      });

      // It answers after the attempt: this webhook has its one request by now,
      // and each of the others has had only its own.
      expected[index] = 1;
      expect(requests()).toEqual(expected);
      expect(answer).toMatchObject({
        success: true,
        data: { webhookId: webhook.id },
      });
    }

    await sleep(QUEUE_WAIT_MS);
    expect(requests()).toEqual([1, 1, 1, 1]);
    expect(strangers.received).toHaveLength(0);
    expect(await allDeliveries()).toHaveLength(4);
    for (const { webhook } of named) {
      expect(await deliveriesOf(webhook.id)).toHaveLength(1);
    }
  });

  it("can try a webhook subscribed to nothing, which real events don't reach", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url, { events: [] });

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });
    expect(answer.success).toBe(true);

    await manager.triggerEvent("order.created", { order: 1 }, owner);

    // Fan-out found no subscriber, so no event row and nothing to deliver.
    expect(await eventRows()).toHaveLength(1);
    await sleep(QUEUE_WAIT_MS);
    expect(receiver.received).toHaveLength(1);
  });
});

describe("what a test sends", () => {
  it("sends an event in the form of any delivery, signed over its bytes", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);

    await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
      testData: { hello: "world", nested: { zebra: 1, apple: 2 } },
    });

    const [request] = receiver.received as [ReceivedRequest];
    const [event] = await eventRows();
    expect(JSON.parse(request.body)).toEqual({
      id: String(event!.id),
      event: "webhook.test",
      timestamp: event!.createdAt.toISOString(),
      data: {
        test: true,
        timestamp: expect.any(String),
        hello: "world",
        nested: { zebra: 1, apple: 2 },
      },
      metadata: { webhookId: webhook.id, triggeredBy: owner },
    });
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-webhook-id"]).toBe(String(webhook.id));
    expect(request.headers["x-webhook-event"]).toBe("webhook.test");
    expect(request.headers["x-webhook-timestamp"]).toBe(
      event!.createdAt.toISOString(),
    );
    expect(request.headers["x-webhook-signature"]).toBe(
      signatureOf(request.body, webhook.secret),
    );
  });

  it("uses the webhook's current URL, secret and headers", async () => {
    const before = await startReceiver();
    const webhook = await webhookAt(before.url);
    const after = await startReceiver();
    const token = `token-${randomUUID()}`;
    await manager.updateWebhook(webhook.id, owner, {
      url: after.url,
      headers: { Authorization: `Bearer ${token}` },
    });
    const rotated = await callerFor(owner).webhookSystem.regenerateSecret({
      webhookId: webhook.id,
    });

    await callerFor(owner).webhookSystem.test({ webhookId: webhook.id });

    expect(before.received).toHaveLength(0);
    const [request] = after.received as [ReceivedRequest];
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    expect(request.headers["x-webhook-signature"]).toBe(
      signatureOf(request.body, rotated.data.secret),
    );

    // Custom headers are usually credentials, so only their names are kept.
    const [row] = await deliveriesOf(webhook.id);
    expect(row!.headers).toMatchObject({ Authorization: "[redacted]" });
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe("what a test answers", () => {
  it("says so when the receiver took it, with what it answered", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });

    const [request] = receiver.received as [ReceivedRequest];
    expect(answer).toMatchObject({
      success: true,
      data: {
        id: request.headers["x-delivery-id"],
        webhookId: webhook.id,
        success: true,
        statusCode: 200,
        response: "from the receiver",
        duration: expect.any(Number),
      },
      message: "Test webhook delivered",
    });
  });

  it("says so when the receiver refuses it, and makes that one attempt", async () => {
    const receiver = await startReceiver([503, 503, 503], "try later");
    const webhook = await webhookAt(receiver.url, {
      // The queue would have repeated it by the end of the wait below.
      retryConfig: { maxRetries: 3, retryDelay: 100, backoffMultiplier: 1 },
    });

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });

    expect(answer).toMatchObject({
      success: false,
      data: {
        id: receiver.received[0]!.headers["x-delivery-id"],
        success: false,
        statusCode: 503,
        response: "try later",
      },
      message: "Test webhook failed: HTTP 503",
    });
    await sleep(QUEUE_WAIT_MS);
    expect(receiver.received).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "failed",
      statusCode: 503,
      response: "try later",
    });
  });

  it("says so when the receiver can't be reached", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    await receiver.close();

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });

    expect(answer.success).toBe(false);
    expect(answer.data.error).toBeTruthy();
    expect(answer.data.statusCode).toBeUndefined();
    expect(answer.message).toBe(`Test webhook failed: ${answer.data.error}`);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "failed",
      statusCode: null,
      error: answer.data.error,
    });
  });

  it("says why when the SSRF guard blocks it, and sends nothing", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    mockAssertRequestUrlIsPublic.mockImplementationOnce(() => {
      throw new SsrfBlockedError("Host is a disallowed (internal) address");
    });

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });

    expect(mockAssertRequestUrlIsPublic).toHaveBeenLastCalledWith(receiver.url);
    expect(answer).toMatchObject({
      success: false,
      data: {
        success: false,
        statusCode: 0,
        error: "Host is a disallowed (internal) address",
      },
      message: "Test webhook failed: Host is a disallowed (internal) address",
    });
    expect(receiver.received).toHaveLength(0);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: answer.data.id,
      status: "failed",
      statusCode: 0,
      error: "Host is a disallowed (internal) address",
    });
  });

  it("reports no more of a long response than it records", async () => {
    const receiver = await startReceiver([], "x".repeat(5000));
    const webhook = await webhookAt(receiver.url);

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
    });

    expect(answer.data.response).toBe("x".repeat(1000));
    const [row] = await deliveriesOf(webhook.id);
    expect(row!.response).toBe("x".repeat(1000));
  });
});

describe("what a test records", () => {
  it("records the attempt on an event row of the form triggerEvent stores", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);

    // A real event first, to compare with.
    await manager.triggerEvent("order.created", { order: 1 }, owner, {
      source: "storage-test",
    });
    for (
      let waited = 0;
      (await deliveriesOf(webhook.id)).length < 1;
      waited++
    ) {
      if (waited > 600) throw new Error("The real event was never delivered");
      await sleep(25);
    }

    const answer = await callerFor(owner).webhookSystem.test({
      webhookId: webhook.id,
      testData: { hello: "world" },
    });

    const [fanOutRow, testRow] = await eventRows();
    const [fanOutRequest, testRequest] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];

    // The same fields in `payload`, and from the row alone comes the same body
    // that was sent. That's what a retry of either one needs.
    expect(Object.keys(testRow!.payload as object).sort()).toEqual([
      "data",
      "metadata",
    ]);
    expect(Object.keys(fanOutRow!.payload as object).sort()).toEqual([
      "data",
      "metadata",
    ]);
    expect(bodyFromRow(fanOutRow!)).toEqual(JSON.parse(fanOutRequest.body));
    expect(bodyFromRow(testRow!)).toEqual(JSON.parse(testRequest.body));

    // Under the webhook's owner, which a retry also checks.
    expect(testRow).toMatchObject({
      event: "webhook.test",
      userId: owner,
      sourceWebhookId: webhook.id,
    });

    // A delivery on that row, like any other. It's the one the answer names.
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      webhookEventId: testRow!.id,
      deliveryId: answer.data.id,
      status: "success",
      statusCode: 200,
      response: "from the receiver",
    });
  });

  it("shows in the webhook's history and stats, under webhook.test", async () => {
    const receiver = await startReceiver([200, 503]);
    const webhook = await webhookAt(receiver.url);
    const caller = callerFor(owner);

    const delivered = await caller.webhookSystem.test({
      webhookId: webhook.id,
    });
    const refused = await caller.webhookSystem.test({ webhookId: webhook.id });

    const history = await caller.webhookSystem.getEventHistory({
      webhookId: webhook.id,
    });
    expect(
      history.items
        .map(({ event, delivery }) => [
          event.event,
          delivery.deliveryId,
          delivery.status,
        ])
        .sort(),
    ).toEqual(
      [
        ["webhook.test", delivered.data.id, "success"],
        ["webhook.test", refused.data.id, "failed"],
      ].sort(),
    );

    const stats = await caller.webhookSystem.getStats({
      webhookId: webhook.id,
    });
    expect(stats.metrics).toMatchObject({
      totalDeliveries: 2,
      successfulDeliveries: 1,
      failedDeliveries: 1,
    });
  });
});

describe("tests it refuses", () => {
  beforeEach(expectErrorLog);

  it("won't send to a disabled webhook, whatever it subscribes to", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url, {
      events: ["*"],
      active: false,
    });
    const caller = callerFor(owner);

    await expect(
      caller.webhookSystem.test({ webhookId: webhook.id }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Webhook is disabled",
    });

    await sleep(QUEUE_WAIT_MS);
    expect(receiver.received).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(await allDeliveries()).toHaveLength(0);

    await manager.updateWebhook(webhook.id, owner, { active: true });
    const answer = await caller.webhookSystem.test({ webhookId: webhook.id });
    expect(answer.success).toBe(true);
    expect(receiver.received).toHaveLength(1);
  });

  it("treats another user's webhook as one that doesn't exist", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const stranger = await seedActiveUser();

    await expect(
      callerFor(stranger).webhookSystem.test({ webhookId: webhook.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor(owner).webhookSystem.test({ webhookId: webhook.id + 1000 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(receiver.received).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(await allDeliveries()).toHaveLength(0);
  });

  it("records nothing when the webhook's secret can't be read", async () => {
    const receiver = await startReceiver();
    const webhook = await webhookAt(receiver.url);
    const other = await webhookAt(receiver.url);
    // An envelope is bound to its webhook, so another webhook's won't decrypt.
    const [{ secret: othersSecret } = { secret: "" }] = await db
      .select({ secret: webhooks.secret })
      .from(webhooks)
      .where(eq(webhooks.id, other.id));
    await db
      .update(webhooks)
      .set({ secret: othersSecret })
      .where(eq(webhooks.id, webhook.id));

    await expect(
      callerFor(owner).webhookSystem.test({ webhookId: webhook.id }),
    ).rejects.toThrow();

    expect(receiver.received).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(await allDeliveries()).toHaveLength(0);
  });
});
