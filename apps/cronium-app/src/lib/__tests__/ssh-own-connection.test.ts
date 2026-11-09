/**
 * @jest-environment node
 *
 * `testConnection` and `checkServerHealth` at the same time on one `SSHService`, against
 * real `ssh2` servers on loopback that answer differently. The app has one `sshService`
 * for the whole process, so these calls overlap in normal use, whoever makes them: a
 * server's page runs a health check when it opens, and anyone signed in can test a
 * connection to any address.
 *
 * Where it matters which call goes first, the first command a server gets waits until the
 * test lets it through, so the overlap is the same on every run.
 *
 * Then servers that misbehave: one that never answers a command, and one that never
 * closes its side after the service says goodbye. Neither may hold a call or a socket
 * for good. The service gets small limits there, so nothing waits for its real ones.
 */
// For the host key verifier. With no key on file, it records the one it's shown.
let mockStoredHostKey: string | null = null;
jest.mock("@server/storage", () => ({
  storage: {
    getServer: jest.fn(() =>
      Promise.resolve({ sshHostKey: mockStoredHostKey }),
    ),
    updateServerSshHostKey: jest.fn(() => Promise.resolve()),
  },
}));

import net from "net";
import { Server as SshServer, utils as sshUtils } from "ssh2";
import type { Connection } from "ssh2";
import { SSHService } from "../ssh";

jest.setTimeout(30_000);

const LOOPBACK = "127.0.0.1";
const USERNAME = "u";
const PASSWORD = "p";
const hostKey = sshUtils.generateKeyPairSync("rsa", { bits: 2048 }).private;

/** The commands a health check runs, in its order. */
const HEALTH_CHECK = [
  "uname -s",
  "uname -r",
  "nproc",
  "free -h | grep Mem",
  "uptime -p",
];

const SERVER_A = {
  answers: {
    "uname -s": "Linux\n",
    "uname -r": "6.1.0-server-a\n",
    nproc: "2\n",
    "free -h | grep Mem": "Mem:  2.0Gi  1.2Gi  512Mi  0B  300Mi  700Mi\n",
    "uptime -p": "up 1 day, 2 hours, 3 minutes\n",
  },
  systemInfo: {
    platform: "Linux",
    release: "6.1.0-server-a",
    cpuCores: 2,
    totalMemory: "2.0Gi",
    freeMemory: "512Mi",
    uptime: { days: 1, hours: 2, minutes: 3 },
  },
};

const SERVER_B = {
  answers: {
    "uname -s": "FreeBSD\n",
    "uname -r": "14.1-server-b\n",
    nproc: "16\n",
    "free -h | grep Mem": "Mem:  64Gi  20Gi  40Gi  0B  4.0Gi  44Gi\n",
    "uptime -p": "up 9 days, 8 hours, 7 minutes\n",
  },
  systemInfo: {
    platform: "FreeBSD",
    release: "14.1-server-b",
    cpuCores: 16,
    totalMemory: "64Gi",
    freeMemory: "40Gi",
    uptime: { days: 9, hours: 8, minutes: 7 },
  },
};

interface FakeServer {
  port: number;
  /** Every command it was asked to run, in the order they came, over any connection. */
  commands: string[];
  /** Connections to it that haven't closed. */
  open: () => number;
  close: () => Promise<void>;
}

const started: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});

/**
 * An SSH server that takes `PASSWORD` and answers each command from `answers`.
 * `holdFirst` keeps the first command it gets waiting until it resolves, and `delayMs`
 * spaces every answer out, so calls overlap.
 */
async function startServer(
  answers: Record<string, string>,
  options: {
    holdFirst?: Promise<void>;
    delayMs?: number;
    refuseCommands?: boolean;
  } = {},
): Promise<FakeServer> {
  const commands: string[] = [];
  const open = new Set<Connection>();
  const server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    client.on("error", () => undefined);
    client.on("authentication", (context) => {
      if (context.method === "password" && context.password === PASSWORD) {
        context.accept();
      } else {
        context.reject(["password"]);
      }
    });
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        acceptSession().on("exec", (acceptExec, rejectExec, info) => {
          const first = commands.length === 0;
          commands.push(info.command);
          if (options.refuseCommands) {
            rejectExec();
            return;
          }
          const stream = acceptExec();
          stream.on("error", () => undefined);
          void ((first && options.holdFirst) || Promise.resolve())
            .then(() => wait(options.delayMs))
            .then(() => {
              try {
                stream.write(answers[info.command] ?? "");
                stream.exit(0);
                stream.end();
              } catch {
                // The connection closed while this one waited.
              }
            });
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const fake = {
    port: (server.address() as net.AddressInfo).port,
    commands,
    open: () => open.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of open) client.end();
        server.close(() => resolve());
      }),
  };
  started.push(fake);
  return fake;
}

interface ServerThatNeverCloses {
  port: number;
  /** Connections to it that it hasn't closed. */
  open: () => number;
  /** Of those, the ones whose client has closed its side. */
  closedByClient: () => number;
  close: () => Promise<void>;
}

const neverClosing: ServerThatNeverCloses[] = [];
afterEach(async () => {
  await Promise.all(neverClosing.splice(0).map((server) => server.close()));
});

/**
 * Passes everything on, both ways, to the SSH server `behind`, but never closes its side
 * of a connection. The client's goodbye reaches the SSH server, which closes, but that
 * never reaches the client. So a client waiting for the server to close waits forever.
 */
async function startServerThatNeverCloses(
  behind: FakeServer,
): Promise<ServerThatNeverCloses> {
  const open = new Set<net.Socket>();
  const closedByClient = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    open.add(socket);
    socket.on("end", () => closedByClient.add(socket));
    socket.on("close", () => {
      open.delete(socket);
      closedByClient.delete(socket);
    });
    socket.on("error", () => undefined);
    const upstream = net.connect(behind.port, LOOPBACK);
    upstream.on("error", () => undefined);
    socket.pipe(upstream);
    upstream.pipe(socket, { end: false });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const fake = {
    port: (server.address() as net.AddressInfo).port,
    open: () => open.size,
    closedByClient: () => closedByClient.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
  neverClosing.push(fake);
  return fake;
}

/** TCP sockets open in this process: the service's, and the fake servers' ends. */
const tcpSocketsHere = () =>
  process
    .getActiveResourcesInfo()
    .filter((resource) => resource === "TCPSocketWrap").length;

/**
 * The service's socket has closed though the server never closed its side: once the SSH
 * server behind it has closed, the only TCP socket left in this process is the one that
 * server still holds. It saw the client close its side first, so the service said
 * goodbye before it stopped waiting.
 */
async function closedThoughServerNeverDid(
  server: ServerThatNeverCloses,
  behind: FakeServer,
) {
  await until(
    "the service's socket to close",
    () =>
      behind.open() === 0 &&
      server.open() === 1 &&
      server.closedByClient() === 1 &&
      tcpSocketsHere() === 1,
  );
  await server.close();
  await nothingStaysOpen(behind);
}

/** What `promise` comes to, or `still waiting` if that takes over `ms`. */
async function settlesWithin<T>(ms: number, promise: Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"still waiting">((resolve) => {
    timer = setTimeout(() => resolve("still waiting"), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A promise and the function that resolves it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

async function until(what: string, condition: () => boolean, within = 5_000) {
  const deadline = performance.now() + within;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out on ${what}`);
    await wait(5);
  }
}

/** No connection left open at the servers, and no socket left open here either. */
async function nothingStaysOpen(...servers: FakeServer[]) {
  await until(
    "every connection to close",
    () =>
      servers.every((server) => server.open() === 0) &&
      !process.getActiveResourcesInfo().includes("TCPSocketWrap"),
  );
}

/** A row as `servers.checkHealth` passes it: owned by whoever asked. */
const serverRow = (id: number, server: FakeServer, password = PASSWORD) => ({
  id,
  name: `server ${id}`,
  address: LOOPBACK,
  sshKey: null,
  password,
  username: USERNAME,
  port: server.port,
});

const online = (systemInfo: typeof SERVER_A.systemInfo) => ({
  online: true,
  systemInfo,
});

const OFFLINE_SYSTEM_INFO = {
  platform: "Unknown",
  release: "Unknown",
  cpuCores: 0,
  totalMemory: "0",
  freeMemory: "0",
  uptime: { days: 0, hours: 0, minutes: 0 },
};

let sshService: SSHService;
beforeEach(() => {
  sshService = new SSHService();
  mockStoredHostKey = null;
});

describe("SSHService, with calls at the same time", () => {
  it("gives two health checks at once each its own server's answers", async () => {
    const letAThrough = gate();
    const letBThrough = gate();
    const a = await startServer(SERVER_A.answers, {
      holdFirst: letAThrough.opened,
    });
    const b = await startServer(SERVER_B.answers, {
      holdFirst: letBThrough.opened,
    });

    // Both connected, each waiting on its first command.
    const checkingA = sshService.checkServerHealth(serverRow(1, a));
    await until("A's first command", () => a.commands.length === 1);
    const checkingB = sshService.checkServerHealth(serverRow(2, b));
    await until("B's first command", () => b.commands.length === 1);
    letAThrough.open();
    const healthA = await checkingA;
    letBThrough.open();
    const healthB = await checkingB;

    expect([healthA, healthB]).toEqual([
      online(SERVER_A.systemInfo),
      online(SERVER_B.systemInfo),
    ]);
    expect([a.commands, b.commands]).toEqual([HEALTH_CHECK, HEALTH_CHECK]);
    await nothingStaysOpen(a, b);
  });

  it("finishes a health check while a connection test comes and goes", async () => {
    const letAThrough = gate();
    const a = await startServer(SERVER_A.answers, {
      holdFirst: letAThrough.opened,
    });
    const b = await startServer(SERVER_B.answers);

    const checkingA = sshService.checkServerHealth(serverRow(1, a));
    await until("A's first command", () => a.commands.length === 1);
    const tested = await sshService.testConnection(
      LOOPBACK,
      PASSWORD,
      USERNAME,
      b.port,
      "password",
    );
    letAThrough.open();

    expect([await checkingA, tested]).toEqual([
      online(SERVER_A.systemInfo),
      { success: true, message: "Connection successful" },
    ]);
    expect(b.commands).toEqual([]);
    await nothingStaysOpen(a, b);
  });

  it("closes a health check's connection though a connection test failed meanwhile", async () => {
    const letAThrough = gate();
    const a = await startServer(SERVER_A.answers, {
      holdFirst: letAThrough.opened,
    });
    const b = await startServer(SERVER_B.answers);

    const checkingA = sshService.checkServerHealth(serverRow(1, a));
    await until("A's first command", () => a.commands.length === 1);
    const tested = await sshService.testConnection(
      LOOPBACK,
      "not the password",
      USERNAME,
      b.port,
      "password",
    );
    letAThrough.open();

    expect([await checkingA, tested]).toEqual([
      online(SERVER_A.systemInfo),
      {
        success: false,
        message: "All configured authentication methods failed",
      },
    ]);
    await nothingStaysOpen(a, b);
  });

  it("gives each of many calls at once its own answer", async () => {
    const a = await startServer(SERVER_A.answers, { delayMs: 5 });
    const b = await startServer(SERVER_B.answers, { delayMs: 5 });

    const results = await Promise.all([
      sshService.checkServerHealth(serverRow(1, a)),
      sshService.checkServerHealth(serverRow(2, b)),
      sshService.testConnection(
        LOOPBACK,
        PASSWORD,
        USERNAME,
        a.port,
        "password",
      ),
      sshService.checkServerHealth(serverRow(1, a)),
      sshService.testConnection(
        LOOPBACK,
        PASSWORD,
        USERNAME,
        b.port,
        "password",
      ),
      sshService.checkServerHealth(serverRow(2, b)),
      sshService.checkServerHealth(serverRow(1, a)),
      sshService.checkServerHealth(serverRow(2, b)),
    ]);

    const tested = { success: true, message: "Connection successful" };
    expect(results).toEqual([
      online(SERVER_A.systemInfo),
      online(SERVER_B.systemInfo),
      tested,
      online(SERVER_A.systemInfo),
      tested,
      online(SERVER_B.systemInfo),
      online(SERVER_A.systemInfo),
      online(SERVER_B.systemInfo),
    ]);
    await nothingStaysOpen(a, b);
  });
});

describe("SSHService, closing what it opened", () => {
  it("closes a connection test's connection", async () => {
    const a = await startServer(SERVER_A.answers);

    await expect(
      sshService.testConnection(
        LOOPBACK,
        PASSWORD,
        USERNAME,
        a.port,
        "password",
      ),
    ).resolves.toEqual({ success: true, message: "Connection successful" });
    await nothingStaysOpen(a);
  });

  it("closes a health check's connection", async () => {
    const a = await startServer(SERVER_A.answers);

    await expect(
      sshService.checkServerHealth(serverRow(1, a)),
    ).resolves.toEqual(online(SERVER_A.systemInfo));
    await nothingStaysOpen(a);
  });

  it("closes a health check's connection when the server won't run a command", async () => {
    const a = await startServer(SERVER_A.answers, { refuseCommands: true });

    await expect(
      sshService.checkServerHealth(serverRow(1, a)),
    ).resolves.toEqual({
      online: false,
      systemInfo: OFFLINE_SYSTEM_INFO,
      error: "Unable to exec",
    });
    expect(a.commands).toEqual(["uname -s"]);
    await nothingStaysOpen(a);
  });

  it("says why a password was refused, and leaves nothing open", async () => {
    const a = await startServer(SERVER_A.answers);

    const health = await sshService.checkServerHealth(
      serverRow(1, a, "not the password"),
    );
    const tested = await sshService.testConnection(
      LOOPBACK,
      "not the password",
      USERNAME,
      a.port,
      "password",
    );

    expect([health, tested]).toEqual([
      {
        online: false,
        systemInfo: OFFLINE_SYSTEM_INFO,
        error: "All configured authentication methods failed",
      },
      {
        success: false,
        message: "All configured authentication methods failed",
      },
    ]);
    await nothingStaysOpen(a);
  });

  it("says a host key was refused, and leaves nothing open", async () => {
    const a = await startServer(SERVER_A.answers);
    mockStoredHostKey = "SHA256:aKeyThisServerDoesNotHave";
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const health = await sshService.checkServerHealth(serverRow(1, a));

      expect(health).toEqual({
        online: false,
        systemInfo: OFFLINE_SYSTEM_INFO,
        error: "Host denied (verification failed)",
      });
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(
          "SSH host key mismatch for 127.0.0.1 (server #1)",
        ),
      );
    } finally {
      logged.mockRestore();
    }
    expect(a.commands).toEqual([]);
    await nothingStaysOpen(a);
  });
});

describe("SSHService, with a server that never answers or never closes", () => {
  const LIMITS = { healthCheckCommandsMs: 400, closeGraceMs: 300 };
  const TIMED_OUT = {
    online: false,
    systemInfo: OFFLINE_SYSTEM_INFO,
    error:
      "Health check timed out: 127.0.0.1 didn't answer its commands within 0.4 seconds.",
  };
  const neverAnswer = new Promise<void>(() => undefined);

  beforeEach(() => {
    sshService = new SSHService(LIMITS);
  });

  it("stops waiting for a health check command that never finishes", async () => {
    const a = await startServer(SERVER_A.answers, { holdFirst: neverAnswer });

    const started = performance.now();
    const health = await settlesWithin(
      10_000,
      sshService.checkServerHealth(serverRow(1, a)),
    );

    expect(health).toEqual(TIMED_OUT);
    expect(performance.now() - started).toBeGreaterThanOrEqual(
      LIMITS.healthCheckCommandsMs,
    );
    expect(a.commands).toEqual(["uname -s"]);
    await nothingStaysOpen(a);
  });

  it("limits a health check's commands together, not one at a time", async () => {
    // Each answer comes well inside the limit, and all five well outside it.
    const a = await startServer(SERVER_A.answers, { delayMs: 300 });

    const health = await settlesWithin(
      10_000,
      sshService.checkServerHealth(serverRow(1, a)),
    );

    expect(health).toEqual(TIMED_OUT);
    expect(a.commands.length).toBeLessThan(HEALTH_CHECK.length);
    await nothingStaysOpen(a);
  });

  it("closes a connection test's socket though the server never closes its side", async () => {
    const a = await startServer(SERVER_A.answers);
    const neverCloses = await startServerThatNeverCloses(a);

    await expect(
      sshService.testConnection(
        LOOPBACK,
        PASSWORD,
        USERNAME,
        neverCloses.port,
        "password",
      ),
    ).resolves.toEqual({ success: true, message: "Connection successful" });
    await closedThoughServerNeverDid(neverCloses, a);
  });

  it("closes a health check's socket at a server that neither answers nor closes", async () => {
    const a = await startServer(SERVER_A.answers, { holdFirst: neverAnswer });
    const neverCloses = await startServerThatNeverCloses(a);

    const health = await settlesWithin(
      10_000,
      sshService.checkServerHealth({
        ...serverRow(1, a),
        port: neverCloses.port,
      }),
    );

    expect(health).toEqual(TIMED_OUT);
    await closedThoughServerNeverDid(neverCloses, a);
  });

  it("closes the socket after a refused password, though the server never closes its side", async () => {
    const a = await startServer(SERVER_A.answers);
    const neverCloses = await startServerThatNeverCloses(a);

    await expect(
      sshService.testConnection(
        LOOPBACK,
        "not the password",
        USERNAME,
        neverCloses.port,
        "password",
      ),
    ).resolves.toEqual({
      success: false,
      message: "All configured authentication methods failed",
    });
    await closedThoughServerNeverDid(neverCloses, a);
  });
});
