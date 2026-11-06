/**
 * @jest-environment node
 *
 * The real SSH, Postgres, MySQL, MongoDB and SMTP clients, connecting over real sockets to
 * servers on loopback, by names a real name server answers. Only where c-ares sends its
 * queries, and which files it reads, are changed.
 *
 * Each of these clients looks a host up with `dns.lookup` unless it's told otherwise, and
 * how to tell it is different for each, so what matters is that the connection really goes
 * through and really doesn't need libuv's threads. A mock can't show either.
 */
let mockNameServerPort = 0;
let mockResolverOptions: { timeout: number; tries: number } | undefined;
jest.mock("dns/promises", () => {
  const actual =
    jest.requireActual<typeof import("dns/promises")>("dns/promises");
  return {
    ...actual,
    Resolver: class extends actual.Resolver {
      constructor(options?: { timeout?: number; tries?: number }) {
        super(mockResolverOptions ?? options);
        this.setServers([`127.0.0.1:${mockNameServerPort}`]);
      }
    },
  };
});

let mockHostsFile = "";
let mockResolvConf = "";
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (args[0] === "/etc/hosts") return mockHostsFile;
      if (args[0] === "/etc/resolv.conf") return mockResolvConf;
      return actual.readFileSync(...args);
    },
  };
});

// email.ts reads system settings through these, which nothing here gets to.
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("../../env.mjs", () => ({ env: {} }));

import crypto from "crypto";
import fs from "fs";
import mysql from "mysql2";
import net from "net";
import os from "os";
import path from "path";
import { Server as SshServer, utils as sshUtils } from "ssh2";
import type { Connection as SshServerConnection } from "ssh2";
import tls from "tls";
import { buildSmtpTransport } from "../email";
import { SSHService } from "../ssh";
import type { SSHConnectionScope } from "../ssh/pool-key";
import { NEVER, startNameServer } from "./helpers/fake-name-server";
import type { FakeNameServer } from "./helpers/fake-name-server";
import { TEST_TLS_CERT, TEST_TLS_KEY } from "./helpers/test-tls-identity";
import { findDocuments } from "@/tools/plugins/mongodb/client";
import { mysqlDriver } from "@/tools/plugins/sql/drivers/mysql";
import { postgresDriver } from "@/tools/plugins/sql/drivers/postgres";
import type { SqlCredentials } from "@/tools/plugins/sql/schemas";

jest.setTimeout(60_000);

const LOOPBACK = "127.0.0.1";
const KUBERNETES = `search ns.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
`;
const QUICKLY = { timeout: 100, tries: 1 };
const secureContext = tls.createSecureContext({
  key: TEST_TLS_KEY,
  cert: TEST_TLS_CERT,
});

/** A server on a real socket that says how many connections reached it. */
interface TestServer {
  port: number;
  connections: () => number;
  /** How many of them the client hasn't closed yet. */
  open: () => number;
  /** The TLS server name of the latest connection, if it asked for one. */
  serverName?: () => string | false | undefined;
  close: () => Promise<void>;
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  return (server.address() as net.AddressInfo).port;
}

/** A net.Server that destroys what's still open when it closes, so a test can end. */
async function serve(
  onConnection: (socket: net.Socket) => void,
  server: net.Server = net.createServer(),
): Promise<TestServer & { record: (name: string | false) => void }> {
  const open = new Set<net.Socket>();
  let connections = 0;
  let serverName: string | false | undefined;
  server.on(
    server instanceof tls.Server ? "secureConnection" : "connection",
    (socket: net.Socket) => {
      connections += 1;
      open.add(socket);
      socket.on("close", () => open.delete(socket));
      socket.on("error", () => undefined);
      onConnection(socket);
    },
  );
  const port = await listen(server);
  const started = {
    port,
    connections: () => connections,
    open: () => open.size,
    serverName: () => serverName,
    record: (name: string | false) => {
      serverName = name;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
  servers.push(started);
  return started;
}

// ---- SSH ------------------------------------------------------------------

const sshHostKey = sshUtils.generateKeyPairSync("rsa", { bits: 2048 }).private;

async function startSshServer(): Promise<TestServer> {
  let connections = 0;
  const open = new Set<SshServerConnection>();
  const server = new SshServer(
    { hostKeys: [sshHostKey] },
    (client: SshServerConnection) => {
      connections += 1;
      open.add(client);
      client.on("error", () => undefined);
      client.on("close", () => open.delete(client));
      client.on("authentication", (context) => context.accept());
      client.on("ready", () => {
        client.on("session", (acceptSession) => {
          const session = acceptSession();
          session.on("exec", (acceptExec, _reject, info) => {
            const stream = acceptExec();
            stream.write(info.command === "nproc" ? "8\n" : "Linux\n");
            stream.exit(0);
            stream.end();
          });
          session.on("pty", (acceptPty) => acceptPty());
          session.on("shell", (acceptShell) => {
            acceptShell().write("a shell\n");
          });
        });
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const started = {
    port: (server.address() as net.AddressInfo).port,
    connections: () => connections,
    open: () => open.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of open) client.end();
        server.close(() => resolve());
      }),
  };
  servers.push(started);
  return started;
}

// ---- Postgres -------------------------------------------------------------

const int16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
};
const int32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const pgMessage = (type: string, ...body: Buffer[]) => {
  const content = Buffer.concat(body);
  return Buffer.concat([Buffer.from(type), int32(content.length + 4), content]);
};

const PG_READY = pgMessage("Z", Buffer.from("I"));
const PG_VERSION = "PostgreSQL 16.0 fake";
const PG_RESULT = Buffer.concat([
  pgMessage(
    "T",
    int16(1),
    Buffer.from("version\0"),
    int32(0),
    int16(0),
    int32(25),
    int16(-1),
    int32(-1),
    int16(0),
  ),
  pgMessage(
    "D",
    int16(1),
    int32(Buffer.byteLength(PG_VERSION)),
    Buffer.from(PG_VERSION),
  ),
  pgMessage("C", Buffer.from("SELECT 1\0")),
  PG_READY,
]);

/** Enough of the protocol for `SELECT version()`, with or without TLS. */
function speakPostgres(
  socket: net.Socket,
  useTls: boolean,
  record: (name: string | false) => void,
) {
  let started = false;
  let buffered = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (!started) {
        if (buffered.length < 8) return;
        const length = buffered.readInt32BE(0);
        const code = buffered.readInt32BE(4);
        buffered = buffered.subarray(length);
        if (code === 80877103) {
          if (!useTls) {
            socket.write("N");
            continue;
          }
          socket.write("S");
          socket.removeListener("data", onData);
          const secure = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext,
          });
          secure.on("error", () => undefined);
          secure.once("secure", () => record(secure.servername));
          speakPostgres(secure, false, record);
          return;
        }
        started = true;
        socket.write(Buffer.concat([pgMessage("R", int32(0)), PG_READY]));
        continue;
      }
      if (buffered.length < 5) return;
      const length = buffered.readInt32BE(1);
      if (buffered.length < length + 1) return;
      const type = String.fromCharCode(buffered[0]!);
      buffered = buffered.subarray(length + 1);
      if (type === "Q") socket.write(PG_RESULT);
      if (type === "X") socket.end();
    }
  };
  socket.on("data", onData);
}

function startFakePostgres(useTls = false): Promise<TestServer> {
  const server: { record: (name: string | false) => void } = {
    record: () => undefined,
  };
  return serve((socket) =>
    speakPostgres(socket, useTls, (name) => server.record(name)),
  ).then((started) => {
    server.record = started.record;
    return started;
  });
}

function sqlCredentials(
  dialect: SqlCredentials["dialect"],
  host: string,
  port: number,
  ssl: SqlCredentials["ssl"] = "disable",
): SqlCredentials {
  return { dialect, host, port, database: "d", user: "u", password: "p", ssl };
}

const said = (result: { success: boolean; message: string }) =>
  result.success ? "ok" : result.message;

// ---- MySQL ----------------------------------------------------------------

async function startFakeMysql(): Promise<TestServer> {
  const open = new Set<{ close: () => void; stream: net.Socket }>();
  let connections = 0;
  const server = mysql.createServer((connection) => {
    connections += 1;
    const conn = connection as unknown as {
      serverHandshake: (args: Record<string, unknown>) => void;
      on: (event: string, listener: (...args: never[]) => void) => void;
      writeOk: () => void;
      writeTextResult: (rows: unknown[], columns: unknown[]) => void;
      close: () => void;
      stream: net.Socket;
    };
    open.add(conn);
    conn.stream.on("close", () => open.delete(conn));
    conn.on("error", () => undefined);
    conn.serverHandshake({
      protocolVersion: 10,
      serverVersion: "8.0.0-fake",
      connectionId: connections,
      statusFlags: 2,
      characterSet: 8,
      // Everything but SSL, which is the 0x800 bit.
      capabilityFlags: 0xffffff & ~0x800,
    });
    conn.on("query", (sql: string) => {
      if (/^START TRANSACTION/i.test(sql)) return conn.writeOk();
      conn.writeTextResult(
        [{ version: "8.0.0-fake" }],
        [
          {
            catalog: "def",
            schema: "",
            table: "",
            orgTable: "",
            name: "version",
            orgName: "version",
            characterSet: 33,
            columnLength: 384,
            columnType: 253,
            flags: 0,
            decimals: 0,
          },
        ],
      );
    });
  });
  const inner = (server as unknown as { _server: net.Server })._server;
  const port = await listen(inner);
  const started = {
    port,
    connections: () => connections,
    open: () => open.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const conn of open) conn.stream.destroy();
        inner.close(() => resolve());
      }),
  };
  servers.push(started);
  return started;
}

// ---- SMTP -----------------------------------------------------------------

let delivered = 0;
let smtpQueueDelayMs = 0;

function speakSmtp(
  socket: net.Socket,
  options: { greet: boolean; offerStartTls: boolean },
  record: (name: string | false) => void,
) {
  if (options.greet) socket.write("220 fake ESMTP\r\n");
  let buffered = "";
  let inData = false;
  const onData = (chunk: Buffer) => {
    buffered += chunk.toString("latin1");
    for (;;) {
      const end = buffered.indexOf("\r\n");
      if (end < 0) return;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          delivered += 1;
          setTimeout(() => socket.write("250 queued\r\n"), smtpQueueDelayMs);
        }
        continue;
      }
      const verb = line.split(" ")[0]!.toUpperCase();
      if (verb === "EHLO") {
        socket.write(
          options.offerStartTls
            ? "250-fake\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n"
            : "250-fake\r\n250 AUTH PLAIN\r\n",
        );
      } else if (verb === "STARTTLS") {
        socket.write("220 go ahead\r\n");
        socket.removeListener("data", onData);
        const secure = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext,
        });
        secure.on("error", () => undefined);
        secure.once("secure", () => record(secure.servername));
        speakSmtp(secure, { greet: false, offerStartTls: false }, record);
        return;
      } else if (verb === "AUTH") {
        socket.write("235 ok\r\n");
      } else if (verb === "DATA") {
        inData = true;
        socket.write("354 go on\r\n");
      } else if (verb === "QUIT") {
        socket.end("221 bye\r\n");
      } else {
        socket.write("250 ok\r\n");
      }
    }
  };
  socket.on("data", onData);
}

function startFakeSmtp(mode: "plain" | "starttls" | "implicit" = "plain") {
  const holder: { record: (name: string | false) => void } = {
    record: () => undefined,
  };
  return serve(
    (socket) => {
      if (mode === "implicit") {
        holder.record((socket as tls.TLSSocket).servername);
      }
      speakSmtp(
        socket,
        { greet: true, offerStartTls: mode === "starttls" },
        (name) => holder.record(name),
      );
    },
    mode === "implicit"
      ? tls.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT })
      : net.createServer(),
  ).then((started) => {
    holder.record = started.record;
    return started;
  });
}

const smtpTransport = (host: string, port: number, secure = false) =>
  buildSmtpTransport({
    host,
    port,
    user: "u",
    password: "p",
    secure,
    allowSelfSigned: true,
  });

// ---- All of them ----------------------------------------------------------

async function startSilentServer(): Promise<TestServer> {
  return serve(() => undefined);
}

const sshService = new SSHService();

const message = (error: unknown) => (error as Error).message;

/**
 * Each client, and what it says after trying `host:port`: "ok", or what went wrong.
 * MongoDB's client won't be satisfied with less than a real server, which CI doesn't have
 * outside mongodb-integration.test.ts, so its row only shows the connection arriving.
 */
const CLIENTS: Array<{
  client: string;
  start: () => Promise<TestServer>;
  attempt: (host: string, port: number) => Promise<string>;
  speaksTheProtocol: boolean;
}> = [
  {
    client: "SSH",
    start: startSshServer,
    attempt: async (host, port) =>
      said(await sshService.testConnection(host, "p", "u", port, "password")),
    speaksTheProtocol: true,
  },
  {
    client: "Postgres",
    start: () => startFakePostgres(),
    attempt: async (host, port) =>
      said(
        await postgresDriver.testConnection(
          sqlCredentials("postgres", host, port),
        ),
      ),
    speaksTheProtocol: true,
  },
  {
    client: "MySQL",
    start: startFakeMysql,
    attempt: async (host, port) =>
      said(
        await mysqlDriver.testConnection(sqlCredentials("mysql", host, port)),
      ),
    speaksTheProtocol: true,
  },
  {
    client: "MongoDB",
    start: startSilentServer,
    attempt: (host, port) =>
      findDocuments(
        {
          scheme: "mongodb",
          host,
          port,
          database: "d",
          user: "",
          password: "",
          tls: "default",
        },
        { collection: "c" },
        { maxDocuments: 1, maxBytes: 1000, timeoutMs: 1500 },
      ).then(() => "ok", message),
    speaksTheProtocol: false,
  },
  {
    client: "SMTP",
    start: () => startFakeSmtp(),
    attempt: (host, port) =>
      smtpTransport(host, port)
        .verify()
        .then(() => "ok", message),
    speaksTheProtocol: true,
  },
];

let nameServer: FakeNameServer;

beforeEach(async () => {
  nameServer = await startNameServer();
  mockNameServerPort = nameServer.port;
  mockResolverOptions = undefined;
  mockHostsFile = "";
  mockResolvConf = "";
  delivered = 0;
  smtpQueueDelayMs = 0;
});

afterEach(async () => {
  await nameServer.close();
});

async function until(what: string, condition: () => boolean, within = 10_000) {
  const deadline = performance.now() + within;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out on ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const pbkdf2 = (iterations: number) =>
  new Promise<void>((resolve, reject) => {
    crypto.pbkdf2("x", "y", iterations, 32, "sha512", (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Runs `work` with every thread in the pool busy. It returns what got done before one came free. */
async function whileEveryThreadIsBusy(
  work: (done: (what: string) => void) => Promise<unknown>,
) {
  const order: string[] = [];
  const threads = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  const busy = Array.from({ length: threads }, () => pbkdf2(3_000_000));
  // Can't start until a thread is free, so it marks the first moment one is.
  const queuedBehindThem = pbkdf2(1).then(() => order.push("a thread"));
  const worked = work((what) => order.push(what));
  await Promise.all([...busy, queuedBehindThem]);
  await worked;
  return order.slice(0, order.indexOf("a thread"));
}

describe.each(CLIENTS)("$client", ({ start, attempt, speaksTheProtocol }) => {
  it("connects by a name the name server knows", async () => {
    const server = await start();
    nameServer.zone.set("db.test", { A: [LOOPBACK] });

    const outcome = await attempt("db.test", server.port);

    expect(server.connections()).toBeGreaterThan(0);
    if (speaksTheProtocol) expect(outcome).toBe("ok");
  });

  it("connects by a short name through a search domain", async () => {
    mockResolvConf = KUBERNETES;
    const server = await start();
    nameServer.zone.set("db.svc.cluster.local", { A: [LOOPBACK] });

    const outcome = await attempt("db", server.port);

    expect(server.connections()).toBeGreaterThan(0);
    if (speaksTheProtocol) expect(outcome).toBe("ok");
  });

  it("connects by a name in /etc/hosts, asking no name server", async () => {
    mockHostsFile = `${LOOPBACK} db\n`;
    const server = await start();

    const outcome = await attempt("db", server.port);

    expect(server.connections()).toBeGreaterThan(0);
    if (speaksTheProtocol) expect(outcome).toBe("ok");
    expect(nameServer.queries).toEqual([]);
  });

  it("connects to an address, asking no name server", async () => {
    const server = await start();

    const outcome = await attempt(LOOPBACK, server.port);

    expect(server.connections()).toBeGreaterThan(0);
    if (speaksTheProtocol) expect(outcome).toBe("ok");
    expect(nameServer.queries).toEqual([]);
  });

  it("tries the next address when the first one refuses", async () => {
    const server = await start();
    // 127.0.0.2 is on loopback too, but nothing listens there.
    nameServer.zone.set("db.test", { A: ["127.0.0.2", LOOPBACK] });

    const outcome = await attempt("db.test", server.port);

    expect(server.connections()).toBeGreaterThan(0);
    if (speaksTheProtocol) expect(outcome).toBe("ok");
  });

  it("says a name doesn't exist, as dns.lookup did", async () => {
    await expect(attempt("nope.test", 1)).resolves.toContain(
      "getaddrinfo ENOTFOUND nope.test",
    );
  });

  it("says a name server didn't answer, as dns.lookup did", async () => {
    mockResolverOptions = QUICKLY;
    nameServer.zone.set("hung.test", NEVER);

    await expect(attempt("hung.test", 1)).resolves.toContain(
      "getaddrinfo EAI_AGAIN hung.test",
    );
  });
});

describe.each(CLIENTS.filter(({ speaksTheProtocol }) => speaksTheProtocol))(
  "$client, which didn't open the socket it's now using",
  ({ start, attempt }) => {
    it("closes it when it's done", async () => {
      const server = await start();
      nameServer.zone.set("db.test", { A: [LOOPBACK] });

      await attempt("db.test", server.port);

      expect(server.connections()).toBeGreaterThan(0);
      await until("the client to close", () => server.open() === 0);
    });
  },
);

describe("with every thread in libuv's pool busy", () => {
  it("reaches every kind of server, which dns.lookup would have to wait for", async () => {
    const started = await Promise.all(CLIENTS.map(({ start }) => start()));
    // A first run of each, so loading them isn't what gets measured.
    await Promise.all(
      CLIENTS.map(({ attempt }, index) =>
        attempt(LOOPBACK, started[index]!.port),
      ),
    );
    const before = started.map((server) => server.connections());
    CLIENTS.forEach(({ client }) =>
      nameServer.zone.set(`${client.toLowerCase()}.test`, { A: [LOOPBACK] }),
    );

    const reached = await whileEveryThreadIsBusy((done) => {
      const attempts = CLIENTS.map(({ client, attempt }, index) =>
        attempt(`${client.toLowerCase()}.test`, started[index]!.port),
      );
      const watch = setInterval(() => {
        CLIENTS.forEach(({ client }, index) => {
          if (started[index]!.connections() > before[index]!) done(client);
        });
      }, 5);
      return Promise.all(attempts).finally(() => clearInterval(watch));
    });

    expect([...new Set(reached)].sort()).toEqual(
      CLIENTS.map(({ client }) => client).sort(),
    );
  });

  it("doesn't let nodemailer fall back to dns.lookup when c-ares finds nothing", async () => {
    // nodemailer treats no address as a reason to ask getaddrinfo, which a name server can
    // then hang on purpose. So asking c-ares first, as nodemailer does, isn't enough.
    nameServer.zone.set("empty.test", {});

    const finished = await whileEveryThreadIsBusy(async (done) => {
      await expect(smtpTransport("empty.test", 25).verify()).rejects.toThrow(
        "getaddrinfo ENOTFOUND empty.test",
      );
      done("the test");
    });

    expect(finished).toEqual(["the test"]);
  });
});

describe("SSH", () => {
  const scope = JSON.stringify({ kind: "test" }) as SSHConnectionScope;

  it("runs a health check over its socket", async () => {
    const server = await startSshServer();
    nameServer.zone.set("ssh.test", { A: [LOOPBACK] });
    // Checking a key means reading the server's row, and there's no database here.
    process.env.CRONIUM_SSH_HOST_KEY_POLICY = "insecure";

    try {
      const health = await sshService.checkServerHealth({
        id: 1,
        name: "a server",
        address: "ssh.test",
        sshKey: null,
        password: "p",
        username: "u",
        port: server.port,
      });

      expect(health).toMatchObject({
        online: true,
        systemInfo: { platform: "Linux", cpuCores: 8 },
      });
    } finally {
      delete process.env.CRONIUM_SSH_HOST_KEY_POLICY;
    }
  });

  it("opens a terminal's shell over its socket", async () => {
    const server = await startSshServer();
    nameServer.zone.set("ssh.test", { A: [LOOPBACK] });

    const { shell, cleanup } = await sshService.openShell(
      scope,
      "ssh.test",
      "p",
      "u",
      server.port,
      80,
      24,
      "password",
    );
    const first = await new Promise<string>((resolve) =>
      shell.once("data", (data: Buffer) => resolve(data.toString())),
    );

    expect(first).toBe("a shell\n");
    shell.close();
    cleanup();
  });

  it("says a terminal's host can't be resolved in the words it always did", async () => {
    await expect(
      sshService.openShell(
        scope,
        "nope.test",
        "p",
        "u",
        22,
        80,
        24,
        "password",
      ),
    ).rejects.toThrow(
      "Cannot resolve hostname nope.test. Check if the address is correct.",
    );
  });

  // ssh2 throws on the key before it listens to the socket, which is already on its way.
  // If it isn't closed, a failure there is an `error` event with nobody listening, and
  // that ends the process. jest-circus fails the running test for it.
  it.each([
    ["a name that doesn't exist", "nope.test"],
    ["a name that does", "ssh.test"],
  ])(
    "closes its socket when it can't parse the key, with %s",
    async (_what, host) => {
      const server = await startSilentServer();
      nameServer.zone.set("ssh.test", { A: [LOOPBACK] });

      const outcome = await sshService.testConnection(
        host,
        "not a key",
        "u",
        server.port,
        "privateKey",
      );

      expect(outcome).toMatchObject({
        success: false,
        message: expect.stringContaining("Cannot parse privateKey"),
      });
      await until(
        "the name server's answer",
        () => nameServer.queries.length >= 2,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(server.connections()).toBe(0);
    },
  );
});

describe("Postgres", () => {
  it("keeps the name for TLS, though the connection went to an address", async () => {
    const server = await startFakePostgres(true);
    nameServer.zone.set("pg.test", { A: [LOOPBACK] });

    const outcome = await postgresDriver.testConnection(
      sqlCredentials("postgres", "pg.test", server.port, "require"),
    );

    expect(said(outcome)).toBe("ok");
    expect(server.serverName?.()).toBe("pg.test");
  });

  it("still takes the path of a Unix socket for a host", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cronium-pg-"));
    const socketPath = path.join(directory, ".s.PGSQL.5432");
    const listener = net.createServer((socket) => {
      socket.on("error", () => undefined);
      speakPostgres(socket, false, () => undefined);
    });
    await new Promise<void>((resolve) => listener.listen(socketPath, resolve));

    try {
      const outcome = await postgresDriver.testConnection(
        sqlCredentials("postgres", directory, 5432),
      );

      expect(said(outcome)).toBe("ok");
      expect(nameServer.queries).toEqual([]);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("MySQL", () => {
  it("sets what mysql2 sets on a socket it makes itself", async () => {
    const server = await startFakeMysql();
    const setNoDelay = jest.spyOn(net.Socket.prototype, "setNoDelay");
    const setKeepAlive = jest.spyOn(net.Socket.prototype, "setKeepAlive");

    try {
      await mysqlDriver.testConnection(
        sqlCredentials("mysql", LOOPBACK, server.port),
      );

      expect(setNoDelay).toHaveBeenCalledWith(true);
      expect(setKeepAlive).toHaveBeenCalledWith(true);
    } finally {
      setNoDelay.mockRestore();
      setKeepAlive.mockRestore();
    }
  });

  it("runs a query over its socket on the path that streams", async () => {
    const server = await startFakeMysql();
    nameServer.zone.set("mysql.test", { A: [LOOPBACK] });

    await expect(
      mysqlDriver.query(
        sqlCredentials("mysql", "mysql.test", server.port),
        "SELECT VERSION() AS version",
        {},
        { maxRows: 10, maxBytes: 10_000, timeoutMs: 5_000 },
      ),
    ).resolves.toMatchObject({ rows: [{ version: "8.0.0-fake" }] });
  });
});

describe("MongoDB", () => {
  it("looks up every host in a list the same way", async () => {
    const [first, second] = await Promise.all([
      startSilentServer(),
      startSilentServer(),
    ]);
    nameServer.zone.set("a.test", { A: [LOOPBACK] });
    nameServer.zone.set("b.test", { A: [LOOPBACK] });

    await expect(
      findDocuments(
        {
          scheme: "mongodb",
          host: `a.test:${first!.port},b.test:${second!.port}`,
          database: "d",
          user: "",
          password: "",
          tls: "default",
        },
        { collection: "c" },
        { maxDocuments: 1, maxBytes: 1000, timeoutMs: 1500 },
      ),
    ).rejects.toThrow();

    expect(first!.connections()).toBeGreaterThan(0);
    expect(second!.connections()).toBeGreaterThan(0);
  });
});

describe("SMTP", () => {
  const MESSAGE = {
    from: "a@example.test",
    to: "b@example.test",
    subject: "s",
    text: "t",
  };

  it("sends a message over its socket", async () => {
    const server = await startFakeSmtp();
    nameServer.zone.set("smtp.test", { A: [LOOPBACK] });

    await expect(
      smtpTransport("smtp.test", server.port).sendMail(MESSAGE),
    ).resolves.toMatchObject({ accepted: ["b@example.test"] });

    expect(delivered).toBe(1);
  });

  it("does TLS on its socket with the name, for `secure`", async () => {
    const server = await startFakeSmtp("implicit");
    nameServer.zone.set("smtp.test", { A: [LOOPBACK] });

    await expect(
      smtpTransport("smtp.test", server.port, true).sendMail(MESSAGE),
    ).resolves.toMatchObject({ accepted: ["b@example.test"] });

    expect(delivered).toBe(1);
    expect(server.serverName?.()).toBe("smtp.test");
  });

  it("does TLS on its socket with the name, for STARTTLS", async () => {
    const server = await startFakeSmtp("starttls");
    nameServer.zone.set("smtp.test", { A: [LOOPBACK] });

    await expect(
      smtpTransport("smtp.test", server.port).sendMail(MESSAGE),
    ).resolves.toMatchObject({ accepted: ["b@example.test"] });

    expect(delivered).toBe(1);
    expect(server.serverName?.()).toBe("smtp.test");
  });

  it("says a port that refuses, as it did", async () => {
    nameServer.zone.set("smtp.test", { A: [LOOPBACK] });
    const closed = await startSilentServer();
    const { port } = closed;
    await closed.close();
    servers.splice(servers.indexOf(closed), 1);

    await expect(smtpTransport("smtp.test", port).verify()).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("gives up after its connection timeout, which nodemailer doesn't apply to this part", async () => {
    // c-ares caps one try at 5 seconds, so this lasts past the 10 seconds allowed, as three
    // name servers that never answer do in real use. Loopback can't keep a port silent.
    mockResolverOptions = { timeout: 5_000, tries: 4 };
    nameServer.zone.set("hung.test", NEVER);

    const started = performance.now();
    await expect(smtpTransport("hung.test", 25).verify()).rejects.toMatchObject(
      {
        message: "Connection timeout",
        code: "ETIMEDOUT",
      },
    );

    expect(performance.now() - started).toBeGreaterThan(9_000);
  });

  it("doesn't hold a slow server to that timeout once it's connected", async () => {
    smtpQueueDelayMs = 11_000;
    const server = await startFakeSmtp();
    nameServer.zone.set("smtp.test", { A: [LOOPBACK] });

    await expect(
      smtpTransport("smtp.test", server.port).sendMail(MESSAGE),
    ).resolves.toMatchObject({ accepted: ["b@example.test"] });
  });
});
