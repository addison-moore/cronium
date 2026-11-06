/**
 * Saving an event past what one request can carry, through the real proxy. Next cuts a
 * body off before a route sees it, and says nothing, so only a real server shows that the
 * cut-off sits above the limit. If it didn't, a chunked body past the limit would read as
 * broken JSON, and a body of exactly the limit might not save.
 *
 * The limit itself is 10 MB, as sent: apps/cronium-app/src/shared/request-limits.ts.
 */
import { APP_URL, pool, seedPrincipal } from "./helpers";

const LIMIT = 10 * 1024 * 1024;
const TOO_LONG = /too long to save.*at most 10 MB/;

let token: string;

beforeAll(async () => {
  ({ token } = await seedPrincipal());
});

afterAll(async () => {
  await pool.end();
});

type Build = (content: string) => unknown;

/** A JSON body of exactly `bytes` bytes, with the script making up the room. */
function bodyOfSize(bytes: number, build: Build): string {
  const shell = Buffer.byteLength(JSON.stringify(build("")));
  const body = JSON.stringify(build("x".repeat(bytes - shell)));
  expect(Buffer.byteLength(body)).toBe(bytes);
  return body;
}

/** The body in pieces with no declared length, which is how fetch sends a stream. */
function chunked(body: string): ReadableStream<Uint8Array> {
  const bytes = Buffer.from(body);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(
        new Uint8Array(bytes.subarray(offset, offset + 500_009)),
      );
      offset += 500_009;
    },
  });
}

async function send(
  path: string,
  method: string,
  body: string | ReadableStream<Uint8Array>,
  auth = true,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
    ...(typeof body === "string" ? {} : { duplex: "half" }),
  } as RequestInit);
  return { status: res.status, text: await res.text() };
}

const restEvent = (name: string, content: string) => ({
  name,
  type: "BASH",
  status: "DRAFT",
  scheduleUnit: "MINUTES",
  runLocation: "LOCAL",
  timeoutValue: 30,
  timeoutUnit: "SECONDS",
  retries: 0,
  content,
});
const trpcEvent = (name: string, content: string) => ({
  json: { name, type: "BASH", content, triggerType: "MANUAL", status: "DRAFT" },
});
const mcpCall = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

async function savedScriptLength(id: number): Promise<number> {
  const { rows } = await pool.query<{ length: number }>(
    "SELECT octet_length(content) AS length FROM events WHERE id = $1",
    [id],
  );
  return rows[0]!.length;
}

async function eventsNamed(name: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM events WHERE name = $1",
    [name],
  );
  return rows[0]!.count;
}

/** An event with a short script, to try to replace it. */
async function shortEvent(): Promise<number> {
  const res = await send(
    "/api/events",
    "POST",
    JSON.stringify(restEvent("limit-target", "echo short")),
  );
  expect(res.status).toBe(201);
  return (JSON.parse(res.text) as { id: number }).id;
}

const creates: Array<[string, string, (name: string) => Build]> = [
  ["REST POST", "/api/events", (name) => (content) => restEvent(name, content)],
  [
    "tRPC events.create",
    "/api/trpc/events.create",
    (name) => (content) => trpcEvent(name, content),
  ],
  [
    "a batched tRPC events.create",
    "/api/trpc/events.create?batch=1",
    (name) => (content) => ({ 0: trpcEvent(name, content) }),
  ],
  [
    "MCP create_event",
    "/api/mcp",
    (name) => (content) =>
      mcpCall("create_event", { name, type: "BASH", content }),
  ],
];

describe.each(creates)("%s", (_surface, path, build) => {
  it.each([
    ["declared", (body: string) => body],
    ["chunked", chunked],
  ])("saves a %s body of exactly the limit", async (_kind, encode) => {
    const name = `limit-fits-${Date.now().toString(36)}-${Math.random()}`;

    const res = await send(
      path,
      "POST",
      encode(bodyOfSize(LIMIT, build(name))),
    );

    expect(res.status).toBeLessThan(300);
    expect(res.text).not.toContain('"isError":true');
    expect(await eventsNamed(name)).toBe(1);
  });

  it.each([
    ["declared", "one byte over", LIMIT + 1, (body: string) => body],
    ["chunked", "one byte over", LIMIT + 1, chunked],
    // Past Next's own cut-off, 11 MB in next.config.mjs, where it passes on only the
    // start of the body. The route still has to see that as too long, not as broken.
    ["declared", "far over", 12 * 1024 * 1024, (body: string) => body],
    ["chunked", "far over", 12 * 1024 * 1024, chunked],
  ])(
    "refuses a %s body %s, says why, and saves nothing",
    async (_kind, _amount, size, encode) => {
      const name = `limit-over-${Date.now().toString(36)}-${Math.random()}`;

      const res = await send(
        path,
        "POST",
        encode(bodyOfSize(size, build(name))),
      );

      expect(res.status).toBe(413);
      expect(res.text).toMatch(TOO_LONG);
      expect(await eventsNamed(name)).toBe(0);
    },
  );

  it("answers 401 first to a caller with no token", async () => {
    const res = await send(
      path,
      "POST",
      bodyOfSize(LIMIT + 1, build("limit-anonymous")),
      false,
    );

    expect(res.status).toBe(401);
  });
});

const updates: Array<[string, string, string, (id: number) => Build]> = [
  ["REST PATCH", "/api/events/{id}", "PATCH", () => (content) => ({ content })],
  ["REST PUT", "/api/events/{id}", "PUT", () => (content) => ({ content })],
  [
    "tRPC events.update",
    "/api/trpc/events.update",
    "POST",
    (id) => (content) => ({ json: { id, content } }),
  ],
  [
    "MCP update_event",
    "/api/mcp",
    "POST",
    (id) => (content) => mcpCall("update_event", { id, content }),
  ],
];

describe.each(updates)("%s", (_surface, path, method, build) => {
  const pathFor = (id: number) => path.replace("{id}", String(id));

  it("saves a body of exactly the limit", async () => {
    const id = await shortEvent();
    const body = bodyOfSize(LIMIT, build(id));

    const res = await send(pathFor(id), method, body);

    expect(res.status).toBeLessThan(300);
    expect(await savedScriptLength(id)).toBeGreaterThan(LIMIT - 1024);
  });

  it.each([
    ["declared", (body: string) => body],
    ["chunked", chunked],
  ])(
    "refuses a %s body one byte over, says why, and leaves the script alone",
    async (_kind, encode) => {
      const id = await shortEvent();

      const res = await send(
        pathFor(id),
        method,
        encode(bodyOfSize(LIMIT + 1, build(id))),
      );

      expect(res.status).toBe(413);
      expect(res.text).toMatch(TOO_LONG);
      expect(await savedScriptLength(id)).toBe("echo short".length);
    },
  );
});

describe("what counts toward the limit", () => {
  it("is what's sent, so a script well under 10 MB can be too long", async () => {
    const name = `limit-short-lines-${Date.now().toString(36)}`;
    // 7.2 MB of script, and 10.8 MB of JSON.
    const content = "a\n".repeat(3_600_000);

    const res = await send(
      "/api/events",
      "POST",
      JSON.stringify(restEvent(name, content)),
    );

    expect(res.status).toBe(413);
    expect(res.text).toMatch(TOO_LONG);
    expect(await eventsNamed(name)).toBe(0);
  });

  it("is bytes, so a script under 10 MB in characters can be too long", async () => {
    const name = `limit-characters-${Date.now().toString(36)}`;
    const content = "é".repeat(5_300_000);

    const res = await send(
      "/api/events",
      "POST",
      JSON.stringify(restEvent(name, content)),
    );

    expect(res.status).toBe(413);
    expect(await eventsNamed(name)).toBe(0);
  });

  it("leaves a body that really is broken reported as that", async () => {
    const res = await send("/api/events", "POST", '{"name":"e","content":"xx');

    expect(res.status).toBe(400);
    expect(res.text).toContain("must be a JSON object");
  });
});
