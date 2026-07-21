/**
 * @jest-environment node
 *
 * HI-01 regression: a webhook event fans out ONLY to the producing tenant's
 * own subscriptions. An attacker's `*` subscription in another tenant must not
 * receive it.
 */
// Self-contained factory (jest.mock is hoisted above module-scope consts).
jest.mock("@/server/storage", () => ({
  storage: { getActiveWebhooksForEvent: jest.fn() },
}));

// db.insert(...).values(...).returning() → one event row.
jest.mock("@/server/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 99, createdAt: new Date(0) }],
      }),
    }),
  },
}));

jest.mock("../WebhookQueue", () => ({
  WebhookQueue: jest
    .fn()
    .mockImplementation(() => ({ enqueue: jest.fn(async () => undefined) })),
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
import { storage } from "@/server/storage";

const mockGetActiveWebhooksForEvent =
  storage.getActiveWebhooksForEvent as jest.Mock;
// The queue instance is created inside the manager's constructor; grab its
// enqueue mock off the singleton.
function enqueueMock(): jest.Mock {
  return (
    WebhookManager.getInstance() as unknown as {
      webhookQueue: { enqueue: jest.Mock };
    }
  ).webhookQueue.enqueue;
}

const OWNER = "tenant-owner";

beforeEach(() => {
  mockGetActiveWebhooksForEvent.mockReset();
  enqueueMock().mockClear();
});

describe("WebhookManager.triggerEvent tenant scoping", () => {
  it("queries subscriptions scoped to the producing tenant", async () => {
    mockGetActiveWebhooksForEvent.mockResolvedValue([
      { id: 1, url: "https://x", secret: "s", headers: {}, retryConfig: null },
    ]);

    await WebhookManager.getInstance().triggerEvent(
      "webhook.thing",
      { hello: "world" },
      OWNER,
      { webhookId: 7 },
    );

    expect(mockGetActiveWebhooksForEvent).toHaveBeenCalledWith(
      "webhook.thing",
      OWNER,
    );
    // Only the owner's subscription is enqueued.
    expect(enqueueMock()).toHaveBeenCalledTimes(1);
  });

  it("does not fan out when the tenant has no subscriptions", async () => {
    mockGetActiveWebhooksForEvent.mockResolvedValue([]);
    await WebhookManager.getInstance().triggerEvent(
      "webhook.thing",
      {},
      OWNER,
      { webhookId: 7 },
    );
    expect(enqueueMock()).not.toHaveBeenCalled();
  });

  it("refuses to fan out without an owning tenant", async () => {
    await expect(
      WebhookManager.getInstance().triggerEvent("webhook.thing", {}, ""),
    ).rejects.toThrow(/owning tenant/i);
    expect(mockGetActiveWebhooksForEvent).not.toHaveBeenCalled();
  });
});
