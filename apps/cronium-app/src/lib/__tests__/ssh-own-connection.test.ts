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
 *
 * Last, the terminal's pool, which keeps connections for the shells it opens and closes
 * them itself: each way it does that, at the server that never closes its side, what it
 * keeps in the pool when a connection it replaced closes, and that it never closes a
 * connection while a shell over it is open.
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
import type { ClientChannel, Connection, ServerChannel } from "ssh2";
import { SSHService } from "../ssh";
import { createServerSSHConnectionScope } from "../ssh/pool-key";

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
  /** Every connection it has had, closed or not. */
  connections: () => number;
  /** Connections to it that haven't closed. */
  open: () => number;
  /** Every shell it has opened, closed or not. */
  shellsOpened: () => number;
  /** Shells open at it, over any connection. */
  shells: () => number;
  close: () => Promise<void>;
}

const started: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});

/**
 * An SSH server that takes `PASSWORD`, answers each command from `answers`, and opens a
 * shell for a terminal. `holdFirst` keeps the first command it gets waiting until it
 * resolves, and `delayMs` spaces every answer out, so calls overlap. `shellDelayMs` takes
 * that long to open each shell, as a busy machine can. `holdSignIn` never answers a
 * sign-in, and `refuseChannels` refuses every channel, so every shell. `maxSessions`
 * refuses a channel to a connection with that many open, as OpenSSH's `MaxSessions`
 * does, where a command and a shell are a session each. `holdFirstShell` keeps the first
 * shell it's asked for waiting until it resolves.
 *
 * A shell echoes what it's sent, and exits once its input ends, as a shell at its prompt
 * does when the terminal's websocket ends it.
 */
async function startServer(
  answers: Record<string, string>,
  options: {
    holdFirst?: Promise<void>;
    delayMs?: number;
    refuseCommands?: boolean;
    shellDelayMs?: number;
    holdSignIn?: boolean;
    refuseChannels?: boolean;
    maxSessions?: number;
    holdFirstShell?: Promise<void>;
  } = {},
): Promise<FakeServer> {
  const commands: string[] = [];
  const open = new Set<Connection>();
  const shells = new Set<ServerChannel>();
  let connections = 0;
  let shellsAsked = 0;
  let shellsOpened = 0;
  const server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    connections += 1;
    open.add(client);
    // Its shells' input ends with it too, and then they can't say anything.
    let gone = false;
    client.on("end", () => (gone = true));
    client.on("close", () => {
      gone = true;
      open.delete(client);
    });
    client.on("error", () => undefined);
    client.on("authentication", (context) => {
      if (options.holdSignIn) return;
      if (context.method === "password" && context.password === PASSWORD) {
        context.accept();
      } else {
        context.reject(["password"]);
      }
    });
    client.on("ready", () => {
      let sessions = 0;
      client.on("session", (acceptSession, rejectSession) => {
        if (options.refuseChannels || sessions === options.maxSessions) {
          rejectSession();
          return;
        }
        sessions += 1;
        acceptSession()
          .on("close", () => (sessions -= 1))
          .on("exec", (acceptExec, rejectExec, info) => {
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
          })
          .on("pty", (acceptPty) => acceptPty())
          .on("shell", (acceptShell) => {
            const startShell = () => {
              // Nothing to accept once the connection or the channel has gone.
              let shell: ServerChannel | undefined;
              try {
                shell = gone
                  ? undefined
                  : (acceptShell() as ServerChannel | undefined);
              } catch {
                // The connection closed while this one waited.
              }
              if (!shell) return;
              shellsOpened += 1;
              shells.add(shell);
              shell.on("close", () => shells.delete(shell));
              shell.on("error", () => undefined);
              shell.on("data", (data: Buffer) => {
                try {
                  shell.write(data);
                } catch {
                  // The connection has gone.
                }
              });
              shell.on("end", () => {
                if (gone) return;
                try {
                  shell.exit(0);
                  shell.close();
                } catch {
                  // The connection has gone.
                }
              });
              shell.write("a shell\n");
            };
            shellsAsked += 1;
            if (shellsAsked === 1 && options.holdFirstShell) {
              void options.holdFirstShell.then(startShell);
            } else if (options.shellDelayMs) {
              setTimeout(startShell, options.shellDelayMs);
            } else {
              startShell();
            }
          });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const fake = {
    port: (server.address() as net.AddressInfo).port,
    commands,
    connections: () => connections,
    open: () => open.size,
    shellsOpened: () => shellsOpened,
    shells: () => shells.size,
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
 *
 * `inUse` other connections through `server` may still be open, as a terminal's pool
 * keeps them. Each of those is four sockets here: the service's, both of the
 * pass-through's, and the SSH server's.
 */
async function closedThoughServerNeverDid(
  server: ServerThatNeverCloses,
  behind: FakeServer,
  inUse = 0,
) {
  await until(
    "the service's socket to close",
    () =>
      behind.open() === inUse &&
      server.open() === inUse + 1 &&
      server.closedByClient() === 1 &&
      tcpSocketsHere() === 1 + 4 * inUse,
  );
  if (inUse > 0) return;
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

describe("SSHService's terminal pool", () => {
  const GRACE = { closeGraceMs: 300 };
  const SCOPE = createServerSSHConnectionScope("user-1", 1);

  /**
   * A shell, as the terminal's websocket opens one and reads it. The pool counts a shell
   * as open until it closes, and an ssh2 shell nobody reads never closes. `closed` says
   * whether it has.
   */
  async function openShell(port: number, password = PASSWORD) {
    const opened = await sshService.openShell(
      SCOPE,
      LOOPBACK,
      password,
      USERNAME,
      port,
      80,
      24,
      "password",
    );
    let closed = false;
    opened.shell.on("close", () => (closed = true)).resume();
    return { ...opened, closed: () => closed };
  }

  type OpenedShell = Awaited<ReturnType<typeof openShell>>;

  /**
   * Ends a shell as the terminal's websocket does when its tab closes: `cleanup`, and
   * then the end of the shell's input. The fake server's shell exits then, and closes.
   */
  function endAsTheTerminalDoes({ shell, cleanup }: OpenedShell) {
    cleanup();
    shell.end();
  }

  /** Whether `shell` still answers: the fake server's shells echo what they're sent. */
  async function answers(shell: ClientChannel) {
    let echoed = "";
    const heard = new Promise<true>((resolve) => {
      const listen = (data: Buffer) => {
        echoed += data.toString();
        if (!echoed.includes("still here")) return;
        shell.off("data", listen);
        resolve(true);
      };
      shell.on("data", listen);
    });
    shell.write("still here\n");
    return settlesWithin(5_000, heard);
  }

  /** An SSH server that answers as server A, behind one that never closes its side. */
  async function startServers(options?: Parameters<typeof startServer>[1]) {
    const a = await startServer(SERVER_A.answers, options);
    return { a, neverCloses: await startServerThatNeverCloses(a) };
  }

  beforeEach(() => {
    sshService = new SSHService(GRACE);
  });

  // What the pool still keeps closes with the servers, before the next test starts. The
  // SSH servers go first: once the pass-through has gone, nothing reads their goodbye.
  afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.close()));
    await Promise.all(neverClosing.splice(0).map((server) => server.close()));
    await until("every socket to close", () => tcpSocketsHere() === 0);
  });

  it("closes a connection it has kept too long, though the server never closes its side", async () => {
    // The pool measures how long it has kept a connection with Date.now(), which stands
    // still here until the shell has opened and closed. Opening it takes longer than the
    // limit, as it can on a busy machine. Then the clock moves past the limit, and the
    // next sweep closes the connection.
    let now = Date.now();
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      sshService = new SSHService({
        ...GRACE,
        terminalIdleMs: 100,
        terminalSweepMs: 50,
      });
      const { a, neverCloses } = await startServers({ shellDelayMs: 250 });

      const { shell, cleanup } = await openShell(neverCloses.port);
      shell.close();
      cleanup();
      now += 1_000;

      await closedThoughServerNeverDid(neverCloses, a);
    } finally {
      clock.mockRestore();
    }
  });

  it("closes a kept connection that fails its check, though the server never closes its side", async () => {
    // Before the pool hands a connection out again, it runs a command over it, which
    // this server refuses.
    const { a, neverCloses } = await startServers({ refuseCommands: true });

    const first = await openShell(neverCloses.port);
    first.shell.close();
    first.cleanup();
    await openShell(neverCloses.port);

    expect(a.commands).toEqual(['echo "test"']);
    expect(a.connections()).toBe(2);
    await closedThoughServerNeverDid(neverCloses, a, 1);
  });

  it("closes a connection that isn't ready in time, though the server never closes its side", async () => {
    sshService = new SSHService({ ...GRACE, terminalConnectMs: 400 });
    const { a, neverCloses } = await startServers({ holdSignIn: true });

    await expect(openShell(neverCloses.port)).rejects.toThrow(
      "Connection to 127.0.0.1 timed out.",
    );
    await closedThoughServerNeverDid(neverCloses, a);
  });

  it("closes a connection after a refused password, though the server never closes its side", async () => {
    const { a, neverCloses } = await startServers();

    await expect(
      openShell(neverCloses.port, "not the password"),
    ).rejects.toThrow(
      "Authentication failed for u@127.0.0.1. Please verify your password is correct.",
    );
    await closedThoughServerNeverDid(neverCloses, a);
  });

  it("closes a connection whose shell was refused, though the server never closes its side", async () => {
    const { a, neverCloses } = await startServers({ refuseChannels: true });

    await expect(openShell(neverCloses.port)).rejects.toThrow(
      "(SSH) Channel open failure",
    );
    await closedThoughServerNeverDid(neverCloses, a);
  });

  it("closes a connection with too many shells once it's replaced and they've closed, though the server never closes its side", async () => {
    const { a, neverCloses } = await startServers();

    // Five shells share a connection, and the sixth gets a new one.
    const firstFive: OpenedShell[] = [];
    for (let shells = 0; shells < 5; shells += 1) {
      firstFive.push(await openShell(neverCloses.port));
    }
    expect(a.connections()).toBe(1);
    await openShell(neverCloses.port);
    expect(a.connections()).toBe(2);

    // The first connection closes once the last of its shells has.
    for (const { shell } of firstFive) shell.close();
    await closedThoughServerNeverDid(neverCloses, a, 1);
    // The first one closing left the second in the pool, for the next shell.
    await openShell(neverCloses.port);
    expect(a.connections()).toBe(2);
  });

  it("keeps the connection that replaced one with too many shells", async () => {
    // Here the first one closes as soon as it's told to, with the second in the pool.
    const a = await startServer(SERVER_A.answers);

    const firstFive: OpenedShell[] = [];
    for (let shells = 0; shells < 5; shells += 1) {
      firstFive.push(await openShell(a.port));
    }
    await openShell(a.port);
    expect(a.connections()).toBe(2);
    firstFive.forEach(endAsTheTerminalDoes);
    await until(
      "the first connection to close",
      () => a.open() === 1 && tcpSocketsHere() === 2,
    );
    await openShell(a.port);

    expect(a.connections()).toBe(2);
  });

  it("keeps a connection while a shell over it is open, however long ago it was handed out", async () => {
    sshService = new SSHService({
      ...GRACE,
      terminalIdleMs: 300,
      terminalSweepMs: 50,
    });
    const a = await startServer(SERVER_A.answers);

    // Two shells share a connection, and the first ends, which the pool hears twice:
    // from its cleanup, and when it closes. It's one shell, and the other is still open.
    const first = await openShell(a.port);
    const second = await openShell(a.port);
    expect(a.connections()).toBe(1);
    endAsTheTerminalDoes(first);
    await until("the first shell to close", first.closed);

    // Well past the time the pool keeps a connection with no shells, with sweeps all
    // along.
    await wait(1_000);
    expect(second.closed()).toBe(false);
    expect([a.open(), a.shells()]).toEqual([1, 1]);
    expect(await answers(second.shell)).toBe(true);

    // Its idle time counts from when its last shell closed.
    const lastClosed = new Promise<number>((resolve) =>
      second.shell.once("close", () => resolve(performance.now())),
    );
    second.shell.close();
    const closedAt = await lastClosed;
    await until("the connection to close", () => a.open() === 0);
    expect(performance.now() - closedAt).toBeGreaterThanOrEqual(250);
  });

  it("keeps five shells going after a sixth opens, and closes their connection after the last", async () => {
    const a = await startServer(SERVER_A.answers);

    // Five shells share a connection, and the sixth gets a new one.
    const firstFive: OpenedShell[] = [];
    for (let shells = 0; shells < 5; shells += 1) {
      firstFive.push(await openShell(a.port));
    }
    await openShell(a.port);
    expect(a.connections()).toBe(2);

    // Longer than the 5 seconds the pool used to give them before it closed their
    // connection.
    await wait(5_500);
    expect(firstFive.filter(({ closed }) => closed()).length).toBe(0);
    expect([a.open(), a.shells()]).toEqual([2, 6]);
    for (const { shell } of firstFive) {
      expect(await answers(shell)).toBe(true);
    }

    // Their connection closes with the last of them, and not before.
    const last = firstFive.pop()!;
    firstFive.forEach(endAsTheTerminalDoes);
    await until(
      "four shells to close, here and at the server",
      () => firstFive.every(({ closed }) => closed()) && a.shells() === 2,
    );
    await wait(300);
    expect(last.closed()).toBe(false);
    expect([a.open(), a.shells()]).toEqual([2, 2]);
    endAsTheTerminalDoes(last);
    await until(
      "the first connection to close",
      () => a.open() === 1 && a.shells() === 1,
    );
  });

  it("keeps a connection whose check failed until its shell has closed", async () => {
    // As OpenSSH with `MaxSessions 1`. Before the pool hands a connection out again, it
    // runs a command over it, a second session, which the server refuses.
    const a = await startServer(SERVER_A.answers, { maxSessions: 1 });

    const first = await openShell(a.port);
    const second = await openShell(a.port);
    expect(a.connections()).toBe(2);

    await wait(500);
    expect(first.closed()).toBe(false);
    expect([a.open(), a.shells()]).toEqual([2, 2]);
    expect(await answers(first.shell)).toBe(true);

    // Out of the pool, the first connection closes once its shell has.
    endAsTheTerminalDoes(first);
    await until("the first connection to close", () => a.open() === 1);
    expect(second.closed()).toBe(false);
  });

  it("keeps a connection whose server refused a shell until its other shell has closed", async () => {
    // Two terminals at once share the connection being made, and the server allows a
    // connection one session, as OpenSSH with `MaxSessions 1`.
    const a = await startServer(SERVER_A.answers, { maxSessions: 1 });

    const results = await Promise.allSettled([
      openShell(a.port),
      openShell(a.port),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const refused = results.find(({ status }) => status === "rejected");
    expect(String((refused as PromiseRejectedResult).reason)).toContain(
      "(SSH) Channel open failure",
    );
    const { value: opened } = results.find(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<OpenedShell>;
    expect(a.connections()).toBe(1);

    await wait(500);
    expect(opened.closed()).toBe(false);
    expect([a.open(), a.shells()]).toEqual([1, 1]);
    expect(await answers(opened.shell)).toBe(true);

    // Out of the pool, it closes once that shell has.
    endAsTheTerminalDoes(opened);
    await until("the connection to close", () => a.open() === 0);
  });

  it("closes a shell that opens after it stopped waiting, and doesn't count it", async () => {
    // The only shell here is the one the server holds, so the short limit on opening a
    // shell is never a race. The pool measures how long it has kept a connection with
    // Date.now(), which stands still until the clock is moved on below.
    let now = Date.now();
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      sshService = new SSHService({
        ...GRACE,
        terminalShellMs: 200,
        terminalIdleMs: 100,
        terminalSweepMs: 50,
      });
      const letShellThrough = gate();
      const a = await startServer(SERVER_A.answers, {
        holdFirstShell: letShellThrough.opened,
      });

      await expect(openShell(a.port)).rejects.toThrow(
        "Shell creation timeout - server may be overloaded",
      );
      // The server opens it after all, when nothing would ever read it or end it.
      letShellThrough.open();
      await until(
        "the late shell to close",
        () => a.shellsOpened() === 1 && a.shells() === 0,
      );
      expect(a.open()).toBe(1);

      // Nor does it count as the connection's shell: with none, the connection is idle,
      // so once the clock moves past the limit, the next sweep closes it.
      now += 1_000;
      await until("the connection to close", () => a.open() === 0);
    } finally {
      clock.mockRestore();
    }
  });
});
