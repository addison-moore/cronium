/**
 * Retrying a recorded webhook delivery, through the real tRPC mutation, against
 * real Postgres and a real HTTP receiver.
 *
 * Real on purpose: a retry rebuilds its body from the stored event row, so the
 * jsonb round trip, the row's columns and the signature over the bytes on the
 * wire are what's under test. Nothing short of a receiver shows whether a retry
 * sent anything: this mutation used to answer "retry initiated" while every
 * attempt failed before making a request.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookRouter } from "@/lib/webhooks/WebhookRouter";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
  UserRole,
  UserStatus,
  webhookDeliveries,
  webhookEvents,
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

/** The queue makes the first attempt and leaves the rest to the test. */
const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };

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
async function startReceiver(statuses: number[] = []) {
  const received: ReceivedRequest[] = [];
  const remaining = [...statuses];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(remaining.shift() ?? 200).end("from the receiver");
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

const eventRows = () =>
  db.select().from(webhookEvents).orderBy(asc(webhookEvents.id));

/** Wait for this many attempts to be on record. The receiver sees a request
 * slightly before its row is written. */
async function recordedAttempts(webhookId: number, count: number) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const rows = await deliveriesOf(webhookId);
    if (rows.length >= count) return rows;
    if (Date.now() > deadline) {
      throw new Error(`Recorded ${rows.length} of ${count} attempts`);
    }
    await sleep(25);
  }
}

/** A sender signing the way the docs tell it to, with no help from app code. */
async function postInbound(key: string, secret: string, body: string) {
  const timestamp = new Date().toISOString();
  const deliveryId = randomUUID();
  const response = await WebhookRouter.getInstance().handleRequest(
    key,
    new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signatureOf(
          `${timestamp}.${deliveryId}.${body}`,
          secret,
        ),
        "x-webhook-timestamp": timestamp,
        "x-webhook-delivery-id": deliveryId,
      },
      body,
    }),
  );
  return response.status;
}

const manager = WebhookManager.getInstance();
let owner: string;

let errorLog: jest.SpyInstance | undefined;
/** The router logs each error it passes on, which is expected noise here. */
function expectErrorLog() {
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
}

/** A webhook subscribed to `order.created`, plus one recorded attempt to retry. */
async function recordedDelivery(
  receiver: { url: string },
  data: Record<string, unknown> = { order: 1 },
  metadata?: Record<string, unknown>,
) {
  const webhook = await manager.registerWebhook(owner, {
    url: receiver.url,
    events: ["order.created"],
    active: true,
    retryConfig: ONE_ATTEMPT,
  });
  await manager.triggerEvent("order.created", data, owner, metadata);
  const [delivery] = await recordedAttempts(webhook.id, 1);
  return { webhook, delivery: delivery! };
}

beforeEach(async () => {
  mockAssertRequestUrlIsPublic.mockReset();
  await resetDatabase();
  owner = await seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });
});

afterEach(async () => {
  errorLog?.mockRestore();
  errorLog = undefined;
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await closePool();
});

describe("retrying a delivery", () => {
  it("sends the original event again, signed with the webhook's current secret", async () => {
    const receiver = await startReceiver([500]);
    // Keys jsonb will reorder, at both levels: what's stored isn't byte for byte
    // what was first sent, and the retry has to be signed over what it sends.
    const data = {
      zebra: 1,
      apple: { y: [1, { b: 2, a: 3 }], x: null },
      note: 'héllo "<b>"',
    };
    const metadata = { source: "storage-test", a: 1 };
    const { webhook, delivery } = await recordedDelivery(
      receiver,
      data,
      metadata,
    );
    expect(delivery).toMatchObject({ status: "failed", statusCode: 500 });
    const [event] = await eventRows();

    const rotated = await callerFor(owner).webhookSystem.regenerateSecret({
      webhookId: webhook.id,
    });

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(receiver.received).toHaveLength(2);
    const [first, second] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];

    // The same event, field for field. `id` is the event's and never changes,
    // which is what a receiver can dedupe on.
    const sent = {
      id: String(event!.id),
      event: "order.created",
      timestamp: event!.createdAt.toISOString(),
      data,
      metadata,
    };
    expect(JSON.parse(first.body)).toEqual(sent);
    expect(JSON.parse(second.body)).toEqual(sent);
    expect(second.headers["x-webhook-event"]).toBe("order.created");
    expect(second.headers["x-webhook-id"]).toBe(String(webhook.id));

    // The event's timestamp, as on an automatic retry, and a new delivery id.
    expect(second.headers["x-webhook-timestamp"]).toBe(sent.timestamp);
    expect(first.headers["x-webhook-timestamp"]).toBe(sent.timestamp);
    expect(second.headers["x-delivery-id"]).toBeTruthy();
    expect(second.headers["x-delivery-id"]).not.toBe(
      first.headers["x-delivery-id"],
    );

    // Signed with the new secret over the bytes it sent, which aren't the bytes
    // of the first attempt.
    expect(second.body).not.toBe(first.body);
    expect(first.headers["x-webhook-signature"]).toBe(
      signatureOf(first.body, webhook.secret),
    );
    expect(second.headers["x-webhook-signature"]).toBe(
      signatureOf(second.body, rotated.data.secret),
    );
    expect(second.headers["x-webhook-signature"]).not.toBe(
      signatureOf(second.body, webhook.secret),
    );

    // The answer is the attempt's, and comes after it.
    expect(answer).toEqual({
      success: true,
      data: {
        id: second.headers["x-delivery-id"],
        webhookId: webhook.id,
        success: true,
        statusCode: 200,
        response: "from the receiver",
        duration: expect.any(Number),
      },
      message: "Webhook delivery retry succeeded",
    });

    // A new row beside the one retried, on the same event.
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(delivery);
    expect(rows[1]).toMatchObject({
      webhookEventId: event!.id,
      deliveryId: second.headers["x-delivery-id"],
      status: "success",
      statusCode: 200,
      error: null,
    });
  });

  it("leaves out metadata when the event had none", async () => {
    const receiver = await startReceiver([500]);
    const { delivery } = await recordedDelivery(receiver);

    await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    const [first, second] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];
    expect(JSON.parse(first.body)).not.toHaveProperty("metadata");
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));
  });

  it("goes to the webhook's current URL with its current headers", async () => {
    const before = await startReceiver([500]);
    const { webhook, delivery } = await recordedDelivery(before);
    const after = await startReceiver();
    const token = `token-${randomUUID()}`;
    await manager.updateWebhook(webhook.id, owner, {
      url: after.url,
      headers: { Authorization: `Bearer ${token}` },
    });

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(answer.success).toBe(true);
    expect(before.received).toHaveLength(1);
    expect(after.received).toHaveLength(1);
    expect(after.received[0]!.headers.authorization).toBe(`Bearer ${token}`);

    const rows = await deliveriesOf(webhook.id);
    expect(rows[1]!.headers).toMatchObject({ Authorization: "[redacted]" });
    expect(JSON.stringify(rows[1])).not.toContain(token);
  });

  it("sends a delivery that succeeded again as well, if asked", async () => {
    const receiver = await startReceiver();
    const { webhook, delivery } = await recordedDelivery(receiver);
    expect(delivery).toMatchObject({ status: "success", statusCode: 200 });

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(answer.success).toBe(true);
    expect(receiver.received).toHaveLength(2);
    expect(JSON.parse(receiver.received[1]!.body)).toEqual(
      JSON.parse(receiver.received[0]!.body),
    );
    expect(await deliveriesOf(webhook.id)).toHaveLength(2);
  });

  it("says so when the receiver refuses it, and makes that one attempt", async () => {
    const receiver = await startReceiver([500, 500, 500, 503]);
    const webhook = await manager.registerWebhook(owner, {
      url: receiver.url,
      events: ["order.created"],
      active: true,
      retryConfig: { maxRetries: 3, retryDelay: 100, backoffMultiplier: 1 },
    });
    await manager.triggerEvent("order.created", { order: 1 }, owner);
    const attempts = await recordedAttempts(webhook.id, 3);

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: attempts[2]!.deliveryId,
    });

    expect(answer).toMatchObject({
      success: false,
      data: { success: false, statusCode: 503 },
      message: "Webhook delivery retry failed: HTTP 503",
    });
    // The queue would have repeated it by now under this retry config: it looks
    // every second, and the delay is 100ms.
    await sleep(1_500);
    expect(receiver.received).toHaveLength(4);
    // Told apart from the queue's own attempts only by its timing: the same
    // timestamp on all of them, and a delivery id of its own on each.
    const headers = receiver.received.map((request) => request.headers);
    expect(new Set(headers.map((h) => h["x-webhook-timestamp"])).size).toBe(1);
    expect(new Set(headers.map((h) => h["x-delivery-id"])).size).toBe(4);
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({
      deliveryId: answer.data.id,
      status: "failed",
      statusCode: 503,
    });

    // The attempt that failed can be retried in turn, and this one gets through.
    const again = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: answer.data.id,
    });
    expect(again).toMatchObject({ success: true, data: { statusCode: 200 } });
    expect(receiver.received).toHaveLength(5);
    expect(JSON.parse(receiver.received[4]!.body)).toEqual(
      JSON.parse(receiver.received[0]!.body),
    );
  });

  it("says so when the receiver can't be reached", async () => {
    const receiver = await startReceiver([500]);
    const { webhook, delivery } = await recordedDelivery(receiver);
    await receiver.close();

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(answer.success).toBe(false);
    expect(answer.data.error).toBeTruthy();
    expect(answer.data.statusCode).toBeUndefined();
    expect(answer.message).toBe(
      `Webhook delivery retry failed: ${answer.data.error}`,
    );
    const rows = await deliveriesOf(webhook.id);
    expect(rows[1]).toMatchObject({
      status: "failed",
      statusCode: null,
      error: answer.data.error,
    });
  });
});

describe("the SSRF guard", () => {
  it("still stands between a retry and the webhook's URL", async () => {
    const receiver = await startReceiver([500]);
    const { webhook, delivery } = await recordedDelivery(receiver);
    mockAssertRequestUrlIsPublic.mockImplementationOnce(() => {
      throw new SsrfBlockedError("Host is a disallowed (internal) address");
    });

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(mockAssertRequestUrlIsPublic).toHaveBeenLastCalledWith(receiver.url);
    expect(answer).toMatchObject({
      success: false,
      data: { success: false, statusCode: 0 },
      message:
        "Webhook delivery retry failed: Host is a disallowed (internal) address",
    });
    expect(receiver.received).toHaveLength(1);
    const rows = await deliveriesOf(webhook.id);
    expect(rows[1]).toMatchObject({
      status: "failed",
      statusCode: 0,
      error: "Host is a disallowed (internal) address",
    });
  });
});

describe("events that came in through the inbound endpoint", () => {
  // A body with a `data` and `metadata` of its own: the router's row holds these
  // at its top level, next to its own fields, so it looks a lot like the row
  // `triggerEvent` writes.
  const INBOUND = JSON.stringify({
    event: "order.created",
    data: { order: 1 },
    metadata: { from: "the-sender" },
  });

  async function receiveInbound(outboundUrl: string) {
    const inbound = await manager.registerWebhook(owner, {
      url: "https://not-used.example/hook",
      events: [],
      active: true,
    });
    const outbound = await manager.registerWebhook(owner, {
      url: outboundUrl,
      events: ["webhook.order.created"],
      active: true,
      retryConfig: ONE_ATTEMPT,
    });
    expect(await postInbound(inbound.key, inbound.secret, INBOUND)).toBe(200);
    const [delivery] = await recordedAttempts(outbound.id, 1);
    const [inboundRow, fanOutRow] = await eventRows();
    return {
      inbound,
      outbound,
      delivery: delivery!,
      inboundRow: inboundRow!,
      fanOutRow: fanOutRow!,
    };
  }

  it("deliveries point at the fan-out's row, never the router's, and retry from it", async () => {
    const receiver = await startReceiver([500]);
    const { inbound, outbound, delivery, inboundRow, fanOutRow } =
      await receiveInbound(receiver.url);

    expect(inboundRow.event).toBe("order.created");
    expect(fanOutRow.event).toBe("webhook.order.created");
    expect(delivery.webhookEventId).toBe(fanOutRow.id);

    const answer = await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: delivery.deliveryId,
    });

    expect(answer.success).toBe(true);
    const [first, second] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];
    const body = JSON.parse(second.body) as Record<string, unknown>;
    expect(body).toEqual(JSON.parse(first.body));
    expect(body).toMatchObject({
      id: String(fanOutRow.id),
      event: "webhook.order.created",
      data: {
        eventType: "order.created",
        webhookId: inbound.id,
        data: { order: 1 },
        metadata: { from: "the-sender" },
      },
      metadata: { webhookId: inbound.id, source: "webhook" },
    });
    expect(second.headers["x-webhook-event"]).toBe("webhook.order.created");
    expect(second.headers["x-webhook-signature"]).toBe(
      signatureOf(second.body, outbound.secret),
    );
  });

  it("refuses a delivery pointing at the router's own row, which was never sent", async () => {
    expectErrorLog();
    const receiver = await startReceiver();
    const { outbound, inboundRow } = await receiveInbound(receiver.url);
    // Nothing writes this. It stands in for restored or hand-edited data.
    await db.insert(webhookDeliveries).values({
      webhookId: outbound.id,
      webhookEventId: inboundRow.id,
      deliveryId: "points-at-the-inbound-row",
      status: "failed",
      attemptedAt: new Date(),
    });
    // What a reader of `{ data, metadata }` alone would have sent.
    expect(inboundRow.payload).toMatchObject({
      data: { order: 1 },
      metadata: { from: "the-sender" },
    });
    const requests = receiver.received.length;

    await expect(
      callerFor(owner).webhookSystem.retryDelivery({
        deliveryId: "points-at-the-inbound-row",
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "This delivery's stored event can't be sent again",
    });

    expect(receiver.received).toHaveLength(requests);
    expect(await deliveriesOf(outbound.id)).toHaveLength(2);
  });
});

describe("retries it refuses", () => {
  beforeEach(expectErrorLog);

  it("won't send to a disabled webhook", async () => {
    const receiver = await startReceiver([500]);
    const { webhook, delivery } = await recordedDelivery(receiver);
    await manager.updateWebhook(webhook.id, owner, { active: false });

    await expect(
      callerFor(owner).webhookSystem.retryDelivery({
        deliveryId: delivery.deliveryId,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Webhook is disabled",
    });

    expect(receiver.received).toHaveLength(1);
    expect(await deliveriesOf(webhook.id)).toHaveLength(1);
  });

  it.each([
    ["another user", () => seedUser()],
    ["no one, as before events had owners", () => Promise.resolve(null)],
  ])(
    "won't send this user's webhook an event owned by %s",
    async (_label, eventOwner) => {
      const receiver = await startReceiver();
      const webhook = await manager.registerWebhook(owner, {
        url: receiver.url,
        events: ["*"],
        active: true,
      });
      const [event] = await db
        .insert(webhookEvents)
        .values({
          event: "order.created",
          payload: { data: { secret: "someone else's" } },
          userId: await eventOwner(),
        })
        .returning();
      await db.insert(webhookDeliveries).values({
        webhookId: webhook.id,
        webhookEventId: event!.id,
        deliveryId: "from-another-tenant",
        status: "failed",
        attemptedAt: new Date(),
      });

      await expect(
        callerFor(owner).webhookSystem.retryDelivery({
          deliveryId: "from-another-tenant",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "This delivery's event isn't recorded under this webhook's owner",
      });

      expect(receiver.received).toHaveLength(0);
      expect(await deliveriesOf(webhook.id)).toHaveLength(1);
    },
  );

  it("treats another user's delivery as one that doesn't exist", async () => {
    const receiver = await startReceiver([500]);
    const { webhook, delivery } = await recordedDelivery(receiver);
    const stranger = await seedUser({
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });

    await expect(
      callerFor(stranger).webhookSystem.retryDelivery({
        deliveryId: delivery.deliveryId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor(owner).webhookSystem.retryDelivery({
        deliveryId: "no-such-delivery",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(receiver.received).toHaveLength(1);
    expect(await deliveriesOf(webhook.id)).toHaveLength(1);
  });
});
