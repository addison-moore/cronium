/**
 * @jest-environment node
 */
import { Readable } from "stream";
import { readResponseBody, WEBHOOK_TIMEOUT_MS } from "../response-body";

const CAP = 16;
const LIMIT_MS = 1000;

const read = (body: Readable, maxBytes = CAP, timeoutMs = LIMIT_MS) =>
  readResponseBody(body, maxBytes, timeoutMs);

const bodyOf = (...chunks: Array<string | Buffer>) =>
  Readable.from(chunks.map((chunk) => Buffer.from(chunk)));

describe("readResponseBody", () => {
  it("gives a limit of 30 seconds", () => {
    expect(WEBHOOK_TIMEOUT_MS).toBe(30_000);
  });

  it("returns a body that ends", async () => {
    await expect(read(bodyOf("hello ", "world"))).resolves.toEqual({
      text: "hello world",
    });
  });

  it("returns an empty body as empty text", async () => {
    await expect(read(bodyOf())).resolves.toEqual({ text: "" });
  });

  it("decodes a character split across two chunks", async () => {
    const emoji = Buffer.from("\u{1F600}");

    await expect(
      read(bodyOf(emoji.subarray(0, 2), emoji.subarray(2))),
    ).resolves.toEqual({ text: "\u{1F600}" });
  });

  it("leaves out a byte order mark, as axios does for text", async () => {
    await expect(read(bodyOf("\uFEFFhello"))).resolves.toEqual({
      text: "hello",
    });
  });

  it("keeps a body of exactly the cap, and reads on to its end", async () => {
    const body = bodyOf("x".repeat(CAP));

    await expect(read(body)).resolves.toEqual({ text: "x".repeat(CAP) });
    expect(body.readableEnded).toBe(true);
  });

  it("stops at the cap, keeping no more than the cap, and destroys the stream", async () => {
    const pulled: number[] = [];
    const body = Readable.from(
      (function* () {
        for (let i = 0; ; i++) {
          pulled.push(i);
          yield Buffer.from("x".repeat(10));
        }
      })(),
    );

    const result = await read(body);

    expect(result).toEqual({ text: "x".repeat(CAP) });
    expect(body.destroyed).toBe(true);
    expect(pulled.length).toBeLessThan(5);
  });

  it("isn't thrown off by the first chunk being past the cap", async () => {
    await expect(read(bodyOf("x".repeat(3 * CAP)))).resolves.toEqual({
      text: "x".repeat(CAP),
    });
  });

  it("returns what came before an error, and why it stopped", async () => {
    const body = new Readable({ read() {} });
    const result = read(body);
    body.push(Buffer.from("start"));
    setImmediate(() => body.destroy(new Error("aborted")));

    await expect(result).resolves.toEqual({
      text: "start",
      unfinished: "The response didn't finish (aborted)",
    });
  });

  it("says so when the stream closes with no error and no end", async () => {
    const body = new Readable({ read() {} });
    const result = read(body);
    body.push(Buffer.from("start"));
    setImmediate(() => body.destroy());

    await expect(result).resolves.toEqual({
      text: "start",
      unfinished: "The response didn't finish (Premature close)",
    });
  });

  it("doesn't wait for the limit on a stream that's already over", async () => {
    const body = new Readable({ read() {} });
    body.destroy(new Error("aborted"));

    await expect(read(body, CAP, 60_000)).resolves.toEqual({
      text: "",
      unfinished: "The response didn't finish (aborted)",
    });
  });

  describe("the time limit", () => {
    beforeEach(() => {
      jest.useFakeTimers({
        doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const settled = () => new Promise((resolve) => setImmediate(resolve));

    it("stops at the limit, returning what came, and destroys the stream", async () => {
      const body = new Readable({ read() {} });
      const result = read(body);
      body.push(Buffer.from("start"));
      await settled();

      jest.advanceTimersByTime(LIMIT_MS);

      await expect(result).resolves.toEqual({
        text: "start",
        unfinished: "The response didn't finish within 1 seconds",
      });
      expect(body.destroyed).toBe(true);
    });

    it("counts from the start, however the chunks are spaced", async () => {
      const body = new Readable({ read() {} });
      const result = read(body);

      for (let i = 0; i < 9; i++) {
        body.push(Buffer.from("."));
        await settled();
        jest.advanceTimersByTime(LIMIT_MS / 10);
      }
      jest.advanceTimersByTime(LIMIT_MS / 10);

      await expect(result).resolves.toMatchObject({
        text: ".........",
        unfinished: expect.stringContaining("within"),
      });
    });

    it("leaves no timer behind once the body has ended", async () => {
      await read(bodyOf("hello"));

      expect(jest.getTimerCount()).toBe(0);
    });

    it("leaves no timer behind once the cap has stopped it", async () => {
      await read(bodyOf("x".repeat(3 * CAP)));

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
