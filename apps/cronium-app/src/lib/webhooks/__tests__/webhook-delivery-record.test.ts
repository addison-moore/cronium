/**
 * @jest-environment node
 *
 * A webhook's custom headers are encrypted at rest and decrypted only to send
 * the request. The delivery record must not undo that: it is an unencrypted
 * column, returned as is by the delivery-history API.
 */
const inserted: Array<Record<string, unknown>> = [];
let insertFailure: Error | undefined;

jest.mock("@/server/db", () => ({
  db: {
    insert: jest.fn(() => ({
      values: jest.fn((row: Record<string, unknown>) => {
        if (insertFailure) return Promise.reject(insertFailure);
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

import { Readable } from "stream";
import axios from "axios";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { serializePayload } from "../delivery-body";
import { WebhookManager } from "../WebhookManager";

const axiosRequest = axios.request as unknown as jest.Mock;

const CUSTOM_HEADERS = {
  Authorization: "Bearer SECRET-SENTINEL",
  "X-Api-Key": "ALSO-SECRET-SENTINEL",
};

const deliver = (headers: Record<string, string> = CUSTOM_HEADERS) =>
  WebhookManager.getInstance().processDelivery(
    1,
    2,
    "https://hooks.example/in",
    "hmac-secret",
    headers,
    serializePayload({
      id: "2",
      event: "user.created",
      timestamp: new Date("2026-11-04T00:00:00Z"),
      data: {},
    }),
  );

beforeEach(() => {
  inserted.length = 0;
  insertFailure = undefined;
  axiosRequest.mockReset();
  axiosRequest.mockImplementation(async () => ({
    status: 200,
    data: Readable.from([Buffer.from("ok")]),
  }));
});

describe("webhook delivery request", () => {
  it("asks for the status before the body, with the guards still on", async () => {
    await deliver();

    expect(axiosRequest.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      url: "https://hooks.example/in",
      responseType: "stream",
      timeout: 30_000,
      httpAgent: {},
      httpsAgent: {},
      proxy: false,
      maxRedirects: 0,
    });
    // axios enforces this one by failing the stream, which isn't a failed delivery.
    expect(axiosRequest.mock.calls[0]![0]).not.toHaveProperty(
      "maxContentLength",
    );
  });
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
    expect(sent["X-Webhook-Signature-V2"]).toMatch(/^sha512=/);
    expect(sent["X-Delivery-Timestamp"]).toBeTruthy();

    const recorded = inserted[0]!.headers as Record<string, string>;
    expect(JSON.stringify(recorded)).not.toContain("SENTINEL");
    expect(recorded.Authorization).toBe("[redacted]");
    expect(recorded["X-Api-Key"]).toBe("[redacted]");
    expect(recorded["X-Webhook-Event"]).toBe("user.created");
    expect(recorded).not.toHaveProperty("X-Webhook-Signature");
    expect(recorded).not.toHaveProperty("X-Webhook-Signature-V2");
    expect(recorded).not.toHaveProperty("X-Delivery-Timestamp");
  });

  it("leaves out a custom header a signature depends on, and records what was sent", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation();

    await deliver({
      "x-delivery-id": "SENTINEL",
      "X-Webhook-Signature": "SENTINEL",
      Authorization: "Bearer token",
    });

    const sent = (
      axiosRequest.mock.calls[0]![0] as { headers: Record<string, string> }
    ).headers;
    expect(JSON.stringify(sent)).not.toContain("SENTINEL");
    expect(sent["X-Delivery-Id"]).toBe("delivery-1");
    expect(sent["X-Webhook-Signature"]).toMatch(/^sha256=/);
    expect(sent.Authorization).toBe("Bearer token");

    const recorded = inserted[0]!.headers as Record<string, string>;
    expect(recorded["X-Delivery-Id"]).toBe("delivery-1");
    expect(recorded).not.toHaveProperty("x-delivery-id");
    expect(recorded).not.toHaveProperty("X-Webhook-Signature");
    expect(recorded.Authorization).toBe("[redacted]");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "(X-Delivery-Id, X-Webhook-Signature)",
    );
    warn.mockRestore();
  });

  it("records a replaced system header under the owner's spelling alone", async () => {
    await deliver({ "content-type": "text/plain" });

    const sent = (
      axiosRequest.mock.calls[0]![0] as { headers: Record<string, string> }
    ).headers;
    expect(sent["content-type"]).toBe("text/plain");

    const recorded = inserted[0]!.headers as Record<string, string>;
    expect(recorded["content-type"]).toBe("[redacted]");
    expect(recorded).not.toHaveProperty("Content-Type");
  });

  it("records nothing sensitive when the delivery fails", async () => {
    axiosRequest.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await deliver();
    expect(JSON.stringify(inserted[0])).not.toContain("SENTINEL");
  });

  it("reports no more of a long response than it records", async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from("x".repeat(5000))]),
    });

    const result = await deliver();

    expect(inserted[0]!.response).toBe("x".repeat(1000));
    expect(result.response).toBe("x".repeat(1000));
  });

  it("keeps what the receiver did when the row won't go in, and logs no values", async () => {
    insertFailure = new DrizzleQueryError(
      "insert into webhook_deliveries",
      ["BODY-SENTINEL"],
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
    );
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await deliver();
    const logged = String(log.mock.calls[0]![0]);
    log.mockRestore();

    expect(axiosRequest).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: "delivery-1",
      success: true,
      statusCode: 200,
      response: "ok",
      recorded: false,
    });
    expect(logged).toContain("Delivery delivery-1 ");
    expect(logged).toContain("ECONNREFUSED: connection refused");
    expect(logged).not.toContain("SENTINEL");
  });
});
