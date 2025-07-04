/**
 * SSH service for terminal operations
 *
 * Handles SSH connections specifically for terminal/console functionality
 * with shell detection and prompt management
 */

import { SSHConnectionManager } from "./shared";

export class TerminalSSHService {
  private connectionManager: SSHConnectionManager;
  private shellCache = new Map<string, string>(); // Cache user shells per server

  constructor() {
    this.connectionManager = new SSHConnectionManager();
  }

  private getConnectionKey(
    host: string,
    username: string,
    port: number,
  ): string {
    return `${username}@${host}:${port}`;
  }

  /**
   * Get the user's default shell for a remote server (cached)
   */
  private async getUserShell(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<string> {
    const connectionKey = this.getConnectionKey(host, username, port);

    // Return cached shell if available
    if (this.shellCache.has(connectionKey)) {
      return this.shellCache.get(connectionKey)!;
    }

    try {
      // Get user's default shell from $SHELL environment variable
      const connection = await this.connectionManager.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false,
      );
      const result = await connection.ssh.execCommand('echo "$SHELL"');

      const userShell = result.stdout ? result.stdout.trim() : "/bin/bash";

      // Cache the shell for future use
      this.shellCache.set(connectionKey, userShell);

      return userShell;
    } catch (error) {
      // Fallback to bash if we can't detect the shell
      const fallbackShell = "/bin/bash";
      this.shellCache.set(connectionKey, fallbackShell);
      return fallbackShell;
    }
  }

  /**
   * Execute a terminal command on a remote server using the user's default shell
   */
  async executeCommand(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
    command: string,
    workingDirectory?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      // Get pooled connection for fast execution
      const connection = await this.connectionManager.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false, // Don't force new connection
      );

      // Get the user's default shell for this connection
      const userShell = await this.getUserShell(
        host,
        privateKey,
        username,
        port,
      );

      // If a working directory is specified, prepend cd command
      let fullCommand = command;
      if (workingDirectory && workingDirectory !== "~") {
        fullCommand = `cd "${workingDirectory}" && ${command}`;
      }

      // Execute the command using the user's default shell
      const result = await connection.ssh.execCommand(
        `${userShell} -c '${fullCommand.replace(/'/g, "'\"'\"'")}'`,
        {
          execOptions: {},
        },
      );

      // Update connection last used time
      connection.lastUsed = Date.now();

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Command execution failed";
      return {
        stdout: "",
        stderr: errorMessage,
      };
    }
  }

  /**
   * Get the actual shell prompt from the remote server
   */
  async getShellPrompt(
    host: string,
    privateKey: string,
    username: string,
    port = 22,
    workingDirectory?: string,
  ): Promise<string> {
    try {
      // Get the user's default shell (cached)
      const userShell = await this.getUserShell(
        host,
        privateKey,
        username,
        port,
      );

      // Get the current shell prompt by echoing PS1 variable using the user's shell
      const result = await this.executeCommand(
        host,
        privateKey,
        username,
        port,
        `${userShell} -c 'echo "$PS1"'`,
        workingDirectory,
      );

      if (result.stdout && result.stdout.trim()) {
        // Process the PS1 variable to create a realistic prompt
        let prompt = result.stdout.trim();

        // Replace common PS1 variables with actual values
        const pwdResult = await this.executeCommand(
          host,
          privateKey,
          username,
          port,
          "pwd",
          workingDirectory,
        );
        const currentDir = pwdResult.stdout
          ? pwdResult.stdout.trim()
          : (workingDirectory ?? "~");

        // Replace PS1 variables with actual values
        prompt = prompt
          .replace(/\\u/g, username)
          .replace(/\\h/g, host.split(".")[0] ?? host) // hostname without domain
          .replace(/\\H/g, host) // full hostname
          .replace(
            /\\w/g,
            currentDir.replace(new RegExp(`^/home/${username}`), "~"),
          )
          .replace(/\\W/g, currentDir.split("/").pop() ?? "~")
          .replace(/\\$/g, username === "root" ? "#" : "$")
          .replace(/\\\[|\\\]/g, "") // Remove color escape sequences markers
          .replace(/\\033\[[0-9;]*m/g, ""); // Remove basic color codes

        return prompt;
      }
    } catch (error) {
      console.log("Failed to get shell prompt, using fallback");
    }

    // Fallback to a reasonable prompt format
    const pwdResult = await this.executeCommand(
      host,
      privateKey,
      username,
      port,
      "pwd",
      workingDirectory,
    );
    const currentDir = pwdResult.stdout
      ? pwdResult.stdout.trim()
      : (workingDirectory ?? "~");
    const shortDir = currentDir.replace(new RegExp(`^/home/${username}`), "~");
    return `${username}@${host.split(".")[0]}:${shortDir}${username === "root" ? "#" : "$"} `;
  }

  /**
   * Prewarm a connection for terminal use to reduce first-command latency
   */
  async prewarmConnection(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<boolean> {
    try {
      console.log(
        `Prewarming SSH connection for terminal use: ${username}@${host}:${port}`,
      );

      // Create or get pooled connection
      const connection = await this.connectionManager.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false,
      );

      // Test connection with a simple command with timeout
      await Promise.race([
        connection.ssh.execCommand('echo "connection test"'),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("SSH command timed out after 5000ms")),
            5000,
          ),
        ),
      ]);

      connection.lastUsed = Date.now();
      console.log(
        `SSH connection prewarmed successfully: ${username}@${host}:${port}`,
      );
      return true;
    } catch (error) {
      console.error(
        `Failed to prewarm SSH connection: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  /**
   * Test SSH connection
   */
  async testConnection(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<{ success: boolean; message: string }> {
    return this.connectionManager.testConnection(
      host,
      privateKey,
      username,
      port,
    );
  }

  /**
   * Dispose of all connections and cleanup
   */
  dispose() {
    this.connectionManager.dispose();
    this.shellCache.clear();
  }
}

export const terminalSSHService = new TerminalSSHService();
