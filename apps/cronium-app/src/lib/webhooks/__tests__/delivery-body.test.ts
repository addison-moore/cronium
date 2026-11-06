/**
 * @jest-environment node
 */
import {
  bodyTooLong,
  deliveryPayload,
  eventBodyBytes,
  eventTooLong,
  MAX_WEBHOOK_REQUEST_BYTES,
  serializePayload,
} from "../delivery-body";

describe("bodyTooLong", () => {
  it("has nothing to say about a body at the limit", () => {
    expect(bodyTooLong("x".repeat(MAX_WEBHOOK_REQUEST_BYTES))).toBeUndefined();
  });

  it("says how long a body past the limit is, and what the limit is", () => {
    expect(bodyTooLong("x".repeat(MAX_WEBHOOK_REQUEST_BYTES + 1))).toBe(
      "This event is too long to deliver: its body would be 8,388,609 bytes, and the limit is 8 MB (8,388,608 bytes).",
    );
  });

  it("counts bytes, not characters", () => {
    const twoBytesEach = "é".repeat(MAX_WEBHOOK_REQUEST_BYTES / 2 + 1);

    expect(twoBytesEach.length).toBeLessThan(MAX_WEBHOOK_REQUEST_BYTES);
    expect(bodyTooLong(twoBytesEach)).toContain("8,388,610 bytes");
  });
});

describe("serializePayload", () => {
  const payload = deliveryPayload(
    { id: 42, event: "e", createdAt: new Date("2026-11-05T12:00:00.000Z") },
    { text: "é😀\ud83d", n: 1 },
    { source: "webhook" },
  );

  it("holds exactly what JSON.stringify makes of the payload, as UTF-8", () => {
    expect(serializePayload(payload).body.toString()).toBe(
      JSON.stringify(payload),
    );
  });

  it("keeps what the headers repeat from the body", () => {
    const { event, timestamp } = serializePayload(payload);

    expect(event).toBe("e");
    expect(timestamp).toEqual(new Date("2026-11-05T12:00:00.000Z"));
  });

  it("doesn't share memory with anything else, so a short one can't pin Node's pool", () => {
    const { body } = serializePayload(payload);

    expect(body.byteOffset).toBe(0);
    expect(body.buffer.byteLength).toBe(body.length);
  });

  it("is told apart from the too long by its bytes", () => {
    expect(
      bodyTooLong(Buffer.alloc(MAX_WEBHOOK_REQUEST_BYTES)),
    ).toBeUndefined();
    expect(bodyTooLong(Buffer.alloc(MAX_WEBHOOK_REQUEST_BYTES + 1))).toContain(
      "8,388,609 bytes",
    );
  });
});

describe("eventBodyBytes", () => {
  it("can't be short of the real body, whatever id the event gets", () => {
    const data = { note: "é😀" };
    const metadata = { source: "webhook" };

    for (const id of [1, 42, 2_147_483_647]) {
      const { body } = serializePayload(
        deliveryPayload(
          { id, event: "e", createdAt: new Date() },
          data,
          metadata,
        ),
      );
      const bytes = eventBodyBytes("e", data, metadata);

      expect(bytes).toBeGreaterThanOrEqual(body.length);
      expect(bytes).toBeLessThanOrEqual(body.length + 9);
    }
  });
});

describe("eventTooLong", () => {
  const LONGEST_ID_DIGITS = 10;

  /** The body of an event with an id of one digit. */
  const bodyOf = (padding: string, metadata?: Record<string, unknown>) =>
    JSON.stringify(
      deliveryPayload(
        { id: 1, event: "e", createdAt: new Date() },
        { padding },
        metadata,
      ),
    );

  const paddingFor = (bytes: number, metadata?: Record<string, unknown>) =>
    "x".repeat(bytes - bodyOf("", metadata).length);

  it("measures what would be sent, counting the longest id an event can have", () => {
    const fits = paddingFor(MAX_WEBHOOK_REQUEST_BYTES - LONGEST_ID_DIGITS + 1);

    expect(eventTooLong("e", { padding: fits })).toBeUndefined();
    expect(eventTooLong("e", { padding: `${fits}x` })).toContain(
      "8,388,609 bytes",
    );
  });

  it("counts the metadata", () => {
    const metadata = { webhookId: 7, source: "webhook" };
    const padding = paddingFor(
      MAX_WEBHOOK_REQUEST_BYTES - LONGEST_ID_DIGITS + 1,
    );

    expect(eventTooLong("e", { padding })).toBeUndefined();
    expect(eventTooLong("e", { padding }, metadata)).toBeDefined();
  });
});
