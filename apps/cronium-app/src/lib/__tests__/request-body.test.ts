/**
 * @jest-environment node
 *
 * Reading a request's body with a limit. `readBodyWithin` also has tests from the routes
 * that use it, in execute-routes.test.ts and events-rest.test.ts.
 */
import { readEventSaveBody, withBodyLimit } from "../request-body";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
} from "@/shared/request-limits";

const URL = "http://localhost:5001/api/things";
const encoder = new TextEncoder();

/** A body sent in pieces, with no declared length, counting what's read. */
function streamed(chunks: Iterable<Uint8Array>) {
  const source = chunks[Symbol.iterator]();
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls++;
        const next = source.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}

const postOf = (
  body: BodyInit,
  headers: Record<string, string> = {},
): Request =>
  new Request(URL, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);

describe("withBodyLimit", () => {
  const tooLong = new Error("too long");
  const limited = (request: Request, limit: number) =>
    withBodyLimit(request, limit, () => tooLong);

  it("passes on a body of exactly the limit", async () => {
    const request = limited(postOf("x".repeat(100)), 100);

    await expect(request.text()).resolves.toBe("x".repeat(100));
  });

  it("fails with the caller's own error one byte past the limit", async () => {
    // tRPC keeps a TRPCError it reads and rewrites anything else as a 400, so it has to
    // get this very error, not a wrapper around it.
    const request = limited(postOf("x".repeat(101)), 100);

    await expect(request.text()).rejects.toBe(tooLong);
  });

  it("fails the same way for every way of reading the body", async () => {
    await expect(limited(postOf("[1,2,3]"), 2).json()).rejects.toBe(tooLong);
    await expect(limited(postOf("[1,2,3]"), 2).blob()).rejects.toBe(tooLong);
  });

  it("counts bytes, not characters", async () => {
    const request = limited(postOf("é".repeat(51)), 101);

    await expect(request.text()).rejects.toBe(tooLong);
  });

  it("refuses a declared length without waiting for the body", async () => {
    const { stream, seen } = streamed([encoder.encode("{}")]);

    const request = limited(postOf(stream, { "content-length": "101" }), 100);

    await expect(request.text()).rejects.toBe(tooLong);
    expect(seen.pulls).toBe(0);
    expect(seen.cancelled).toBe(true);
  });

  it("stops reading an undeclared body as soon as it passes the limit", async () => {
    function* farTooMuch() {
      for (let i = 0; i < 64; i++) yield new Uint8Array(1024);
    }
    const { stream, seen } = streamed(farTooMuch());

    const request = limited(postOf(stream), 4 * 1024);

    await expect(request.text()).rejects.toBe(tooLong);
    // Four chunks reach the limit exactly, and the fifth passes it.
    expect(seen.pulls).toBeLessThanOrEqual(6);
    expect(seen.cancelled).toBe(true);
  });

  it("does not trust a declared length that understates the body", async () => {
    const { stream } = streamed([new Uint8Array(101)]);

    const request = limited(postOf(stream, { "content-length": "2" }), 100);

    await expect(request.text()).rejects.toBe(tooLong);
  });

  it("keeps the method, URL and headers", () => {
    const request = limited(postOf("{}", { "x-custom": "kept" }), 100);

    expect(request.method).toBe("POST");
    expect(request.url).toBe(URL);
    expect(request.headers.get("x-custom")).toBe("kept");
  });

  it("follows the original request's signal", () => {
    const abort = new AbortController();
    const request = limited(
      new Request(URL, {
        method: "POST",
        body: "{}",
        signal: abort.signal,
      }),
      100,
    );

    abort.abort();

    expect(request.signal.aborted).toBe(true);
  });

  it("leaves a request with no body alone", () => {
    const request = new Request(URL);

    expect(limited(request, 100)).toBe(request);
  });
});

describe("readEventSaveBody", () => {
  it("returns the parsed body", async () => {
    await expect(readEventSaveBody(postOf('{"a":1}'))).resolves.toEqual({
      ok: true,
      body: { a: 1 },
    });
  });

  it("answers 413 with the reason past the limit", async () => {
    const read = await readEventSaveBody(
      postOf("x".repeat(MAX_REQUEST_BODY_BYTES + 1)),
    );

    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(413);
    await expect(read.response.json()).resolves.toEqual({
      error: EVENT_TOO_LONG_MESSAGE,
    });
  });

  it("answers 400 to a body that isn't JSON", async () => {
    const read = await readEventSaveBody(postOf("{not json"));

    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(400);
  });

  it("reads a body with none as not JSON", async () => {
    const read = await readEventSaveBody(new Request(URL, { method: "POST" }));

    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(400);
  });
});
