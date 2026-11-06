/**
 * @jest-environment node
 *
 * Holds the public API docs (apps/cronium-info/src/app/docs/api/examples) to the
 * routes that actually exist. Each documented example is sent to the real handler,
 * through the real token and scope checks and the real request schemas, so a
 * route, method, field or scope the code does not support fails here. Storage and
 * the enqueue are mocks: tests/storage/rest-execute.test.ts covers those.
 *
 * The docs once described routes that answered 404 and bodies the schemas rejected.
 */
jest.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: 1001, eventId: 42 }]),
      }),
    }),
  },
}));
jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/server/storage", () => ({
  storage: {
    getApiTokenByToken: jest.fn(),
    updateApiToken: jest.fn(),
    getAllEvents: jest.fn(),
    getEvent: jest.fn(),
    getEventWithRelations: jest.fn(),
    createScript: jest.fn(),
    updateScript: jest.fn(),
    deleteScript: jest.fn(),
    replaceEventEnvVars: jest.fn(),
    setEventServers: jest.fn(),
    getFilteredLogs: jest.fn(),
    getAllServers: jest.fn(),
    getServer: jest.fn(),
    canUserAccessServer: jest.fn(),
    createServer: jest.fn(),
    updateServer: jest.fn(),
    deleteServer: jest.fn(),
  },
}));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/server/security/authorization", () => ({
  ...jest.requireActual<typeof import("@/server/security/authorization")>(
    "@/server/security/authorization",
  ),
  getAuthorizedPrincipal: jest.fn(),
}));
jest.mock("@/server/security/resource-access", () => ({
  ...jest.requireActual<typeof import("@/server/security/resource-access")>(
    "@/server/security/resource-access",
  ),
  assertEventCapability: jest.fn(),
  assertEventRelations: jest.fn(),
  assertProposedEventServers: jest.fn(),
  assertWorkflowGraphCapability: jest.fn(),
}));
jest.mock("@/lib/scheduler", () => ({
  scheduler: { updateScript: jest.fn() },
}));
jest.mock("@/lib/ssh", () => ({
  sshService: { testConnection: jest.fn() },
}));
jest.mock("@/lib/scheduling/dispatch", () => ({
  dispatchEventJob: jest.fn(),
}));
jest.mock("@/lib/scheduling/workflow-engine", () => ({
  startWorkflowRun: jest.fn(),
}));
jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { tryCheckLimit: jest.fn() },
}));

import fs from "node:fs";
import path from "node:path";
import { getTableColumns, type Table } from "drizzle-orm";
import { NextRequest } from "next/server";
import { RateLimitService } from "@/lib/rate-limit-service";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { startWorkflowRun } from "@/lib/scheduling/workflow-engine";
import { sshService } from "@/lib/ssh";
import { getAuthorizedPrincipal } from "@/server/security/authorization";
import { storage } from "@/server/storage";
import {
  TokenStatus,
  UserRole,
  envVars,
  events,
  logs,
  servers,
} from "@/shared/schema";
import {
  allEndpoints,
  apiExample,
  authenticationExamples,
  errorExamples,
  responseExamples,
  type ApiEndpoint,
  type ApiRequest,
  type TokenScope,
} from "../../../../../cronium-info/src/app/docs/api/examples";

const INFO_SRC = path.resolve(__dirname, "../../../../../cronium-info/src");
const API_DIRS = [
  path.resolve(__dirname, ".."),
  path.join(INFO_SRC, "app/api"), // the site's own contact form route
];
// Mentioned on the site but not Next routes: the socket server's transport path,
// and the example of what an unknown path answers.
const NOT_APP_ROUTES = new Set(["/api/socketio", "/api/does-not-exist"]);
// A URL on one of these is the reader's own instance. Anything else is external.
const INSTANCE_HOSTS =
  /^(cronium\.example\.com|your-cronium-host|localhost(:\d+)?)$/;

const USER = "user-1";
const s = storage as unknown as Record<string, jest.Mock>;

interface Route {
  segments: string[];
  file: string;
  source: string;
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, match);
    return match(entry.name) ? [full] : [];
  });
}

const isDynamic = (segment: string) => segment.startsWith("[");

const routes: Route[] = API_DIRS.flatMap(
  (apiDir) =>
    walk(apiDir, (name) => name === "route.ts").map((file) => ({
      file,
      source: fs.readFileSync(file, "utf8"),
      segments: [
        "api",
        ...path.relative(apiDir, path.dirname(file)).split(path.sep),
      ],
    })),
  // The catch-all answers every unknown path with a JSON 404. Matching against it
  // would make every path in the docs look real.
).filter((route) => !route.segments.some((seg) => seg.startsWith("[...")));

/** The route Next would pick for a path: static segments beat dynamic ones. */
function resolveRoute(pathname: string): Route | undefined {
  const parts = pathname.split("/").filter(Boolean);
  const firstDynamic = (route: Route) => {
    const index = route.segments.findIndex(isDynamic);
    return index === -1 ? Infinity : index;
  };
  return routes
    .filter(
      ({ segments }) =>
        segments.length === parts.length &&
        segments.every((seg, i) => isDynamic(seg) || seg === parts[i]),
    )
    .sort((a, b) => firstDynamic(b) - firstDynamic(a))[0];
}

function exportedMethods(route: Route): string[] {
  const named = route.source.matchAll(
    /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  );
  const aliased = route.source.matchAll(
    /\bas\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  );
  return [...named, ...aliased].map((match) => match[1]!);
}

async function send(request: ApiRequest): Promise<Response> {
  const url = new URL(request.path, "http://localhost:5001");
  const route = resolveRoute(url.pathname);
  if (!route) throw new Error(`No route for ${request.path}`);

  const parts = url.pathname.split("/").filter(Boolean);
  const params = Object.fromEntries(
    route.segments.flatMap((seg, i) =>
      isDynamic(seg) ? [[seg.slice(1, -1), parts[i]]] : [],
    ),
  );
  const handlers = (await import(route.file)) as Record<
    string,
    (req: NextRequest, ctx: unknown) => Promise<Response>
  >;
  const handler = handlers[request.method];
  if (!handler) throw new Error(`No ${request.method} on ${route.file}`);

  return handler(
    new NextRequest(url, {
      method: request.method,
      headers: { authorization: "Bearer a-token" },
      ...(request.body && { body: JSON.stringify(request.body) }),
    }),
    { params: Promise.resolve(params) },
  );
}

function tokenWithScopes(scopes: string[]) {
  s.getApiTokenByToken!.mockResolvedValue({
    id: 1,
    userId: USER,
    status: TokenStatus.ACTIVE,
    expiresAt: null,
    scopes,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  tokenWithScopes(["full"]);
  (getAuthorizedPrincipal as jest.Mock).mockResolvedValue({
    id: USER,
    role: UserRole.USER,
  });
  (RateLimitService.tryCheckLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    remaining: 49,
    resetAt: new Date(),
  });
  const event = { id: 42, userId: USER, envVars: [], servers: [] };
  const server = { id: 7, userId: USER, address: "203.0.113.10", port: 22 };
  s.getAllEvents!.mockResolvedValue([event]);
  s.getEvent!.mockResolvedValue(event);
  s.getEventWithRelations!.mockResolvedValue(event);
  s.createScript!.mockResolvedValue(event);
  s.getFilteredLogs!.mockResolvedValue({ logs: [], total: 0 });
  s.getAllServers!.mockResolvedValue([server]);
  s.getServer!.mockResolvedValue(server);
  s.canUserAccessServer!.mockResolvedValue(true);
  s.createServer!.mockResolvedValue(server);
  s.updateServer!.mockResolvedValue(server);
  (sshService.testConnection as jest.Mock).mockResolvedValue({ success: true });
  (dispatchEventJob as jest.Mock).mockResolvedValue({
    job: { id: "job_abc" },
    logId: 1001,
  });
  (startWorkflowRun as jest.Mock).mockResolvedValue({
    success: true,
    executionId: 88,
    status: "RUNNING",
  });
});

const named = allEndpoints.map((endpoint): [string, ApiEndpoint] => [
  `${endpoint.method} ${endpoint.path}`,
  endpoint,
]);

describe.each(named)("the docs for %s", (_name, endpoint) => {
  const { example, method, parameters = [] } = endpoint;
  const bodyParams = parameters.filter((param) => param.in === "body");

  it("name a route that exists and answers that method", () => {
    const route = resolveRoute(endpoint.path);
    expect(route).toBeDefined();
    expect(exportedMethods(route!)).toContain(method);
  });

  it("show an example of that same route and method", () => {
    const url = new URL(example.request.path, "http://localhost:5001");
    expect(example.request.method).toBe(method);
    expect(resolveRoute(url.pathname)).toBe(resolveRoute(endpoint.path));
  });

  it.each<TokenScope>(["full", "mcp"])(
    "are right about whether a %s token works, and about the status it gets",
    async (scope) => {
      tokenWithScopes([scope]);
      const res = await send(example.request);
      expect(res.status).toBe(
        endpoint.scopes.includes(scope) ? endpoint.status : 403,
      );
    },
  );

  it("have every path placeholder in the path", () => {
    for (const param of parameters.filter((p) => p.in === "path")) {
      expect(endpoint.path).toContain(`{${param.name}}`);
    }
  });

  it("list query parameters the route reads", () => {
    const route = resolveRoute(endpoint.path)!;
    for (const param of parameters.filter((p) => p.in === "query")) {
      expect(route.source).toContain(`searchParams.get("${param.name}")`);
    }
    // A query string in the example has to be documented too.
    const query = new URL(example.request.path, "http://localhost:5001");
    for (const key of query.searchParams.keys()) {
      expect(parameters.map((p) => p.name)).toContain(key);
    }
  });

  if (bodyParams.length > 0) {
    it("list body fields the route's strict schema recognizes", async () => {
      for (const { name } of bodyParams) {
        const res = await send({
          ...example.request,
          body: { [name]: null },
        });
        expect([name, await res.text()]).not.toEqual([
          name,
          expect.stringMatching(/unrecognized key/i),
        ]);
      }
    });

    it("are held to that schema: an unknown field is rejected", async () => {
      const res = await send({
        ...example.request,
        body: { ...example.request.body, notARealField: 1 },
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/unrecognized key/i);
    });

    it("mark as required only what the route requires", async () => {
      for (const { name } of bodyParams.filter((param) => param.required)) {
        const { [name]: omitted, ...rest } = example.request.body ?? {};
        void omitted;
        const res = await send({ ...example.request, body: rest });
        expect([name, res.status]).toEqual([name, 400]);
      }
    });

    it("show the body in all three languages", () => {
      const json = JSON.stringify(example.request.body, null, 2);
      expect(example.curl.replace(/\n {2}/g, "\n")).toContain(json);
      expect(example.nodejs.replace(/\n {4}/g, "\n")).toContain(json);
      for (const key of Object.keys(example.request.body ?? {})) {
        expect(example.python).toContain(`"${key}":`);
      }
    });
  }

  it("show the same request in all three languages", () => {
    const url = `https://cronium.example.com${example.request.path}`;
    for (const snippet of [example.curl, example.python, example.nodejs]) {
      expect(snippet).toContain(url);
      expect(snippet).toContain("Bearer YOUR_API_TOKEN");
    }
    expect(example.python).toContain(`requests.${method.toLowerCase()}(`);
    if (method !== "GET") {
      expect(example.curl).toContain(`-X ${method}`);
      expect(example.nodejs).toContain(`method: "${method}"`);
    }
  });
});

describe("documented responses", () => {
  const columns = (table: Table) => Object.keys(getTableColumns(table));
  const eventFields = [
    ...columns(events),
    "envVars",
    "server",
    "servers",
    "eventServers",
    "secretFieldsRedacted",
  ];
  const logFields = [...columns(logs), "scriptContent", "workflowName"];
  const serverFields = [
    ...columns(servers).filter((c) => !["sshKey", "password"].includes(c)),
    "hasPrivateKey",
    "hasPassword",
  ];

  it.each<[string, object, string[]]>([
    ["event", responseExamples.event, eventFields],
    ["event list entry", responseExamples.eventList[0]!, eventFields],
    ["env var", responseExamples.event.envVars[0]!, columns(envVars)],
    ["log", responseExamples.log, logFields],
    ["log list entry", responseExamples.logList.logs[0]!, logFields],
    ["server", responseExamples.server, serverFields],
    ["server list entry", responseExamples.serverList[0]!, serverFields],
  ])("use only real fields on a %s", (_label, example, fields) => {
    expect(Object.keys(example).filter((key) => !fields.includes(key))).toEqual(
      [],
    );
  });

  it("match what running an event returns", async () => {
    const res = await send({
      method: "POST",
      path: "/api/events/42/execute",
    });
    expect(Object.keys((await res.json()) as object).sort()).toEqual(
      Object.keys(responseExamples.eventRun).sort(),
    );
  });

  it("match what running a workflow returns", async () => {
    const res = await send({
      method: "POST",
      path: "/api/workflows/12/execute",
    });
    expect(await res.json()).toEqual(responseExamples.workflowRun);
  });

  it("match what listing logs returns", async () => {
    const res = await send({ method: "GET", path: "/api/logs" });
    expect(Object.keys((await res.json()) as object).sort()).toEqual(
      Object.keys(responseExamples.logList).sort(),
    );
  });

  it("match what deleting a server returns", async () => {
    const res = await send({ method: "DELETE", path: "/api/servers/7" });
    expect(await res.json()).toEqual(responseExamples.serverDeleted);
  });

  it("show a validation error the way the routes report it", async () => {
    const res = await send({
      method: "PATCH",
      path: "/api/events/42",
      body: { script: "echo hi", timeoutValue: 0 },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(errorExamples.validation);
  });

  it("show an unknown path the way the catch-all answers it", async () => {
    const { GET } = await import("../[...notfound]/route");
    const res = await GET(
      new NextRequest("http://localhost:5001/api/does-not-exist"),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ...errorExamples.unknownRoute,
      timestamp: expect.any(String),
    });
  });

  it("use a request the authentication section can really make", async () => {
    const { request } = authenticationExamples.usingApiTokens;
    expect((await send(request)).status).toBe(200);
  });
});

// The parameter descriptions make promises the checks above cannot see, and no other
// suite covered this route: with main's version of it in place, nothing here failed.
describe("what the docs say about GET /api/logs", () => {
  const list = (query: string) =>
    send({ method: "GET", path: `/api/logs?${query}` });
  const filtersSent = () =>
    s.getFilteredLogs!.mock.calls[0]![0] as Record<string, unknown>;

  it("defaults to page 1 of 20", async () => {
    await send({ method: "GET", path: "/api/logs" });
    expect(s.getFilteredLogs).toHaveBeenCalledWith(expect.anything(), 20, 1);
  });

  it("caps pageSize at 100", async () => {
    const res = await list("pageSize=500");
    expect(s.getFilteredLogs).toHaveBeenCalledWith(expect.anything(), 100, 1);
    expect(await res.json()).toMatchObject({ pageSize: 100 });
  });

  it("only ever asks for the caller's logs", async () => {
    await list("status=SUCCESS");
    expect(filtersSent()).toMatchObject({ userId: USER, status: "SUCCESS" });
  });

  it("ignores a status it does not know", async () => {
    const res = await list("status=NOPE");
    expect(res.status).toBe(200);
    expect(filtersSent()).not.toHaveProperty("status");
  });

  it.each(["eventId=abc", "eventId=-1", "workflowId=abc", "workflowId=-1"])(
    "answers 400 for %s",
    async (query) => {
      expect((await list(query)).status).toBe(400);
      expect(s.getFilteredLogs).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for an event that does not exist", async () => {
    s.getEvent!.mockResolvedValue(undefined);
    expect((await list("eventId=42")).status).toBe(404);
  });

  it("answers 403 for an event that is not the caller's", async () => {
    s.getEvent!.mockResolvedValue({ id: 42, userId: "someone-else" });
    expect((await list("eventId=42")).status).toBe(403);
    expect(s.getFilteredLogs).not.toHaveBeenCalled();
  });

  it("takes none to mean outside any workflow, and all to mean no filter", async () => {
    await list("workflowId=none");
    expect(filtersSent()).toMatchObject({ workflowId: null });

    s.getFilteredLogs!.mockClear();
    await list("workflowId=all");
    expect(filtersSent()).not.toHaveProperty("workflowId");
  });

  it("filters by a numeric workflow id", async () => {
    await list("workflowId=12");
    expect(filtersSent()).toMatchObject({ workflowId: 12 });
  });
});

describe("the example generator", () => {
  it("quotes a URL with a query string, so the shell leaves it alone", () => {
    const { curl } = apiExample({ method: "GET", path: "/api/logs?a=1&b=2" });
    expect(curl).toContain('"https://cronium.example.com/api/logs?a=1&b=2"');
  });

  it("keeps a single quote in a body from ending curl's -d argument", () => {
    const { curl } = apiExample({
      method: "POST",
      path: "/api/events",
      body: { content: "echo 'hi'" },
    });
    expect(curl).toContain(`echo '\\''hi'\\''`);
  });

  it("writes Python literals, not JSON", () => {
    const { python } = apiExample({
      method: "POST",
      path: "/api/events",
      body: { a: true, b: false, c: null, d: [], e: {} },
    });
    expect(python).toContain('"a": True,');
    expect(python).toContain('"b": False,');
    expect(python).toContain('"c": None,');
    expect(python).toContain('"d": [],');
    expect(python).toContain('"e": {},');
  });

  it("does not try to print the empty body of a 204", () => {
    const example = apiExample({
      method: "DELETE",
      path: "/api/events/42",
      noContent: true,
    });
    expect(example.python).not.toContain(".json()");
    expect(example.nodejs).not.toContain(".json()");
  });
});

describe("every /api path mentioned on the info site", () => {
  const mention =
    /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(?:https?:\/\/([^\s/'"`]+)|(?<![\w.-]))(\/api\/[\w\-{}$./]*)/g;

  const mentions = walk(INFO_SRC, (name) => /\.tsx?$/.test(name)).flatMap(
    (file) =>
      [...fs.readFileSync(file, "utf8").matchAll(mention)]
        .filter(([, , host]) => !host || INSTANCE_HOSTS.test(host))
        .map(([, method, , rawPath]) => ({
          file: path.relative(INFO_SRC, file),
          method,
          pathname: rawPath!.replace(/[./]+$/, ""),
        }))
        .filter(
          ({ pathname }) =>
            pathname !== "/api" && !NOT_APP_ROUTES.has(pathname),
        ),
  );

  it("is actually being found (scanner self-check)", () => {
    const pathnames = mentions.map((m) => m.pathname);
    expect(pathnames).toEqual(
      expect.arrayContaining([
        "/api/mcp",
        "/api/health",
        "/api/events/{id}/execute",
        "/api/events/{event_id}/execute",
        "/api/events/42/execute",
        "/api/logs/$LOG_ID",
      ]),
    );
  });

  it("resolves to a route", () => {
    const dead = mentions
      .filter(({ pathname }) => !resolveRoute(pathname))
      .map(({ file, pathname }) => `${file}: ${pathname}`);
    expect(dead).toEqual([]);
  });

  it("names a method the route answers, when it names one", () => {
    const wrong = mentions
      .filter(({ method, pathname }) => {
        const route = resolveRoute(pathname);
        return method && route && !exportedMethods(route).includes(method);
      })
      .map(({ file, method, pathname }) => `${file}: ${method} ${pathname}`);
    expect(wrong).toEqual([]);
  });

  // What the REST v1 docs promised. If one comes back it needs its own docs, and
  // this list should change along with them.
  it.each([
    "/api/workflows",
    "/api/workflows/1",
    "/api/variables",
    "/api/variables/KEY",
    "/api/events/1/logs",
    "/api/servers/1/test",
  ])("does not include the removed route %s", (pathname) => {
    expect(resolveRoute(pathname)).toBeUndefined();
    expect(mentions.map((m) => m.pathname)).not.toContain(pathname);
  });
});
