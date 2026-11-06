/**
 * @jest-environment node
 *
 * What the app's tRPC client says when something other than Cronium answers it. The client,
 * the tRPC route and tRPC's adapter are all real, with a small router standing in for the
 * app's, and `fetch` plays what's in front of them.
 *
 * The answers from named products are what those products really sent, in front of the real
 * app, with Chrome saving through the real form. Without the client's own check, they read
 * `Unexpected token '<', "<html>...`, `Unexpected end of JSON input`,
 * `Unexpected token 'R', "Request En"...` and `Unable to transform response from server` in
 * the form's toast.
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
          throw new TRPCError({ code: "FORBIDDEN" });
        }),
        getAll: t.procedure.query(() => ["one", "two"]),
        // Fail with the code they're given, as a save and as a read.
        delete: t.procedure
          .input((input: unknown) => input as "NOT_FOUND")
          .mutation(({ input }) => {
            throw new TRPCError({ code: input, message: `Cronium: ${input}` });
          }),
        getById: t.procedure
          .input((input: unknown) => input as "NOT_FOUND")
          .query(({ input }) => {
            throw new TRPCError({ code: input, message: `Cronium: ${input}` });
          }),
      }),
    }),
  };
});

import { TRPCClientError } from "@trpc/client";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/trpc/[trpc]/route";
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

    expect(error.message).toBe("FORBIDDEN");
    expect(error.data).toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });
});

/** Puts something in front of the app that answers every request itself. */
function answeredBy(answer: () => Response): jest.Mock {
  const inFront = jest.fn(async () => answer());
  global.fetch = inFront as unknown as typeof fetch;
  return inFront;
}

/** Takes every call to the real route, reads included, and keeps what it answers. */
function reachingCronium(): Response[] {
  const answered: Response[] = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = init?.method === "GET" ? GET : POST;
      const response = await route(
        new NextRequest(
          new URL(String(input), "http://localhost:5001"),
          init as ConstructorParameters<typeof NextRequest>[1],
        ),
      );
      answered.push(response);
      return response;
    },
  ) as unknown as typeof fetch;
  return answered;
}

const nginxPage = (title: string) =>
  `<html>\r\n<head><title>${title}</title></head>\r\n<body>\r\n` +
  `<center><h1>${title}</h1></center>\r\n` +
  "<hr><center>nginx/1.31.8</center>\r\n</body>\r\n</html>\r\n";

/** The first bytes of oauth2-proxy's sign-in page, which is all that matters to a parser. */
const SIGN_IN_PAGE =
  '<!DOCTYPE html>\n<html lang="en" charset="utf-8">\n  <head>\n    <meta charset="utf-8">\n' +
  "    <title>Sign In</title>\n  </head>\n  <body></body>\n</html>\n";

const html = { "content-type": "text/html" };
const json = { "content-type": "application/json; charset=utf-8" };

const answers: Array<[string, number, string | null, HeadersInit]> = [
  ["nginx, the app stopped", 502, nginxPage("502 Bad Gateway"), html],
  ["nginx, the app hung", 504, nginxPage("504 Gateway Time-out"), html],
  [
    "nginx's rate limiter",
    503,
    nginxPage("503 Service Temporarily Unavailable"),
    html,
  ],
  ["nginx refusing the path", 403, nginxPage("403 Forbidden"), html],
  ["nginx with no route", 404, nginxPage("404 Not Found"), html],
  ["nginx, a long URL", 414, nginxPage("414 Request-URI Too Large"), html],
  ["Node in front of Next, a long URL", 431, null, {}],
  ["ModSecurity, a script it dislikes", 403, nginxPage("403 Forbidden"), html],
  ["ModSecurity, a long script", 400, nginxPage("400 Bad Request"), html],
  ["Caddy, the app stopped", 502, null, {}],
  ["Traefik, the app stopped", 502, "Bad Gateway", {}],
  [
    "Kong, the app stopped",
    502,
    '{\n  "message":"An invalid response was received from the upstream server",\n  "request_id":"3b7f"\n}',
    json,
  ],
  [
    "Kong, no API key",
    401,
    '{\n  "message":"No API key found in request",\n  "request_id":"3b7f"\n}',
    json,
  ],
  ["Kong, terminating at 200", 200, '{"message":"Down for maintenance"}', json],
  ["oauth2-proxy's sign-in page at 403", 403, SIGN_IN_PAGE, html],
  ["oauth2-proxy's sign-in page at 200", 200, SIGN_IN_PAGE, html],
  ["an empty 200", 200, null, {}],
  ["no content at all", 204, null, {}],
  ["JSON null", 200, "null", json],
  ["an empty list", 200, "[]", json],
  ["a list of something else", 200, '[{"status":"blocked"}]', json],
  ["a result that isn't tRPC's", 200, '{"result":"ok"}', json],
  ["a result object that isn't tRPC's", 200, '{"result":{"a":1}}', json],
  ["an error that isn't tRPC's", 500, '{"error":"Upstream failed"}', json],
  [
    "an error object without its transformer",
    500,
    '{"error":{"code":500,"message":"Upstream failed"}}',
    json,
  ],
  [
    "one tRPC answer and one that isn't",
    200,
    '[{"result":{"data":{"json":1}}},{"status":"blocked"}]',
    json,
  ],
];

describe("an answer that isn't Cronium's", () => {
  describe.each<[string, number, string | null, HeadersInit]>(answers)(
    "%s, %i",
    (_name, status, body, headers) => {
      const respond = () => new Response(body, { status, headers });

      it("names the status, on a save", async () => {
        answeredBy(respond);

        const error = await failureOf(save(10));

        expect(error.message).toContain(
          `Got HTTP ${status}, not Cronium's answer`,
        );
      });

      it("names the status, on a read", async () => {
        answeredBy(respond);

        const error = await failureOf(
          trpcClient.events.getAll.query({} as never),
        );

        expect(error.message).toContain(
          `Got HTTP ${status}, not Cronium's answer.`,
        );
      });

      it("isn't one of Cronium's errors, for anything that branches on those", async () => {
        answeredBy(respond);

        const error = await failureOf(save(10));

        expect(error.data).toBeUndefined();
        expect(error.shape).toBeUndefined();
      });
    },
  );

  const notFromCronium = (status: number) =>
    `Got HTTP ${status}, not Cronium's answer. It may be from a reverse proxy, firewall or sign-in page: open Cronium in a new tab to check.`;

  it.each<[number, string]>([
    [200, notFromCronium(200)],
    [401, notFromCronium(401)],
    [403, notFromCronium(403)],
    [404, notFromCronium(404)],
    [
      500,
      "Got HTTP 500, not Cronium's answer, so this may still have gone through. Cronium may be restarting, or a reverse proxy in front of it can't reach it.",
    ],
    [
      504,
      "Got HTTP 504, not Cronium's answer, so this may still have gone through. Cronium may be restarting, or a reverse proxy in front of it can't reach it.",
    ],
  ])(
    "offers causes for a %i on a save, and chooses none",
    async (status, message) => {
      answeredBy(
        () => new Response("<html></html>", { status, headers: html }),
      );

      const error = await failureOf(save(10));

      expect(error.message).toBe(message);
    },
  );

  it.each<[number, string]>([
    [403, notFromCronium(403)],
    [
      502,
      "Got HTTP 502, not Cronium's answer. Cronium may be restarting, or a reverse proxy in front of it can't reach it.",
    ],
  ])(
    "offers causes for a %i on a read, which can't have changed anything",
    async (status, message) => {
      answeredBy(
        () => new Response("<html></html>", { status, headers: html }),
      );

      const error = await failureOf(
        trpcClient.events.getAll.query({} as never),
      );

      expect(error.message).toBe(message);
    },
  );

  it("names a redirect, which the browser reports with no status at all", async () => {
    // What `fetch` gives a page for a 302 with `redirect: "manual"`. Node's fetch doesn't
    // do this, and a Response can't be built with status 0.
    const inFront = answeredBy(() =>
      Object.defineProperties(new Response(null, { status: 200 }), {
        type: { value: "opaqueredirect" },
        status: { value: 0 },
      }),
    );

    const error = await failureOf(save(10));

    expect(inFront.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({ redirect: "manual" }),
    ]);
    expect(error.message).toBe(
      "Got a redirect, not Cronium's answer. It may be to a sign-in page: open Cronium in a new tab to check.",
    );
  });

  it("fails every call in a batch, on one request", async () => {
    const inFront = answeredBy(
      () =>
        new Response(nginxPage("502 Bad Gateway"), {
          status: 502,
          headers: html,
        }),
    );

    const results = await Promise.allSettled([save(10), save(20)]);

    expect(inFront).toHaveBeenCalledTimes(1);
    const expected = {
      status: "rejected",
      reason: { message: expect.stringContaining("Got HTTP 502") as unknown },
    };
    expect(results).toMatchObject([expected, expected]);
  });

  it("recovers on the next call once Cronium answers again", async () => {
    answeredBy(() => new Response(null, { status: 502 }));
    await failureOf(trpcClient.events.getAll.query({} as never));

    reachingCronium();

    await expect(trpcClient.events.getAll.query({} as never)).resolves.toEqual([
      "one",
      "two",
    ]);
  });
});

describe("what isn't an answer at all", () => {
  it("leaves a network failure as the browser put it", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const error = await failureOf(save(10));

    expect(error.message).toBe("Failed to fetch");
  });

  it.each<[string, DOMException | TypeError]>([
    ["an aborted call", new DOMException("Aborted", "AbortError")],
    ["a connection lost part way", new TypeError("network error")],
  ])(
    "leaves %s as what it is, while reading the body",
    async (_name, cause) => {
      answeredBy(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(cause);
              },
            }),
            { status: 200, headers: json },
          ),
      );

      const error = await failureOf(
        trpcClient.events.getAll.query({} as never),
      );

      expect(error.message).toBe(cause.message);
      expect(error.cause).toBe(cause);
    },
  );
});

describe("Cronium's answers, at every status", () => {
  const codes: Array<[string, number]> = [
    ["BAD_REQUEST", 400],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["METHOD_NOT_SUPPORTED", 405],
    ["TIMEOUT", 408],
    ["CONFLICT", 409],
    ["PRECONDITION_FAILED", 412],
    ["PAYLOAD_TOO_LARGE", 413],
    ["UNPROCESSABLE_CONTENT", 422],
    ["TOO_MANY_REQUESTS", 429],
    ["INTERNAL_SERVER_ERROR", 500],
    ["NOT_IMPLEMENTED", 501],
    ["BAD_GATEWAY", 502],
    ["SERVICE_UNAVAILABLE", 503],
    ["GATEWAY_TIMEOUT", 504],
  ];

  it.each(codes)("passes on %s, %i, from a save", async (code, httpStatus) => {
    reachingCronium();

    const error = await failureOf(
      trpcClient.events.delete.mutate(code as never),
    );

    expect(error.message).toBe(`Cronium: ${code}`);
    expect(error.data).toMatchObject({ code, httpStatus });
  });

  it.each(codes)("passes on %s, %i, from a read", async (code, httpStatus) => {
    reachingCronium();

    const error = await failureOf(
      trpcClient.events.getById.query(code as never),
    );

    expect(error.message).toBe(`Cronium: ${code}`);
    expect(error.data).toMatchObject({ code, httpStatus });
  });

  it("gives each call in a mixed batch its own answer, at 207", async () => {
    const answered = reachingCronium();

    const [found, missing] = await Promise.allSettled([
      trpcClient.events.getAll.query({} as never),
      trpcClient.events.getById.query("NOT_FOUND" as never),
    ]);

    expect(answered.map((response) => response.status)).toEqual([207]);
    expect(found).toEqual({ status: "fulfilled", value: ["one", "two"] });
    expect(missing).toMatchObject({
      status: "rejected",
      reason: { message: "Cronium: NOT_FOUND" },
    });
  });

  it("reads a long answer once, without copying it first", async () => {
    const clone = jest.spyOn(Response.prototype, "clone");
    const text = jest.spyOn(Response.prototype, "text");
    reachingCronium();

    await expect(save(MB)).resolves.toEqual({ length: MB });

    expect(clone).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    clone.mockRestore();
    text.mockRestore();
  });
});
