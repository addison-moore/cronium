/**
 * @jest-environment node
 */
const processDelivery = jest.fn();

jest.mock("../WebhookManager", () => ({
  WebhookManager: { getInstance: () => ({ processDelivery }) },
}));

import { WebhookQueue, type QueueItem } from "../WebhookQueue";

type Enqueue = Omit<QueueItem, "id" | "attempts">;

const item = (retryConfig?: QueueItem["retryConfig"]): Enqueue => ({
  webhookId: 1,
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
