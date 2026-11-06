/**
 * What a webhook's custom headers can do to its deliveries, through the real tRPC
 * mutations, against real Postgres and a real HTTP receiver.
 *
 * The rule is in lib/webhooks/custom-headers.ts: a custom header can't replace a
 * signature or anything a signature covers, and it can replace any other system
 * header. Outbound headers are a contract with receivers Cronium can't see, so both
 * halves are checked on the request that arrives, with the Node example from
 * docs/WEBHOOKS.md doing the verifying.
 *
 * A "stored" webhook here holds a name the mutations now refuse, as one from before
 * the rule can. `registerWebhook` takes input the schema has already checked, so
 * calling it directly writes the row the old code wrote.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { PROTECTED_DELIVERY_HEADERS } from "@/lib/webhooks/custom-headers";
import { decryptWebhookHeaders } from "@/lib/webhooks/webhook-secret";
import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { webhookSystemRouter } from "@/server/api/routers/webhook-system";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
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

const SECRET = "the-secret-the-receiver-was-given";
/** A custom header's value, which may be a credential, so it must go nowhere else. */
const VALUE = "the-custom-value-SENTINEL";

const UNSIGNED_SYSTEM_HEADERS = [
  "Content-Type",
  "X-Webhook-Id",
  "X-Webhook-Event",
  "X-Webhook-Timestamp",
];

/**
 * What the HTTP client takes for the same header, so what the rule has to catch. The
 * last is a Kelvin sign, which lower-cases to `k`, for the names that have a `k`.
 */
const SPELLINGS = PROTECTED_DELIVERY_HEADERS.flatMap((name) => [
  name,
  name.toLowerCase(),
  name.toUpperCase(),
  `${name} `,
  `\t${name}`,
  ...(name.includes("k") ? [name.replace("k", "\u212A")] : []),
]);

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
  rawHeaders: string[];
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const openReceivers: Array<() => Promise<void>> = [];

/** A real HTTP server. `answer` decides each status, from the request received. */
async function startReceiver(
  answer: (request: ReceivedRequest) => number = () => 200,
) {
  const received: ReceivedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = {
        rawHeaders: req.rawHeaders,
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      received.push(request);
      res.writeHead(answer(request)).end("from the receiver");
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
  return { url: `http://127.0.0.1:${port}/hook`, received };
}

/** Each value sent under this name, so a header sent twice can't pass as one. */
function sentValues({ rawHeaders }: ReceivedRequest, name: string) {
  return rawHeaders.flatMap((entry, index) =>
    index % 2 === 0 && entry.toLowerCase() === name.toLowerCase()
      ? [rawHeaders[index + 1]!]
      : [],
  );
}

function expectBothSignaturesToVerify(request: ReceivedRequest) {
  expect(verifyDelivery(request.headers, request.body, SECRET)).toBe(true);
  expect(request.headers["x-webhook-signature"]).toBe(
    `sha256=${createHmac("sha256", SECRET).update(request.body).digest("hex")}`,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const deliveriesOf = (webhookId: number) =>
  db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.id));

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

const storedWebhook = (
  url: string,
  headers: Record<string, string>,
  retryConfig = ONE_ATTEMPT,
) =>
  manager.registerWebhook(owner, {
    url,
    events: ["order.created"],
    active: true,
    secret: SECRET,
    retryConfig,
    headers,
  });

/** Sends one event, and returns the delivery's row once it's on record. */
async function deliverEvent(webhookId: number) {
  const before = (await deliveriesOf(webhookId)).length;
  await manager.triggerEvent("order.created", { order: 1 }, owner);
  const rows = await recordedAttempts(webhookId, before + 1);
  return rows[before]!;
}

const rowOf = async (webhookId: number) => {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, webhookId));
  return row!;
};

let warn: jest.SpiedFunction<typeof console.warn>;

/** Only this warning: `withTiming` also warns, about a slow mutation on a busy machine. */
const ignoredHeaderWarnings = () =>
  warn.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes("left out custom headers"));

const refusal = (attempt: Promise<unknown>) =>
  attempt.then(
    () => {
      throw new Error("Expected it to be refused");
    },
    (error: unknown) => error as TRPCError,
  );

beforeEach(async () => {
  warn = jest.spyOn(console, "warn").mockImplementation();
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

describe("which headers a custom one can replace", () => {
  it("covers every system header a delivery sends, one way or the other", async () => {
    const receiver = await startReceiver();
    const { id } = await storedWebhook(receiver.url, {});
    await deliverEvent(id);

    const sent = Object.keys(receiver.received[0]!.headers).filter(
      (name) => name.startsWith("x-") || name === "content-type",
    );
    expect(sent.sort()).toEqual(
      [...PROTECTED_DELIVERY_HEADERS, ...UNSIGNED_SYSTEM_HEADERS]
        .map((name) => name.toLowerCase())
        .sort(),
    );
  });

  it("protects what the docs' table says a signature depends on, and nothing else", () => {
    const table = DOCS.slice(
      DOCS.indexOf("The request also has these headers"),
      DOCS.indexOf("Any custom headers"),
    );
    const rows = [...table.matchAll(/^\| `([\w-]+)`.*\| ([^|]*?) *\|$/gm)];
    expect(rows).toHaveLength(8);
    // Blank for a signature itself, and "By ..." for what one covers.
    const dependedOn = rows.filter((row) => !row[2]!.startsWith("No"));

    expect(dependedOn.map((row) => row[1]).sort()).toEqual(
      [...PROTECTED_DELIVERY_HEADERS].sort(),
    );
  });

  it("is what the docs' paragraph on custom headers says", () => {
    const paragraph = /^Any custom headers.*$/m.exec(DOCS)?.[0] ?? "";

    for (const name of PROTECTED_DELIVERY_HEADERS) {
      expect(paragraph).toContain(`\`${name}\``);
    }
  });
});

describe("a stored webhook holding a protected name", () => {
  it.each(SPELLINGS)(
    "sends a delivery that verifies, without the value, when it's spelled %j",
    async (name) => {
      const receiver = await startReceiver();
      const { id } = await storedWebhook(receiver.url, {
        [name]: VALUE,
        Authorization: "Bearer the-token",
      });

      const delivery = await deliverEvent(id);

      expect(delivery).toMatchObject({ status: "success", statusCode: 200 });
      const request = receiver.received[0]!;
      expect(request.rawHeaders).not.toContain(VALUE);
      for (const protectedName of PROTECTED_DELIVERY_HEADERS) {
        expect(sentValues(request, protectedName)).toHaveLength(1);
      }
      expectBothSignaturesToVerify(request);
      // Only that one is left out.
      expect(sentValues(request, "authorization")).toEqual([
        "Bearer the-token",
      ]);
    },
  );

  it("records what was sent, with nothing under the protected names", async () => {
    const receiver = await startReceiver();
    const { id } = await storedWebhook(receiver.url, {
      "X-Delivery-Id": VALUE,
      "x-webhook-signature": VALUE,
      "X-Webhook-Signature-V2 ": VALUE,
      "X-DELIVERY-TIMESTAMP": VALUE,
      Authorization: "Bearer the-token",
    });

    const delivery = await deliverEvent(id);

    const request = receiver.received[0]!;
    expect(sentValues(request, "x-delivery-id")).toEqual([delivery.deliveryId]);
    // This is the row the history API returns: the real id, so it can be matched
    // to what the receiver logged, and no placeholder claiming a value was sent.
    expect(delivery.headers).toEqual({
      "Content-Type": "application/json",
      "X-Webhook-Id": String(id),
      "X-Webhook-Event": "order.created",
      "X-Webhook-Timestamp": sentValues(request, "x-webhook-timestamp")[0],
      "X-Delivery-Id": delivery.deliveryId,
      Authorization: "[redacted]",
    });
  });

  it("does the same on an automatic retry and a manual one", async () => {
    const statuses = [500];
    const receiver = await startReceiver(() => statuses.shift() ?? 200);
    const { id } = await storedWebhook(
      receiver.url,
      { "X-Webhook-Signature": VALUE, "x-delivery-timestamp": VALUE },
      TWO_ATTEMPTS,
    );

    await manager.triggerEvent("order.created", { order: 1 }, owner);
    const rows = await recordedAttempts(id, 2);
    await callerFor(owner).webhookSystem.retryDelivery({
      deliveryId: rows[1]!.deliveryId,
    });

    expect(receiver.received).toHaveLength(3);
    for (const request of receiver.received) {
      expect(request.rawHeaders).not.toContain(VALUE);
      expectBothSignaturesToVerify(request);
    }
  });

  it("does the same when the row is plaintext from before encryption at rest", async () => {
    const receiver = await startReceiver();
    const { id } = await storedWebhook(receiver.url, {});
    await db
      .update(webhooks)
      .set({ headers: { "X-Webhook-Signature": VALUE, "X-Other": "kept" } })
      .where(eq(webhooks.id, id));

    await deliverEvent(id);

    const request = receiver.received[0]!;
    expect(request.rawHeaders).not.toContain(VALUE);
    expect(sentValues(request, "x-other")).toEqual(["kept"]);
    expectBothSignaturesToVerify(request);
  });

  it("gets refused, recorded as failed, by a receiver that wanted its own value there", async () => {
    // What this rule costs: a webhook using one of these names for a fixed token.
    const receiver = await startReceiver((request) =>
      request.headers["x-webhook-signature"] === VALUE ? 200 : 401,
    );
    const { id } = await storedWebhook(receiver.url, {
      "X-Webhook-Signature": VALUE,
    });

    const delivery = await deliverEvent(id);

    expect(delivery).toMatchObject({ status: "failed", statusCode: 401 });
    expect(ignoredHeaderWarnings()).toHaveLength(1);
  });

  it("logs which webhook and header on each attempt, in the usual spelling and without the value", async () => {
    const receiver = await startReceiver();
    const { id } = await storedWebhook(receiver.url, {
      "x-webhook-signature\n": VALUE,
      "X-DELIVERY-ID": VALUE,
      "x-delivery-id": VALUE,
    });

    await deliverEvent(id);

    const lines = ignoredHeaderWarnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`Webhook ${id}:`);
    expect(lines[0]).toContain("(X-Webhook-Signature, X-Delivery-Id)");
    expect(lines[0]).not.toContain(VALUE);
    expect(lines[0]).not.toContain("\n");
  });

  it("logs nothing about a webhook with none", async () => {
    const receiver = await startReceiver();
    const { id } = await storedWebhook(receiver.url, {
      Authorization: "Bearer the-token",
      "Content-Type": "application/vnd.api+json",
    });

    await deliverEvent(id);

    expect(ignoredHeaderWarnings()).toEqual([]);
  });
});

describe("creating a webhook", () => {
  const create = (headers: Record<string, string>, url: string) =>
    callerFor(owner).webhookSystem.create({
      url,
      events: ["order.created"],
      active: true,
      secret: SECRET,
      retryConfig: ONE_ATTEMPT,
      headers,
    });

  it.each(SPELLINGS)(
    "refuses a header spelled %j, and stores nothing",
    async (name) => {
      const error = await refusal(
        create({ [name]: VALUE }, "https://example.test/hook"),
      );

      expect(error.code).toBe("BAD_REQUEST");
      expect(await db.select().from(webhooks)).toEqual([]);
    },
  );

  it("says which headers it refused, and repeats no value", async () => {
    const error = await refusal(
      create(
        {
          "x-webhook-signature": VALUE,
          "X-Delivery-Id": VALUE,
          Authorization: VALUE,
        },
        "https://example.test/hook",
      ),
    );

    expect(error.message).toContain("named X-Webhook-Signature:");
    expect(error.message).toContain("named X-Delivery-Id:");
    expect(error.message).not.toContain("named Authorization");
    expect(error.message).not.toContain(VALUE);
    expect(JSON.stringify(error.cause)).not.toContain(VALUE);
  });

  it("accepts names that only look like a protected one, and sends them", async () => {
    const receiver = await startReceiver();
    const headers = {
      "X-Webhook-Signature-Extra": "one",
      "X-Delivery-Id-Upstream": "two",
      "X-Webhook-Token": "three",
      Authorization: "Bearer the-token",
    };

    const { data } = await create(headers, receiver.url);
    await deliverEvent(data.id);

    const request = receiver.received[0]!;
    for (const [name, value] of Object.entries(headers)) {
      expect(sentValues(request, name)).toEqual([value]);
    }
    expectBothSignaturesToVerify(request);
  });

  it.each([
    ["Content-Type", "application/vnd.api+json"],
    ["content-type", "text/plain"],
    // Harmless today, and common in copied config, so it has to stay accepted.
    ["Content-Type", "application/json"],
    ["X-Webhook-Id", "orders-prod"],
    ["x-webhook-id", "orders-prod"],
    ["X-Webhook-Event", "orders"],
    ["x-webhook-event", "orders"],
    ["X-Webhook-Timestamp", "custom"],
    ["X-WEBHOOK-TIMESTAMP", "custom"],
    ["Content-Type ", "text/plain"],
  ])(
    "accepts %j, which replaces the system header, and the delivery still verifies",
    async (name, value) => {
      const receiver = await startReceiver();

      const { data } = await create({ [name]: value }, receiver.url);
      const delivery = await deliverEvent(data.id);

      const request = receiver.received[0]!;
      expect(sentValues(request, name.trim())).toEqual([value]);
      expectBothSignaturesToVerify(request);
      // Whatever the header says, the body is the JSON event the signatures cover.
      expect(JSON.parse(request.body.toString())).toMatchObject({
        event: "order.created",
        data: { order: 1 },
      });
      // Under the owner's spelling alone. Claiming the system's value as well would
      // say something was sent that wasn't.
      const recorded = Object.entries(delivery.headers as object).filter(
        ([key]) => key.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      expect(recorded).toEqual([[name, "[redacted]"]]);
    },
  );
});

describe("updating a stored webhook that holds a protected name", () => {
  async function stored() {
    const receiver = await startReceiver();
    const { id, key } = await storedWebhook(receiver.url, {
      "X-Webhook-Signature": VALUE,
      Authorization: "Bearer the-token",
    });
    return { receiver, id, key, before: await rowOf(id) };
  }

  const update = (
    id: number,
    updates: Parameters<
      ReturnType<typeof callerFor>["webhookSystem"]["update"]
    >[0]["updates"],
  ) => callerFor(owner).webhookSystem.update({ id, updates });

  it("goes through when it doesn't name headers, and leaves them stored and ignored", async () => {
    const { id, before } = await stored();
    const other = await startReceiver();

    await update(id, { url: other.url, active: false });
    await update(id, { active: true });

    const after = await rowOf(id);
    expect(after).toMatchObject({ url: other.url, active: true });
    expect(after.headers).toEqual(before.headers);

    await deliverEvent(id);
    const request = other.received[0]!;
    expect(request.rawHeaders).not.toContain(VALUE);
    expect(sentValues(request, "authorization")).toEqual(["Bearer the-token"]);
    expectBothSignaturesToVerify(request);
  });

  it("doesn't show the owner the name, so reads can't tell them it's there", async () => {
    const { id } = await stored();

    const { data } = await callerFor(owner).webhookSystem.get({ id });

    expect(data).toMatchObject({ headers: {}, hasHeaders: true });
  });

  it.each(["X-Webhook-Signature", "x-webhook-signature "])(
    "is refused when it sends %j again, and nothing else in that update applies",
    async (name) => {
      const { id, before } = await stored();
      const other = await startReceiver();

      const error = await refusal(
        update(id, {
          url: other.url,
          active: false,
          events: ["something.else"],
          headers: { [name]: VALUE, Authorization: "Bearer another-token" },
        }),
      );

      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toContain("named X-Webhook-Signature:");
      expect(error.message).not.toContain(VALUE);
      expect(await rowOf(id)).toEqual(before);
    },
  );

  it("replaces them when it sends headers without the name, so nothing is left to ignore", async () => {
    const { receiver, id, key } = await stored();

    await update(id, { headers: { Authorization: "Bearer another-token" } });

    const after = await rowOf(id);
    expect(decryptWebhookHeaders(after.headers, key, owner)).toEqual({
      Authorization: "Bearer another-token",
    });

    await deliverEvent(id);
    expect(sentValues(receiver.received[0]!, "authorization")).toEqual([
      "Bearer another-token",
    ]);
    expectBothSignaturesToVerify(receiver.received[0]!);
    expect(ignoredHeaderWarnings()).toEqual([]);
  });

  it("clears them when it sends none", async () => {
    const { receiver, id } = await stored();

    await update(id, { headers: {} });

    expect((await rowOf(id)).headers).toEqual({});
    await deliverEvent(id);
    expect(sentValues(receiver.received[0]!, "authorization")).toEqual([]);
    expectBothSignaturesToVerify(receiver.received[0]!);
  });
});
