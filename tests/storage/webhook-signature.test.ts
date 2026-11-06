/**
 * What a webhook delivery carries and how a receiver checks it, against real
 * Postgres and a real HTTP receiver.
 *
 * Outbound signatures are a contract with receivers Cronium can't see, so the
 * first group pins what existing ones rely on. The rest runs the Node example from
 * docs/WEBHOOKS.md, as written, on the bytes that arrive, so the docs can't drift
 * from what's sent.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { WebhookRouter } from "@/lib/webhooks/WebhookRouter";
import { WebhookSecurity } from "@/lib/webhooks/WebhookSecurity";
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
jest.mock("@/lib/ssrf-guard", () => ({
  ...jest.requireActual<object>("@/lib/ssrf-guard"),
  assertRequestUrlIsPublic: () => undefined,
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

const MINUTE = 60_000;
/** The window the docs tell a receiver to enforce. */
const WINDOW_MS = 5 * MINUTE;
/** Given to each webhook, so a receiver can check even the first attempt. */
const SECRET = "the-secret-the-receiver-was-given";

const DOCS = readFileSync(join(__dirname, "../../docs/WEBHOOKS.md"), "utf8");

type Verifier = (
  headers: http.IncomingHttpHeaders,
  rawBody: Buffer,
  secret: string,
) => boolean;

/** The docs' Node example, run as written. */
const verifyDelivery = (() => {
  const source = /```js\n([\s\S]+?)```/.exec(DOCS)?.[1];
  if (!source) throw new Error("docs/WEBHOOKS.md has no Node example");
  return new Function("require", `${source}\nreturn verifyDelivery;`)(
    require,
  ) as Verifier;
})();

/** The queue makes the first attempt and leaves the rest to the test. */
const ONE_ATTEMPT = { maxRetries: 1, retryDelay: 100, backoffMultiplier: 1 };
const TWO_ATTEMPTS = { maxRetries: 2, retryDelay: 100, backoffMultiplier: 1 };

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
  body: Buffer;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server. `answer` decides each status, from the bytes received. */
async function startReceiver(
  answer: (request: ReceivedRequest) => number | Promise<number> = () => 200,
) {
  const received: ReceivedRequest[] = [];
  const statuses: number[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = { headers: req.headers, body: Buffer.concat(chunks) };
      received.push(request);
      void Promise.resolve(answer(request)).then((status) => {
        statuses.push(status);
        res.writeHead(status).end("from the receiver");
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  openReceivers.push(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  return { url: `http://127.0.0.1:${port}/hook`, received, statuses };
}

/** Answers with each of `statuses` in turn, then 200s. */
function answering(statuses: number[]) {
  const remaining = [...statuses];
  return () => remaining.shift() ?? 200;
}

const sha256Of = (body: Buffer | string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const header = (request: ReceivedRequest, name: string) =>
  String(request.headers[name]);

/** The headers a delivery's sender chose, as a client can send them again. */
const senderHeaders = ({ headers }: ReceivedRequest) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.startsWith("x-") || name === "content-type",
    ),
  ) as Record<string, string>;

const parsed = (request: ReceivedRequest) =>
  JSON.parse(request.body.toString()) as Record<string, unknown>;

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

const manager = WebhookManager.getInstance();
let owner: string;

/** A webhook subscribed to `order.created`, plus one recorded attempt. */
async function recordedDelivery(
  receiver: { url: string },
  data: Record<string, unknown> = { order: 1 },
  options: {
    metadata?: Record<string, unknown>;
    headers?: Record<string, string>;
    retryConfig?: typeof ONE_ATTEMPT;
  } = {},
) {
  const webhook = await manager.registerWebhook(owner, {
    url: receiver.url,
    events: ["order.created"],
    active: true,
    secret: SECRET,
    retryConfig: options.retryConfig ?? ONE_ATTEMPT,
    ...(options.headers && { headers: options.headers }),
  });
  await manager.triggerEvent("order.created", data, owner, options.metadata);
  const [delivery] = await recordedAttempts(webhook.id, 1);
  return { webhook, delivery: delivery! };
}

const retry = (deliveryId: string) =>
  callerFor(owner).webhookSystem.retryDelivery({ deliveryId });

/** The event happened this long ago, as far as a retry can tell. */
async function age(webhookEventId: number, ms: number) {
  await db
    .update(webhookEvents)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(webhookEvents.id, webhookEventId));
}

beforeEach(async () => {
  await resetDatabase();
  owner = await seedUser({ role: UserRole.USER, status: UserStatus.ACTIVE });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(openReceivers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await closePool();
});

describe("what existing receivers rely on", () => {
  it("keeps the body, its signature and the headers they had", async () => {
    const receiver = await startReceiver();
    const data = { zebra: 1, apple: { y: 2, x: 3 }, note: 'héllo "<b>"' };
    const metadata = { source: "storage-test" };
    const { webhook, delivery } = await recordedDelivery(receiver, data, {
      metadata,
    });
    const [event] = await eventRows();
    const request = receiver.received[0]!;
    const timestamp = event!.createdAt.toISOString();

    // Byte for byte, in this key order, with nothing added.
    expect(request.body.toString()).toBe(
      JSON.stringify({
        id: String(event!.id),
        event: "order.created",
        timestamp,
        data,
        metadata,
      }),
    );
    // Over the body alone: changing this breaks every receiver verifying it.
    expect(header(request, "x-webhook-signature")).toBe(
      sha256Of(request.body, SECRET),
    );
    // The event's time, the same as in the body.
    expect(header(request, "x-webhook-timestamp")).toBe(timestamp);
    expect(header(request, "x-delivery-id")).toBe(delivery.deliveryId);
    expect(header(request, "x-webhook-event")).toBe("order.created");
    expect(header(request, "x-webhook-id")).toBe(String(webhook.id));
    expect(header(request, "content-type")).toBe("application/json");
  });

  it("can't be handed the new signature as if it were X-Webhook-Signature", async () => {
    const receiver = await startReceiver();
    await recordedDelivery(receiver);
    const request = receiver.received[0]!;

    // The signed string sent as a body, with the new signature's digest in the old
    // header. Under SHA-256 this would pass an existing receiver's check.
    const signedString = `${header(request, "x-delivery-timestamp")}\n${header(
      request,
      "x-delivery-id",
    )}\n${request.body.toString()}`;
    expect(
      header(request, "x-webhook-signature-v2").replace("sha512=", "sha256="),
    ).not.toBe(sha256Of(signedString, SECRET));
  });

  it("adds exactly two headers to them", async () => {
    const receiver = await startReceiver();
    await recordedDelivery(receiver);

    const names = Object.keys(receiver.received[0]!.headers)
      .filter((name) => name.startsWith("x-"))
      .sort();
    expect(names).toEqual([
      "x-delivery-id",
      "x-delivery-timestamp",
      "x-webhook-event",
      "x-webhook-id",
      "x-webhook-signature",
      "x-webhook-signature-v2",
      "x-webhook-timestamp",
    ]);
  });
});

describe("X-Webhook-Signature-V2", () => {
  it("covers this attempt's time and id and the bytes received", async () => {
    const receiver = await startReceiver();
    const before = Date.now();
    // Non-ASCII, so a signature over anything but the bytes wouldn't match.
    await recordedDelivery(receiver, { note: 'héllo "<b>" 日本語 😀' });
    const after = Date.now();
    const request = receiver.received[0]!;

    const timestamp = header(request, "x-delivery-timestamp");
    expect(timestamp).toBe(new Date(timestamp).toISOString());
    expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(timestamp)).toBeLessThanOrEqual(after);

    expect(header(request, "x-webhook-signature-v2")).toBe(
      `sha512=${createHmac("sha512", SECRET)
        .update(`${timestamp}\n${header(request, "x-delivery-id")}\n`)
        .update(request.body)
        .digest("hex")}`,
    );
    expect(verifyDelivery(request.headers, request.body, SECRET)).toBe(true);
  });

  it("stops verifying when anything it covers changes", async () => {
    const receiver = await startReceiver();
    await recordedDelivery(receiver);
    const { headers, body } = receiver.received[0]!;

    const fresh = new Date(Date.now() + 1000).toISOString();
    expect(
      verifyDelivery(
        { ...headers, "x-delivery-timestamp": fresh },
        body,
        SECRET,
      ),
    ).toBe(false);
    expect(
      verifyDelivery(
        { ...headers, "x-delivery-id": "another-attempt" },
        body,
        SECRET,
      ),
    ).toBe(false);
    expect(
      verifyDelivery(
        headers,
        Buffer.from(body.toString().replace('"order":1', '"order":2')),
        SECRET,
      ),
    ).toBe(false);
    expect(verifyDelivery(headers, body, "another-secret")).toBe(false);
  });

  describe("a captured delivery, relabelled", () => {
    /** The receiver from the docs, and one delivery it accepted. */
    async function capturedDelivery() {
      const receiver = await startReceiver((request) =>
        verifyDelivery(request.headers, request.body, SECRET) ? 200 : 401,
      );
      await recordedDelivery(receiver, { note: "has.a.few.dots" });
      expect(receiver.statuses).toEqual([200]);
      const captured = receiver.received[0]!;
      return { receiver, captured, text: captured.body.toString() };
    }

    const dotsIn = (text: string) =>
      [...text.matchAll(/\./g)].map((match) => match.index);

    it("is refused with the start of its body moved into the id, at every dot", async () => {
      const { receiver, captured, text } = await capturedDelivery();
      const id = header(captured, "x-delivery-id");
      expect(dotsIn(text).length).toBeGreaterThan(0);

      for (const dot of dotsIn(text)) {
        const replay = await fetch(receiver.url, {
          method: "POST",
          headers: {
            ...senderHeaders(captured),
            "x-delivery-id": `${id}.${text.slice(0, dot)}`,
          },
          body: text.slice(dot + 1),
        });
        expect(replay.status).toBe(401);
      }
    });

    it("is refused with its time split at the time's own dot", async () => {
      const { receiver, captured, text } = await capturedDelivery();
      const [whole, fraction] = header(captured, "x-delivery-timestamp").split(
        ".",
      ) as [string, string];
      const id = header(captured, "x-delivery-id");

      const replay = await fetch(receiver.url, {
        method: "POST",
        headers: {
          ...senderHeaders(captured),
          "x-delivery-timestamp": whole,
          "x-delivery-id": fraction,
        },
        body: `${id}.${text}`,
      });

      expect(replay.status).toBe(401);
    });
  });

  it("stops being accepted once the attempt leaves the window, either way", async () => {
    const receiver = await startReceiver();
    await recordedDelivery(receiver);
    const { headers, body } = receiver.received[0]!;
    const sentAt = Date.parse(
      header(receiver.received[0]!, "x-delivery-timestamp"),
    );
    const clock = jest.spyOn(Date, "now");
    const acceptedAt = (now: number) => {
      clock.mockReturnValue(now);
      return verifyDelivery(headers, body, SECRET);
    };

    expect(acceptedAt(sentAt + WINDOW_MS)).toBe(true);
    expect(acceptedAt(sentAt + WINDOW_MS + 1)).toBe(false);
    expect(acceptedAt(sentAt - WINDOW_MS)).toBe(true);
    expect(acceptedAt(sentAt - WINDOW_MS - 1)).toBe(false);
  });

  it("isn't recorded, and the record holds the headers it always did", async () => {
    const receiver = await startReceiver();
    const { delivery } = await recordedDelivery(receiver);
    const request = receiver.received[0]!;

    // The scrub in migration 0015 keeps these names and no others.
    expect(Object.keys(delivery.headers as object).sort()).toEqual([
      "Content-Type",
      "X-Delivery-Id",
      "X-Webhook-Event",
      "X-Webhook-Id",
      "X-Webhook-Timestamp",
    ]);
    const row = JSON.stringify(delivery);
    expect(row).not.toContain(header(request, "x-webhook-signature-v2"));
    expect(row).not.toContain(header(request, "x-webhook-signature"));
  });
});

describe("a late retry", () => {
  const AN_HOUR = 60 * MINUTE;

  it("passes a receiver checking the attempt's time, though the event is an hour old", async () => {
    const receiver = await startReceiver((request) =>
      verifyDelivery(request.headers, request.body, SECRET) ? 200 : 401,
    );
    const { delivery } = await recordedDelivery(receiver);
    expect(delivery.statusCode).toBe(200);
    await age(delivery.webhookEventId, AN_HOUR);

    const answer = await retry(delivery.deliveryId);

    expect(answer).toMatchObject({ success: true, data: { statusCode: 200 } });
    const request = receiver.received[1]!;
    const eventTime = String(parsed(request).timestamp);
    // The event's time on both, an hour old, and this attempt's own beside it.
    expect(header(request, "x-webhook-timestamp")).toBe(eventTime);
    expect(Date.now() - Date.parse(eventTime)).toBeGreaterThanOrEqual(AN_HOUR);
    expect(
      Date.now() - Date.parse(header(request, "x-delivery-timestamp")),
    ).toBeLessThan(MINUTE);
  });

  it("is refused by a receiver checking the event's time, and recorded as failed", async () => {
    // All a receiver can do with only the older signature: the body's `timestamp`
    // is the only signed time it has.
    const receiver = await startReceiver((request) => {
      if (
        header(request, "x-webhook-signature") !==
        sha256Of(request.body, SECRET)
      ) {
        return 400;
      }
      const eventTime = Date.parse(String(parsed(request).timestamp));
      return Date.now() - eventTime > WINDOW_MS ? 401 : 200;
    });
    const { webhook, delivery } = await recordedDelivery(receiver);
    expect(delivery.statusCode).toBe(200);
    await age(delivery.webhookEventId, AN_HOUR);

    const answer = await retry(delivery.deliveryId);

    expect(answer).toMatchObject({ success: false, data: { statusCode: 401 } });
    const rows = await deliveriesOf(webhook.id);
    expect(rows[1]).toMatchObject({ status: "failed", statusCode: 401 });
  });
});

describe("across attempts", () => {
  it("an automatic retry repeats the bytes and X-Webhook-Signature, under a new attempt", async () => {
    const receiver = await startReceiver(answering([500]));
    const { webhook } = await recordedDelivery(
      receiver,
      { zebra: 1, apple: 2 },
      { retryConfig: TWO_ATTEMPTS },
    );
    await recordedAttempts(webhook.id, 2);
    const [first, second] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];

    expect(second.body.equals(first.body)).toBe(true);
    for (const name of ["x-webhook-signature", "x-webhook-timestamp"]) {
      expect(header(second, name)).toBe(header(first, name));
    }

    expect(header(second, "x-delivery-id")).not.toBe(
      header(first, "x-delivery-id"),
    );
    expect(Date.parse(header(second, "x-delivery-timestamp"))).toBeGreaterThan(
      Date.parse(header(first, "x-delivery-timestamp")),
    );
    expect(header(second, "x-webhook-signature-v2")).not.toBe(
      header(first, "x-webhook-signature-v2"),
    );
    for (const request of [first, second]) {
      expect(verifyDelivery(request.headers, request.body, SECRET)).toBe(true);
    }
  });

  it("a manual retry can send other bytes, and both signatures cover the ones it sends", async () => {
    const receiver = await startReceiver(answering([500]));
    // Keys jsonb will reorder, at both levels.
    const { delivery } = await recordedDelivery(receiver, {
      zebra: 1,
      apple: { y: 2, x: 3 },
    });

    await retry(delivery.deliveryId);

    const [first, second] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
    ];
    // The same event, with the same `id`, in different bytes.
    expect(parsed(second)).toEqual(parsed(first));
    expect(parsed(second).id).toBe(parsed(first).id);
    expect(second.body.equals(first.body)).toBe(false);

    // Under the same secret, so the older signature differs too.
    expect(header(second, "x-webhook-signature")).not.toBe(
      header(first, "x-webhook-signature"),
    );
    expect(header(second, "x-webhook-signature")).toBe(
      sha256Of(second.body, SECRET),
    );
    expect(verifyDelivery(second.headers, second.body, SECRET)).toBe(true);
  });

  it("an automatic retry keeps the secret it was queued with, and a manual one uses the current one", async () => {
    let rotated = "";
    let webhookId = 0;
    // Rotates during the first attempt, before the automatic retry goes out.
    const receiver = await startReceiver(async () => {
      if (rotated) return 200;
      const fresh = await callerFor(owner).webhookSystem.regenerateSecret({
        webhookId,
      });
      rotated = fresh.data.secret;
      return 500;
    });
    const webhook = await manager.registerWebhook(owner, {
      url: receiver.url,
      events: ["order.created"],
      active: true,
      secret: SECRET,
      retryConfig: TWO_ATTEMPTS,
    });
    webhookId = webhook.id;
    await manager.triggerEvent("order.created", { order: 1 }, owner);
    const rows = await recordedAttempts(webhook.id, 2);

    await retry(rows[1]!.deliveryId);

    const [, automatic, manual] = receiver.received as [
      ReceivedRequest,
      ReceivedRequest,
      ReceivedRequest,
    ];
    expect(verifyDelivery(automatic.headers, automatic.body, SECRET)).toBe(
      true,
    );
    expect(verifyDelivery(automatic.headers, automatic.body, rotated)).toBe(
      false,
    );
    expect(verifyDelivery(manual.headers, manual.body, rotated)).toBe(true);
    expect(verifyDelivery(manual.headers, manual.body, SECRET)).toBe(false);
  });
});

describe("a receiver following the docs", () => {
  it("handles an event once across retries, and refuses a replayed request", async () => {
    // Steps 2 to 5 of "Verifying a delivery".
    const seenDeliveries = new Set<string>();
    const handledEvents: unknown[] = [];
    const receiver = await startReceiver((request) => {
      if (!verifyDelivery(request.headers, request.body, SECRET)) return 401;
      const deliveryId = header(request, "x-delivery-id");
      if (seenDeliveries.has(deliveryId)) return 409;
      seenDeliveries.add(deliveryId);
      const { id } = parsed(request);
      if (!handledEvents.includes(id)) handledEvents.push(id);
      return 200;
    });
    const { delivery } = await recordedDelivery(receiver);

    // The same event again, as a retry: accepted, and nothing more to do.
    expect((await retry(delivery.deliveryId)).success).toBe(true);
    expect((await retry(delivery.deliveryId)).success).toBe(true);
    expect(receiver.received).toHaveLength(3);
    expect(handledEvents).toEqual([String(delivery.webhookEventId)]);

    // Someone sending a captured request back, unchanged.
    const captured = receiver.received[2]!;
    const replay = await fetch(receiver.url, {
      method: "POST",
      headers: senderHeaders(captured),
      body: new Uint8Array(captured.body),
    });
    expect(replay.status).toBe(409);
    expect(handledEvents).toHaveLength(1);
  });
});

describe("a delivery sent to an inbound endpoint", () => {
  async function postInbound(
    key: string,
    headers: Record<string, string>,
    body: Buffer,
  ) {
    const response = await WebhookRouter.getInstance().handleRequest(
      key,
      new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
        method: "POST",
        headers,
        body: body.toString(),
      }),
    );
    return { status: response.status, ...(await response.json()) } as {
      status: number;
      error?: string;
    };
  }

  it("is refused however it's labelled, and starts nothing", async () => {
    // Subscribed to everything, so anything accepted would be sent straight back.
    const receiver = await startReceiver();
    const webhook = await manager.registerWebhook(owner, {
      url: receiver.url,
      events: ["*"],
      active: true,
      retryConfig: ONE_ATTEMPT,
    });
    await manager.triggerEvent("order.created", { order: 1 }, owner);
    await recordedAttempts(webhook.id, 1);
    const captured = receiver.received[0]!;
    const signature = header(captured, "x-webhook-signature");
    const signatureV2 = header(captured, "x-webhook-signature-v2");
    const eventsBefore = (await eventRows()).length;

    await expect(
      postInbound(webhook.key, senderHeaders(captured), captured.body),
    ).resolves.toEqual({ status: 401, error: "Missing delivery id header" });

    // Under the names the endpoint reads, with each signature.
    const relabelled = {
      "content-type": "application/json",
      "x-webhook-timestamp": header(captured, "x-delivery-timestamp"),
      "x-webhook-delivery-id": header(captured, "x-delivery-id"),
    };
    await expect(
      postInbound(
        webhook.key,
        { ...relabelled, "x-webhook-signature": signature },
        captured.body,
      ),
    ).resolves.toEqual({ status: 401, error: "Invalid signature" });
    await expect(
      postInbound(
        webhook.key,
        { ...relabelled, "x-webhook-signature": signatureV2 },
        captured.body,
      ),
    ).resolves.toEqual({ status: 401, error: "Invalid signature format" });
    await expect(
      postInbound(
        webhook.key,
        {
          ...relabelled,
          "x-webhook-signature": signatureV2.replace("sha512=", "sha256="),
        },
        captured.body,
      ),
    ).resolves.toEqual({ status: 401, error: "Invalid signature" });

    expect(await eventRows()).toHaveLength(eventsBefore);
    expect(receiver.received).toHaveLength(1);
  });
});

// `recordedDelivery` goes straight to `registerWebhook`, so these are webhooks stored
// before `webhookSystem.create` refused any names. The rest of what custom headers
// can do is in webhook-custom-headers.test.ts.
describe("custom headers", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation();
  });

  it.each([
    "X-Webhook-Signature",
    "x-webhook-signature",
    "X-Webhook-Signature-V2",
    "x-webhook-signature-v2",
    "X-Delivery-Id",
    "x-delivery-id",
    "X-Delivery-Timestamp",
    "x-delivery-timestamp",
  ])(
    "one named %s doesn't replace the system header, as the docs say",
    async (name) => {
      const receiver = await startReceiver();
      await recordedDelivery(
        receiver,
        { order: 1 },
        { headers: { [name]: "custom" } },
      );
      const request = receiver.received[0]!;

      expect(header(request, name.toLowerCase())).not.toBe("custom");
      expect(verifyDelivery(request.headers, request.body, SECRET)).toBe(true);
      expect(header(request, "x-webhook-signature")).toBe(
        sha256Of(request.body, SECRET),
      );
    },
  );

  it.each([
    "Content-Type",
    "content-type",
    "X-Webhook-Id",
    "x-webhook-id",
    "X-Webhook-Event",
    "x-webhook-event",
    "X-Webhook-Timestamp",
    "x-webhook-timestamp",
  ])(
    "one named %s replaces the system header, as the docs say, and the delivery still verifies",
    async (name) => {
      const receiver = await startReceiver();
      await recordedDelivery(
        receiver,
        { order: 1 },
        { headers: { [name]: "custom" } },
      );
      const request = receiver.received[0]!;

      expect(header(request, name.toLowerCase())).toBe("custom");
      expect(verifyDelivery(request.headers, request.body, SECRET)).toBe(true);
      expect(header(request, "x-webhook-signature")).toBe(
        sha256Of(request.body, SECRET),
      );
    },
  );
});

describe("the example delivery in the docs", () => {
  const field = (label: string) => {
    const value = new RegExp(`^${label}:\\s+(.+)$`, "m").exec(DOCS)?.[1];
    if (!value) throw new Error(`docs/WEBHOOKS.md has no ${label} line`);
    return value;
  };
  const secret = field("secret");
  const timestamp = field("X-Delivery-Timestamp");
  const deliveryId = field("X-Delivery-Id");
  const body = field("body");

  it("has the signatures the code makes", () => {
    const security = new WebhookSecurity();
    expect(
      security.generateDeliverySignature(timestamp, deliveryId, body, secret),
    ).toBe(field("X-Webhook-Signature-V2"));
    expect(security.generateSignature(body, secret)).toBe(
      field("X-Webhook-Signature"),
    );
  });

  it("verifies with the docs' example at the time it was made, and not now", () => {
    const headers = {
      "x-delivery-timestamp": timestamp,
      "x-delivery-id": deliveryId,
      "x-webhook-signature-v2": field("X-Webhook-Signature-V2"),
    };
    expect(verifyDelivery(headers, Buffer.from(body), secret)).toBe(false);
    jest.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp));
    expect(verifyDelivery(headers, Buffer.from(body), secret)).toBe(true);
  });
});
