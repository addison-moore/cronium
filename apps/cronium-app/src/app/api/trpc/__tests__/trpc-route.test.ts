/**
 * @jest-environment node
 *
 * What the tRPC route answers to a body past the limit. tRPC reads the body itself, so
 * this runs the real route and the real adapter, with a small router standing in for
 * the app's. tests/e2e/event-save-limit.test.ts does the same on the real app.
 */
jest.mock("@/env.mjs", () => ({ env: { NODE_ENV: "test" } }));
jest.mock("@server/api/trpc", () => ({
  createTRPCContext: jest.fn(async () => ({})),
}));
jest.mock("@server/api/root", () => {
  const { initTRPC, TRPCError } =
    jest.requireActual<typeof import("@trpc/server")>("@trpc/server");
  const t = initTRPC.create();
  const echo = t.procedure
    .input((input: unknown) => input as { content: string })
    .mutation(({ input }) => ({ length: input.content.length }));
  return {
    appRouter: t.router({
      events: t.router({ create: echo, update: echo }),
      workflows: t.router({ update: echo }),
      locked: t.router({
        // Auth comes before input, as it does on the real procedures.
        update: t.procedure
          .use(() => {
            throw new TRPCError({ code: "UNAUTHORIZED" });
          })
          .input((input: unknown) => input)
          .mutation(() => "unreachable"),
      }),
    }),
  };
});

import { NextRequest } from "next/server";
import { POST } from "../[trpc]/route";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
  REQUEST_TOO_LONG_MESSAGE,
} from "@/shared/request-limits";

/** A JSON body of exactly `bytes` bytes, whatever wraps the script. */
function bodyOfSize(bytes: number, wrap: (content: string) => unknown) {
  const shell = JSON.stringify(wrap("")).length;
  return JSON.stringify(wrap("x".repeat(bytes - shell)));
}
const single = (content: string) => ({ content });
const batch = (content: string) => ({ 0: { content } });

const OVER = MAX_REQUEST_BODY_BYTES + 1;

const send = (
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  POST(
    new NextRequest(`http://localhost:5001/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]),
  );

interface TrpcFailure {
  error: { message: string; data: { code: string; httpStatus: number } };
}

describe("a body past the limit", () => {
  it.each(["events.create", "events.update"])(
    "%s says the event is too long",
    async (procedure) => {
      const res = await send(procedure, bodyOfSize(OVER, single));

      expect(res.status).toBe(413);
      const { error } = (await res.json()) as TrpcFailure;
      expect(error.message).toBe(EVENT_TOO_LONG_MESSAGE);
      expect(error.data.code).toBe("PAYLOAD_TOO_LARGE");
      expect(error.data.httpStatus).toBe(413);
    },
  );

  it("refuses each call in a batch, which the client matches up by position", async () => {
    const res = await send(
      "events.create,workflows.update?batch=1",
      bodyOfSize(OVER, batch),
    );

    expect(res.status).toBe(413);
    const calls = (await res.json()) as TrpcFailure[];
    expect(calls.map((call) => call.error.message)).toEqual([
      EVENT_TOO_LONG_MESSAGE,
      EVENT_TOO_LONG_MESSAGE,
    ]);
  });

  it("refuses a chunked body the same way, with no declared length", async () => {
    const bytes = new TextEncoder().encode(bodyOfSize(OVER, single));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 1024 * 1024) {
          controller.enqueue(bytes.subarray(at, at + 1024 * 1024));
        }
        controller.close();
      },
    });

    const res = await send("events.create", stream);

    expect(res.status).toBe(413);
    const { error } = (await res.json()) as TrpcFailure;
    expect(error.message).toBe(EVENT_TOO_LONG_MESSAGE);
  });

  it("gives a procedure that takes no script a plain message", async () => {
    const res = await send("workflows.update", bodyOfSize(OVER, single));

    expect(res.status).toBe(413);
    const { error } = (await res.json()) as TrpcFailure;
    expect(error.message).toBe(REQUEST_TOO_LONG_MESSAGE);
  });

  it("still answers 401 first to a caller who can't save anything", async () => {
    const res = await send("locked.update", bodyOfSize(OVER, single));

    expect(res.status).toBe(401);
  });
});

describe("a body within the limit", () => {
  it("reaches the procedure whole at exactly the limit", async () => {
    const body = bodyOfSize(MAX_REQUEST_BODY_BYTES, single);

    const res = await send("events.create", body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      result: {
        data: {
          length: MAX_REQUEST_BODY_BYTES - JSON.stringify(single("")).length,
        },
      },
    });
  });

  it("still reports JSON that really is broken as that", async () => {
    const res = await send("events.create", "{not json");

    expect(res.status).toBe(400);
    const { error } = (await res.json()) as TrpcFailure;
    expect(error.data.code).toBe("BAD_REQUEST");
  });
});
