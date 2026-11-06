/**
 * @jest-environment node
 */
import {
  bodyTooLong,
  deliveryPayload,
  eventTooLong,
  MAX_WEBHOOK_REQUEST_BYTES,
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
