/**
 * Tests for the Cronium Node.js runtime SDK (cronium.js).
 *
 * These tests exercise the REAL request path: a local node:http server is
 * started on an ephemeral 127.0.0.1 port and the SDK is pointed at it via the
 * environment variables it reads (CRONIUM_RUNTIME_API, CRONIUM_EXECUTION_TOKEN,
 * CRONIUM_EXECUTION_ID). Each test asserts what actually went over the wire
 * (method, path, headers, body) and how responses are parsed.
 */

const http = require("http");
const https = require("https");

const EXECUTION_ID = "exec-test-123";
const TOKEN = "test-execution-token";

/** Requests captured by the local server, in arrival order. */
let received;
/** Per-test response handler: (record, res) => void. */
let responder;
/** The local HTTP server and its base URL. */
let server;
let baseUrl;
/** The SDK module (loaded fresh once the server port is known). */
let sdk;

function defaultResponder(record, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
}

function jsonResponder(statusCode, payload) {
  return (record, res) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };
}

/**
 * Load cronium.js in an isolated module registry so the module-level
 * singleton is constructed with the current process.env.
 */
function loadSdk() {
  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require("../cronium.js");
  });
  return mod;
}

/** Create a standalone client with fast retry/timeout settings for tests. */
function makeClient(overrides = {}) {
  const client = new sdk();
  client.retryDelay = 5;
  Object.assign(client, overrides);
  return client;
}

beforeAll((done) => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      };
      received.push(record);
      responder(record, res);
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;

    process.env.CRONIUM_RUNTIME_API = baseUrl;
    process.env.CRONIUM_EXECUTION_TOKEN = TOKEN;
    process.env.CRONIUM_EXECUTION_ID = EXECUTION_ID;

    sdk = loadSdk();
    done();
  });
});

afterAll((done) => {
  // Destroy any sockets left open by never-responding handlers (timeout tests).
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  server.close(done);
});

beforeEach(() => {
  received = [];
  responder = defaultResponder;
});

describe("environment / construction", () => {
  test("throws CroniumError at load when CRONIUM_EXECUTION_TOKEN is missing", () => {
    const saved = process.env.CRONIUM_EXECUTION_TOKEN;
    delete process.env.CRONIUM_EXECUTION_TOKEN;
    try {
      expect(() => loadSdk()).toThrow(
        "CRONIUM_EXECUTION_TOKEN environment variable not set",
      );
      expect(() => loadSdk()).toThrow(
        expect.objectContaining({ name: "CroniumError" }),
      );
    } finally {
      process.env.CRONIUM_EXECUTION_TOKEN = saved;
    }
  });

  test("throws CroniumError at load when CRONIUM_EXECUTION_ID is missing", () => {
    const saved = process.env.CRONIUM_EXECUTION_ID;
    delete process.env.CRONIUM_EXECUTION_ID;
    try {
      expect(() => loadSdk()).toThrow(
        "CRONIUM_EXECUTION_ID environment variable not set",
      );
    } finally {
      process.env.CRONIUM_EXECUTION_ID = saved;
    }
  });

  test("defaults the API URL to http://localhost:8081 when CRONIUM_RUNTIME_API is unset", () => {
    const saved = process.env.CRONIUM_RUNTIME_API;
    delete process.env.CRONIUM_RUNTIME_API;
    try {
      const client = new sdk();
      expect(client.apiUrl).toBe("http://localhost:8081");
      expect(client.httpModule).toBe(http);
    } finally {
      process.env.CRONIUM_RUNTIME_API = saved;
    }
  });

  test("selects the https module for https:// API URLs", () => {
    const saved = process.env.CRONIUM_RUNTIME_API;
    process.env.CRONIUM_RUNTIME_API = "https://runtime.example.com:8443";
    try {
      const client = new sdk();
      expect(client.httpModule).toBe(https);
    } finally {
      process.env.CRONIUM_RUNTIME_API = saved;
    }
  });
});

describe("request wire format", () => {
  test("sends Authorization bearer token and JSON headers", async () => {
    responder = jsonResponder(200, { success: true, data: { ok: 1 } });
    await sdk.cronium.input();

    expect(received).toHaveLength(1);
    const req = received[0];
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers.accept).toBe("application/json");
  });
});

describe("input()", () => {
  test("GETs /executions/{id}/input and returns the data field", async () => {
    responder = jsonResponder(200, {
      success: true,
      data: { message: "hello", n: 42 },
    });

    const result = await sdk.cronium.input();

    expect(received[0].method).toBe("GET");
    expect(received[0].url).toBe(`/executions/${EXECUTION_ID}/input`);
    expect(received[0].body).toBe("");
    expect(result).toEqual({ message: "hello", n: 42 });
  });

  test("returns null when the response carries no data", async () => {
    responder = jsonResponder(200, { success: true });
    await expect(sdk.cronium.input()).resolves.toBeNull();
  });

  test("module-level input() convenience function uses the singleton", async () => {
    responder = jsonResponder(200, { success: true, data: "payload" });
    await expect(sdk.input()).resolves.toBe("payload");
    expect(received[0].url).toBe(`/executions/${EXECUTION_ID}/input`);
  });

  test("current behavior: falsy input data (0, false, '') is coerced to null", async () => {
    // Documents `result?.data || null` — falsy-but-present values are lost.
    responder = jsonResponder(200, { success: true, data: 0 });
    await expect(sdk.cronium.input()).resolves.toBeNull();
  });
});

describe("output()", () => {
  test("POSTs /executions/{id}/output with a {data} body", async () => {
    const payload = { result: [1, 2, 3], done: true };
    await expect(sdk.cronium.output(payload)).resolves.toBeUndefined();

    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe(`/executions/${EXECUTION_ID}/output`);
    expect(JSON.parse(received[0].body)).toEqual({ data: payload });
  });

  test("module-level output() convenience function works", async () => {
    await sdk.output("done");
    expect(JSON.parse(received[0].body)).toEqual({ data: "done" });
  });
});

describe("getVariable()", () => {
  test("GETs /executions/{id}/variables/{key} and unwraps data.value", async () => {
    responder = jsonResponder(200, {
      success: true,
      data: { key: "greeting", value: "hi" },
    });

    const value = await sdk.cronium.getVariable("greeting");

    expect(received[0].method).toBe("GET");
    expect(received[0].url).toBe(
      `/executions/${EXECUTION_ID}/variables/greeting`,
    );
    expect(value).toBe("hi");
  });

  test("URL-encodes the variable key", async () => {
    responder = jsonResponder(200, {
      success: true,
      data: { key: "a b/c", value: 1 },
    });
    await sdk.cronium.getVariable("a b/c");
    expect(received[0].url).toBe(
      `/executions/${EXECUTION_ID}/variables/a%20b%2Fc`,
    );
  });

  test("returns null on a 404 instead of throwing", async () => {
    responder = jsonResponder(404, {
      error: "Not Found",
      message: "variable not found",
    });
    await expect(sdk.cronium.getVariable("missing")).resolves.toBeNull();
    expect(received).toHaveLength(1); // 4xx is not retried
  });

  test("rethrows non-404 API errors", async () => {
    responder = jsonResponder(403, {
      error: "Forbidden",
      message: "execution ID mismatch",
    });
    await expect(sdk.cronium.getVariable("k")).rejects.toMatchObject({
      name: "CroniumAPIError",
      statusCode: 403,
      message: "API Error (403): execution ID mismatch",
    });
  });

  test("current behavior: falsy variable values (0, false, '') are coerced to null", async () => {
    // Documents `result?.data?.value || null`.
    responder = jsonResponder(200, {
      success: true,
      data: { key: "count", value: 0 },
    });
    await expect(sdk.cronium.getVariable("count")).resolves.toBeNull();
  });
});

describe("setVariable()", () => {
  test("PUTs /executions/{id}/variables/{key} with a {value} body", async () => {
    await expect(
      sdk.cronium.setVariable("config", { retries: 3 }),
    ).resolves.toBeUndefined();

    expect(received[0].method).toBe("PUT");
    expect(received[0].url).toBe(
      `/executions/${EXECUTION_ID}/variables/config`,
    );
    expect(JSON.parse(received[0].body)).toEqual({ value: { retries: 3 } });
  });

  test("URL-encodes the variable key", async () => {
    await sdk.setVariable("my key", "v");
    expect(received[0].url).toBe(
      `/executions/${EXECUTION_ID}/variables/my%20key`,
    );
  });
});

describe("setCondition()", () => {
  test("POSTs /executions/{id}/condition with a {condition} body", async () => {
    await expect(sdk.cronium.setCondition(true)).resolves.toBeUndefined();

    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe(`/executions/${EXECUTION_ID}/condition`);
    expect(JSON.parse(received[0].body)).toEqual({ condition: true });
  });

  test("module-level setCondition(false) serializes false", async () => {
    await sdk.setCondition(false);
    expect(JSON.parse(received[0].body)).toEqual({ condition: false });
  });
});

describe("event()", () => {
  test("GETs /executions/{id}/context and returns the data field", async () => {
    const context = {
      id: "ev-1",
      name: "Nightly job",
      type: "script",
      userId: "u-1",
      executionId: EXECUTION_ID,
    };
    responder = jsonResponder(200, { success: true, data: context });

    await expect(sdk.cronium.event()).resolves.toEqual(context);
    expect(received[0].method).toBe("GET");
    expect(received[0].url).toBe(`/executions/${EXECUTION_ID}/context`);
  });

  test("returns an empty object when the response carries no data", async () => {
    responder = jsonResponder(200, { success: true });
    await expect(sdk.event()).resolves.toEqual({});
  });
});

describe("executeToolAction()", () => {
  test("POSTs /tool-actions/execute with tool, action, and config", async () => {
    responder = jsonResponder(200, {
      success: true,
      data: { messageId: "m-1" },
    });

    const result = await sdk.cronium.executeToolAction(
      "slack",
      "send_message",
      {
        channel: "#general",
        text: "hi",
      },
    );

    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe("/tool-actions/execute");
    expect(JSON.parse(received[0].body)).toEqual({
      tool: "slack",
      action: "send_message",
      config: { channel: "#general", text: "hi" },
    });
    expect(result).toEqual({ messageId: "m-1" });
  });

  test("rejects with CroniumAPIError when the body reports success: false", async () => {
    responder = jsonResponder(200, {
      success: false,
      message: "tool not connected",
    });
    await expect(
      sdk.executeToolAction("slack", "send_message", {}),
    ).rejects.toMatchObject({
      name: "CroniumAPIError",
      statusCode: 200,
      message: "API Error (200): tool not connected",
    });
  });

  test("success: false without a message falls back to 'Unknown error'", async () => {
    responder = jsonResponder(200, { success: false });
    await expect(
      sdk.executeToolAction("email", "send_message", {}),
    ).rejects.toMatchObject({
      message: "API Error (200): Unknown error",
    });
  });
});

describe("tool convenience wrappers", () => {
  beforeEach(() => {
    responder = jsonResponder(200, { success: true, data: { sent: true } });
  });

  test("sendEmail wraps a single recipient into an array and forwards extras", async () => {
    const result = await sdk.cronium.sendEmail({
      to: "a@example.com",
      subject: "Hi",
      body: "Hello",
      cc: ["b@example.com"],
    });

    expect(JSON.parse(received[0].body)).toEqual({
      tool: "email",
      action: "send_message",
      config: {
        to: ["a@example.com"],
        subject: "Hi",
        body: "Hello",
        cc: ["b@example.com"],
      },
    });
    expect(result).toEqual({ sent: true });
  });

  test("sendEmail keeps an array of recipients as-is", async () => {
    await sdk.sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      body: "b",
    });
    expect(JSON.parse(received[0].body).config.to).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  test("sendSlackMessage builds a slack send_message action", async () => {
    await sdk.sendSlackMessage({
      channel: "#ops",
      text: "deploy done",
      blocks: [{ type: "divider" }],
    });
    expect(JSON.parse(received[0].body)).toEqual({
      tool: "slack",
      action: "send_message",
      config: {
        channel: "#ops",
        text: "deploy done",
        blocks: [{ type: "divider" }],
      },
    });
  });

  test("sendDiscordMessage builds a discord send_message action", async () => {
    await sdk.sendDiscordMessage({
      channelId: "123",
      content: "ping",
      embeds: [{ title: "t" }],
    });
    expect(JSON.parse(received[0].body)).toEqual({
      tool: "discord",
      action: "send_message",
      config: { channelId: "123", content: "ping", embeds: [{ title: "t" }] },
    });
  });
});

describe("error handling and retries", () => {
  test("non-2xx with an ErrorResponse body rejects with CroniumAPIError and is not retried (4xx)", async () => {
    responder = jsonResponder(400, {
      error: "Bad Request",
      message: "invalid request body",
    });
    const client = makeClient();

    await expect(client.input()).rejects.toMatchObject({
      name: "CroniumAPIError",
      statusCode: 400,
      message: "API Error (400): invalid request body",
    });
    expect(received).toHaveLength(1);
  });

  test("non-2xx without a message falls back to 'HTTP <status>'", async () => {
    responder = jsonResponder(403, { error: "Forbidden" });
    await expect(makeClient().input()).rejects.toMatchObject({
      message: "API Error (403): HTTP 403",
    });
  });

  test("5xx responses are retried maxRetries times, then rejected", async () => {
    responder = jsonResponder(500, {
      error: "Internal Server Error",
      message: "failed to get input",
    });
    const client = makeClient();

    await expect(client.input()).rejects.toMatchObject({
      name: "CroniumAPIError",
      statusCode: 500,
    });
    expect(received).toHaveLength(client.maxRetries);
  });

  test("recovers when a 5xx is followed by a success", async () => {
    let calls = 0;
    responder = (record, res) => {
      calls += 1;
      if (calls === 1) {
        jsonResponder(503, { error: "Service Unavailable", message: "busy" })(
          record,
          res,
        );
      } else {
        jsonResponder(200, { success: true, data: "recovered" })(record, res);
      }
    };

    await expect(makeClient().input()).resolves.toBe("recovered");
    expect(received).toHaveLength(2);
  });

  test("malformed JSON in a 200 response rejects with a parse CroniumError", async () => {
    responder = (record, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("this is not json");
    };

    await expect(makeClient().input()).rejects.toMatchObject({
      name: "CroniumError",
      message: expect.stringMatching(/^Failed to parse response:/),
    });
    expect(received).toHaveLength(1);
  });

  test("an empty response body resolves to null", async () => {
    responder = (record, res) => {
      res.writeHead(200);
      res.end();
    };
    await expect(makeClient().input()).resolves.toBeNull();
  });

  test("times out, retries, and rejects with CroniumTimeoutError", async () => {
    const sockets = [];
    responder = (record, res) => {
      // Never respond; hold the socket open until cleanup.
      sockets.push(res);
    };
    const client = makeClient({ timeout: 100 });

    await expect(client.input()).rejects.toMatchObject({
      name: "CroniumTimeoutError",
      message: "Request timed out",
    });
    expect(received).toHaveLength(client.maxRetries);
    sockets.forEach((res) => res.destroy());
  }, 15000);

  test("connection failures reject with CroniumError and are not retried", async () => {
    // Find a port with nothing listening on it.
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const deadPort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));

    const client = makeClient();
    client.apiUrl = `http://127.0.0.1:${deadPort}`;

    await expect(client.input()).rejects.toMatchObject({
      name: "CroniumError",
      message: expect.stringMatching(/^Request failed:/),
    });
    expect(received).toHaveLength(0);
  });

  test("maxRetries of 0 rejects with 'Max retries exceeded'", async () => {
    const client = makeClient({ maxRetries: 0 });
    await expect(client.input()).rejects.toMatchObject({
      name: "CroniumError",
      message: "Max retries exceeded",
    });
    expect(received).toHaveLength(0);
  });
});

describe("exported error classes", () => {
  test("error classes are exported and form the expected hierarchy", () => {
    expect(new sdk.CroniumError("x")).toBeInstanceOf(Error);
    expect(new sdk.CroniumAPIError(500, "x")).toBeInstanceOf(sdk.CroniumError);
    expect(new sdk.CroniumTimeoutError("x")).toBeInstanceOf(sdk.CroniumError);

    const apiError = new sdk.CroniumAPIError(418, "teapot");
    expect(apiError.statusCode).toBe(418);
    expect(apiError.message).toBe("API Error (418): teapot");
  });
});
