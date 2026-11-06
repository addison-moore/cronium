/**
 * Round-trip tests for the stdio ↔ HTTP bridge (dist/index.js): spawn the real
 * binary against a local mock /api/mcp endpoint and assert the newline-
 * delimited JSON-RPC behavior an MCP client observes — request forwarding,
 * notification (202) silence, HTTP-failure → JSON-RPC error mapping, answers
 * that aren't Cronium's, and parse-error handling. Zero test dependencies
 * (node:test).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.js",
);

const GOOD_TOKEN = "good-token";
// Accepted for the startup probe (ping) but rejected afterwards — simulates a
// token that expires mid-session.
const EXPIRING_TOKEN = "expiring-token";

const nginxPage = (title) =>
  `<html>\r\n<head><title>${title}</title></head>\r\n<body>\r\n` +
  `<center><h1>${title}</h1></center>\r\n` +
  "<hr><center>nginx/1.31.8</center>\r\n</body>\r\n</html>\r\n";

const SIGN_IN_PAGE =
  '<!doctype html><html><head><title>Sign in</title></head><body><h1>Please sign in</h1><form method="post"><input name="user"></form></body></html>';

/**
 * Answers that aren't Cronium's, as real proxies sent them to the real bridge. Using one of
 * these names as the API token gets that answer to everything, the startup ping included.
 */
const NOT_CRONIUM = {
  nginx_502: {
    status: 502,
    type: "text/html",
    body: nginxPage("502 Bad Gateway"),
  },
  nginx_504: {
    status: 504,
    type: "text/html",
    body: nginxPage("504 Gateway Time-out"),
  },
  caddy_502: { status: 502, body: "" },
  traefik_502: { status: 502, body: "Bad Gateway" },
  kong_502: {
    status: 502,
    type: "application/json; charset=utf-8",
    body: '{\n  "message":"An invalid response was received from the upstream server",\n  "request_id":"2351866bb53cab54c194c24360e9756f"\n}',
  },
  kong_200: {
    status: 200,
    type: "application/json; charset=utf-8",
    body: '{"message":"Down for maintenance"}',
  },
  firewall_403: {
    status: 403,
    type: "text/html",
    body: nginxPage("403 Forbidden"),
  },
  firewall_400: {
    status: 400,
    type: "text/html",
    body: nginxPage("400 Bad Request"),
  },
  nginx_404: {
    status: 404,
    type: "text/html",
    body: nginxPage("404 Not Found"),
  },
  nginx_basic_401: {
    status: 401,
    type: "text/html",
    wwwAuthenticate: 'Basic realm="Cronium"',
    body: nginxPage("401 Authorization Required"),
  },
  kong_key_401: {
    status: 401,
    type: "application/json; charset=utf-8",
    wwwAuthenticate: "Key",
    body: '{\n  "message":"No API key found in request",\n  "request_id":"a934917eed2885379300d1444fbf6313"\n}',
  },
  kong_basic_401: {
    status: 401,
    type: "application/json; charset=utf-8",
    wwwAuthenticate: 'Basic realm="service"',
    body: '{\n  "message":"Unauthorized",\n  "request_id":"1b224c0212b8730db4547f1f76195d30"\n}',
  },
  caddy_401: {
    status: 401,
    wwwAuthenticate: 'Basic realm="restricted"',
    body: "",
  },
  traefik_401: {
    status: 401,
    type: "text/plain",
    wwwAuthenticate: 'Basic realm="traefik"',
    body: "401 Unauthorized\n",
  },
  // Not seen from a real product, but near enough to Cronium's own to get wrong.
  plain_error_401: {
    status: 401,
    type: "application/json",
    body: '{"error":"unauthorized"}',
  },
  capital_error_401: {
    status: 401,
    type: "application/json",
    body: '{"error":"Unauthorized: bad key"}',
  },
  object_error_401: {
    status: 401,
    type: "application/json",
    body: '{"error":{"message":"unauthorized: bad key"}}',
  },
  null_401: { status: 401, type: "application/json", body: "null" },
  cronium_words_403: {
    status: 403,
    type: "application/json",
    body: '{"error":"unauthorized: not at this status"}',
  },
  sign_in_200: { status: 200, type: "text/html", body: SIGN_IN_PAGE },
  empty_200: { status: 200, type: "text/plain", body: "" },
  no_content_204: { status: 204 },
  created_201: {
    status: 201,
    type: "text/plain",
    location: "https://elsewhere.example.invalid/1",
    body: "Created",
  },
  queued_202: { status: 202, type: "text/plain", body: "Queued" },
  array_200: {
    status: 200,
    type: "application/json",
    body: '[{"status":"blocked"}]',
  },
  empty_array_200: { status: 200, type: "application/json", body: "[]" },
  null_200: { status: 200, type: "application/json", body: "null" },
  other_version_200: {
    status: 200,
    type: "application/json",
    body: '{"jsonrpc":"1.0","id":1,"result":{}}',
  },
  half_batch_200: {
    status: 200,
    type: "application/json",
    body: '[{"jsonrpc":"2.0","id":1,"result":{}},{"status":"blocked"}]',
  },
};

/** Redirects, which the bridge must report and not follow. */
const REDIRECTS = {
  moved_301: {
    status: 301,
    type: "text/html",
    location: "https://cronium.example.invalid/api/mcp",
    body: nginxPage("301 Moved Permanently"),
  },
  sign_in_302: {
    status: 302,
    type: "text/html",
    location:
      "https://login.example.invalid/authorize?client_id=abc&state=secret",
    body: nginxPage("302 Found"),
  },
  relative_302: {
    status: 302,
    location: "/followed/sign_in?rd=/api/mcp",
    body: nginxPage("302 Found"),
  },
  same_origin_307: {
    status: 307,
    location: "/followed/api/mcp",
    body: "",
  },
  same_origin_308: {
    status: 308,
    location: "/followed/api/mcp",
    body: nginxPage("308 Permanent Redirect"),
  },
  no_location_302: { status: 302, body: nginxPage("302 Found") },
  bad_location_302: {
    status: 302,
    location: "http://[not a url",
    body: nginxPage("302 Found"),
  },
};

/** Others that need tests of their own. */
const OTHER_ANSWERS = {
  // What the route said from when it was written until its OAuth support.
  older_cronium_401: {
    status: 401,
    type: "application/json",
    body: '{"error":"unauthorized: provide a valid Cronium API token as a Bearer token"}',
  },
  long_page_200: { status: 200, type: "text/html", body: "x".repeat(1000) },
};

const TOKEN_REJECTED =
  "Cronium rejected the API token (HTTP 401). Check CRONIUM_API_TOKEN — " +
  "create a token with the MCP scope under Settings → API Tokens (tokens expire).";

/** Minimal stateless /api/mcp stand-in mirroring the app route's contract. */
let server;
let baseUrl;
// How many requests a followed redirect brought back. Should stay at 0.
let followed = 0;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.startsWith("/followed")) {
        followed += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: "followed", result: {} }));
        return;
      }
      const auth = req.headers.authorization ?? "";
      const token = auth.replace("Bearer ", "");
      const canned =
        NOT_CRONIUM[token] ?? REDIRECTS[token] ?? OTHER_ANSWERS[token];
      if (canned) {
        const headers = {};
        if (canned.type) headers["content-type"] = canned.type;
        if (canned.location) headers.location = canned.location;
        if (canned.wwwAuthenticate) {
          headers["www-authenticate"] = canned.wwwAuthenticate;
        }
        res.writeHead(canned.status, headers);
        res.end(canned.body);
        return;
      }
      const probeOnly =
        auth === `Bearer ${EXPIRING_TOKEN}` && body.includes('"ping"');
      if (auth !== `Bearer ${GOOD_TOKEN}` && !probeOnly) {
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="The access token is invalid or expired"`,
        });
        res.end(
          JSON.stringify({
            error:
              "unauthorized: authenticate with an OAuth access token or a Cronium API token",
          }),
        );
        return;
      }
      const msg = JSON.parse(body);
      // A save that a reverse proxy refused, in the bytes real nginx sends.
      if (msg.params?.name === "refused_by_proxy") {
        res.writeHead(413, { "content-type": "text/html" });
        res.end(
          "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n" +
            "<center><h1>413 Request Entity Too Large</h1></center>\r\n" +
            "<hr><center>nginx/1.31.8</center>\r\n</body>\r\n</html>\r\n",
        );
        return;
      }
      // A save that the app's route refused, which has no request id to answer with.
      if (msg.params?.name === "refused_by_cronium") {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "This event is too long to save." },
          }),
        );
        return;
      }
      // Cronium's own answer to a batch past its limit.
      if (Array.isArray(msg) && msg.length > 25) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Batch limit is 25 messages" },
          }),
        );
        return;
      }
      // A tool that failed, which is Cronium's answer at 200 like any other.
      if (msg.params?.name === "tool_with_an_error") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [{ type: "text", text: "Error: no such event" }],
              isError: true,
            },
          }),
        );
        return;
      }
      const messages = Array.isArray(msg) ? msg : [msg];
      const responses = messages
        .filter((m) => m.id !== undefined && m.method)
        .map((m) => {
          if (m.method === "initialize") {
            return {
              jsonrpc: "2.0",
              id: m.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "cronium", version: "test" },
              },
            };
          }
          if (m.method === "tools/list") {
            return {
              jsonrpc: "2.0",
              id: m.id,
              result: { tools: [{ name: "get_capabilities" }] },
            };
          }
          if (m.method === "ping") {
            return { jsonrpc: "2.0", id: m.id, result: {} };
          }
          return {
            jsonrpc: "2.0",
            id: m.id,
            error: { code: -32601, message: `Method not found: ${m.method}` },
          };
        });
      if (responses.length === 0) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(msg) ? responses : responses[0]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/**
 * Spawn the bridge, write `lines` to stdin, and collect stdout lines until
 * `expected` responses arrived (or a timeout).
 */
function runBridge(lines, { token = GOOD_TOKEN, expected = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST], {
      env: {
        ...process.env,
        CRONIUM_BASE_URL: baseUrl,
        CRONIUM_API_TOKEN: token,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    let buffer = "";
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (err) reject(err);
      else resolve(out);
    };
    const timer = setTimeout(
      () => finish(new Error(`timeout; got ${JSON.stringify(out)}`)),
      5000,
    );
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) out.push(JSON.parse(line));
        if (out.length >= expected) finish();
      }
    });
    child.on("error", finish);
    for (const line of lines) {
      child.stdin.write(`${JSON.stringify(line)}\n`);
    }
  });
}

/**
 * Spawn the bridge and collect what it logs until `until` matches, it exits, or a timeout.
 * Resolves with the log and the exit code, if there was one.
 */
function bridgeLog(token, until) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST], {
      env: {
        ...process.env,
        CRONIUM_BASE_URL: baseUrl,
        CRONIUM_API_TOKEN: token,
      },
    });
    let log = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; log was ${log}`));
    }, 5000);
    child.stderr.on("data", (chunk) => {
      log += chunk.toString();
      if (until.test(log)) {
        clearTimeout(timer);
        child.kill();
        resolve({ log, code: null });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ log, code });
    });
  });
}

const read = (id) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const call = (id) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "create_event", arguments: { name: "x", type: "BASH" } },
});

test("forwards initialize and returns the server's response", async () => {
  const [res] = await runBridge([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  ]);
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, "cronium");
  assert.equal(res.result.protocolVersion, "2025-06-18");
});

test("forwards tools/list and multiple concurrent requests", async () => {
  const out = await runBridge(
    [
      { jsonrpc: "2.0", id: "a", method: "tools/list" },
      { jsonrpc: "2.0", id: "b", method: "ping" },
    ],
    { expected: 2 },
  );
  const byId = new Map(out.map((m) => [m.id, m]));
  assert.equal(byId.get("a").result.tools[0].name, "get_capabilities");
  assert.deepEqual(byId.get("b").result, {});
});

test("stays silent for notifications (202 upstream)", async () => {
  // Send a notification followed by a ping; only the ping may produce output.
  const out = await runBridge([
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 9, method: "ping" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 9);
});

test("maps a mid-session 401 (expired token) to a JSON-RPC error naming the env var", async () => {
  const [res] = await runBridge(
    [{ jsonrpc: "2.0", id: 5, method: "tools/list" }],
    { token: EXPIRING_TOKEN },
  );
  assert.equal(res.id, 5);
  assert.equal(res.error.code, -32001);
  assert.equal(res.error.message, TOKEN_REJECTED);
});

test("says a reverse proxy refused a request, under the right id, rather than quote its page", async () => {
  const [res] = await runBridge([
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "refused_by_proxy" },
    },
  ]);
  assert.equal(res.id, 11);
  assert.equal(res.error.code, -32001);
  assert.match(res.error.message, /reverse proxy in front of Cronium/);
  assert.match(res.error.message, /client_max_body_size/);
  assert.doesNotMatch(res.error.message, /<html>/);
});

test("passes on Cronium's own 413 as it did", async () => {
  const [res] = await runBridge([
    {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "refused_by_cronium" },
    },
  ]);
  assert.equal(res.id, 12);
  assert.equal(res.error.code, -32001);
  assert.equal(
    res.error.message,
    'Cronium /api/mcp returned HTTP 413: {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"This event is too long to save."}}',
  );
});

test("passes on Cronium's own 400 as it did, under each id of the batch", async () => {
  const batch = Array.from({ length: 26 }, (_, i) => read(`b${i}`));
  const out = await runBridge([batch], { expected: 26 });
  assert.deepEqual(
    out.map((m) => m.id),
    batch.map((m) => m.id),
  );
  for (const res of out) {
    assert.equal(
      res.error.message,
      'Cronium /api/mcp returned HTTP 400: {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Batch limit is 25 messages"}}',
    );
  }
});

test("passes on Cronium's own JSON-RPC error at 200 untouched", async () => {
  const [res] = await runBridge([{ jsonrpc: "2.0", id: 13, method: "nope" }]);
  assert.deepEqual(res, {
    jsonrpc: "2.0",
    id: 13,
    error: { code: -32601, message: "Method not found: nope" },
  });
});

test("passes on a tool's error at 200 untouched", async () => {
  const [res] = await runBridge([
    {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "tool_with_an_error" },
    },
  ]);
  assert.deepEqual(res, {
    jsonrpc: "2.0",
    id: 14,
    result: {
      content: [{ type: "text", text: "Error: no such event" }],
      isError: true,
    },
  });
});

test("writes each answer to a batch on its own line", async () => {
  const out = await runBridge([[read("x"), read("y")]], { expected: 2 });
  assert.deepEqual(
    out.map((m) => m.id),
    ["x", "y"],
  );
  assert.equal(out[1].result.tools[0].name, "get_capabilities");
});

for (const [token, answer] of Object.entries(NOT_CRONIUM)) {
  test(`says ${token} isn't Cronium's answer, under the right id, without quoting it`, async () => {
    const [res] = await runBridge([read("the id")], { token });
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, "the id");
    assert.equal(res.error.code, -32001);
    assert.ok(
      res.error.message.startsWith(
        `Got HTTP ${answer.status}, not Cronium's answer. `,
      ),
      res.error.message,
    );
    assert.doesNotMatch(res.error.message, /returned|failed/);
    if (answer.body) assert.ok(!res.error.message.includes(answer.body));
    assert.ok(res.error.message.length < 150, res.error.message);
  });
}

test("gives a read the status and causes, and nothing about going through", async () => {
  const [res] = await runBridge([read(1)], { token: "nginx_502" });
  assert.equal(
    res.error.message,
    "Got HTTP 502, not Cronium's answer. Cronium may be restarting, or a reverse proxy in front of it can't reach it.",
  );
});

test("doesn't say a tool call failed at a 5xx, since it may have gone through", async () => {
  const [res] = await runBridge([call(2)], { token: "nginx_504" });
  assert.equal(res.id, 2);
  assert.equal(
    res.error.message,
    "Got HTTP 504, not Cronium's answer, so this call may still have gone through: check before repeating it. Cronium may be restarting, or a reverse proxy in front of it can't reach it.",
  );
});

test("doesn't say a tool call failed at a 200 that isn't Cronium's either", async () => {
  const [res] = await runBridge([call(3)], { token: "sign_in_200" });
  assert.equal(res.id, 3);
  assert.equal(
    res.error.message,
    "Got HTTP 200, not Cronium's answer, so this call may still have gone through: check before repeating it. It may be from a reverse proxy, firewall or sign-in page, or CRONIUM_BASE_URL may be wrong.",
  );
});

test("leaves going through out of a tool call a proxy refused", async () => {
  const [res] = await runBridge([call(4)], { token: "firewall_403" });
  assert.equal(
    res.error.message,
    "Got HTTP 403, not Cronium's answer. It may be from a reverse proxy, firewall or sign-in page, or CRONIUM_BASE_URL may be wrong.",
  );
});

test("answers each id of a batch, with what a tool call in it needs", async () => {
  const out = await runBridge([[read("r"), call("c")]], {
    token: "nginx_502",
    expected: 2,
  });
  assert.deepEqual(
    out.map((m) => m.id),
    ["r", "c"],
  );
  for (const res of out) {
    assert.equal(res.error.code, -32001);
    assert.match(res.error.message, /may still have gone through/);
  }
});

test("writes nothing to stdout for a notification something else answered", async () => {
  // Answered by a read, whose line must be the only one. The 200 is the case that matters:
  // it used to go out as it was, as a line with no id.
  for (const token of ["nginx_502", "kong_200", "null_200"]) {
    const out = await runBridge(
      [{ jsonrpc: "2.0", method: "notifications/initialized" }, read(9)],
      { token },
    );
    assert.equal(out.length, 1, token);
    assert.equal(out[0].id, 9, token);
  }
});

for (const [token, answer] of Object.entries(REDIRECTS)) {
  test(`reports ${token} and doesn't follow it`, async () => {
    const before = followed;
    const [res] = await runBridge([call("r")], { token });
    assert.equal(res.id, "r");
    assert.equal(res.error.code, -32001);
    assert.match(res.error.message, new RegExp(`^Got HTTP ${answer.status}`));
    assert.match(res.error.message, /, not Cronium's answer\. /);
    assert.doesNotMatch(res.error.message, /gone through/);
    assert.doesNotMatch(res.error.message, /state=|client_id|rd=|<html>/);
    assert.equal(followed, before);
  });
}

test("says where a redirect was going, without its query", async () => {
  const cases = {
    moved_301: "Got HTTP 301 to https://cronium.example.invalid/api/mcp,",
    sign_in_302: "Got HTTP 302 to https://login.example.invalid/authorize,",
    relative_302: `Got HTTP 302 to ${baseUrl}/followed/sign_in,`,
    no_location_302: "Got HTTP 302,",
    bad_location_302: "Got HTTP 302,",
  };
  for (const [token, start] of Object.entries(cases)) {
    const [res] = await runBridge([read(1)], { token });
    assert.ok(res.error.message.startsWith(start), res.error.message);
  }
});

test("doesn't blame the token for a gateway's 401, or quit over it at startup", async () => {
  for (const token of [
    "nginx_basic_401",
    "kong_key_401",
    "kong_basic_401",
    "caddy_401",
    "traefik_401",
    "plain_error_401",
  ]) {
    const { log, code } = await bridgeLog(token, /the answer began/);
    assert.equal(code, null, token);
    assert.doesNotMatch(log, /rejected|CRONIUM_API_TOKEN/, token);
    assert.match(
      log,
      /warning — Got HTTP 401, not Cronium's answer\. .* Will retry per request\./,
      token,
    );
  }
});

test("leaves going through out of a tool call a gateway refused with a 401", async () => {
  const [res] = await runBridge([call(5)], { token: "kong_key_401" });
  assert.equal(res.id, 5);
  assert.equal(res.error.code, -32001);
  assert.equal(
    res.error.message,
    "Got HTTP 401, not Cronium's answer. It may be from a reverse proxy, firewall or sign-in page, or CRONIUM_BASE_URL may be wrong.",
  );
});

test("logs what a gateway said in its 401, for whoever reads the log", async () => {
  const { log } = await bridgeLog("kong_key_401", /the answer began/);
  assert.match(log, /the answer began .*No API key found in request/);
});

test("still says Cronium rejected the token, and quits at startup, for an older Cronium's words", async () => {
  const { log, code } = await bridgeLog("older_cronium_401", /no-such-line/);
  assert.equal(code, 1);
  assert.ok(log.includes(`cronium-mcp: ${TOKEN_REJECTED}`), log);
});

test("logs that it connected only when Cronium answered", async () => {
  const { log } = await bridgeLog(GOOD_TOKEN, /connected to/);
  assert.match(log, /cronium-mcp: connected to /);

  for (const token of ["nginx_502", "kong_200", "sign_in_200", "moved_301"]) {
    const { log: other, code } = await bridgeLog(token, /the answer began/);
    assert.equal(code, null, token);
    assert.doesNotMatch(other, /connected to/, token);
    assert.match(
      other,
      /cronium-mcp: warning — Got HTTP \d+.*, not Cronium's answer\. .* Will retry per request\./,
      token,
    );
  }
});

test("doesn't take a redirect at startup for a rejected token", async () => {
  // Followed, this one went to Cronium without the token, and the bridge quit over its 401.
  const { log, code } = await bridgeLog("same_origin_308", /the answer began/);
  assert.equal(code, null);
  assert.doesNotMatch(log, /rejected/);
  assert.equal(followed, 0);
});

test("logs the start of an answer that isn't Cronium's, on one line, for whoever reads the log", async () => {
  const { log } = await bridgeLog("nginx_502", /the answer began/);
  const line = log.split("\n").find((l) => l.includes("the answer began"));
  assert.equal(
    line,
    `cronium-mcp: the answer began ${JSON.stringify(NOT_CRONIUM.nginx_502.body)}`,
  );
});

test("logs at most 300 characters of an answer that isn't Cronium's", async () => {
  const { log } = await bridgeLog("long_page_200", /the answer began/);
  assert.ok(log.includes(`began "${"x".repeat(300)}"`), log);
});

test("fails fast at startup when the token is rejected outright", async () => {
  const child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      CRONIUM_BASE_URL: baseUrl,
      CRONIUM_API_TOKEN: "wrong",
    },
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c.toString()));
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.ok(stderr.includes(`cronium-mcp: ${TOKEN_REJECTED}`), stderr);
});

test("answers unparseable stdin lines with -32700", async () => {
  const res = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST], {
      env: {
        ...process.env,
        CRONIUM_BASE_URL: baseUrl,
        CRONIUM_API_TOKEN: GOOD_TOKEN,
      },
    });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(timer);
        child.kill();
        resolve(JSON.parse(buffer.slice(0, nl)));
      }
    });
    child.stdin.write("this is not json\n");
  });
  assert.equal(res.error.code, -32700);
  assert.equal(res.id, null);
});
