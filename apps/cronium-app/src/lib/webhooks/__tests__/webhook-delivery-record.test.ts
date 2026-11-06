/**
 * @jest-environment node
 *
 * A webhook's custom headers are encrypted at rest and decrypted only to send
 * the request. The delivery record must not undo that: it is an unencrypted
 * column, returned as is by the delivery-history API.
 */
const inserted: Array<Record<string, unknown>> = [];

jest.mock("@/server/db", () => ({
  db: {
    insert: jest.fn(() => ({
      values: jest.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve();
      }),
    })),
  },
}));
jest.mock("@/server/storage", () => ({ storage: {} }));
jest.mock("../WebhookQueue", () => ({
  WebhookQueue: jest.fn().mockImplementation(() => ({ enqueue: jest.fn() })),
}));
jest.mock("@/lib/rate-limit-service", () => ({ RateLimitService: {} }));
jest.mock("@/lib/ssrf-guard", () => ({
  assertRequestUrlIsPublic: jest.fn(),
  ssrfHttpAgent: {},
  ssrfHttpsAgent: {},
}));
jest.mock("@/lib/tools/safe-fetch", () => ({
  SsrfBlockedError: class extends Error {},
}));
jest.mock("axios", () => ({ request: jest.fn() }));
jest.mock("nanoid", () => ({ nanoid: () => "delivery-1" }));

import axios from "axios";
import { WebhookManager } from "../WebhookManager";

const axiosRequest = axios.request as unknown as jest.Mock;

const CUSTOM_HEADERS = {
  Authorization: "Bearer SECRET-SENTINEL",
  "X-Api-Key": "ALSO-SECRET-SENTINEL",
};

const deliver = () =>
  WebhookManager.getInstance().processDelivery(
    1,
    2,
    "https://hooks.example/in",
    "hmac-secret",
    CUSTOM_HEADERS,
    {
      id: "2",
      event: "user.created",
      timestamp: new Date("2026-11-04T00:00:00Z"),
      data: {},
    },
  );

beforeEach(() => {
  inserted.length = 0;
  axiosRequest.mockReset();
  axiosRequest.mockResolvedValue({ status: 200, data: "ok" });
});

describe("webhook delivery record", () => {
  it("sends the custom headers but records only their names", async () => {
    await deliver();

    const sent = (
      axiosRequest.mock.calls[0]![0] as { headers: Record<string, string> }
    ).headers;
    expect(sent.Authorization).toBe("Bearer SECRET-SENTINEL");
    expect(sent["X-Api-Key"]).toBe("ALSO-SECRET-SENTINEL");
    expect(sent["X-Webhook-Signature"]).toMatch(/^sha256=/);

    const recorded = inserted[0]!.headers as Record<string, string>;
    expect(JSON.stringify(recorded)).not.toContain("SENTINEL");
    expect(recorded.Authorization).toBe("[redacted]");
    expect(recorded["X-Api-Key"]).toBe("[redacted]");
    expect(recorded["X-Webhook-Event"]).toBe("user.created");
    expect(recorded).not.toHaveProperty("X-Webhook-Signature");
  });

  it("records nothing sensitive when the delivery fails", async () => {
    axiosRequest.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await deliver();
    expect(JSON.stringify(inserted[0])).not.toContain("SENTINEL");
  });

  it("reports no more of a long response than it records", async () => {
    axiosRequest.mockResolvedValue({ status: 200, data: "x".repeat(5000) });

    const result = await deliver();

    expect(inserted[0]!.response).toBe("x".repeat(1000));
    expect(result.response).toBe("x".repeat(1000));
  });
});
