/**
 * @jest-environment node
 */

// Handler-level tests for /api/webhooks/[key]. The signature-verification
// library (WebhookSecurity) and the secret decryption shim (webhook-secret,
// exercised on its legacy-plaintext path) stay REAL so these tests prove the
// route actually wires raw-body HMAC verification. The db-backed lookups
// (WebhookManager), the db writes, the rate limiter, and the replay store are
// mocked at their module boundaries.

jest.mock("@/lib/webhooks/WebhookManager", () => {
  const getWebhookByKey = jest.fn();
  const prepareEvent = jest.fn();
  return {
    __manager: { getWebhookByKey, prepareEvent },
    WebhookManager: {
      getInstance: jest.fn(() => ({ getWebhookByKey, prepareEvent })),
    },
  };
});

jest.mock("@/server/db", () => {
  const insertCalls: Array<{
    table: unknown;
    values: Record<string, unknown>;
  }> = [];
  const insert = jest.fn((table: unknown) => ({
    values: jest.fn((values: Record<string, unknown>) => {
      insertCalls.push({ table, values });
      return {
        returning: jest.fn(() => Promise.resolve([{ id: 101, ...values }])),
      };
    }),
  }));
  // A transaction writes through the same insert, so the calls show up alongside.
  const tx = { insert };
  return {
    __insertCalls: insertCalls,
    __tx: tx,
    db: {
      insert,
      transaction: jest.fn((callback: (t: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    },
  };
});

jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { tryCheckLimit: jest.fn() },
}));

// Replay store: first use of a delivery id succeeds, a repeat is rejected
// (same in-memory semantics the security-lib unit tests use).
jest.mock("@/lib/webhooks/webhook-replay-store", () => {
  const seen = new Set<string>();
  return {
    __seen: seen,
    consumeWebhookDeliveryOnce: jest.fn(
      async (webhookId: number, deliveryId: string) => {
        const key = `${webhookId}:${deliveryId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    ),
    releaseWebhookDelivery: jest.fn(
      async (webhookId: number, deliveryId: string) => {
        seen.delete(`${webhookId}:${deliveryId}`);
      },
    ),
  };
});

import crypto from "crypto";
import { NextRequest } from "next/server";
import { GET, OPTIONS, POST } from "../[key]/route";
import { webhookEvents, webhookLogs } from "@/shared/schema";

const managerMock = jest.requireMock("@/lib/webhooks/WebhookManager") as {
  __manager: { getWebhookByKey: jest.Mock; prepareEvent: jest.Mock };
};
const dbMock = jest.requireMock("@/server/db") as {
  __insertCalls: Array<{ table: unknown; values: Record<string, unknown> }>;
  __tx: unknown;
  db: { insert: jest.Mock; transaction: jest.Mock };
};
const rateLimitMock = jest.requireMock("@/lib/rate-limit-service") as {
  RateLimitService: { tryCheckLimit: jest.Mock };
};
const replayMock = jest.requireMock("@/lib/webhooks/webhook-replay-store") as {
  __seen: Set<string>;
};

const SECRET = "shared-hmac-secret";
const TENANT = "tenant-user-1";

// Legacy plaintext secret (not a `crn.` envelope) so the REAL
// decryptWebhookSecret passes it through without needing a vault key.
function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: TENANT,
    name: "Inbound",
    url: "",
    key: "whk_valid",
    secret: SECRET,
    events: [],
    headers: {},
    active: true,
    verifyTimestamp: true,
    ipWhitelist: null,
    rateLimit: null,
    retryConfig: null,
    transformations: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function sign(
  timestamp: string,
  deliveryId: string,
  rawBody: string,
  secret = SECRET,
): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${rawBody}`)
    .digest("hex");
  return `sha256=${mac}`;
}

let deliveryCounter = 0;

function signedHeaders(
  rawBody: string,
  overrides: Record<string, string> = {},
) {
  const timestamp =
    overrides["x-webhook-timestamp"] ?? new Date().toISOString();
  const deliveryId =
    overrides["x-webhook-delivery-id"] ?? `delivery-${++deliveryCounter}`;
  return {
    "content-type": "application/json",
    "x-webhook-timestamp": timestamp,
    "x-webhook-delivery-id": deliveryId,
    "x-webhook-signature": sign(timestamp, deliveryId, rawBody),
    ...overrides,
  };
}

function post(
  key: string,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  const request = new NextRequest(`http://localhost:5001/api/webhooks/${key}`, {
    method: "POST",
    headers,
    body,
  });
  return POST(request, { params: Promise.resolve({ key }) });
}

function eventInserts() {
  return dbMock.__insertCalls.filter((c) => c.table === webhookEvents);
}
function logInserts() {
  return dbMock.__insertCalls.filter((c) => c.table === webhookLogs);
}

const storePrepared = jest.fn();
const sendPrepared = jest.fn();
const cancelPrepared = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  replayMock.__seen.clear();
  dbMock.__insertCalls.length = 0;
  managerMock.__manager.getWebhookByKey.mockResolvedValue(undefined);
  managerMock.__manager.prepareEvent.mockResolvedValue({
    store: storePrepared,
    send: sendPrepared,
    cancel: cancelPrepared,
  });
  rateLimitMock.RateLimitService.tryCheckLimit.mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
  });
});

let errorSpy: jest.SpyInstance;
beforeAll(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => errorSpy.mockRestore());

describe("POST /api/webhooks/[key] — lookup and state", () => {
  it("returns 400 when the key param is empty", async () => {
    const res = await post("", "{}", { "content-type": "application/json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Webhook key is required" });
  });

  it("returns 404 for an unknown key without dispatching anything", async () => {
    const res = await post("whk_missing", "{}", signedHeaders("{}"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Webhook not found" });
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
    expect(eventInserts()).toHaveLength(0);
  });

  it("returns 403 for a disabled webhook even with a valid signature", async () => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(
      webhookRow({ active: false }),
    );
    const body = '{"event":"x"}';
    const res = await post("whk_valid", body, signedHeaders(body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Webhook is disabled" });
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when the lookup boundary throws", async () => {
    managerMock.__manager.getWebhookByKey.mockRejectedValue(
      new Error("db down"),
    );
    const res = await post("whk_valid", "{}", signedHeaders("{}"));
    expect(res.status).toBe(500);
  });

  it("returns 500 from the route-level catch when params reject", async () => {
    const request = new NextRequest("http://localhost:5001/api/webhooks/x", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(request, {
      params: Promise.reject(new Error("boom")),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("POST /api/webhooks/[key] — signature verification (real HMAC)", () => {
  beforeEach(() => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(webhookRow());
  });

  it("rejects a missing signature header with 401", async () => {
    const body = '{"event":"user.created"}';
    const headers = signedHeaders(body);
    delete (headers as Record<string, string>)["x-webhook-signature"];
    const res = await post("whk_valid", body, headers);
    expect(res.status).toBe(401);
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
    expect(eventInserts()).toHaveLength(0);
    // A failed verification is still audit-logged for the tenant's webhook.
    expect(logInserts()).toHaveLength(1);
    expect(logInserts()[0]?.values).toMatchObject({
      webhookId: 7,
      success: false,
    });
  });

  it("rejects a missing delivery-id header with 401", async () => {
    const body = "{}";
    const headers = signedHeaders(body);
    delete (headers as Record<string, string>)["x-webhook-delivery-id"];
    const res = await post("whk_valid", body, headers);
    expect(res.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = '{"event":"user.created"}';
    const timestamp = new Date().toISOString();
    const res = await post("whk_valid", body, {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-delivery-id": "d-wrong-secret",
      "x-webhook-signature": sign(timestamp, "d-wrong-secret", body, "other"),
    });
    expect(res.status).toBe(401);
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("rejects a tampered body (signature covers the exact raw bytes)", async () => {
    const signedBody = '{"amount":1}';
    const headers = signedHeaders(signedBody);
    const res = await post("whk_valid", '{"amount":9999}', headers);
    expect(res.status).toBe(401);
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("rejects a body-only HMAC that does not bind timestamp/delivery id", async () => {
    const body = '{"a":1}';
    const bodyOnly = `sha256=${crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex")}`;
    const res = await post("whk_valid", body, {
      "content-type": "application/json",
      "x-webhook-timestamp": new Date().toISOString(),
      "x-webhook-delivery-id": "d-body-only",
      "x-webhook-signature": bodyOnly,
    });
    expect(res.status).toBe(401);
  });

  it("content-type tricks do not bypass verification (text/plain, unsigned)", async () => {
    const res = await post("whk_valid", "hello", {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(401);
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp even when correctly signed (replay window)", async () => {
    const body = "{}";
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await post(
      "whk_valid",
      body,
      signedHeaders(body, { "x-webhook-timestamp": stale }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /timestamp/i,
    );
  });

  it("rejects a malformed timestamp", async () => {
    const body = "{}";
    const res = await post(
      "whk_valid",
      body,
      signedHeaders(body, { "x-webhook-timestamp": "not-a-date" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a replayed delivery id at the handler layer", async () => {
    const body = '{"event":"once"}';
    const headers = signedHeaders(body, {
      "x-webhook-delivery-id": "d-replay",
    });
    const first = await post("whk_valid", body, headers);
    expect(first.status).toBe(200);
    const second = await post("whk_valid", body, headers);
    expect(second.status).toBe(401);
    expect(((await second.json()) as { error: string }).error).toMatch(
      /replay|duplicate/i,
    );
    expect(managerMock.__manager.prepareEvent).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/webhooks/[key] — a full delivery queue", () => {
  beforeEach(() => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(webhookRow());
  });

  const fullFor = (refused: string) =>
    managerMock.__manager.prepareEvent.mockResolvedValueOnce({ refused });

  it.each([
    ["webhook", /webhooks this event goes to/],
    ["owner", /This account/],
    ["total", /This server/],
  ])(
    "answers 503 and stores nothing when the %s limit is reached",
    async (reason, says) => {
      fullFor(reason);
      const body = '{"event":"backed.up"}';

      const res = await post("whk_valid", body, signedHeaders(body));

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(((await res.json()) as { error: string }).error).toMatch(says);
      expect(eventInserts()).toEqual([]);
      expect(sendPrepared).not.toHaveBeenCalled();
      expect(logInserts()).toHaveLength(1);
      expect(logInserts()[0]!.values).toMatchObject({ success: false });
    },
  );

  it("lets the sender use the same delivery id again", async () => {
    fullFor("webhook");
    const body = '{"event":"backed.up"}';
    const headers = signedHeaders(body, {
      "x-webhook-delivery-id": "d-refused",
    });

    expect((await post("whk_valid", body, headers)).status).toBe(503);
    expect((await post("whk_valid", body, headers)).status).toBe(200);
    expect(sendPrepared).toHaveBeenCalledTimes(1);

    // Accepted now, so from here on that id is a replay.
    expect((await post("whk_valid", body, headers)).status).toBe(401);
  });

  it("gives the room back if the event can't be stored", async () => {
    const errors = jest.requireMock("@/server/db") as {
      db: { insert: jest.Mock };
    };
    errors.db.insert.mockImplementationOnce(() => {
      throw new Error("no database");
    });
    const body = '{"event":"unstorable"}';

    const res = await post("whk_valid", body, signedHeaders(body));

    expect(res.status).toBe(500);
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(sendPrepared).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/[key] — the event's rows", () => {
  beforeEach(() => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(webhookRow());
  });

  const body = '{"event":"order.created"}';
  const sameId = (raw = body) =>
    signedHeaders(raw, { "x-webhook-delivery-id": "d-rows" });

  /** A transaction that runs its callback, and then has its COMMIT fail like this. */
  function commitFails(error: Error) {
    dbMock.db.transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(dbMock.__tx);
        throw error;
      },
    );
  }

  it("stores both in one transaction, and queues deliveries once it's committed", async () => {
    const steps: string[] = [];
    dbMock.db.transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        const row = await callback(dbMock.__tx);
        steps.push("commit");
        return row;
      },
    );
    storePrepared.mockImplementationOnce(async () => steps.push("store"));
    sendPrepared.mockImplementationOnce(async () => steps.push("send"));

    expect((await post("whk_valid", body, sameId())).status).toBe(200);

    expect(storePrepared).toHaveBeenCalledWith(dbMock.__tx);
    expect(eventInserts()).toHaveLength(1);
    expect(steps).toEqual(["store", "commit", "send"]);
    expect(cancelPrepared).not.toHaveBeenCalled();
  });

  it("frees the id and gives the room back when the second row won't go in", async () => {
    storePrepared.mockRejectedValueOnce(new Error("no database"));

    expect((await post("whk_valid", body, sameId())).status).toBe(500);
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(sendPrepared).not.toHaveBeenCalled();

    expect((await post("whk_valid", body, sameId())).status).toBe(200);
  });

  it("frees the id when Postgres refuses the COMMIT", async () => {
    commitFails(
      Object.assign(new Error("Failed query: commit"), {
        cause: Object.assign(new Error("refused"), {
          code: "40001",
          severity: "ERROR",
        }),
      }),
    );

    expect((await post("whk_valid", body, sameId())).status).toBe(500);
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(sendPrepared).not.toHaveBeenCalled();

    expect((await post("whk_valid", body, sameId())).status).toBe(200);
  });

  it("keeps the id used, and queues nothing, when the COMMIT gets no answer", async () => {
    commitFails(new Error("Connection terminated unexpectedly"));

    expect((await post("whk_valid", body, sameId())).status).toBe(500);
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(sendPrepared).not.toHaveBeenCalled();

    const replay = await post("whk_valid", body, sameId());
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: string }).error).toMatch(
      /replay|duplicate/i,
    );
  });

  it("refuses what Postgres couldn't store with a 400, before claiming room or writing", async () => {
    const unstorable = '{"event":"order.created","note":"\\u0000"}';

    const res = await post("whk_valid", unstorable, sameId(unstorable));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /NUL character/,
    );
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
    expect(dbMock.db.transaction).not.toHaveBeenCalled();
    expect(logInserts()).toHaveLength(1);
    expect(logInserts()[0]!.values).toMatchObject({ success: false });

    // Nothing was done, so the corrected request can use the same id.
    expect((await post("whk_valid", body, sameId())).status).toBe(200);
  });
});

describe("POST /api/webhooks/[key] — body handling", () => {
  beforeEach(() => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(webhookRow());
  });

  it("rejects an oversized body with 413 before verification", async () => {
    const big = "a".repeat(1024 * 1024 + 1);
    const res = await post("whk_valid", big, {
      "content-type": "application/json",
    });
    expect(res.status).toBe(413);
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON that was validly signed", async () => {
    const body = "{not json";
    const res = await post("whk_valid", body, signedHeaders(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
    expect(eventInserts()).toHaveLength(0);
  });
});

describe("POST /api/webhooks/[key] — dispatch contract and tenant scoping", () => {
  beforeEach(() => {
    managerMock.__manager.getWebhookByKey.mockResolvedValue(webhookRow());
  });

  it("stores the event stamped with the owning tenant and fans out tenant-scoped", async () => {
    const body = JSON.stringify({ event: "user.created", data: { id: "u1" } });
    const res = await post("whk_valid", body, signedHeaders(body));
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      success: true,
      eventId: 101,
      message: "Webhook processed successfully",
    });
    expect(res.headers.get("X-Webhook-Id")).toBe("7");
    expect(res.headers.get("X-Event-Id")).toBe("101");

    // The stored event carries the inbound webhook's owner (tenant stamping).
    expect(eventInserts()).toHaveLength(1);
    const stored = eventInserts()[0]?.values;
    expect(stored).toMatchObject({
      event: "user.created",
      userId: TENANT,
      sourceWebhookId: 7,
    });
    expect(stored?.payload).toMatchObject({
      eventType: "user.created",
      webhookId: 7,
    });

    // Fan-out is scoped to the same tenant, with the full dispatch contract.
    expect(managerMock.__manager.prepareEvent).toHaveBeenCalledTimes(1);
    const [eventName, payload, tenantId, meta] = managerMock.__manager
      .prepareEvent.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
      Record<string, unknown>,
    ];
    expect(eventName).toBe("webhook.user.created");
    expect(payload).toMatchObject({ eventType: "user.created" });
    expect(tenantId).toBe(TENANT);
    // The inbound key is a credential: it must not travel to outbound subscribers.
    expect(meta).toEqual({
      webhookId: 7,
      source: "webhook",
    });

    // Success is audit-logged against the webhook.
    expect(logInserts()).toHaveLength(1);
    expect(logInserts()[0]?.values).toMatchObject({
      webhookId: 7,
      success: true,
      eventId: 101,
    });
  });

  it("returns 429 with rate-limit headers when the webhook's limit is exhausted", async () => {
    rateLimitMock.RateLimitService.tryCheckLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date("2026-07-22T00:00:00Z"),
    });
    const body = "{}";
    const res = await post("whk_valid", body, signedHeaders(body));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    // The limiter is keyed per webhook id, not per caller-supplied value.
    expect(rateLimitMock.RateLimitService.tryCheckLimit).toHaveBeenCalledWith(
      "webhook:7",
      "webhook",
      expect.any(Object),
    );
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });
});

describe("GET and OPTIONS /api/webhooks/[key]", () => {
  it("GET returns generic documentation and never dispatches or reveals key validity", async () => {
    const request = new NextRequest(
      "http://localhost:5001/api/webhooks/whk_anything",
      { method: "GET" },
    );
    const res = await GET(request, {
      params: Promise.resolve({ key: "whk_anything" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      message: string;
      documentation: { methods: string[] };
    };
    expect(json.message).toMatch(/POST method/);
    expect(json.documentation.methods).toEqual(["POST"]);
    // No lookup happens, so responses are indistinguishable for any key.
    expect(managerMock.__manager.getWebhookByKey).not.toHaveBeenCalled();
    expect(managerMock.__manager.prepareEvent).not.toHaveBeenCalled();
  });

  it("OPTIONS advertises methods without opening CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Allow")).toBe("POST, GET, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
