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

describe("WebhookSecurity.verifyIPWhitelist", () => {
  const allow = (ip: string, list: string[]) =>
    sec.verifyIPWhitelist(ip, list).isValid;

  it("permits everything when no allowlist is configured", () => {
    expect(allow("203.0.113.9", [])).toBe(true);
  });

  it("matches exact addresses and rejects others", () => {
    expect(allow("203.0.113.9", ["203.0.113.9"])).toBe(true);
    expect(allow("203.0.113.10", ["203.0.113.9"])).toBe(false);
  });

  it("matches CIDR ranges at the boundaries", () => {
    expect(allow("10.0.0.1", ["10.0.0.0/8"])).toBe(true);
    expect(allow("10.255.255.255", ["10.0.0.0/8"])).toBe(true);
    expect(allow("11.0.0.1", ["10.0.0.0/8"])).toBe(false);

    expect(allow("192.168.1.0", ["192.168.1.0/24"])).toBe(true);
    expect(allow("192.168.1.255", ["192.168.1.0/24"])).toBe(true);
    expect(allow("192.168.2.0", ["192.168.1.0/24"])).toBe(false);

    // /32 is a single host; /0 is everything.
    expect(allow("8.8.8.8", ["8.8.8.8/32"])).toBe(true);
    expect(allow("8.8.8.9", ["8.8.8.8/32"])).toBe(false);
    expect(allow("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });

  it("matches high octets, where a signed 32-bit shift goes negative", () => {
    expect(allow("192.168.1.5", ["192.168.0.0/16"])).toBe(true);
    expect(allow("172.16.0.1", ["172.16.0.0/12"])).toBe(true);
    expect(allow("172.32.0.1", ["172.16.0.0/12"])).toBe(false);
    expect(allow("255.255.255.255", ["255.255.255.255/32"])).toBe(true);
  });

  // The allowlist must fail closed on anything it cannot parse. Each of these
  // previously reduced to 0 and matched a 0.0.0.0/x rule.
  it.each([
    ["non-numeric octets", "abc.def.ghi.jkl"],
    ["an IPv6 address", "::1"],
    ["an IPv6-mapped address", "::ffff:10.0.0.1"],
    ["too few octets", "10.0.1"],
    ["too many octets", "10.0.0.1.5"],
    ["an out-of-range octet", "10.0.0.256"],
    ["an empty octet", "10.0..1"],
    ["an empty string", ""],
    ["a zero-padded (octal-looking) octet", "010.0.0.1"],
  ])("rejects %s against a permissive rule", (_label, ip) => {
    expect(allow(ip, ["0.0.0.0/8"])).toBe(false);
  });

  it("rejects a malformed CIDR rule rather than matching everything", () => {
    expect(allow("10.0.0.1", ["10.0.0.0/33"])).toBe(false);
    expect(allow("10.0.0.1", ["10.0.0.0/abc"])).toBe(false);
    expect(allow("10.0.0.1", ["not-an-ip/8"])).toBe(false);
    expect(allow("10.0.0.1", ["10.0.0.0/"])).toBe(false);
  });

  it("does not let extra octets wrap around onto the first", () => {
    // "10.0.0.1.5" folded index 4 back onto index 0 via a mod-32 shift.
    expect(allow("10.0.0.1.5", ["10.0.0.0/24"])).toBe(false);
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

describe("WebhookSecurity.verifySignature", () => {
  it("rejects a wrong-length signature without leaking a crypto error", () => {
    expect(sec.verifySignature("body", "sha256=short", SECRET)).toEqual({
      isValid: false,
      error: "Invalid signature",
    });
  });

  it("rejects a same-length wrong signature with a reason", () => {
    const wrong = sec.generateSignature("other body", SECRET);
    expect(sec.verifySignature("body", wrong, SECRET)).toEqual({
      isValid: false,
      error: "Invalid signature",
    });
  });
});

describe("WebhookSecurity.generateDeliverySignature", () => {
  const timestamp = "2026-11-05T12:00:00.000Z";
  const signature = sec.generateDeliverySignature(
    timestamp,
    "delivery-1",
    '{"a":1}',
    SECRET,
  );

  it("is an HMAC-SHA512 of the attempt's time and id and the body", () => {
    const expected = crypto
      .createHmac("sha512", SECRET)
      .update(`${timestamp}\ndelivery-1\n{"a":1}`)
      .digest("hex");
    expect(signature).toBe(`sha512=${expected}`);
  });

  it.each([
    ["time", "2026-11-05T12:00:00.001Z", "delivery-1", '{"a":1}', SECRET],
    ["id", timestamp, "delivery-2", '{"a":1}', SECRET],
    ["body", timestamp, "delivery-1", '{"a":2}', SECRET],
    ["secret", timestamp, "delivery-1", '{"a":1}', "other"],
  ])("changes with the %s", (_what, time, id, body, secret) => {
    expect(sec.generateDeliverySignature(time, id, body, secret)).not.toBe(
      signature,
    );
  });

  it("doesn't let bytes move between the id and the body", () => {
    expect(
      sec.generateDeliverySignature(timestamp, "id.start", "rest", SECRET),
    ).not.toBe(
      sec.generateDeliverySignature(timestamp, "id", "start.rest", SECRET),
    );
  });

  it("can't pass as an inbound signature, however it's labelled", async () => {
    const now = new Date().toISOString();
    const delivered = sec.generateDeliverySignature(
      now,
      "delivery-1",
      '{"hello":"world"}',
      SECRET,
    );
    const hex = delivered.slice("sha512=".length);

    for (const relabelled of [delivered, `sha256=${hex}`]) {
      const result = await sec.verifyWebhook(
        request({ timestamp: now, signature: relabelled }),
        { secret: SECRET },
      );
      expect(result.isValid).toBe(false);
    }
    expect(replay.__seen.size).toBe(0);
  });
});

describe("WebhookSecurity.verifyWebhook replay memory", () => {
  it("remembers a delivery id for the whole time its signature stays valid", async () => {
    // A timestamp at the far future edge of the 5 minute tolerance stays
    // acceptable for 10 minutes from now, so a 6 minute memory left a window
    // where the same signed request could be replayed.
    const replayStore = replay as unknown as {
      consumeWebhookDeliveryOnce: jest.Mock;
    };
    const timestamp = new Date().toISOString();
    const deliveryId = "ttl-check";
    await sec.verifyWebhook(
      {
        webhookId: 77,
        rawBody: "{}",
        headers: {
          "x-webhook-signature": sec.generateSignature(
            `${timestamp}.${deliveryId}.{}`,
            SECRET,
          ),
          "x-webhook-timestamp": timestamp,
          "x-webhook-delivery-id": deliveryId,
        },
      },
      { secret: SECRET },
    );

    const ttl = replayStore.consumeWebhookDeliveryOnce.mock.lastCall?.[2];
    expect(ttl).toBeGreaterThanOrEqual(10 * 60);
  });
});

describe("WebhookSecurity.sanitizePayload", () => {
  it("keeps arrays as arrays, at any depth", () => {
    expect(
      sec.sanitizePayload({
        tags: ["a", "b"],
        nested: { items: [{ name: "x" }, 1, null, ["y"]] },
      }),
    ).toEqual({
      tags: ["a", "b"],
      nested: { items: [{ name: "x" }, 1, null, ["y"]] },
    });
  });

  it("does not let __proto__ in a JSON body set the result's prototype", () => {
    const parsed = JSON.parse(
      '{"__proto__": {"isAdmin": true}, "nested": {"__proto__": {"isAdmin": true}}}',
    ) as Record<string, unknown>;

    const result = sec.sanitizePayload(parsed) as {
      isAdmin?: unknown;
      nested: { isAdmin?: unknown };
    };

    expect(result.isAdmin).toBeUndefined();
    expect(result.nested.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
