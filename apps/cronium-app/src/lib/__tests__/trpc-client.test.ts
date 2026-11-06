/**
 * @jest-environment node
 *
 * What the app's tRPC client says when a reverse proxy refuses a request as too long. The
 * client, the tRPC route and tRPC's adapter are all real, with a small router standing in
 * for the app's, and `fetch` plays the proxy in front of them.
 *
 * The nginx, Caddy and Traefik answers are what those proxies really sent, in front of the
 * real app, with Chrome saving through the real form. Without the client's own fetch, those
 * read `Unexpected token '<', "<html>...`, `Unexpected end of JSON input` and
 * `Unexpected token 'R', "Request En"...` in the form's toast.
 *
 * Jest stands in for superjson here, with the same `{ json }` wrapper around a plain value.
 * tests/e2e/event-save-limit.test.ts holds the real one to that format.
 */
jest.mock("@/env.mjs", () => ({ env: { NODE_ENV: "test" } }));
jest.mock("@server/api/trpc", () => ({
  createTRPCContext: jest.fn(async () => ({})),
}));
jest.mock("@server/api/root", () => {
  const { initTRPC, TRPCError } =
    jest.requireActual<typeof import("@trpc/server")>("@trpc/server");
  const { default: transformer } =
    jest.requireActual<typeof import("superjson")>("superjson");
  const t = initTRPC.create({ transformer });
  return {
    appRouter: t.router({
      events: t.router({
        create: t.procedure
          .input((input: unknown) => input as { content: string })
          .mutation(({ input }) => ({ length: input.content.length })),
        // Stands in for any failure of Cronium's own, at a status other than 413.
        update: t.procedure.mutation(() => {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }),
      }),
    }),
  };
});

import { TRPCClientError } from "@trpc/client";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trpc/[trpc]/route";
import { trpcClient } from "@/lib/trpc";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
  PROXY_REFUSED_REQUEST_MESSAGE,
} from "@/shared/request-limits";

const MB = 1024 * 1024;

const NGINX_PAGE =
  "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n" +
  "<center><h1>413 Request Entity Too Large</h1></center>\r\n" +
  "<hr><center>nginx/1.31.8</center>\r\n</body>\r\n</html>\r\n";

type Refusal = () => Response;

/** Puts a proxy with this limit in front of the real route, in place of `fetch`. */
function behindProxy(limit: number, refuse: Refusal): jest.Mock {
  const proxy = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (Buffer.byteLength(String(init?.body)) > limit) return refuse();
      return POST(
        new NextRequest(
          new URL(String(input), "http://localhost:5001"),
          init as ConstructorParameters<typeof NextRequest>[1],
        ),
      );
    },
  );
  global.fetch = proxy as unknown as typeof fetch;
  return proxy;
}

const nginx: Refusal = () =>
  new Response(NGINX_PAGE, {
    status: 413,
    headers: { "content-type": "text/html" },
  });

/** The client's mutation, for a script of this many bytes. */
const save = (bytes: number) =>
  trpcClient.events.create.mutate({ content: "x".repeat(bytes) } as never);

/** The error a call fails with, for assertions on what the form would show. */
async function failureOf(
  call: Promise<unknown>,
): Promise<TRPCClientError<never>> {
  const error: unknown = await call.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TRPCClientError);
  return error as TRPCClientError<never>;
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe("a 413 from a reverse proxy", () => {
  it.each<[string, Refusal]>([
    ["nginx's HTML page", nginx],
    ["Caddy's empty answer", () => new Response(null, { status: 413 })],
    [
      "Traefik's plain text",
      () => new Response("Request Entity Too Large", { status: 413 }),
    ],
    [
      "a gateway's JSON",
      () =>
        Response.json(
          { message: "Request size limit exceeded" },
          { status: 413 },
        ),
    ],
    [
      "a gateway's JSON with an error field",
      () => Response.json({ error: "Too large" }, { status: 413 }),
    ],
    [
      "a gateway's JSON with an error object",
      () =>
        Response.json(
          { error: { code: 413, message: "Too large" } },
          { status: 413 },
        ),
    ],
  ])("says a proxy refused it, given %s", async (_name, refuse) => {
    behindProxy(MB, refuse);

    const error = await failureOf(save(MB + 1));

    expect(error.message).toBe(PROXY_REFUSED_REQUEST_MESSAGE);
  });

  it("states Cronium's real limit, the only one it can know", () => {
    expect(PROXY_REFUSED_REQUEST_MESSAGE).toContain("up to 10 MB");
    expect(MAX_REQUEST_BODY_BYTES).toBe(10 * MB);
  });

  it("fails every call in a batch, since none of them got through", async () => {
    const proxy = behindProxy(MB, nginx);

    const results = await Promise.allSettled([save(MB), save(MB)]);

    expect(proxy).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({
          message: PROXY_REFUSED_REQUEST_MESSAGE,
        }) as unknown,
      }),
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({
          message: PROXY_REFUSED_REQUEST_MESSAGE,
        }) as unknown,
      }),
    ]);
  });
});

describe("Cronium's own answers", () => {
  it("still saves a request the proxy lets through", async () => {
    behindProxy(MB, nginx);

    await expect(save(1000)).resolves.toEqual({ length: 1000 });
  });

  it("passes on Cronium's own 413, through a proxy with a higher limit", async () => {
    behindProxy(20 * MB, nginx);

    const error = await failureOf(save(MAX_REQUEST_BODY_BYTES + 1));

    expect(error.message).toBe(EVENT_TOO_LONG_MESSAGE);
    expect(error.data).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 413,
    });
  });

  it("gives each call in a batch Cronium's own 413", async () => {
    behindProxy(20 * MB, nginx);

    const [first, second] = await Promise.allSettled([
      save(MAX_REQUEST_BODY_BYTES),
      save(1000),
    ]);

    expect(first).toMatchObject({
      status: "rejected",
      reason: { message: EVENT_TOO_LONG_MESSAGE },
    });
    expect(second).toMatchObject({
      status: "rejected",
      reason: { message: EVENT_TOO_LONG_MESSAGE },
    });
  });

  it("leaves Cronium's failures at other statuses alone", async () => {
    behindProxy(MB, nginx);

    const error = await failureOf(trpcClient.events.update.mutate({} as never));

    expect(error.message).toBe("UNAUTHORIZED");
    expect(error.data).toMatchObject({
      code: "UNAUTHORIZED",
      httpStatus: 401,
    });
  });
});
