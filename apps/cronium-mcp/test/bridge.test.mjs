/**
 * Round-trip tests for the stdio ↔ HTTP bridge (dist/index.js): spawn the real
 * binary against a local mock /api/mcp endpoint and assert the newline-
 * delimited JSON-RPC behavior an MCP client observes — request forwarding,
 * notification (202) silence, HTTP-failure → JSON-RPC error mapping, answers
 * that aren't Cronium's, requests with no whole answer, and parse-error
 * handling. Zero test dependencies (node:test).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const SHORT_TIMEOUT = path.join(here, "short-timeout.cjs");
const FAILING_FETCH = path.join(here, "failing-fetch.cjs");

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

/** Two more that need tests of their own. */
const OTHER_ANSWERS = {
  gateway_401: {
    status: 401,
    type: "application/json; charset=utf-8",
    body: '{\n  "message":"No API key found in request",\n  "request_id":"1f0beb32429e5a1dba54bc0292d51a01"\n}',
  },
  long_page_200: { status: 200, type: "text/html", body: "x".repeat(1000) },
};

/** Sends part of an answer, then does `end` to the connection once that's had time to arrive. */
const partOfAnAnswer =
  (status, end, headers = {}) =>
  (res) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.write('{"jsonrpc":"2.0","id":1,"resu', () => {
      setTimeout(() => end(res.socket), 100);
    });
  };
const close = (socket) => socket.destroy();
const reset = (socket) => socket.resetAndDestroy();
const held = () => {};

/**
 * Connections that give no whole answer, once the whole request has come in. Using one of these
 * names as the API token gets that to everything, the startup ping included.
 */
const NO_WHOLE_ANSWER = {
  // No answer at all.
  closed: (res) => close(res.socket),
  reset: (res) => reset(res.socket),
  not_http: (res) => res.socket.end("SSH-2.0-OpenSSH_9.6\r\n"),
  no_answer_in_time: held,
  // Headers, and then not all of the body.
  cut_by_length: partOfAnAnswer(200, close, { "content-length": 100 }),
  cut_chunked: partOfAnAnswer(200, close),
  cut_then_reset: partOfAnAnswer(200, reset, { "content-length": 100 }),
  cut_502: partOfAnAnswer(502, close, { "content-length": 100 }),
  cut_403: partOfAnAnswer(403, close, { "content-length": 100 }),
  cut_401: partOfAnAnswer(401, close, { "content-length": 100 }),
  cut_302: partOfAnAnswer(302, close, { "content-length": 100 }),
  corrupt_gzip_200: (res) => {
    res.writeHead(200, {
      "content-encoding": "gzip",
      "content-type": "text/plain",
    });
    res.end("this was never gzip");
  },
  bad_chunk_200: (res) => {
    res.socket.write(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\nhello\r\n",
    );
  },
  rest_not_in_time: partOfAnAnswer(200, held),
};

/**
 * Causes that mean nothing was sent, as fetch really reported them, on Node 18, 22 and 24 on macOS
 * and Linux. Node 22 and 24 report a name with several addresses as a list of attempts.
 */
const NEVER_SENT = {
  "a refused connection": {
    code: "ECONNREFUSED",
    syscall: "connect",
    message: "connect ECONNREFUSED 127.0.0.1:1",
  },
  "a refused connection to a name with two addresses": {
    code: "ECONNREFUSED",
    message: "",
    errors: [
      {
        code: "ECONNREFUSED",
        syscall: "connect",
        message: "connect ECONNREFUSED ::1:1",
      },
      {
        code: "ECONNREFUSED",
        syscall: "connect",
        message: "connect ECONNREFUSED 127.0.0.1:1",
      },
    ],
  },
  "a name that doesn't exist": { code: "ENOTFOUND", syscall: "getaddrinfo" },
  "a lookup with no network": { code: "EAI_AGAIN", syscall: "getaddrinfo" },
  "no route, on Linux": { code: "ENETUNREACH", syscall: "connect" },
  "no route, on macOS": { code: "EHOSTUNREACH", syscall: "connect" },
  "an address that can't be used": { code: "EAFNOSUPPORT", syscall: "connect" },
  "a connection the system gave up on": {
    code: "ETIMEDOUT",
    syscall: "connect",
  },
  "a connection the system gave up on, to a name with two addresses": {
    code: "ETIMEDOUT",
    message: "",
    errors: [
      { code: "ETIMEDOUT", syscall: "connect" },
      { code: "ETIMEDOUT", syscall: "connect" },
    ],
  },
  "undici's limit on connecting": {
    code: "UND_ERR_CONNECT_TIMEOUT",
    message:
      "Connect Timeout Error (attempted address: 240.0.0.1:81, timeout: 10000ms)",
  },
  "a self-signed certificate": { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
  "a self-signed root in the chain": { code: "SELF_SIGNED_CERT_IN_CHAIN" },
  "a missing issuer": { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" },
  "a private CA nothing trusts": { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
  "an expired certificate": { code: "CERT_HAS_EXPIRED" },
  "a certificate not valid yet": { code: "CERT_NOT_YET_VALID" },
  "a certificate for another name": { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
  "a port that doesn't speak TLS": { code: "ERR_SSL_WRONG_VERSION_NUMBER" },
  "an address that doesn't parse": {
    code: "ERR_INVALID_URL",
    message: "Invalid URL",
  },
};

/** Causes from a connection already made, as measured too, and ones nothing knows about yet. */
const MAY_HAVE_BEEN_SENT = {
  "the other side closing": {
    code: "UND_ERR_SOCKET",
    message: "other side closed",
  },
  "a reset while reading": { code: "ECONNRESET", syscall: "read" },
  "a reset while writing": { code: "ECONNRESET", syscall: "write" },
  "a broken pipe": { code: "EPIPE", syscall: "write" },
  "a connection the system gave up on after it was made": {
    code: "ETIMEDOUT",
    syscall: "read",
    message: "read ETIMEDOUT",
  },
  "an answer that isn't HTTP, on Node 18 and 22": {
    code: "HPE_INVALID_CONSTANT",
  },
  "an answer that isn't HTTP, on Node 24": {
    message: "Response does not match the HTTP/1.1 protocol",
  },
  "a TLS connection closed during the handshake, which can't be told apart": {
    code: "ECONNRESET",
    message:
      "Client network socket disconnected before secure TLS connection was established",
  },
  "a code nothing knows about": {
    code: "E_SOMETHING_NEW",
    syscall: "somethingnew",
  },
  "attempts that aren't all failures to connect": {
    code: "E_SOMETHING_NEW",
    errors: [
      { code: "ECONNREFUSED", syscall: "connect" },
      { code: "E_SOMETHING_NEW", syscall: "read" },
    ],
  },
};

const GONE_THROUGH =
  ", so this call may still have gone through: check before repeating it. ";

const CLOSED = "The connection to Cronium closed with no answer";
const CLOSED_CAUSES =
  "Cronium may be restarting, a reverse proxy in front of it can't reach it, or CRONIUM_BASE_URL may be wrong.";

const IN_TIME = "Got no answer from Cronium in 120 seconds";
const IN_TIME_CAUSES =
  "Cronium may still be working on it, or a reverse proxy in front of it may be holding it up.";

const cutOff = (status) => `Got HTTP ${status}, but not the whole answer`;
const CUT_OFF_CAUSES =
  "Cronium may be restarting, or a reverse proxy in front of it can't reach it.";

const couldNotReach = (base, reason = "fetch failed") =>
  `Could not reach Cronium at ${base}/api/mcp: ${reason}. Check CRONIUM_BASE_URL and that the instance is running.`;

const TOKEN_REJECTED =
  "Cronium rejected the API token (HTTP 401). Check CRONIUM_API_TOKEN — " +
  "create a token with the MCP scope under Settings → API Tokens (tokens expire).";

/** Minimal stateless /api/mcp stand-in mirroring the app route's contract. */
let server;
let baseUrl;
// How many requests a followed redirect brought back. Should stay at 0.
let followed = 0;
// A port with nothing listening on it.
let closedPort;

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
      if (NO_WHOLE_ANSWER[token]) {
        NO_WHOLE_ANSWER[token](res);
        return;
      }
      const canned =
        NOT_CRONIUM[token] ?? REDIRECTS[token] ?? OTHER_ANSWERS[token];
      if (canned) {
        const headers = {};
        if (canned.type) headers["content-type"] = canned.type;
        if (canned.location) headers.location = canned.location;
        res.writeHead(canned.status, headers);
        res.end(canned.body);
        return;
      }
      const probeOnly =
        auth === `Bearer ${EXPIRING_TOKEN}` && body.includes('"ping"');
      if (auth !== `Bearer ${GOOD_TOKEN}` && !probeOnly) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const msg = JSON.parse(body);
      // A call that gets no answer, among others that do.
      if (msg.params?.name === "dropped") {
        close(res.socket);
        return;
      }
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

  const closed = createTcpServer();
  closed.listen(0, "127.0.0.1");
  await once(closed, "listening");
  closedPort = closed.address().port;
  closed.close();
  await once(closed, "close");
});

after(() => server.close());

/**
 * Spawn the bridge, write `lines` to stdin, and collect stdout lines until
 * `expected` responses arrived (or a timeout).
 */
function runBridge(
  lines,
  { token = GOOD_TOKEN, expected = 1, base = baseUrl, preload, env = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      preload ? ["--require", preload, DIST] : [DIST],
      {
        env: {
          ...process.env,
          CRONIUM_BASE_URL: base,
          CRONIUM_API_TOKEN: token,
          ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
 * Spawn the bridge, write `lines` to stdin, and collect what it logs until `until` matches, it
 * exits, or a timeout. Resolves with the log, the exit code if there was one, and stdout, a moment
 * after the log line, for anything written after it.
 */
function bridgeLog(token, until, { lines = [], preload, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      preload ? ["--require", preload, DIST] : [DIST],
      {
        env: {
          ...process.env,
          CRONIUM_BASE_URL: baseUrl,
          CRONIUM_API_TOKEN: token,
          ...env,
        },
      },
    );
    let log = "";
    let stdout = "";
    let matched = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; log was ${log}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      log += chunk.toString();
      if (!matched && until.test(log)) {
        matched = true;
        clearTimeout(timer);
        setTimeout(() => {
          child.kill();
          resolve({ log, code: null, stdout });
        }, 50);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ log, code, stdout });
    });
    for (const line of lines) {
      child.stdin.write(`${JSON.stringify(line)}\n`);
    }
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

test("keeps the 401 message for a gateway's 401 too, and exits at startup as it did", async () => {
  const { log, code } = await bridgeLog("gateway_401", /no-such-line/);
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
  assert.match(stderr, /CRONIUM_API_TOKEN/);
});

test("keeps the words for a refused connection, for a tool call and a read alike", async () => {
  const base = `http://127.0.0.1:${closedPort}`;
  const out = await runBridge([call("c"), read("r")], { base, expected: 2 });
  assert.equal(out.length, 2);
  for (const res of out) {
    assert.equal(res.error.code, -32001);
    assert.equal(res.error.message, couldNotReach(base));
  }
});

test("keeps the words for a refused connection to a name with several addresses", async () => {
  const base = `http://localhost:${closedPort}`;
  const [res] = await runBridge([call(1)], { base });
  assert.equal(res.error.message, couldNotReach(base));
});

test("keeps the words for a name that can't be looked up", async () => {
  const base = "http://no-such-host.invalid";
  const [res] = await runBridge([call(1)], { base });
  assert.equal(res.error.message, couldNotReach(base));
});

test("keeps the words for https:// to a port that speaks http", async () => {
  const base = baseUrl.replace("http:", "https:");
  const [res] = await runBridge([call(1)], { base });
  assert.equal(res.error.message, couldNotReach(base));
});

test("keeps the words for an address fetch can't use", async () => {
  const cases = {
    "localhost:5001": "fetch failed",
    "ftp://127.0.0.1": "fetch failed",
    "http://127.0.0.1:6000": "fetch failed",
    "cronium.example.invalid":
      "Failed to parse URL from cronium.example.invalid/api/mcp",
    "http://127.0.0.1:99999":
      "Failed to parse URL from http://127.0.0.1:99999/api/mcp",
  };
  for (const [base, reason] of Object.entries(cases)) {
    const [res] = await runBridge([call(1)], { base });
    assert.equal(res.error.message, couldNotReach(base, reason));
  }
});

test("says it couldn't reach Cronium with a token that can't be sent", async () => {
  const [res] = await runBridge([call(1)], { token: "a\nb" });
  assert.match(res.error.message, /^Could not reach Cronium at /);
  assert.doesNotMatch(res.error.message, /gone through/);
});

for (const [name, cause] of Object.entries(NEVER_SENT)) {
  test(`keeps the words for ${name}`, async () => {
    const [res] = await runBridge([call(1)], {
      preload: FAILING_FETCH,
      env: { FETCH_FAILURE_CAUSE: JSON.stringify(cause) },
    });
    assert.equal(res.error.message, couldNotReach(baseUrl));
  });
}

for (const [name, cause] of Object.entries(MAY_HAVE_BEEN_SENT)) {
  test(`doesn't say it couldn't reach Cronium for ${name}`, async () => {
    const [res] = await runBridge([call(1)], {
      preload: FAILING_FETCH,
      env: { FETCH_FAILURE_CAUSE: JSON.stringify(cause) },
    });
    assert.equal(res.error.message, `${CLOSED}${GONE_THROUGH}${CLOSED_CAUSES}`);
  });
}

for (const token of ["closed", "reset", "not_http"]) {
  test(`says a tool call may have gone through when it gets ${token}, under the right id`, async () => {
    const [res] = await runBridge([call("the id")], { token });
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, "the id");
    assert.equal(res.error.code, -32001);
    assert.equal(res.error.message, `${CLOSED}${GONE_THROUGH}${CLOSED_CAUSES}`);
  });

  test(`gives a read that gets ${token} what happened, and nothing about going through`, async () => {
    const [res] = await runBridge([read("the id")], { token });
    assert.equal(res.id, "the id");
    assert.equal(res.error.message, `${CLOSED}. ${CLOSED_CAUSES}`);
  });
}

test("says a tool call may have gone through at the bridge's own time limit", async () => {
  const [res] = await runBridge([call("the id")], {
    token: "no_answer_in_time",
    preload: SHORT_TIMEOUT,
  });
  assert.equal(res.id, "the id");
  assert.equal(res.error.code, -32001);
  assert.equal(res.error.message, `${IN_TIME}${GONE_THROUGH}${IN_TIME_CAUSES}`);
});

test("gives a read at the bridge's own time limit what happened, and nothing about going through", async () => {
  const [res] = await runBridge([read(1)], {
    token: "no_answer_in_time",
    preload: SHORT_TIMEOUT,
  });
  assert.equal(res.error.message, `${IN_TIME}. ${IN_TIME_CAUSES}`);
});

for (const token of [
  "cut_by_length",
  "cut_chunked",
  "cut_then_reset",
  "corrupt_gzip_200",
  "bad_chunk_200",
]) {
  test(`says a tool call may have gone through when ${token} cuts the answer off`, async () => {
    const [res] = await runBridge([call("the id")], { token });
    assert.equal(res.id, "the id");
    assert.equal(res.error.code, -32001);
    assert.equal(
      res.error.message,
      `${cutOff(200)}${GONE_THROUGH}${CUT_OFF_CAUSES}`,
    );
  });
}

test("says a tool call may have gone through when the rest of the answer doesn't come in time", async () => {
  const [res] = await runBridge([call(1)], {
    token: "rest_not_in_time",
    preload: SHORT_TIMEOUT,
  });
  assert.equal(
    res.error.message,
    `${cutOff(200)}${GONE_THROUGH}${CUT_OFF_CAUSES}`,
  );
});

test("says the answer was cut off at a 5xx, which may have gone through as well", async () => {
  const [res] = await runBridge([call(1)], { token: "cut_502" });
  assert.equal(
    res.error.message,
    `${cutOff(502)}${GONE_THROUGH}${CUT_OFF_CAUSES}`,
  );
});

test("leaves going through out of a refusal that was cut off", async () => {
  for (const [token, status] of [
    ["cut_302", 302],
    ["cut_401", 401],
    ["cut_403", 403],
  ]) {
    const [res] = await runBridge([call(1)], { token });
    assert.equal(res.error.message, `${cutOff(status)}. ${CUT_OFF_CAUSES}`);
  }
});

test("gives a read that was cut off what happened, and nothing about going through", async () => {
  const [res] = await runBridge([read(1)], { token: "cut_by_length" });
  assert.equal(res.error.message, `${cutOff(200)}. ${CUT_OFF_CAUSES}`);
});

test("answers each id of a batch that gets no answer, with what a tool call in it needs", async () => {
  const out = await runBridge([[read("r"), call("c")]], {
    token: "closed",
    expected: 2,
  });
  assert.deepEqual(
    out.map((m) => m.id),
    ["r", "c"],
  );
  for (const res of out) {
    assert.equal(res.error.message, `${CLOSED}${GONE_THROUGH}${CLOSED_CAUSES}`);
  }
});

test("leaves going through out of a batch of reads that gets no answer", async () => {
  const out = await runBridge([[read("x"), read("y")]], {
    token: "closed",
    expected: 2,
  });
  for (const res of out) {
    assert.equal(res.error.message, `${CLOSED}. ${CLOSED_CAUSES}`);
  }
});

test("goes on answering after a call that got no answer", async () => {
  const out = await runBridge(
    [
      {
        jsonrpc: "2.0",
        id: "dropped",
        method: "tools/call",
        params: { name: "dropped" },
      },
      { jsonrpc: "2.0", id: "next", method: "ping" },
    ],
    { expected: 2 },
  );
  const byId = new Map(out.map((m) => [m.id, m]));
  assert.equal(
    byId.get("dropped").error.message,
    `${CLOSED}${GONE_THROUGH}${CLOSED_CAUSES}`,
  );
  assert.deepEqual(byId.get("next").result, {});
});

test("writes nothing to stdout for a notification that got no answer", async () => {
  const { stdout, log } = await bridgeLog("closed", /closed with no answer\./, {
    lines: [{ jsonrpc: "2.0", method: "notifications/initialized" }],
  });
  assert.equal(stdout, "");
  assert.match(
    log,
    /cronium-mcp: The connection to Cronium closed with no answer\. /,
  );
});

test("logs Node's reason, which only the log gets, on one line", async () => {
  const { log, stdout } = await bridgeLog("closed", /the cause was/, {
    lines: [read(1)],
  });
  const lines = log.split("\n");
  assert.ok(
    lines.includes(
      "cronium-mcp: the cause was UND_ERR_SOCKET: other side closed",
    ),
    log,
  );
  assert.doesNotMatch(stdout, /UND_ERR_SOCKET|other side closed/);
});

test("logs Node's reason when nothing was sent as well", async () => {
  const cases = [
    [
      NEVER_SENT["a refused connection"],
      "ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1",
    ],
    [
      NEVER_SENT["a refused connection to a name with two addresses"],
      "ECONNREFUSED",
    ],
    [{ message: "unknown scheme" }, "unknown scheme"],
    [
      { code: "E_MULTI", message: "first line\nsecond line\n" },
      "E_MULTI: first line second line",
    ],
  ];
  for (const [cause, reason] of cases) {
    const { log } = await bridgeLog(GOOD_TOKEN, /the cause was/, {
      lines: [read(1)],
      preload: FAILING_FETCH,
      env: { FETCH_FAILURE_CAUSE: JSON.stringify(cause) },
    });
    assert.ok(
      log.split("\n").includes(`cronium-mcp: the cause was ${reason}`),
      log,
    );
  }
});

test("still only warns at startup when the first ping gets no answer", async () => {
  for (const token of ["closed", "cut_by_length"]) {
    const { log, code } = await bridgeLog(token, /will retry per request/);
    assert.equal(code, null, token);
    assert.match(log, /cronium-mcp: warning — could not reach /, token);
  }
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
