/**
 * @jest-environment node
 *
 * The steps `prepareEvent` hands back. The inbound endpoint stores the event's row in its
 * own transaction and queues the deliveries only once that has committed, so `store`
 * writes with whatever it's given and queues nothing, and the room comes back once
 * whichever way an event fails. tests/storage/webhook-delivery-id-release.test.ts covers
 * the same through the real route and real Postgres.
 */
jest.mock("@/server/storage", () => ({
  storage: { getActiveWebhooksForEvent: jest.fn() },
}));
jest.mock("@/server/db", () => ({ db: { insert: jest.fn() } }));
jest.mock("../WebhookQueue", () => ({
  WebhookQueue: jest.fn().mockImplementation(() => ({ reserve: jest.fn() })),
}));
jest.mock("../WebhookSecurity", () => ({
  WebhookSecurity: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("@/lib/ssrf-guard", () => ({
  assertRequestUrlIsPublic: jest.fn(),
  ssrfHttpAgent: {},
  ssrfHttpsAgent: {},
}));
jest.mock("@/lib/tools/safe-fetch", () => ({
  SsrfBlockedError: class extends Error {},
}));
jest.mock("axios", () => ({ request: jest.fn() }));
jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));

import { WebhookManager } from "@/lib/webhooks/WebhookManager";
import { db } from "@/server/db";
import { storage } from "@/server/storage";

const OWNER = "tenant-owner";
const SUBSCRIBER = {
  id: 1,
  url: "https://receiver.example",
  secret: "s",
  headers: {},
  retryConfig: null,
};

const manager = WebhookManager.getInstance();
const reserve = (manager as unknown as { webhookQueue: { reserve: jest.Mock } })
  .webhookQueue.reserve;
const enqueue = jest.fn();
const cancel = jest.fn();

/** Something to write with, like `db` or a transaction, whose insert answers `answer`. */
function writerAnswering(answer: () => Promise<unknown[]>) {
  const returning = jest.fn(answer);
  const values = jest.fn(() => ({ returning }));
  return { insert: jest.fn(() => ({ values })), values };
}

const storedRow = () =>
  Promise.resolve([{ id: 42, event: "webhook.thing", createdAt: new Date(0) }]);

async function prepared(subscribers: unknown[] = [SUBSCRIBER]) {
  (storage.getActiveWebhooksForEvent as jest.Mock).mockResolvedValue(
    subscribers,
  );
  const event = await manager.prepareEvent(
    "webhook.thing",
    { hello: "world" },
    OWNER,
    { webhookId: 7 },
  );
  if (event.refused) throw new Error("refused");
  return event;
}

beforeEach(() => {
  jest.clearAllMocks();
  reserve.mockReturnValue({ full: [], enqueue, cancel });
});

describe("a prepared event", () => {
  it("stores its row with what it's given, and queues nothing until it's sent", async () => {
    const event = await prepared();
    const writer = writerAnswering(storedRow);

    await event.store(writer as never);

    expect(writer.values).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "webhook.thing",
        userId: OWNER,
        sourceWebhookId: 7,
      }),
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    await event.send();

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [eventId, payload] = enqueue.mock.calls[0] as [
      number,
      { event: string; body: Buffer },
    ];
    expect(eventId).toBe(42);
    expect(JSON.parse(payload.body.toString())).toMatchObject({
      id: "42",
      event: "webhook.thing",
      data: { hello: "world" },
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("leaves giving the room back to its caller when its row won't go in", async () => {
    const event = await prepared();
    const writer = writerAnswering(() =>
      Promise.reject(new Error("no database")),
    );

    await expect(event.store(writer as never)).rejects.toThrow("no database");

    // The caller cancels, as it has to when its own writes fail after this worked,
    // and giving the room back twice would make room that isn't there.
    expect(cancel).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("can't be sent before its row is stored", async () => {
    const event = await prepared();

    await expect(event.send()).rejects.toThrow(/stored before it's sent/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stores and queues nothing when nothing subscribes", async () => {
    const event = await prepared([]);
    const writer = writerAnswering(storedRow);

    await event.store(writer as never);
    await event.send();
    event.cancel();

    expect(reserve).not.toHaveBeenCalled();
    expect(writer.insert).not.toHaveBeenCalled();
  });
});

describe("triggerEvent", () => {
  it("gives the room back and queues nothing when the row won't go in", async () => {
    (storage.getActiveWebhooksForEvent as jest.Mock).mockResolvedValue([
      SUBSCRIBER,
    ]);
    const writer = writerAnswering(() =>
      Promise.reject(new Error("no database")),
    );
    (db.insert as jest.Mock).mockImplementation(writer.insert);

    await expect(
      manager.triggerEvent("webhook.thing", {}, OWNER),
    ).rejects.toThrow("no database");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stores the row with `db` and then queues it", async () => {
    (storage.getActiveWebhooksForEvent as jest.Mock).mockResolvedValue([
      SUBSCRIBER,
    ]);
    const writer = writerAnswering(storedRow);
    (db.insert as jest.Mock).mockImplementation(writer.insert);

    await manager.triggerEvent("webhook.thing", {}, OWNER);

    expect(writer.insert).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(42, expect.anything());
    expect(cancel).not.toHaveBeenCalled();
  });
});
