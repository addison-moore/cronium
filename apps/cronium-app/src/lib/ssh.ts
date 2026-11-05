import {
  createSSHPoolKey,
  type SSHAuthType,
  type SSHConnectionScope,
} from "@/lib/ssh/pool-key";
import { createHostVerifier } from "@/lib/ssh/host-verifier";
import { Client } from "ssh2"; // Import Client from ssh2
import type { ClientChannel } from "ssh2";

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

export class SSHService {
  private ssh?: Client; // Changed to optional ssh2 Client
  private isConnected = false;
  private connectionPool = new Map<string, SSHConnection>();
  private maxConnections = 3; // Further reduced to prevent overwhelming servers
  private maxChannelsPerConnection = 5; // Reduced SSH channels limit per connection
  private connectionTimeout = 300000; // 5 minutes - longer for terminal sessions
  private channelCounts = new Map<string, number>(); // Track open channels

  constructor() {
    // Clean up stale connections every 2 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 120000);
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Use Array.from to handle Map iteration
    Array.from(this.connectionPool.entries()).forEach(([key, connection]) => {
      if (now - connection.lastUsed > this.connectionTimeout) {
        try {
          connection.ssh.end();
        } catch (error) {
          console.error(
            `Failed to close SSH connection for key ${key}:`,
            error,
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
          await Promise.race([
            new Promise<void>((resolve, reject) => {
              connection.ssh.exec('echo "test"', (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              });
            }),
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new Error("Connection test timeout")),
                5000,
              ),
            ),
          ]);
          connection.lastUsed = Date.now();
          console.log(`Reusing existing connection to ${connectionKey ?? ""}`);
          return connection;
        } catch (error) {
          console.log(
            `Existing connection to ${connectionKey ?? ""} failed test: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Connection is dead, remove it
          try {
            connection.ssh.end();
          } catch (error) {
            console.error(
              `Failed to dispose dead SSH connection for ${connectionKey}:`,
              error,
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
      const connectionTimeout = setTimeout(() => {
        ssh.end();
        reject(new Error(`Connection to ${host ?? ""} timed out.`));
      }, 20000); // Use readyTimeout from connect options

      ssh.on("ready", () => {
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
          err,
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

        reject(new Error(errorMessage));
      });
      ssh.on("end", () => {
        console.log(`SSH connection to ${connectionKey ?? ""} ended.`);
        this.connectionPool.delete(connectionKey);
      });
      ssh.on("close", () => {
        console.log(`SSH connection to ${connectionKey ?? ""} closed.`);
        this.connectionPool.delete(connectionKey);
      });
      ssh.connect({
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
    });
  }

  /**
   * Establishes an SSH connection to a remote server
   */
  public async connect(
    host: string,
    authCredential: string,
    username = "root",
    port = 22,
    authType: "privateKey" | "password" = "privateKey",
    serverId?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client();
      const connectionTimeout = setTimeout(() => {
        sshClient.end();
        reject(new Error(`Connection to ${host ?? ""} timed out.`));
      }, 60000); // Use readyTimeout from connect options

      sshClient
        .on("ready", () => {
          clearTimeout(connectionTimeout);
          this.ssh = sshClient;
          this.isConnected = true;
          resolve();
        })
        .on("error", (err) => {
          clearTimeout(connectionTimeout);
          this.isConnected = false;
          reject(err);
        })
        .connect({
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
      await this.connect(
        host,
        authCredential,
        username,
        port,
        authType,
        serverId,
      );
      await this.disconnect();
      return { success: true, message: "Connection successful" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown SSH connection error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Disconnects the current SSH session
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected && this.ssh) {
      this.ssh.end();
      this.isConnected = false;
      delete this.ssh;
    }
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

      await this.connect(
        server.address,
        authCredential,
        server.username,
        server.port,
        authType,
        server.id,
      );

      // Get system information
      const platformResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uname -s", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const releaseResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uname -r", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const cpuResult = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          this.ssh!.exec("nproc", (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => (stdout += data.toString()));
            stream.stderr.on(
              "data",
              (data: Buffer) => (stderr += data.toString()),
            );
            stream.on("close", () => resolve({ stdout, stderr }));
          });
        },
      );
      const memoryResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("free -h | grep Mem", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const uptimeResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uptime -p", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });

      await this.disconnect();

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
                oldConnection.ssh.end();
              }
            } catch (e) {
              console.error(`Error cleaning up old connection: ${String(e)}`);
            }
          }, 5000);
        } catch (e) {
          console.error(`Error handling old connection: ${String(e)}`);
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
                freshConnection.ssh.end();
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
                connection.ssh.end();
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
