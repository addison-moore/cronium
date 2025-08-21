/**
 * Shared SSH utilities and interfaces
 *
 * Common SSH functionality used by both terminal and script execution
 */

import { NodeSSH } from "node-ssh";

export interface SSHConnection {
  ssh: NodeSSH;
  isConnected: boolean;
  lastUsed: number;
}

export interface SSHConnectionConfig {
  host: string;
  privateKey?: string;
  password?: string;
  username: string;
  port: number;
}

export class SSHConnectionManager {
  private connectionPool = new Map<string, SSHConnection>();
  private connectionLocks = new Map<string, Promise<SSHConnection>>();
  private readonly maxPoolSize = 5;
  private readonly connectionTimeout = 30000;
  private readonly idleTimeout = 300000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  private getConnectionKey(
    host: string,
    username: string,
    port: number,
  ): string {
    return `${username}@${host}:${port}`;
  }

  private startCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // Check every minute
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    this.connectionPool.forEach((connection, key) => {
      if (now - connection.lastUsed > this.idleTimeout) {
        connectionsToRemove.push(key);
        try {
          connection.ssh.dispose();
        } catch (error) {
          console.error(`Error disposing idle connection ${key}:`, error);
        }
      }
    });

    connectionsToRemove.forEach((key) => {
      this.connectionPool.delete(key);
      console.log(`Cleaned up idle SSH connection: ${key}`);
    });
  }

  // Updated to support both privateKey and password authentication
  async getPooledConnection(
    host: string,
    authCredential: string, // Can be either privateKey or password
    username = "root",
    port = 22,
    forceNew = false,
    authType: "privateKey" | "password" = "privateKey",
  ): Promise<SSHConnection> {
    const connectionKey = this.getConnectionKey(host, username, port);

    // Check if there's already a connection being established for this key
    if (this.connectionLocks.has(connectionKey)) {
      console.log(`Waiting for existing connection to ${connectionKey}...`);
      return await this.connectionLocks.get(connectionKey)!;
    }

    // Check if we have a valid existing connection and not forcing new
    if (!forceNew && this.connectionPool.has(connectionKey)) {
      const connection = this.connectionPool.get(connectionKey)!;
      if (connection.isConnected) {
        // Test the connection is still alive
        try {
          await connection.ssh.execCommand('echo "test"');
          connection.lastUsed = Date.now();
          console.log(`Reusing existing connection to ${connectionKey}`);
          return connection;
        } catch {
          console.log(
            `Existing connection to ${connectionKey} failed test, removing...`,
          );
          // Connection is dead, remove it
          try {
            connection.ssh.dispose();
          } catch {
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
    );
    this.connectionLocks.set(connectionKey, connectionPromise);

    try {
      const connection = await connectionPromise;
      return connection;
    } finally {
      // Remove the lock regardless of success or failure
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
  ): Promise<SSHConnection> {
    console.log(
      `Creating new SSH connection to ${connectionKey} using ${authType}...`,
    );

    const ssh = new NodeSSH();

    try {
      const connectionConfig: Config = {
        host,
        username,
        port,
        readyTimeout: this.connectionTimeout,
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group16-sha512",
            "diffie-hellman-group18-sha512",
            "diffie-hellman-group-exchange-sha256",
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
            "ecdsa-sha2-nistp384",
            "ecdsa-sha2-nistp521",
            "ssh-ed25519",
          ],
          hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
        },
        ...(authType === "password"
          ? { password: authCredential }
          : { privateKey: authCredential }),
      };

      await ssh.connect(connectionConfig);

      const connection: SSHConnection = {
        ssh,
        isConnected: true,
        lastUsed: Date.now(),
      };

      // Add to pool if we have space
      if (this.connectionPool.size < this.maxPoolSize) {
        this.connectionPool.set(connectionKey, connection);
        console.log(`Successfully created SSH connection to ${connectionKey}`);
      } else {
        console.log(
          `Connection pool full, using temporary connection for ${connectionKey}`,
        );
      }

      return connection;
    } catch (error) {
      console.error(
        `Failed to create SSH connection to ${connectionKey}:`,
        error,
      );
      try {
        ssh.dispose();
      } catch {
        // Ignore disposal errors
      }
      throw error;
    }
  }

  // Updated to support both privateKey and password authentication
  async testConnection(
    host: string,
    authCredential: string,
    username = "root",
    port = 22,
    authType: "privateKey" | "password" = "privateKey",
  ): Promise<{ success: boolean; message: string }> {
    try {
      const connection = await this.getPooledConnection(
        host,
        authCredential,
        username,
        port,
        true,
        authType,
      );

      const testResult = await connection.ssh.execCommand(
        'echo "Connection test successful"',
      );

      if (testResult.stdout.includes("Connection test successful")) {
        return { success: true, message: "SSH connection successful" };
      } else {
        return { success: false, message: "SSH connection test failed" };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown connection error";
      return { success: false, message: errorMessage };
    }
  }

  dispose() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Dispose all connections
    this.connectionPool.forEach((connection, key) => {
      try {
        connection.ssh.dispose();
      } catch (error) {
        console.error(`Error disposing connection ${key}:`, error);
      }
    });

    this.connectionPool.clear();
    this.connectionLocks.clear();
  }
}
