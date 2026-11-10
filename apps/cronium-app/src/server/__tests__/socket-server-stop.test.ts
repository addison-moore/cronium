/**
 * @jest-environment node
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Manager } from "socket.io-client";
import { VALKEY_ANSWER_MS } from "../../lib/valkey-answer-limit";
import { SHUTDOWN_TIMEOUT_MS } from "../socket-server-shutdown";

/**
 * Stops the bundle the image runs, as a real process, because what kept it running
 * was in modules it only imports. Valkey is faked so that it can stop answering on
 * demand. To a client that looks the same as a paused server: the connection stays
 * up and no reply comes.
 */

// jest.setTimeout, because the build and the time limit outlast the 5 second default.
jest.setTimeout(30_000);

const APP_DIR = path.resolve(__dirname, "../../..");
const BUNDLE = "dist/socket-server-stop-test.cjs";

/** Allows for a slow machine, and stays well inside Docker's 10 seconds. */
const STOPPED_WITHIN_MS = SHUTDOWN_TIMEOUT_MS + 3_000;
const OUT_OF_TIME = "exiting anyway";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** RESP arrays, which is all a client sends. Keeps whatever hasn't fully arrived. */
function parseCommands(input: string): { commands: string[][]; rest: string } {
  const lines = input.split("\r\n");
  const commands: string[][] = [];
  let position = 0;
  while (lines[position]?.startsWith("*")) {
    const count = Number(lines[position]?.slice(1));
    const next = position + 1 + count * 2;
    if (next >= lines.length) break;
    commands.push(
      Array.from(
        { length: count },
        (_, index) => lines[position + 2 + index * 2] ?? "",
      ),
    );
    position = next;
  }
  return { commands, rest: lines.slice(position).join("\r\n") };
}

const bulk = (value: string) => `$${value.length}\r\n${value}\r\n`;

function reply([name = "", channel = ""]: string[]): string {
  switch (name.toUpperCase()) {
    case "INFO":
      return bulk("loading:0\r\n");
    case "PING":
      return "+PONG\r\n";
    case "SUBSCRIBE":
      return `*3\r\n${bulk("subscribe")}${bulk(channel)}:1\r\n`;
    case "UNSUBSCRIBE":
      return `*3\r\n${bulk("unsubscribe")}${bulk(channel)}:0\r\n`;
    default:
      return "+OK\r\n";
  }
}

class FakeValkey {
  answering = true;
  connections = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly server = net.createServer((socket) => {
    this.connections += 1;
    this.sockets.add(socket);
    let pending = "";
    socket.on("error", () => undefined);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("data", (chunk) => {
      const { commands, rest } = parseCommands(pending + chunk.toString());
      pending = rest;
      if (this.answering) socket.write(commands.map(reply).join(""));
    });
  });

  async start(): Promise<number> {
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    return (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const accepting = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

let valkey: FakeValkey;
let valkeyPort: number;
let server: ChildProcess | null = null;
let serverPort: number;
let output = "";
let exited: Promise<{ code: number | null; signal: string | null }>;
const clients: net.Socket[] = [];
let browser: Manager | null = null;

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}. Output:\n${output}`);
    }
    await sleep(10);
  }
}

async function launch(): Promise<void> {
  serverPort = await freePort();
  output = "";
  const child = spawn(process.execPath, [BUNDLE], {
    cwd: APP_DIR,
    env: {
      NODE_ENV: "production",
      SOCKET_PORT: String(serverPort),
      VALKEY_URL: `redis://127.0.0.1:${valkeyPort}`,
      AUTH_URL: "http://localhost:3000",
      PUBLIC_APP_URL: "http://localhost:3000",
      AUTH_SECRET: "a".repeat(32),
      ENCRYPTION_KEY: "a".repeat(64),
      // Never connected to: the pool waits for a query, and nothing here sends one.
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server = child;
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  exited = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function launchAndWaitUntilListening(): Promise<void> {
  await launch();
  await waitFor("the server to listen", () =>
    output.includes("listening on port"),
  );
}

/** How the process ended and how long that took from now. */
async function stop(signal: NodeJS.Signals) {
  const startedAt = Date.now();
  server?.kill(signal);
  const result = await exited;
  return { ...result, tookMs: Date.now() - startedAt };
}

beforeAll(() => {
  execFileSync("pnpm", ["run", "build:socket", `--outfile=${BUNDLE}`], {
    cwd: APP_DIR,
    stdio: "pipe",
  });
});

afterAll(() => {
  fs.rmSync(path.join(APP_DIR, BUNDLE), { force: true });
});

beforeEach(async () => {
  valkey = new FakeValkey();
  valkeyPort = await valkey.start();
});

afterEach(async () => {
  if (server) {
    server.kill("SIGKILL");
    await exited;
    server = null;
  }
  for (const client of clients.splice(0)) client.destroy();
  browser?.engine.close();
  browser = null;
  await valkey.stop();
});

describe("stopping the socket server", () => {
  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ] as const)(
    "exits after one %s with the status that signal gives, once everything closes",
    async (signal, status) => {
      await launchAndWaitUntilListening();

      const { code, tookMs } = await stop(signal);

      expect(code).toBe(status);
      expect(output).not.toContain(OUT_OF_TIME);
      expect(tookMs).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    },
  );

  it.each([["websocket"], ["polling"]])(
    "exits without running out of time when a browser is connected over %s",
    async (transport) => {
      await launchAndWaitUntilListening();
      // A connection with no namespace, because joining one takes a real user. It
      // stays open and closes the same way.
      const connection = new Manager(`http://127.0.0.1:${serverPort}`, {
        path: "/api/socketio",
        transports: [transport],
        extraHeaders: { origin: "http://localhost:3000" },
        reconnection: false,
        autoConnect: false,
      });
      browser = connection;
      await new Promise<void>((resolve, reject) => {
        connection.open((error) => (error ? reject(error) : resolve()));
      });
      await sleep(100);
      expect(connection.engine.readyState).toBe("open");

      const { code, tookMs } = await stop("SIGTERM");

      expect(code).toBe(143);
      expect(output).not.toContain(OUT_OF_TIME);
      expect(tookMs).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    },
  );

  it("closes its port at once and exits in time when Valkey stops answering", async () => {
    await launchAndWaitUntilListening();
    valkey.answering = false;

    const startedAt = Date.now();
    const stopping = stop("SIGTERM");

    // This used to wait on Valkey first, and went on taking connections meanwhile.
    await waitFor(
      "the port to close",
      async () => !(await accepting(serverPort)),
    );
    expect(Date.now() - startedAt).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(server?.exitCode).toBeNull();

    const { code, tookMs } = await stopping;

    expect(code).toBe(143);
    // The wait on Valkey now ends by itself: UNSUBSCRIBE gives up after
    // VALKEY_ANSWER_MS, before the time limit this used to run out.
    expect(output).not.toContain(OUT_OF_TIME);
    expect(tookMs).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(tookMs).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  });

  it("exits in time when a client never finishes its request", async () => {
    await launchAndWaitUntilListening();
    const client = net.connect(serverPort, "127.0.0.1");
    clients.push(client);
    client.on("error", () => undefined);
    client.write("GET /health HTTP/1.1\r\nHost: localhost\r\n");
    await new Promise((resolve) => client.once("connect", resolve));
    await sleep(100);

    const { code, tookMs } = await stop("SIGTERM");

    expect(code).toBe(143);
    expect(output).toContain(OUT_OF_TIME);
    expect(tookMs).toBeLessThan(STOPPED_WITHIN_MS);
  });

  it.each([
    // The same signal again finds no listener. This is what start.sh sends when Next
    // exits first, and what a second Ctrl-C sends.
    ["SIGTERM", "SIGTERM", null, "SIGTERM"],
    ["SIGINT", "SIGINT", null, "SIGINT"],
    // The other signal still has its listener, which has to end the process too.
    ["SIGTERM", "SIGINT", 130, null],
    ["SIGINT", "SIGTERM", 143, null],
  ] as const)(
    "ends at once on %s followed by %s, without waiting for Valkey",
    async (first, second, status, killedBy) => {
      await launchAndWaitUntilListening();
      valkey.answering = false;

      server?.kill(first);
      await waitFor("the first signal to land", () =>
        output.includes("cleaned up"),
      );
      const { code, signal, tookMs } = await stop(second);

      expect(code).toBe(status);
      expect(signal).toBe(killedBy);
      expect(output).not.toContain(OUT_OF_TIME);
      expect(tookMs).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    },
  );

  it("reports a stop during startup as a stop, not a failed preflight", async () => {
    // The store gives up on a connection Valkey doesn't answer after VALKEY_ANSWER_MS,
    // so the preflight fails while the stop waits on it, inside the time limit.
    valkey.answering = false;
    await launch();
    await waitFor("the server to reach Valkey", () => valkey.connections > 0);
    await sleep(VALKEY_ANSWER_MS / 2);

    const { code } = await stop("SIGTERM");

    expect(code).toBe(143);
    expect(output).not.toContain("failed security preflight");
    expect(output).not.toContain(OUT_OF_TIME);
  });
});
