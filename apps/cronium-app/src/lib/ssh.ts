import {
  createSSHPoolKey,
  type SSHAuthType,
  type SSHConnectionScope,
} from "@/lib/ssh/pool-key";
import { createHostVerifier } from "@/lib/ssh/host-verifier";
import type { Socket } from "net";
import { Client } from "ssh2"; // Import Client from ssh2
import type { ClientChannel, ConnectConfig } from "ssh2";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";
import { connectWithSearch } from "@/lib/resolve-host";

/**
 * SSH connection debug logging is gated behind CRONIUM_SSH_DEBUG because the
 * ssh2 debug stream includes auth-protocol lines. Off by default.
 */
const SSH_DEBUG_ENABLED = Boolean(process.env.CRONIUM_SSH_DEBUG);

/**
 * Best-effort extraction of the owning server id from an opaque connection
 * scope so the host-key verifier can look up / persist the trusted key. Scopes
 * created by createServerSSHConnectionScope are JSON `{kind:"server", serverId}`.
 */
function serverIdFromScope(
  connectionScope: SSHConnectionScope,
): number | undefined {
  try {
    const parsed = JSON.parse(connectionScope) as {
      kind?: string;
      serverId?: number;
    };
    if (
      parsed.kind === "server" &&
      typeof parsed.serverId === "number" &&
      Number.isInteger(parsed.serverId)
    ) {
      return parsed.serverId;
    }
  } catch {
    // Non-JSON / unexpected scope shape: no server context available.
  }
  return undefined;
}

/**
 * `client.connect` with a socket of our own, because ssh2 otherwise looks the host up
 * with `dns.lookup`, and a server's address is whatever its owner typed: see
 * lib/resolve-host.ts.
 *
 * The socket has to exist before ssh2 sees it, and ssh2 throws on a key it can't parse
 * before it listens for anything. So close it then, or its failure would be an `error`
 * event with nobody listening, which ends the process.
 *
 * Hands back the socket, for `closeConnection`.
 */
function connectOverOwnSocket(
  client: Client,
  config: ConnectConfig & { host: string; port: number },
): Socket {
  const sock = connectWithSearch(config.host, config.port);
  try {
    client.connect({ ...config, sock });
  } catch (error) {
    sock.destroy();
    throw error;
  }
  return sock;
}

/**
 * Closes `client` and the socket under it, whatever the server does.
 *
 * `client.end()` says goodbye and closes our side, then waits for the server to close
 * its side. A server that never does would keep the socket open for as long as the
 * process runs, and `client.destroy()` does nothing once `end()` has run, because ssh2
 * only destroys a socket it can still write to. So the socket itself goes `graceMs`
 * later if it's still open.
 */
function closeConnection(
  client: Client,
  socket: Socket,
  graceMs: number,
): void {
  client.end();
  if (socket.destroyed) return;
  const closeAnyway = setTimeout(() => socket.destroy(), graceMs).unref();
  socket.once("close", () => clearTimeout(closeAnyway));
}

/** The socket under each connection `connect` or the terminal's pool made, for `disconnect`. */
const socketOf = new WeakMap<Client, Socket>();

/** `work`, unless `ms` pass first: then a rejection with `timedOut()`. */
function withinTime<T>(
  work: Promise<T>,
  ms: number,
  timedOut: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timedOut()), ms).unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

/** Runs `command` over `connection` and collects what it printed. */
function runCommand(
  connection: Client,
  command: string,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    connection.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream.on("data", (data: Buffer) => (stdout += data.toString()));
      stream.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
      stream.on("close", () => resolve({ stdout, stderr }));
    });
  });
}

/** A health check's commands, each after the one before, over the check's own connection. */
async function readSystemInfo(connection: Client) {
  const platformResult = await runCommand(connection, "uname -s");
  const releaseResult = await runCommand(connection, "uname -r");
  const cpuResult = await runCommand(connection, "nproc");
  const memoryResult = await runCommand(connection, "free -h | grep Mem");
  const uptimeResult = await runCommand(connection, "uptime -p");
  return {
    platformResult,
    releaseResult,
    cpuResult,
    memoryResult,
    uptimeResult,
  };
}

interface SSHConnection {
  ssh: Client; // Changed from NodeSSH to ssh2 Client
  isConnected: boolean;
  poolKey: string;
  lastUsed: number;
}

interface SSHConnectionRequest {
  connectionScope: SSHConnectionScope;
  host: string;
  authCredential: string;
  username: string;
  port: number;
  forceNew?: boolean;
  authType: SSHAuthType;
}

export interface SSHServiceLimits {
  /**
   * How long a health check's commands may take, all five together, once it has
   * connected. A server that takes longer is reported offline.
   */
  healthCheckCommandsMs?: number;
  /**
   * How long closing a connection waits for the server to close its side before
   * closing the socket outright.
   */
  closeGraceMs?: number;
  /** How long a terminal's new connection may take to be ready. */
  terminalConnectMs?: number;
  /** How long the pool keeps a terminal's connection after it last handed it out. */
  terminalIdleMs?: number;
  /** How often the pool looks for connections it has kept that long. */
  terminalSweepMs?: number;
  /**
   * How long a terminal's connection that reached its channel limit keeps going once a
   * new one has replaced it, so that its shells can finish, before it's closed.
   */
  replacedConnectionMs?: number;
}

export class SSHService {
  private connectionPool = new Map<string, SSHConnection>();
  private maxConnections = 3; // Further reduced to prevent overwhelming servers
  private maxChannelsPerConnection = 5; // Reduced SSH channels limit per connection
  private channelCounts = new Map<string, number>(); // Track open channels
  private readonly healthCheckCommandsMs: number;
  private readonly closeGraceMs: number;
  private readonly terminalConnectMs: number;
  private readonly terminalIdleMs: number;
  private readonly replacedConnectionMs: number;

  constructor({
    healthCheckCommandsMs = 30_000,
    closeGraceMs = 5_000,
    terminalConnectMs = 20_000,
    terminalIdleMs = 300_000, // 5 minutes - longer for terminal sessions
    terminalSweepMs = 120_000,
    replacedConnectionMs = 5_000,
  }: SSHServiceLimits = {}) {
    this.healthCheckCommandsMs = healthCheckCommandsMs;
    this.closeGraceMs = closeGraceMs;
    this.terminalConnectMs = terminalConnectMs;
    this.terminalIdleMs = terminalIdleMs;
    this.replacedConnectionMs = replacedConnectionMs;
    // Clean up stale connections every 2 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
    }, terminalSweepMs).unref();
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Use Array.from to handle Map iteration
    Array.from(this.connectionPool.entries()).forEach(([key, connection]) => {
      if (now - connection.lastUsed > this.terminalIdleMs) {
        try {
          this.disconnect(connection.ssh);
        } catch (error) {
          console.error(
            `Failed to close SSH connection for key ${key}:`,
            failureWithStack(error),
          );
          // Ignore cleanup errors
        }
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.connectionPool.delete(key));
  }

  private connectionLocks = new Map<string, Promise<SSHConnection>>();

  private async getPooledConnection(
    request: SSHConnectionRequest,
  ): Promise<SSHConnection> {
    const {
      connectionScope,
      host,
      authCredential,
      username,
      port,
      forceNew = false,
      authType,
    } = request;
    const connectionKey = createSSHPoolKey({
      connectionScope,
      host,
      username,
      port,
      authType,
      authCredential,
    });

    // Check if there's already a connection being established for this key
    if (this.connectionLocks.has(connectionKey)) {
      console.log(
        `Waiting for existing connection to ${connectionKey ?? ""}...`,
      );
      return await this.connectionLocks.get(connectionKey)!;
    }

    // Check if we have a valid existing connection and not forcing new
    if (!forceNew && this.connectionPool.has(connectionKey)) {
      const connection = this.connectionPool.get(connectionKey)!;
      if (connection.isConnected) {
        // Test the connection is still alive with a timeout
        try {
          await withinTime(
            new Promise<void>((resolve, reject) => {
              connection.ssh.exec('echo "test"', (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              });
            }),
            5000,
            () => new Error("Connection test timeout"),
          );
          connection.lastUsed = Date.now();
          console.log(`Reusing existing connection to ${connectionKey ?? ""}`);
          return connection;
        } catch (error) {
          console.log(
            `Existing connection to ${connectionKey ?? ""} failed test: ${describeFailure(error)}`,
          );
          // Connection is dead, remove it
          try {
            this.disconnect(connection.ssh);
          } catch (error) {
            console.error(
              `Failed to dispose dead SSH connection for ${connectionKey}:`,
              failureWithStack(error),
            );
            // Ignore disposal errors
          }
          this.connectionPool.delete(connectionKey);
        }
      } else {
        // Remove stale connection
        this.connectionPool.delete(connectionKey);
      }
    }

    // Create a promise for the new connection and lock it
    const connectionPromise = this.createNewConnection(
      host,
      authCredential,
      username,
      port,
      connectionKey,
      authType,
      serverIdFromScope(connectionScope),
    );
    this.connectionLocks.set(connectionKey, connectionPromise);

    try {
      const connection = await connectionPromise;
      return connection;
    } finally {
      // Always remove the lock when done
      this.connectionLocks.delete(connectionKey);
    }
  }

  private async createNewConnection(
    host: string,
    authCredential: string,
    username: string,
    port: number,
    connectionKey: string,
    authType: "privateKey" | "password" = "privateKey",
    serverId?: number,
  ): Promise<SSHConnection> {
    // Clean up old connections if we're at max capacity
    if (this.connectionPool.size >= this.maxConnections) {
      this.cleanupStaleConnections();
    }

    console.log(`Creating new SSH connection to ${connectionKey ?? ""}...`);

    // Create new connection
    const ssh = new Client();

    return new Promise((resolve, reject) => {
      let ready = false;
      const connectionTimeout = setTimeout(() => {
        this.disconnect(ssh);
        reject(new Error(`Connection to ${host ?? ""} timed out.`));
      }, this.terminalConnectMs).unref(); // Use readyTimeout from connect options

      ssh.on("ready", () => {
        ready = true;
        clearTimeout(connectionTimeout);
        const connection: SSHConnection = {
          ssh,
          isConnected: true,
          poolKey: connectionKey,
          lastUsed: Date.now(),
        };
        this.connectionPool.set(connectionKey, connection);
        console.log(
          `Successfully created SSH connection to ${connectionKey ?? ""}`,
        );
        resolve(connection);
      });
      ssh.on("error", (err) => {
        clearTimeout(connectionTimeout);
        console.error(
          `Failed to create SSH connection to ${connectionKey ?? ""}:`,
          failureWithStack(err),
        );

        // Provide more specific error messages
        let errorMessage = `Server ${host ?? ""} is not reachable`;
        if (err.message) {
          if (err.message.includes("ECONNREFUSED")) {
            errorMessage = `Connection refused by ${host}:${port}. Verify the server is running and accepting SSH connections.`;
          } else if (
            err.message.includes("ETIMEDOUT") ||
            err.message.includes("ECONNABORTED")
          ) {
            errorMessage = `Connection to ${host}:${port} timed out. Check if the server is reachable and firewall rules allow SSH.`;
          } else if (
            err.message.includes("authentication") ||
            err.message.includes("publickey") ||
            err.message.includes("password")
          ) {
            errorMessage = `Authentication failed for ${username}@${host}. Please verify your ${authType === "password" ? "password" : "SSH key"} is correct.`;
          } else if (err.message.includes("EHOSTUNREACH")) {
            errorMessage = `Host ${host} is unreachable. Check network connectivity.`;
          } else if (err.message.includes("getaddrinfo")) {
            errorMessage = `Cannot resolve hostname ${host}. Check if the address is correct.`;
          } else {
            errorMessage = `SSH connection failed: ${err.message}`;
          }
        }

        // Nothing else would close a connection that never got into the pool, and after
        // a refused password ssh2 has already said goodbye and waits for the server.
        if (!ready) this.disconnect(ssh);
        reject(new Error(errorMessage));
      });
      // This connection, and nothing else: by the time it ends, one that replaced it can
      // be in the pool under the same key.
      const leavePool = () => {
        if (this.connectionPool.get(connectionKey)?.ssh === ssh) {
          this.connectionPool.delete(connectionKey);
        }
      };
      ssh.on("end", () => {
        console.log(`SSH connection to ${connectionKey ?? ""} ended.`);
        leavePool();
      });
      ssh.on("close", () => {
        console.log(`SSH connection to ${connectionKey ?? ""} closed.`);
        leavePool();
      });
      // The handlers above only ever run after this returns, so `disconnect` finds the
      // socket recorded. If it throws, connectOverOwnSocket has closed the socket itself.
      const socket = connectOverOwnSocket(ssh, {
        host,
        username,
        ...(authType === "password"
          ? { password: authCredential }
          : { privateKey: authCredential }),
        port,
        readyTimeout: 20000,
        // Verify the server's host key (TOFU) before the credential is sent.
        hostVerifier: createHostVerifier({ serverId, host }),
        // Auth-protocol debug logging is opt-in (CRONIUM_SSH_DEBUG) to avoid
        // routinely logging every SSH auth line.
        ...(SSH_DEBUG_ENABLED
          ? {
              debug: (info) => {
                if (
                  info.includes("authentication") ||
                  info.includes("publickey") ||
                  info.includes("password")
                ) {
                  console.log(`SSH Auth Debug for ${connectionKey}: ${info}`);
                }
              },
            }
          : {}),
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        tryKeyboard: false,
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group16-sha512",
          ],
          cipher: [
            "aes128-ctr",
            "aes192-ctr",
            "aes256-ctr",
            "aes128-gcm",
            "aes256-gcm",
          ],
          serverHostKey: [
            "rsa-sha2-512",
            "rsa-sha2-256",
            "ssh-rsa",
            "ecdsa-sha2-nistp256",
          ],
          hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
        },
      });
      socketOf.set(ssh, socket);
    });
  }

  /**
   * Connects to a server, and hands back the connection for the caller to close with
   * `disconnect`. It's the caller's alone: `sshService` is one object for the whole
   * process, so a connection kept on it would be used and closed by whichever call
   * came next, another user's included.
   */
  public async connect(
    host: string,
    authCredential: string,
    username = "root",
    port = 22,
    authType: "privateKey" | "password" = "privateKey",
    serverId?: number,
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client();
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        this.disconnect(sshClient);
        reject(error);
      };
      const connectionTimeout = setTimeout(() => {
        fail(new Error(`Connection to ${host ?? ""} timed out.`));
      }, 60000).unref(); // Use readyTimeout from connect options

      sshClient
        .on("ready", () => {
          if (settled) {
            // Too late: nobody is waiting for it, so nobody else would close it.
            this.disconnect(sshClient);
            return;
          }
          settled = true;
          clearTimeout(connectionTimeout);
          resolve(sshClient);
        })
        // Stays for as long as the connection does. An `error` event with nobody
        // listening would end the process, and what the connection was doing fails by
        // itself.
        .on("error", fail);
      // The handlers above only ever run after this returns, so `disconnect` finds the
      // socket recorded. If it throws, connectOverOwnSocket has closed the socket itself.
      const socket = connectOverOwnSocket(sshClient, {
        host,
        username,
        ...(authType === "password"
          ? { password: authCredential }
          : { privateKey: authCredential }),
        port,
        readyTimeout: 60000,
        // Verify the server's host key (TOFU) before the credential is sent.
        hostVerifier: createHostVerifier({ serverId, host }),
        keepaliveInterval: 5000,
        keepaliveCountMax: 10,
        tryKeyboard: false,
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group14-sha256",
          ],
          cipher: ["aes128-ctr", "aes192-ctr", "aes256-ctr"],
          serverHostKey: ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"],
          hmac: ["hmac-sha2-256", "hmac-sha2-512"],
        },
      });
      socketOf.set(sshClient, socket);
    });
  }

  /**
   * Tests an SSH connection to verify credentials and connectivity
   */
  public async testConnection(
    host: string,
    authCredential: string,
    username = "root",
    port = 22,
    authType: "privateKey" | "password" = "privateKey",
    serverId?: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const connection = await this.connect(
        host,
        authCredential,
        username,
        port,
        authType,
        serverId,
      );
      this.disconnect(connection);
      return { success: true, message: "Connection successful" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown SSH connection error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Closes a connection that `connect` or the terminal's pool made. The server gets
   * `closeGraceMs` to close its side, and then the socket closes anyway.
   */
  public disconnect(connection: Client): void {
    const socket = socketOf.get(connection);
    if (socket) closeConnection(connection, socket, this.closeGraceMs);
    else connection.end();
  }

  async checkServerHealth(server: {
    id: number;
    name: string;
    address: string;
    sshKey: string | null;
    password?: string | null;
    username: string;
    port: number;
  }): Promise<{
    online: boolean;
    systemInfo: {
      platform?: string;
      release?: string;
      cpuCores?: number;
      totalMemory?: string;
      freeMemory?: string;
      uptime?: {
        days: number;
        hours: number;
        minutes: number;
      };
    };
    error?: string;
  }> {
    try {
      // Determine auth type and credential
      const authCredential = server.sshKey ?? server.password ?? "";
      const authType = server.sshKey ? "privateKey" : "password";

      const connection = await this.connect(
        server.address,
        authCredential,
        server.username,
        server.port,
        authType,
        server.id,
      );

      // Get system information, unless the server takes too long, and close the
      // connection however that went. A command that never finishes would otherwise
      // hold the request and its connection for good.
      const {
        platformResult,
        releaseResult,
        cpuResult,
        memoryResult,
        uptimeResult,
      } = await withinTime(
        readSystemInfo(connection),
        this.healthCheckCommandsMs,
        () =>
          new Error(
            `Health check timed out: ${server.address} didn't answer its commands within ${this.healthCheckCommandsMs / 1000} seconds.`,
          ),
      ).finally(() => this.disconnect(connection));

      // Parse memory information
      let totalMemory = "";
      let freeMemory = "";
      if (memoryResult.stdout) {
        const memParts = memoryResult.stdout.trim().split(/\s+/);
        if (memParts.length >= 4) {
          totalMemory = memParts[1] ?? "";
          freeMemory = memParts[3] ?? "";
        }
      }

      // Parse uptime
      const uptime = { days: 0, hours: 0, minutes: 0 };
      if (uptimeResult.stdout) {
        const uptimeStr = uptimeResult.stdout.replace("up ", "");
        const dayMatch = /(\d+) days?/.exec(uptimeStr);
        const hourMatch = /(\d+) hours?/.exec(uptimeStr);
        const minuteMatch = /(\d+) minutes?/.exec(uptimeStr);

        if (dayMatch?.[1]) uptime.days = parseInt(dayMatch[1]);
        if (hourMatch?.[1]) uptime.hours = parseInt(hourMatch[1]);
        if (minuteMatch?.[1]) uptime.minutes = parseInt(minuteMatch[1]);
      }

      return {
        online: true,
        systemInfo: {
          platform: platformResult.stdout.trim() || "Unknown",
          release: releaseResult.stdout.trim() || "Unknown",
          cpuCores: parseInt(cpuResult.stdout.trim()) || 0,
          totalMemory,
          freeMemory,
          uptime,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown health check error";
      return {
        online: false,
        systemInfo: {
          platform: "Unknown",
          release: "Unknown",
          cpuCores: 0,
          totalMemory: "0",
          freeMemory: "0",
          uptime: { days: 0, hours: 0, minutes: 0 },
        },
        error: errorMessage,
      };
    }
  }

  async openShell(
    connectionScope: SSHConnectionScope,
    host: string,
    authCredential: string,
    username = "root",
    port = 22,
    cols = 80,
    rows = 30,
    authType: "privateKey" | "password" = "privateKey",
  ): Promise<{
    shell: ClientChannel;
    connectionKey: string;
    cleanup: () => void;
  }> {
    const connectionKey = createSSHPoolKey({
      connectionScope,
      host,
      username,
      port,
      authType,
      authCredential,
    });

    // Check if we've hit the channel limit for this connection
    const currentChannels = this.channelCounts.get(connectionKey) ?? 0;

    // Lower the threshold to prevent hitting server limits (use maxChannelsPerConnection)
    const shouldForceNew = currentChannels >= this.maxChannelsPerConnection;

    if (shouldForceNew) {
      console.log(
        `Channel limit reached for ${connectionKey} (${currentChannels}/${this.maxChannelsPerConnection} channels), forcing new connection`,
      );
      // Remove the overloaded connection gracefully
      const oldConnection = this.connectionPool.get(connectionKey);
      if (oldConnection) {
        try {
          // Don't end the connection immediately - let existing channels finish
          this.connectionPool.delete(connectionKey);
          // Schedule connection cleanup after a delay
          setTimeout(() => {
            try {
              if (oldConnection.ssh) {
                this.disconnect(oldConnection.ssh);
              }
            } catch (e) {
              console.error(
                `Error cleaning up old connection: ${describeFailure(e)}`,
              );
            }
          }, this.replacedConnectionMs);
        } catch (e) {
          console.error(`Error handling old connection: ${describeFailure(e)}`);
        }
      }
    }

    const connection = await this.getPooledConnection({
      connectionScope,
      host,
      authCredential,
      username,
      port,
      forceNew: shouldForceNew,
      authType,
    });

    // Verify connection is actually connected
    if (!connection.isConnected || !connection.ssh) {
      throw new Error(`SSH connection to ${host} is not established`);
    }

    // Check if the ssh2 Client is actually connected
    // @ts-expect-error - accessing private property for debugging
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sock = connection.ssh._sock;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const isDestroyed = sock?.destroyed;
    if (!sock || isDestroyed) {
      console.error(
        `SSH client socket is not connected or destroyed for ${host}`,
      );
      // Try to remove the bad connection and create a new one
      this.connectionPool.delete(connection.poolKey);
      this.channelCounts.delete(connection.poolKey);

      // Get a fresh connection
      const freshConnection = await this.getPooledConnection({
        connectionScope,
        host,
        authCredential,
        username,
        port,
        forceNew: true,
        authType,
      });

      const shell = await new Promise<ClientChannel>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(
            new Error("Shell creation timeout - server may be overloaded"),
          );
        }, 10000);

        freshConnection.ssh.shell(
          {
            term: "xterm",
            cols,
            rows,
          },
          (err, stream) => {
            clearTimeout(timeoutId);

            if (err) {
              // Clean up the fresh connection if it fails
              this.connectionPool.delete(freshConnection.poolKey);
              this.channelCounts.delete(freshConnection.poolKey);
              try {
                this.disconnect(freshConnection.ssh);
              } catch {
                // Ignore cleanup errors
              }
              return reject(
                new Error(
                  "Unable to open shell - SSH server may have reached its limit",
                ),
              );
            }

            // Track channel count
            const key = freshConnection.poolKey;
            const newCount = (this.channelCounts.get(key) ?? 0) + 1;
            this.channelCounts.set(key, newCount);
            console.log(
              `Channel opened for ${key}, total channels: ${newCount}`,
            );

            // Track if cleanup was already called
            let cleanupCalled = false;

            // Clean up channel count on close
            const handleClose = () => {
              if (!cleanupCalled) {
                cleanupCalled = true;
                const count = this.channelCounts.get(key) ?? 1;
                if (count <= 1) {
                  this.channelCounts.delete(key);
                } else {
                  this.channelCounts.set(key, count - 1);
                }
                console.log(
                  `Channel closed for ${key}, remaining channels: ${count - 1}`,
                );
              }
            };

            stream.on("close", handleClose);
            stream.on("end", handleClose);

            resolve(stream);
          },
        );
      });

      console.log(
        `Opened interactive shell for ${freshConnection.poolKey} (new connection)`,
      );
      freshConnection.lastUsed = Date.now();

      // Create manual cleanup function
      const cleanup = () => {
        const key = freshConnection.poolKey;
        const count = this.channelCounts.get(key) ?? 0;
        if (count > 0) {
          const newCount = count - 1;
          if (newCount <= 0) {
            this.channelCounts.delete(key);
          } else {
            this.channelCounts.set(key, newCount);
          }
          console.log(
            `Manual cleanup: Channel closed for ${key}, remaining channels: ${newCount}`,
          );
        }
      };

      return { shell, connectionKey: freshConnection.poolKey, cleanup };
    }

    const shell = await new Promise<ClientChannel>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Shell creation timeout - server may be overloaded"));
      }, 10000); // 10 second timeout for shell creation

      connection.ssh.shell(
        {
          term: "xterm",
          cols,
          rows,
        },
        (err, stream) => {
          clearTimeout(timeoutId);

          if (err) {
            // If shell creation fails, it might be due to channel limits
            // Remove this connection from the pool to force a fresh one next time
            if (err.message?.includes("Channel open failure")) {
              console.error(
                `Shell creation failed due to channel limits, removing connection from pool`,
              );
              this.connectionPool.delete(connection.poolKey);
              this.channelCounts.delete(connection.poolKey);

              // Try to gracefully close the connection
              try {
                this.disconnect(connection.ssh);
              } catch {
                // Ignore cleanup errors
              }
            }
            return reject(err);
          }

          // Track channel count
          const key = connection.poolKey;
          const newCount = (this.channelCounts.get(key) ?? 0) + 1;
          this.channelCounts.set(key, newCount);
          console.log(`Channel opened for ${key}, total channels: ${newCount}`);

          // Track if cleanup was already called to prevent double cleanup
          let cleanupCalled = false;

          // Clean up channel count on close
          const handleClose = () => {
            if (!cleanupCalled) {
              cleanupCalled = true;
              const count = this.channelCounts.get(key) ?? 1;
              if (count <= 1) {
                this.channelCounts.delete(key);
              } else {
                this.channelCounts.set(key, count - 1);
              }
              console.log(
                `Channel closed for ${key}, remaining channels: ${count - 1}`,
              );
            }
          };

          stream.on("close", handleClose);
          stream.on("end", handleClose); // Also listen for end event

          resolve(stream);
        },
      );
    });

    console.log(
      `Opened interactive shell for ${connection.poolKey}, channels: ${this.channelCounts.get(connection.poolKey) ?? 1}`,
    );
    connection.lastUsed = Date.now(); // Update last used time

    // Create manual cleanup function
    const cleanup = () => {
      const key = connection.poolKey;
      const count = this.channelCounts.get(key) ?? 0;
      if (count > 0) {
        const newCount = count - 1;
        if (newCount <= 0) {
          this.channelCounts.delete(key);
        } else {
          this.channelCounts.set(key, newCount);
        }
        console.log(
          `Manual cleanup: Channel closed for ${key}, remaining channels: ${newCount}`,
        );
      }
    };

    return { shell, connectionKey: connection.poolKey, cleanup };
  }
}

export const sshService = new SSHService();
