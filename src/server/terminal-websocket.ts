import { Server } from "socket.io";
import { spawn } from "node-pty";
import { storage } from "./storage";
import { decryptSensitiveData } from "@/lib/encryption-service";
import { sshService } from "@/lib/ssh";

interface TerminalSession {
  ptyProcess: any;
  userId: string;
  serverId?: number;
  createdAt: number;
  lastActivity: number;
  socketId: string; // Track the socket ID associated with the session
}

export class TerminalWebSocketHandler {
  private io: Server;
  private activeSessions = new Map<string, TerminalSession>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(io: Server) {
    this.io = io;
    this.setupEventHandlers();
    // Start cleanup interval on construction
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldSessions();
      },
      2 * 60 * 1000,
    ); // Cleanup every 2 minutes
  }

  private setupEventHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`Server: Terminal WebSocket client connected: ${socket.id}`);

      socket.on("create-terminal", async (data) => {
        const { userId, serverId, cols, rows } = data;
        console.log(
          `Server: Received 'create-terminal' from ${socket.id}. userId: ${userId}, serverId: ${serverId}, cols: ${cols}, rows: ${rows}`,
        );

        if (!userId) {
          socket.emit("terminal-error", { error: "User ID required" });
          console.error(
            `Server: 'create-terminal' failed: User ID required for socket ${socket.id}`,
          );
          return;
        }

        try {
          const sessionId = await this.createTerminalSession(
            socket,
            userId,
            serverId,
            cols,
            rows,
          );
          socket.emit("terminal-created", { sessionId });
          console.log(
            `Server: 'terminal-created' emitted for sessionId: ${sessionId}`,
          );
        } catch (error) {
          console.error("Server: Failed to create terminal session:", error);
          socket.emit("terminal-error", {
            error: `Failed to create terminal: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      });

      socket.on("terminal-input", (data) => {
        const { sessionId, input } = data;
        // console.log(`Server: Received 'terminal-input' for sessionId: ${sessionId}, input length: ${input.length}`);
        const session = this.activeSessions.get(sessionId);

        if (session) {
          session.lastActivity = Date.now(); // Update last activity on input
          // Check if it's a node-pty process or node-ssh shell stream
          if (session.ptyProcess.write) {
            session.ptyProcess.write(input);
          }
        } else {
          console.warn(
            `Server: 'terminal-input' received for unknown sessionId: ${sessionId}`,
          );
        }
      });

      socket.on("terminal-resize", (data) => {
        const { sessionId, cols, rows } = data;
        console.log(
          `Server: Received 'terminal-resize' for sessionId: ${sessionId}, cols: ${cols}, rows: ${rows}`,
        );
        const session = this.activeSessions.get(sessionId);

        if (session) {
          session.lastActivity = Date.now(); // Update last activity on resize
          // Check if it's a node-pty process or node-ssh shell stream
          if (session.ptyProcess.resize) {
            session.ptyProcess.resize(cols, rows);
          }
        } else {
          console.warn(
            `Server: 'terminal-resize' received for unknown sessionId: ${sessionId}`,
          );
        }
      });

      socket.on("destroy-terminal", (data) => {
        const { sessionId } = data;
        console.log(
          `Server: Received 'destroy-terminal' for sessionId: ${sessionId}`,
        );
        this.destroyTerminalSession(sessionId);
      });

      socket.on("disconnect", () => {
        console.log(
          `Server: Terminal WebSocket client disconnected: ${socket.id}`,
        );
        this.cleanupSocketSessions(socket.id);
      });
    });
  }

  private async createTerminalSession(
    socket: any,
    userId: string,
    serverId?: number,
    cols: number = 80,
    rows: number = 30,
  ): Promise<string> {
    const sessionId = `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let ptyProcess: any; // This will now be either node-pty or node-ssh shell stream
    let isRemote = false;

    if (serverId) {
      isRemote = true;
      // Remote server connection via SSH using sshService
      const servers = await storage.getAllServers(userId);
      const server = servers.find((s) => s.id === serverId);

      if (!server) {
        console.error(
          `Server: Server not found for userId: ${userId}, serverId: ${serverId}`,
        );
        throw new Error("Server not found");
      }

      const decryptedServer = decryptSensitiveData(server, "servers");

      try {
        const { shell } = await sshService.openShell(
          decryptedServer.address,
          decryptedServer.sshKey,
          decryptedServer.username,
          decryptedServer.port,
          cols,
          rows,
        );
        ptyProcess = shell; // Assign the node-ssh shell stream
        console.log(
          `Server: Created remote SSH shell session ${sessionId} for ${decryptedServer.username}@${decryptedServer.address}:${decryptedServer.port}`,
        );
      } catch (error) {
        console.error(
          `Server: SSH connection failed for sessionId ${sessionId}:`,
          error,
        );
        throw new Error(
          `SSH connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } else {
      // Local terminal connection - use user's default shell with login
      const shell = process.env.SHELL || "/bin/bash";

      ptyProcess = spawn(shell, [], {
        name: "xterm",
        cols,
        rows,
        cwd: process.env.HOME || process.cwd(),
        env: {
          ...process.env,
          TERM: "xterm",
        },
      });

      console.log(
        `Server: Created local PTY session ${sessionId} with shell: ${shell}`,
      );
    }

    // Store the session
    const session: TerminalSession = {
      ptyProcess,
      userId,
      ...(serverId !== undefined && { serverId }),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      socketId: socket.id,
    };

    this.activeSessions.set(sessionId, session);

    // Handle PTY/Shell output
    if (isRemote) {
      // For node-ssh shell stream
      ptyProcess.on("data", (data: Buffer) => {
        // console.log(`Server: Remote shell output for sessionId ${sessionId}, data length: ${data.length}`);
        socket.emit("terminal-output", { sessionId, data: data.toString() });
      });
      ptyProcess.on("close", (code: number, signal: string) => {
        console.log(
          `Server: Remote shell session ${sessionId} closed with code ${code}, signal ${signal}`,
        );
        socket.emit("terminal-exit", { sessionId, exitCode: code });
        this.activeSessions.delete(sessionId);
      });
      ptyProcess.on("error", (err: Error) => {
        console.error(`Server: Remote shell session ${sessionId} error:`, err);
        socket.emit("terminal-error", { sessionId, error: err.message });
        this.activeSessions.delete(sessionId);
      });
    } else {
      // For node-pty process
      ptyProcess.onData((data: string) => {
        // console.log(`Server: PTY output for sessionId ${sessionId}, data length: ${data.length}`);
        socket.emit("terminal-output", { sessionId, data });
      });
      ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
        console.log(
          `Server: PTY session ${sessionId} exited with code ${event.exitCode}`,
        );
        socket.emit("terminal-exit", { sessionId, exitCode: event.exitCode });
        this.activeSessions.delete(sessionId);
      });
    }

    return sessionId;
  }

  private destroyTerminalSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      try {
        // Check if it's a node-pty process or node-ssh shell stream
        if (session.ptyProcess.kill) {
          session.ptyProcess.kill();
          console.log(`Server: Killed PTY process for sessionId: ${sessionId}`);
        } else if (session.ptyProcess.end) {
          // For node-ssh ClientChannel
          session.ptyProcess.end();
          console.log(`Server: Ended SSH shell for sessionId: ${sessionId}`);
        }
      } catch (error) {
        console.error(
          `Server: Failed to terminate PTY/shell process for sessionId ${sessionId}:`,
          error,
        );
      }
      this.activeSessions.delete(sessionId);
      console.log(`Server: Destroyed PTY/shell session: ${sessionId}`);
    } else {
      console.warn(
        `Server: Attempted to destroy unknown sessionId: ${sessionId}`,
      );
    }
  }

  private cleanupSocketSessions(socketId: string) {
    // Clean up sessions associated with the disconnected socket
    Array.from(this.activeSessions.entries()).forEach(
      ([sessionId, session]) => {
        if (session.socketId === socketId) {
          console.log(
            `Server: Cleaning up session ${sessionId} for disconnected socket ${socketId}`,
          );
          this.destroyTerminalSession(sessionId);
        }
      },
    );
  }

  private cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const maxInactivity = 10 * 60 * 1000; // 10 minutes of inactivity

    const sessionsToCleanup: string[] = [];

    this.activeSessions.forEach((session, sessionId) => {
      if (
        now - session.createdAt > maxAge ||
        now - session.lastActivity > maxInactivity
      ) {
        sessionsToCleanup.push(sessionId);
      }
    });

    sessionsToCleanup.forEach((sessionId) => {
      console.log(`Server: Cleaning up old PTY session: ${sessionId}`);
      this.destroyTerminalSession(sessionId);
    });
  }

  public getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  public getSessionInfo(sessionId: string): TerminalSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  public cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Destroy all active sessions
    this.activeSessions.forEach((_, sessionId) => {
      this.destroyTerminalSession(sessionId);
    });
    this.activeSessions.clear();
    console.log("Server: TerminalWebSocketHandler cleaned up.");
  }
}
