/**
 * @jest-environment node
 */
const processDelivery = jest.fn();

jest.mock("../WebhookManager", () => ({
  WebhookManager: { getInstance: () => ({ processDelivery }) },
}));

import type { SerializedPayload } from "../delivery-body";
import {
  deliveryOwnBytes,
  MAX_HELD_BYTES,
  MAX_HELD_BYTES_PER_OWNER,
  MAX_HELD_BYTES_PER_WEBHOOK,
  MAX_RUNNING_DELIVERIES,
  MAX_RUNNING_PER_OWNER,
  MAX_RUNNING_PER_WEBHOOK,
  WebhookQueue,
  type DeliveryTarget,
  type QueueItem,
  type QueueReservation,
} from "../WebhookQueue";

const payload = (body = "{}"): SerializedPayload => ({
  event: "e",
  timestamp: new Date(),
  body: Buffer.from(body),
});

const target = (
  webhookId = 1,
  retryConfig?: QueueItem["retryConfig"],
): DeliveryTarget => ({
  webhookId,
  url: "https://hooks.example/in",
  secret: "decrypted-secret",
  headers: {},
  ...(retryConfig !== undefined && { retryConfig }),
});

interface OneDelivery {
  target: DeliveryTarget;
  ownerUserId: string;
}

const item = (
  retryConfig?: QueueItem["retryConfig"],
  webhookId = 1,
  ownerUserId = "tenant-a",
): OneDelivery => ({ target: target(webhookId, retryConfig), ownerUserId });

/** One event to one webhook, as the manager does it. */
function enqueue(queue: WebhookQueue, delivery: OneDelivery) {
  const body = payload();
  const reservation = queue.reserve(delivery.ownerUserId, body.body.length, [
    delivery.target,
  ]);
  accepted(reservation).enqueue(2, body);
}

function accepted(reservation: QueueReservation) {
  if (reservation.refused) throw new Error(`Refused: ${reservation.refused}`);
  return reservation;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise(setImmediate);
};

const retained = (queue: WebhookQueue) =>
  (queue as unknown as { queue: Map<string, QueueItem> }).queue;

interface Delivery {
  webhookId: number;
  finish: (result: { success: boolean; statusCode?: number }) => void;
  fail: (error: Error) => void;
}

/** Deliveries stay running until the test ends them, like a receiver thinking. */
function holdDeliveries(): Delivery[] {
  const running: Delivery[] = [];
  processDelivery.mockImplementation(
    (webhookId: number) =>
      new Promise((resolve, reject) => {
        running.push({ webhookId, finish: resolve, fail: reject });
      }),
  );
  return running;
}

const tick = async () => {
  jest.advanceTimersByTime(1000);
  await flush();
};

const startedFor = (webhookId: number) =>
  processDelivery.mock.calls.filter(([id]) => id === webhookId).length;

beforeEach(() => {
  processDelivery.mockReset();
  jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("WebhookQueue", () => {
  it("delivers once and keeps nothing after success", async () => {
    processDelivery.mockResolvedValue({ success: true });
    const queue = new WebhookQueue();

    enqueue(queue, item());
    await flush();

    expect(processDelivery).toHaveBeenCalledTimes(1);
    expect(retained(queue).size).toBe(0);
  });

  it("retries with backoff, then lets go of the item and its secret", async () => {
    processDelivery.mockResolvedValue({ success: false, statusCode: 500 });
    const queue = new WebhookQueue();

    enqueue(
      queue,
      item({ maxRetries: 3, retryDelay: 100, backoffMultiplier: 2 }),
    );
    await flush();
    expect(processDelivery).toHaveBeenCalledTimes(1);
    expect(retained(queue).size).toBe(1);

    // Backoff not elapsed: the 1s tick must not redeliver early.
    jest.advanceTimersByTime(1000);
    await flush();
    expect(processDelivery).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    await flush();
    expect(processDelivery).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(60_000);
    await flush();
    expect(processDelivery).toHaveBeenCalledTimes(3);
    expect(retained(queue).size).toBe(0);
  });

  it("makes no more attempts at a failure that another can't change", async () => {
    processDelivery.mockResolvedValue({
      success: false,
      retryable: false,
      error: "too long",
    });
    const queue = new WebhookQueue();

    enqueue(
      queue,
      item({ maxRetries: 3, retryDelay: 100, backoffMultiplier: 2 }),
    );
    await flush();
    expect(retained(queue).size).toBe(0);

    jest.advanceTimersByTime(60_000);
    await flush();
    expect(processDelivery).toHaveBeenCalledTimes(1);
  });
});

describe("what a delivery can hold up", () => {
  it("keeps a webhook to its limit, and goes past it to one that can run", async () => {
    holdDeliveries();
    const queue = new WebhookQueue();

    for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK + 2; i++) {
      enqueue(queue, item(undefined, 1));
    }
    enqueue(queue, item(undefined, 2));
    await tick();
    await tick();

    expect(startedFor(1)).toBe(MAX_RUNNING_PER_WEBHOOK);
    expect(startedFor(2)).toBe(1);
    expect(retained(queue).size).toBe(2);
  });

  it("keeps a tenant to its limit however many webhooks it has", async () => {
    holdDeliveries();
    const queue = new WebhookQueue();
    const webhooks = MAX_RUNNING_PER_OWNER; // One running on each is enough.

    for (let webhookId = 1; webhookId <= webhooks + 1; webhookId++) {
      enqueue(queue, item(undefined, webhookId, "tenant-a"));
    }
    enqueue(queue, item(undefined, 100, "tenant-b"));
    await tick();

    expect(processDelivery).toHaveBeenCalledTimes(MAX_RUNNING_PER_OWNER + 1);
    expect(startedFor(100)).toBe(1);
  });

  it("keeps everyone to the total", async () => {
    holdDeliveries();
    const queue = new WebhookQueue();

    for (
      let webhookId = 1;
      webhookId <= MAX_RUNNING_DELIVERIES + 1;
      webhookId++
    ) {
      enqueue(queue, item(undefined, webhookId, `tenant-${webhookId}`));
    }
    await tick();

    expect(processDelivery).toHaveBeenCalledTimes(MAX_RUNNING_DELIVERIES);
    expect(retained(queue).size).toBe(1);
  });

  it("gives a free slot to the tenant with the fewest running, ahead of older items", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();

    // Every slot taken, with an older backlog for one of the tenants running.
    const fullTenants = MAX_RUNNING_DELIVERIES / MAX_RUNNING_PER_OWNER;
    for (let tenant = 0; tenant < fullTenants; tenant++) {
      for (let i = 0; i < MAX_RUNNING_PER_OWNER; i++) {
        enqueue(queue, item(undefined, tenant * 100 + i, `tenant-${tenant}`));
      }
    }
    enqueue(queue, item(undefined, 0, "tenant-0"));
    enqueue(queue, item(undefined, 9999, "tenant-with-nothing-running"));
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_DELIVERIES);

    running[0]!.finish({ success: true });
    await flush();
    await tick();

    expect(running).toHaveLength(MAX_RUNNING_DELIVERIES + 1);
    expect(running.at(-1)!.webhookId).toBe(9999);
  });

  it("gives a tenant's free slot to its webhook with the fewest running", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();

    // The tenant at its limit on two webhooks, with an older backlog on one.
    for (let i = 0; i < MAX_RUNNING_PER_OWNER / 2; i++) {
      enqueue(queue, item(undefined, 1));
      enqueue(queue, item(undefined, 2));
    }
    enqueue(queue, item(undefined, 1));
    enqueue(queue, item(undefined, 3));
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_PER_OWNER);

    running.find(({ webhookId }) => webhookId === 1)!.finish({ success: true });
    await flush();
    await tick();

    expect(running).toHaveLength(MAX_RUNNING_PER_OWNER + 1);
    expect(running.at(-1)!.webhookId).toBe(3);
  });

  it("starts one item per webhook on a tick, however many slots are free", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();

    // A backlog behind each webhook's limit, then every slot free again.
    for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK + 3; i++) {
      enqueue(queue, item(undefined, 1));
      enqueue(queue, item(undefined, 2));
    }
    await flush();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK * 2);
    running.splice(0).forEach((delivery) => delivery.finish({ success: true }));
    await flush();

    await tick();
    expect(running.map(({ webhookId }) => webhookId).sort()).toEqual([1, 2]);

    await tick();
    expect(running.map(({ webhookId }) => webhookId).sort()).toEqual([
      1, 1, 2, 2,
    ]);
    expect(retained(queue).size).toBe(2);
  });

  it("starts one item for each new event, on top of the tick's", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();

    for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK + 1; i++) {
      enqueue(queue, item());
    }
    await flush();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);
    running.splice(0).forEach((delivery) => delivery.finish({ success: true }));
    await flush();

    // Nothing looked at the queue when those ended. The new event does.
    expect(running).toHaveLength(0);
    enqueue(queue, item());
    await flush();
    expect(running).toHaveLength(1);
    expect(retained(queue).size).toBe(1);

    await tick();
    expect(running).toHaveLength(2);
  });

  it("doesn't count a retry waiting out its backoff against its webhook", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();
    const slowRetry = { maxRetries: 2, retryDelay: 3_600_000 };

    for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK; i++) {
      enqueue(queue, item(slowRetry));
    }
    enqueue(queue, item(slowRetry));
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);

    running[0]!.finish({ success: false, statusCode: 500 });
    await flush();
    await tick();

    // The next event went instead, and the retry is still there for later.
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK + 1);
    expect(retained(queue).size).toBe(1);
    expect([...retained(queue).values()][0]!.attempts).toBe(1);

    // A free slot doesn't bring it forward.
    running[1]!.finish({ success: true });
    await flush();
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK + 1);
    expect(retained(queue).size).toBe(1);

    jest.advanceTimersByTime(3_600_000);
    await flush();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK + 2);
    expect(retained(queue).size).toBe(0);
  });

  it("holds a due retry while its webhook is at its limit, and doesn't lose it", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();
    const quickRetry = { maxRetries: 2, retryDelay: 100 };

    for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK + 1; i++) {
      enqueue(queue, item(quickRetry));
    }
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);

    // The freed slot goes to the waiting event, so the retry is due and held.
    running[0]!.finish({ success: false, statusCode: 500 });
    await flush();
    await tick();
    await tick();
    await tick();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK + 1);
    expect(retained(queue).size).toBe(1);

    running[1]!.finish({ success: true });
    await flush();
    await tick();

    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK + 2);
    expect(retained(queue).size).toBe(0);
  });

  it.each([
    ["succeeds", (delivery: Delivery) => delivery.finish({ success: true })],
    [
      "fails",
      (delivery: Delivery) =>
        delivery.finish({ success: false, statusCode: 500 }),
    ],
    ["throws", (delivery: Delivery) => delivery.fail(new Error("no database"))],
  ])("gives its slot back when a delivery %s", async (_how, end) => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();
    const oneAttempt = { maxRetries: 1 };

    // Enough rounds to run into any of the limits if one didn't come back down.
    const rounds = MAX_RUNNING_DELIVERIES / MAX_RUNNING_PER_WEBHOOK + 1;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < MAX_RUNNING_PER_WEBHOOK; i++) {
        enqueue(queue, item(oneAttempt));
      }
      await flush();

      expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);
      expect(retained(queue).size).toBe(0);
      running.splice(0).forEach(end);
      await flush();
    }
  });
});

describe("what the queue holds", () => {
  const MiB = 1024 * 1024;
  const own = deliveryOwnBytes(target());

  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation();
  });
  afterEach(() => {
    warn.mockRestore();
  });

  /** An event this long, and nothing of that length in memory but its count. */
  const reserve = (
    queue: WebhookQueue,
    bodyBytes: number,
    webhookIds: number[] = [1],
    ownerUserId = "tenant-a",
  ) =>
    queue.reserve(
      ownerUserId,
      bodyBytes,
      webhookIds.map((webhookId) => target(webhookId)),
    );

  /** Claims that never start running, so they hold their room until told. */
  const fill = (
    queue: WebhookQueue,
    webhookIds: number[],
    ownerUserId = "tenant-a",
  ) => {
    for (const webhookId of webhookIds) {
      accepted(
        reserve(
          queue,
          MAX_HELD_BYTES_PER_WEBHOOK - own,
          [webhookId],
          ownerUserId,
        ),
      );
    }
  };

  it("fits an event that takes a webhook exactly to its limit, and no more", () => {
    const queue = new WebhookQueue();

    expect(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own + 1).refused).toBe(
      "webhook",
    );

    accepted(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own));
    expect(reserve(queue, 0).refused).toBe("webhook");
  });

  it("keeps a tenant to its limit however many webhooks it has", () => {
    const queue = new WebhookQueue();
    const webhooks = MAX_HELD_BYTES_PER_OWNER / MAX_HELD_BYTES_PER_WEBHOOK;

    fill(
      queue,
      Array.from({ length: webhooks }, (_, n) => n + 1),
    );

    expect(reserve(queue, 0, [100]).refused).toBe("owner");
  });

  it("leaves one tenant's room alone when another's is used up", () => {
    const queue = new WebhookQueue();

    fill(queue, [1, 2], "tenant-a");

    accepted(reserve(queue, MiB, [3], "tenant-b"));
    expect(reserve(queue, MiB, [4], "tenant-a").refused).toBe("owner");
  });

  it("keeps everyone to the total", () => {
    const queue = new WebhookQueue();
    const tenants = MAX_HELD_BYTES / MAX_HELD_BYTES_PER_OWNER;
    const webhooks = MAX_HELD_BYTES_PER_OWNER / MAX_HELD_BYTES_PER_WEBHOOK;

    for (let tenant = 0; tenant < tenants; tenant++) {
      fill(
        queue,
        Array.from({ length: webhooks }, (_, n) => tenant * 100 + n),
        `tenant-${tenant}`,
      );
    }

    expect(reserve(queue, 0, [9999], "tenant-with-nothing").refused).toBe(
      "total",
    );
  });

  it("counts an event's body once at the tenant, however many webhooks it goes to", () => {
    const queue = new WebhookQueue();
    const webhooks = [1, 2, 3];
    const events = 3;
    const body = 10 * MiB;

    // Past the tenant's limit if each webhook's share counted, when there's one copy.
    expect(events * webhooks.length * body).toBeGreaterThan(
      MAX_HELD_BYTES_PER_OWNER,
    );

    for (let event = 0; event < events; event++) {
      expect(accepted(reserve(queue, body, webhooks)).full).toEqual([]);
    }
  });

  it.each([
    ["URL", { url: "x".repeat(MAX_HELD_BYTES_PER_WEBHOOK) }],
    ["secret", { secret: "x".repeat(MAX_HELD_BYTES_PER_WEBHOOK) }],
    [
      "custom headers",
      { headers: { "X-Long": "x".repeat(MAX_HELD_BYTES_PER_WEBHOOK) } },
    ],
  ])("counts a delivery's own copy of its %s", (_what, long) => {
    const queue = new WebhookQueue();

    expect(
      queue.reserve("tenant-a", 1, [{ ...target(), ...long }]).refused,
    ).toBe("webhook");
  });

  it("has a limit on tiny events too, through what each delivery costs", () => {
    const queue = new WebhookQueue();
    const fits = Math.floor(MAX_HELD_BYTES_PER_WEBHOOK / (own + 2));

    for (let event = 0; event < fits; event++) {
      accepted(reserve(queue, 2));
    }

    expect(fits).toBeLessThan(20_000);
    expect(reserve(queue, 2).refused).toBe("webhook");
  });

  it("leaves out a webhook with no room while another has some", async () => {
    processDelivery.mockResolvedValue({ success: true });
    const queue = new WebhookQueue();
    fill(queue, [1]);

    const reservation = accepted(reserve(queue, 1, [1, 2]));
    reservation.enqueue(2, payload());
    await flush();

    expect(reservation.full.map(({ webhookId }) => webhookId)).toEqual([1]);
    expect(processDelivery.mock.calls.map(([id]) => id)).toEqual([2]);
  });

  it("refuses an event when none of its webhooks has room", () => {
    const queue = new WebhookQueue();
    fill(queue, [1, 2]);

    expect(reserve(queue, 1, [1, 2]).refused).toBe("webhook");
  });

  it("gives the room back when told the event isn't going out", () => {
    const queue = new WebhookQueue();

    for (let i = 0; i < 3; i++) {
      accepted(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own)).cancel();
    }

    expect(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own).refused).toBe(
      undefined,
    );
  });

  it("gives back a fanned-out event's body with the last of its deliveries", async () => {
    const running = holdDeliveries();
    const queue = new WebhookQueue();

    // Together these take the tenant exactly to its limit.
    const body = MAX_HELD_BYTES_PER_WEBHOOK - own;
    const fannedOut = accepted(reserve(queue, body, [1, 2]));
    fannedOut.enqueue(2, payload());
    await flush();
    expect(running).toHaveLength(2);
    accepted(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - 2 * own, [3]));
    expect(reserve(queue, 0, [4]).refused).toBe("owner");

    // One delivery over gives back only what it held itself.
    running[0]!.finish({ success: true });
    await flush();
    expect(reserve(queue, 1, [4]).refused).toBe("owner");

    running[1]!.finish({ success: true });
    await flush();
    accepted(reserve(queue, MiB, [4]));
  });

  it.each([
    ["succeeds", { success: true }],
    ["fails for good", { success: false, retryable: false }],
  ])("gives the room back when a delivery %s", async (_how, result) => {
    processDelivery.mockResolvedValue(result);
    const queue = new WebhookQueue();

    for (let round = 0; round < 3; round++) {
      const reservation = accepted(
        reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own),
      );
      reservation.enqueue(2, payload());
      await flush();
    }
  });

  it("keeps a retry's room while it waits, so new events are the ones refused", async () => {
    processDelivery.mockResolvedValue({ success: false, statusCode: 500 });
    const queue = new WebhookQueue();
    const retrying = {
      ...target(1, { maxRetries: 2, retryDelay: 60_000, backoffMultiplier: 1 }),
    };

    const reservation = accepted(
      queue.reserve("tenant-a", MAX_HELD_BYTES_PER_WEBHOOK - own, [retrying]),
    );
    reservation.enqueue(2, payload());
    await flush();

    // One attempt over and the other waiting out its backoff.
    expect(processDelivery).toHaveBeenCalledTimes(1);
    expect(retained(queue).size).toBe(1);
    expect(reserve(queue, 1).refused).toBe("webhook");

    // Nothing moved it, so it goes out when it's due, and only then is the room free.
    jest.advanceTimersByTime(60_000);
    await flush();
    await tick();
    expect(processDelivery).toHaveBeenCalledTimes(2);
    expect(retained(queue).size).toBe(0);
    accepted(reserve(queue, 1));
  });

  it("gives the room back when a delivery runs out of attempts", async () => {
    processDelivery.mockResolvedValue({ success: false, statusCode: 500 });
    const queue = new WebhookQueue();

    const reservation = accepted(
      queue.reserve("tenant-a", MAX_HELD_BYTES_PER_WEBHOOK - own, [
        target(1, { maxRetries: 1 }),
      ]),
    );
    reservation.enqueue(2, payload());
    await flush();

    expect(retained(queue).size).toBe(0);
    accepted(reserve(queue, MAX_HELD_BYTES_PER_WEBHOOK - own));
  });

  it("tells the server log, at most once a minute", () => {
    const queue = new WebhookQueue();
    fill(queue, [1]);

    reserve(queue, 1);
    reserve(queue, 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"webhook" limit');

    jest.advanceTimersByTime(60_000);
    reserve(queue, 1);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
