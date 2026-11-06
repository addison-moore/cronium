/**
 * The bridge against Cronium's answer when it can't check a token, usually because Postgres
 * is down: a 503 with a JSON-RPC error, which isn't a verdict on the token. The bridge has to
 * stay up through it, tell the client, and work again once the database is back.
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

// In the bytes the app sends, from apps/cronium-app/src/app/api/mcp/route.ts.
const COULD_NOT_CHECK = JSON.stringify({
  jsonrpc: "2.0",
  id: null,
  error: {
    code: -32603,
    message:
      "Cronium couldn't check these credentials, usually because it can't reach its database. They may be fine, so keep them and try again shortly.",
  },
});

let server;
let baseUrl;
let databaseUp = false;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!databaseUp) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(COULD_NOT_CHECK);
        return;
      }
      const { id } = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("stays up through a 503, passes it on, and works once the database is back", async () => {
  const bridge = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      CRONIUM_BASE_URL: baseUrl,
      CRONIUM_API_TOKEN: "good-token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let exited = false;
  bridge.on("exit", () => (exited = true));
  bridge.stderr.resume();

  let buffered = "";
  const answers = new Map();
  const waiting = new Map();
  bridge.stdout.setEncoding("utf8");
  bridge.stdout.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const message = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      answers.set(message.id, message);
      waiting.get(message.id)?.(message);
    }
  });
  const ask = (id) => {
    bridge.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })}\n`,
    );
    return answers.has(id)
      ? Promise.resolve(answers.get(id))
      : new Promise((resolve) => waiting.set(id, resolve));
  };

  try {
    const during = await ask(1);
    assert.equal(during.error.code, -32001);
    assert.match(during.error.message, /HTTP 503/);
    assert.match(during.error.message, /couldn't check these credentials/);
    assert.doesNotMatch(during.error.message, /rejected the API token/);

    // Long enough for the startup probe's answer to have ended the process, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(exited, false);

    databaseUp = true;
    assert.deepEqual(await ask(2), { jsonrpc: "2.0", id: 2, result: {} });
  } finally {
    bridge.kill();
  }
});
