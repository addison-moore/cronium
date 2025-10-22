import { type Server, type Socket } from "socket.io";
import { storage } from "./storage";
import { decryptSensitiveData } from "@/lib/encryption-service";
import { sshService } from "@/lib/ssh";
import type { ClientChannel } from "ssh2";

interface TerminalSession {
  ptyProcess: ClientChannel & {
    resize?: (columns: number, rows: number) => void;
  };
  userId: string;
  serverId: number;
  createdAt: number;
  lastActivity: number;
  socketId: string; // Track the socket ID associated with the session
  cleanup?: () => void; // Manual cleanup function for channel count
}

// WebSocket event data interfaces
interface CreateTerminalData {
  userId: string;
  serverId?: number;
  cols: number;
  rows: number;
}

interface TerminalInputData {
  sessionId: string;
  input: string;
}

interface TerminalResizeData {
  sessionId: string;
  cols: number;
  rows: number;
}

interface DestroyTerminalData {
  sessionId: string;
}

export class TerminalWebSocketHandler {
  private io: Server;
  private activeSessions = new Map<string, TerminalSession>();
  private cleanupInterval: NodeJS.Timeout;
  private pendingCreations = new Map<string, boolean>(); // Track pending session creations per socket
  private socketSessions = new Map<string, string>(); // Map socket ID to session ID

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
      console.log(
        `Server: Terminal WebSocket client connected: ${socket.id ?? ""}`,
      );

      socket.on("create-terminal", async (data: CreateTerminalData) => {
        const { userId, serverId, cols, rows } = data;
        console.log(
          `Server: Received 'create-terminal' from ${socket.id ?? ""}. userId: ${userId}, serverId: ${serverId ?? ""}, cols: ${cols}, rows: ${rows}`,
        );

        // Check if this socket already has a session
        const existingSessionId = this.socketSessions.get(socket.id);
        if (existingSessionId && this.activeSessions.has(existingSessionId)) {
          console.log(
            `Server: Socket ${socket.id ?? ""} already has active session ${existingSessionId} - ignoring duplicate request`,
          );
          // Re-emit the session ID in case the client missed it
          socket.emit("terminal-created", { sessionId: existingSessionId });
          return;
        }

        // Check if we're already creating a session for this socket
        if (this.pendingCreations.get(socket.id)) {
          console.log(
            `Server: Ignoring duplicate 'create-terminal' from ${socket.id ?? ""} - session creation already in progress`,
          );
          return;
        }

        if (!userId) {
          socket.emit("terminal-error", { error: "User ID required" });
          console.error(
            `Server: 'create-terminal' failed: User ID required for socket ${socket.id ?? ""}`,
          );
          return;
        }

        try {
          // Mark as creating
          this.pendingCreations.set(socket.id, true);

          const sessionId = await this.createTerminalSession(
            socket,
            userId,
            serverId,
            cols,
            rows,
          );
          // Store the socket-session mapping
          this.socketSessions.set(socket.id, sessionId);
          socket.emit("terminal-created", { sessionId });
          console.log(
            `Server: 'terminal-created' emitted for sessionId: ${sessionId ?? ""}`,
          );
        } catch (error) {
          console.error("Server: Failed to create terminal session:", error);
          socket.emit("terminal-error", {
            error: `Failed to create terminal: ${error instanceof Error ? (error.message ?? "") : "Unknown error"}`,
          });
        } finally {
          // Clear the pending flag
          this.pendingCreations.delete(socket.id);
        }
      });

      socket.on("terminal-input", (data: TerminalInputData) => {
        const { sessionId, input } = data;
        // console.log(`Server: Received 'terminal-input' for sessionId: ${sessionId}, input length: ${input.length}`);
        const session = this.activeSessions.get(sessionId);

        if (session) {
          session.lastActivity = Date.now(); // Update last activity on input
          // Check if it's a node-pty process or node-ssh shell stream
          if ("write" in session.ptyProcess) {
            session.ptyProcess.write(input);
          }
        } else {
          console.warn(
            `Server: 'terminal-input' received for unknown sessionId: ${sessionId}`,
          );
        }
      });

      socket.on("terminal-resize", (data: TerminalResizeData) => {
        const { sessionId, cols, rows } = data;
        console.log(
          `Server: Received 'terminal-resize' for sessionId: ${sessionId}, cols: ${cols}, rows: ${rows}`,
        );
        const session = this.activeSessions.get(sessionId);

        if (session) {
          session.lastActivity = Date.now(); // Update last activity on resize
          // Check if it's a node-pty process or node-ssh shell stream
          if (typeof session.ptyProcess.resize === "function") {
            session.ptyProcess.resize(cols, rows);
          } else if (typeof session.ptyProcess.setWindow === "function") {
            session.ptyProcess.setWindow(rows, cols, 0, 0);
          }
        } else {
          console.warn(
            `Server: 'terminal-resize' received for unknown sessionId: ${sessionId}`,
          );
        }
      });

      socket.on("destroy-terminal", (data: DestroyTerminalData) => {
        const { sessionId } = data;
        console.log(
          `Server: Received 'destroy-terminal' for sessionId: ${sessionId}`,
        );
        this.destroyTerminalSession(sessionId);
      });

      socket.on("disconnect", () => {
        console.log(
          `Server: Terminal WebSocket client disconnected: ${socket.id ?? ""}`,
        );
        this.pendingCreations.delete(socket.id); // Clean up pending flag
        this.socketSessions.delete(socket.id); // Clean up socket-session mapping
        this.cleanupSocketSessions(socket.id);
      });
    });
  }

  private async createTerminalSession(
    socket: Socket,
    userId: string,
    serverId?: number,
    cols = 80,
    rows = 30,
  ): Promise<string> {
    // Require serverId - no local execution allowed
    if (!serverId) {
      throw new Error(
        "Server ID is required. Local terminal access is not available.",
      );
    }

    const sessionId = `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

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

    // Determine auth type and credential
    const authCredential =
      decryptedServer.sshKey ?? decryptedServer.password ?? "";
    const authType = decryptedServer.sshKey ? "privateKey" : "password";

    console.log(
      `Server: Attempting SSH connection to ${decryptedServer.address}:${decryptedServer.port} as ${decryptedServer.username} using ${authType}`,
    );

    // Validate credentials
    if (!authCredential) {
      throw new Error(
        `No ${authType === "privateKey" ? "SSH key" : "password"} found for server ${server.name}`,
      );
    }

    let ptyProcess: ClientChannel;
    let cleanup: (() => void) | undefined;

    try {
      const result = await sshService.openShell(
        decryptedServer.address,
        authCredential,
        decryptedServer.username,
        decryptedServer.port,
        cols,
        rows,
        authType,
      );
      ptyProcess = result.shell;
      cleanup = result.cleanup;

      console.log(
        `Server: Successfully created remote SSH shell session ${sessionId} for ${decryptedServer.username ?? ""}@${decryptedServer.address ?? ""}:${decryptedServer.port}`,
      );
    } catch (error) {
      console.error(
        `Server: SSH connection failed for sessionId ${sessionId}:`,
        error,
      );

      // Provide more detailed error message
      let errorMessage = "SSH connection failed";
      if (error instanceof Error) {
        if (error.message.includes("Not connected")) {
          errorMessage =
            "Unable to establish SSH connection to server. Please verify the server is online and credentials are correct.";
        } else if (error.message.includes("ECONNREFUSED")) {
          errorMessage =
            "Connection refused. Please verify the server address and port are correct.";
        } else if (error.message.includes("ETIMEDOUT")) {
          errorMessage =
            "Connection timed out. Please verify the server is reachable.";
        } else if (error.message.includes("authentication")) {
          errorMessage =
            "Authentication failed. Please verify your SSH credentials.";
        } else {
          errorMessage = error.message;
        }
      }

      throw new Error(errorMessage);
    }

    // Store the session
    const session: TerminalSession = {
      ptyProcess,
      userId,
      serverId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      socketId: socket.id ?? "unknown",
      cleanup, // Store the cleanup function
    };

    this.activeSessions.set(sessionId, session);

    // Handle SSH shell output (ClientChannel)
    const shellProcess = ptyProcess;
    shellProcess.on("data", (data: Buffer) => {
      // console.log(`Server: Remote shell output for sessionId ${sessionId}, data length: ${data.length}`);
      socket.emit("terminal-output", { sessionId, data: data.toString() });
    });
    shellProcess.on("close", (code: number, signal: string) => {
      console.log(
        `Server: Remote shell session ${sessionId} closed with code ${code}, signal ${signal ?? ""}`,
      );
      socket.emit("terminal-exit", { sessionId, exitCode: code });
      this.activeSessions.delete(sessionId);
    });
    shellProcess.on("error", (err: Error) => {
      console.error(`Server: Remote shell session ${sessionId} error:`, err);
      socket.emit("terminal-error", { sessionId, error: err.message });
      this.activeSessions.delete(sessionId);
    });

    return sessionId;
  }

  private destroyTerminalSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      try {
        // Call manual cleanup to immediately decrement channel count
        if (session.cleanup) {
          session.cleanup();
        }

        // End the SSH ClientChannel
        session.ptyProcess.end();
        console.log(`Server: Ended SSH shell for sessionId: ${sessionId}`);
      } catch (error) {
        console.error(
          `Server: Failed to terminate SSH shell process for sessionId ${sessionId}:`,
          error,
        );
      }
      this.activeSessions.delete(sessionId);

      // Clean up the socket-session mapping
      for (const [socketId, sid] of this.socketSessions.entries()) {
        if (sid === sessionId) {
          this.socketSessions.delete(socketId);
          break;
        }
      }

      console.log(`Server: Destroyed SSH shell session: ${sessionId}`);
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
            `Server: Cleaning up session ${sessionId} for disconnected socket ${socketId ?? ""}`,
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
