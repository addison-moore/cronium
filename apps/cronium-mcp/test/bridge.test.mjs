/**
 * Round-trip tests for the stdio ↔ HTTP bridge (dist/index.js): spawn the real
 * binary against a local mock /api/mcp endpoint and assert the newline-
 * delimited JSON-RPC behavior an MCP client observes — request forwarding,
 * notification (202) silence, HTTP-failure → JSON-RPC error mapping, and
 * parse-error handling. Zero test dependencies (node:test).
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

/** Minimal stateless /api/mcp stand-in mirroring the app route's contract. */
let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization ?? "";
      const probeOnly =
        auth === `Bearer ${EXPIRING_TOKEN}` && body.includes('"ping"');
      if (auth !== `Bearer ${GOOD_TOKEN}` && !probeOnly) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const msg = JSON.parse(body);
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
  assert.match(res.error.message, /CRONIUM_API_TOKEN/);
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
