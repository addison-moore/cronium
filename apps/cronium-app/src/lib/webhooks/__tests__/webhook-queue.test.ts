/**
 * @jest-environment node
 */
const processDelivery = jest.fn();

jest.mock("../WebhookManager", () => ({
  WebhookManager: { getInstance: () => ({ processDelivery }) },
}));

import {
  MAX_RUNNING_DELIVERIES,
  MAX_RUNNING_PER_OWNER,
  MAX_RUNNING_PER_WEBHOOK,
  WebhookQueue,
  type QueueItem,
} from "../WebhookQueue";

type Enqueue = Omit<QueueItem, "id" | "attempts">;

const item = (
  retryConfig?: QueueItem["retryConfig"],
  webhookId = 1,
  ownerUserId = "tenant-a",
): Enqueue => ({
  webhookId,
  ownerUserId,
  webhookEventId: 2,
  url: "https://hooks.example/in",
  secret: "decrypted-secret",
  headers: {},
  payload: {
    id: "2",
    event: "e",
    timestamp: new Date(),
    data: {},
  },
  ...(retryConfig !== undefined && { retryConfig }),
});

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

    await queue.enqueue(item());
    await flush();

    expect(processDelivery).toHaveBeenCalledTimes(1);
    expect(retained(queue).size).toBe(0);
  });

  it("retries with backoff, then lets go of the item and its secret", async () => {
    processDelivery.mockResolvedValue({ success: false, statusCode: 500 });
    const queue = new WebhookQueue();

    await queue.enqueue(
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

    await queue.enqueue(
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
      await queue.enqueue(item(undefined, 1));
    }
    await queue.enqueue(item(undefined, 2));
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
      await queue.enqueue(item(undefined, webhookId, "tenant-a"));
    }
    await queue.enqueue(item(undefined, 100, "tenant-b"));
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
      await queue.enqueue(item(undefined, webhookId, `tenant-${webhookId}`));
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
        await queue.enqueue(
          item(undefined, tenant * 100 + i, `tenant-${tenant}`),
        );
      }
    }
    await queue.enqueue(item(undefined, 0, "tenant-0"));
    await queue.enqueue(item(undefined, 9999, "tenant-with-nothing-running"));
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
      await queue.enqueue(item(undefined, 1));
      await queue.enqueue(item(undefined, 2));
    }
    await queue.enqueue(item(undefined, 1));
    await queue.enqueue(item(undefined, 3));
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
      await queue.enqueue(item(undefined, 1));
      await queue.enqueue(item(undefined, 2));
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
      await queue.enqueue(item());
    }
    await flush();
    expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);
    running.splice(0).forEach((delivery) => delivery.finish({ success: true }));
    await flush();

    // Nothing looked at the queue when those ended. The new event does.
    expect(running).toHaveLength(0);
    await queue.enqueue(item());
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
      await queue.enqueue(item(slowRetry));
    }
    await queue.enqueue(item(slowRetry));
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
      await queue.enqueue(item(quickRetry));
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
        await queue.enqueue(item(oneAttempt));
      }
      await flush();

      expect(running).toHaveLength(MAX_RUNNING_PER_WEBHOOK);
      expect(retained(queue).size).toBe(0);
      running.splice(0).forEach(end);
      await flush();
    }
  });
});
