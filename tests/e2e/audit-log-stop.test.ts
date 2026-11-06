/**
 * Stopping a real Next server, from the build this suite already made. Every
 * credential change is logged in this process, and Next exits within milliseconds of
 * SIGTERM. Whether its last entries survive depends on how Next exits, which it
 * doesn't document, so this is what catches an upgrade changing that.
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { hangableDatabase } from "../hangable-database";
import { pool, seedPrincipal } from "./helpers";

const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");

interface Launch {
  args: string[];
  cwd: string;
}

const LAUNCHES: Array<[string, (port: number) => Launch]> = [
  [
    "next start",
    (port) => ({
      args: [
        path.join(APP_DIR, "node_modules/next/dist/bin/next"),
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      cwd: APP_DIR,
    }),
  ],
  [
    "the standalone server the image runs",
    () => ({
      args: ["server.js"],
      cwd: path.join(APP_DIR, ".next/standalone/apps/cronium-app"),
    }),
  ],
];

const STANDALONE = LAUNCHES[1]![1];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

let server: ChildProcess | null = null;
let output = "";

async function startServer(
  launch: (port: number) => Launch,
  databaseUrl = process.env.DATABASE_URL!,
) {
  const port = await freePort();
  const { args, cwd } = launch(port);
  output = "";
  server = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  server.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const up = await fetch(`${url}/api/health`).catch(() => null);
    if (up) return url;
    if (Date.now() > deadline) {
      throw new Error(`The server didn't start. Its output:\n${output}`);
    }
    await sleep(100);
  }
}

/** Sends SIGTERM and says how it went, or fails after `withinMs`. */
function stopServer(withinMs: number) {
  const started = Date.now();
  return new Promise<{ code: number | null; tookMs: number }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `The server hadn't exited ${withinMs}ms after SIGTERM. Its output:\n${output.slice(-4000)}`,
          ),
        );
      }, withinMs);
      server!.once("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, tookMs: Date.now() - started });
      });
      server!.kill("SIGTERM");
    },
  );
}

async function createCredential(url: string, token: string, name: string) {
  const res = await fetch(`${url}/api/trpc/tools.create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      json: {
        name,
        type: "SQL",
        credentials: {
          dialect: "postgres",
          host: "127.0.0.1",
          database: "unused",
          user: "unused",
          password: "unused",
          ssl: "disable",
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `tools.create answered ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
  }
}

const auditRows = async (userId: string) =>
  (
    await pool.query<{ action: string }>(
      `SELECT action FROM tool_audit_logs WHERE user_id = $1 ORDER BY id`,
      [userId],
    )
  ).rows;

afterEach(() => {
  server?.kill("SIGKILL");
  server = null;
});

afterAll(async () => {
  await pool.end();
});

describe("a Next server being stopped", () => {
  it.each(LAUNCHES)(
    "writes the entries of what it just did, once each: %s",
    async (_name, launch) => {
      const { userId, token } = await seedPrincipal();
      const url = await startServer(launch);
      await createCredential(url, token, "first");
      await createCredential(url, token, "second");

      const { code } = await stopServer(30_000);

      expect(code).toBe(143);
      expect(await auditRows(userId)).toEqual([
        { action: "credential.create" },
        { action: "credential.create" },
      ]);
      expect(output).not.toContain("DROPPED");
    },
  );

  it("still exits on a database that has hung, with its entries in the server log", async () => {
    const { userId, token } = await seedPrincipal();
    const database = await hangableDatabase(process.env.DATABASE_URL!);
    try {
      const url = await startServer(STANDALONE, database.url);
      await createCredential(url, token, "first");

      database.hang();
      // A request that can't finish, which Next would wait for with no limit.
      void fetch(`${url}/api/trpc/tools.getAll`, {
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      await sleep(300);

      const { code, tookMs } = await stopServer(30_000);

      expect(code).toBe(143);
      expect(tookMs).toBeLessThan(20_000);
      const dropped = output
        .split("\n")
        .filter(
          (line) =>
            line.includes("DROPPED a credential.create entry") &&
            line.includes(userId),
        );
      // Both, for a write that was under way when the database hung.
      expect(
        (await auditRows(userId)).length + dropped.length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      database.close();
    }
  });
});
