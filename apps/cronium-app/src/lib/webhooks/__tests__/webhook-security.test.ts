/**
 * @jest-environment node
 */
// Stub the rate-limit service so importing WebhookSecurity does not pull the
// ESM-only env chain (@t3-oss/env-nextjs) into the transform.
jest.mock("@/lib/rate-limit-service", () => ({ RateLimitService: {} }));

// Replay store: first use of a delivery id succeeds, repeat is rejected.
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
  };
});

import crypto from "crypto";
import { WebhookSecurity } from "../WebhookSecurity";

const sec = new WebhookSecurity();
const SECRET = "shhh";

const replay = jest.requireMock("@/lib/webhooks/webhook-replay-store") as {
  __seen: Set<string>;
};

beforeEach(() => replay.__seen.clear());

function sign(timestamp: string, deliveryId: string, rawBody: string): string {
  const mac = crypto
    .createHmac("sha256", SECRET)
    .update(`${timestamp}.${deliveryId}.${rawBody}`)
    .digest("hex");
  return `sha256=${mac}`;
}

function request(overrides: {
  rawBody?: string;
  timestamp?: string;
  deliveryId?: string;
  signature?: string;
  ip?: string;
}) {
  const rawBody = overrides.rawBody ?? '{"hello":"world"}';
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const deliveryId = overrides.deliveryId ?? "delivery-1";
  const signature = overrides.signature ?? sign(timestamp, deliveryId, rawBody);
  return {
    webhookId: 1,
    rawBody,
    headers: {
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
      "x-webhook-delivery-id": deliveryId,
    },
    ...(overrides.ip !== undefined && { ip: overrides.ip }),
  };
}

describe("WebhookSecurity.verifyTimestamp (replay window)", () => {
  it("accepts a current timestamp and rejects malformed/old ones (HI-12)", () => {
    expect(sec.verifyTimestamp(new Date().toISOString()).isValid).toBe(true);
    expect(sec.verifyTimestamp("not-a-date").isValid).toBe(false);
    expect(
      sec.verifyTimestamp(new Date(Date.now() - 3_600_000).toISOString())
        .isValid,
    ).toBe(false);
  });
});

describe("WebhookSecurity.verifyWebhook (HI-12)", () => {
  it("accepts a correctly signed, fresh delivery", async () => {
    const res = await sec.verifyWebhook(request({}), { secret: SECRET });
    expect(res.isValid).toBe(true);
  });

  it("rejects a replayed delivery id", async () => {
    const req = request({ deliveryId: "dup" });
    expect((await sec.verifyWebhook(req, { secret: SECRET })).isValid).toBe(
      true,
    );
    const second = await sec.verifyWebhook(req, { secret: SECRET });
    expect(second.isValid).toBe(false);
    expect(second.error).toMatch(/replay/i);
  });

  it("rejects a tampered body (signature covers the raw bytes)", async () => {
    const req = request({});
    req.rawBody = '{"hello":"evil"}';
    expect((await sec.verifyWebhook(req, { secret: SECRET })).isValid).toBe(
      false,
    );
  });

  it("rejects when the signature does not bind the timestamp/delivery id", async () => {
    // Signature computed over the body only (old scheme) must not verify.
    const rawBody = '{"a":1}';
    const bodyOnly = `sha256=${crypto
      .createHmac("sha256", SECRET)
      .update(rawBody)
      .digest("hex")}`;
    const res = await sec.verifyWebhook(
      request({ rawBody, signature: bodyOnly }),
      { secret: SECRET },
    );
    expect(res.isValid).toBe(false);
  });

  it("requires the delivery id and timestamp headers", async () => {
    const req = request({});
    delete (req.headers as Record<string, string>)["x-webhook-delivery-id"];
    expect((await sec.verifyWebhook(req, { secret: SECRET })).isValid).toBe(
      false,
    );
  });

  it("fails closed when an IP allowlist is set but no IP is available", async () => {
    const res = await sec.verifyWebhook(request({}), {
      secret: SECRET,
      ipWhitelist: ["10.0.0.0/8"],
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/source ip/i);
  });
});
