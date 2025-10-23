import { io, type Socket } from "socket.io-client";

interface TerminalSocketManager {
  socket: Socket | null;
  sessionId: string | null;
  isConnecting: boolean;
  isCreatingSession: boolean;
  lastServerId: number | null;
  connectionPromise: Promise<Socket> | null;
}

// Global singleton manager
const manager: TerminalSocketManager = {
  socket: null,
  sessionId: null,
  isConnecting: false,
  isCreatingSession: false,
  lastServerId: null,
  connectionPromise: null,
};

export const terminalSocketManager = {
  async getSocket(serverId: number, forceNew = false): Promise<Socket> {
    // If we're already connecting, wait for that connection
    if (manager.isConnecting && manager.connectionPromise && !forceNew) {
      console.log("Terminal Socket Manager: Already connecting, waiting...");
      return manager.connectionPromise;
    }

    // If we have an existing socket for a different server, clean it up
    if (manager.socket && manager.lastServerId !== serverId) {
      const previousServerId = manager.lastServerId ?? "unknown";
      console.log(
        `Terminal Socket Manager: Server changed from ${previousServerId} to ${serverId}, cleaning up...`,
      );
      await this.cleanup();
    }

    // If we have a valid socket for the same server, reuse it
    if (
      manager.socket &&
      manager.socket.connected &&
      manager.lastServerId === serverId &&
      !forceNew
    ) {
      console.log("Terminal Socket Manager: Reusing existing socket");
      return manager.socket;
    }

    // Clean up any disconnected socket
    if (manager.socket && !manager.socket.connected) {
      console.log(
        "Terminal Socket Manager: Socket disconnected, cleaning up...",
      );
      await this.cleanup();
    }

    // Create new connection
    manager.isConnecting = true;
    manager.lastServerId = serverId;

    manager.connectionPromise = new Promise<Socket>((resolve, reject) => {
      console.log("Terminal Socket Manager: Creating new socket connection");

      // Clean up existing socket first
      if (manager.socket) {
        if (manager.sessionId) {
          manager.socket.emit("destroy-terminal", {
            sessionId: manager.sessionId,
          });
        }
        manager.socket.disconnect();
        manager.socket = null;
        manager.sessionId = null;
      }

      const socket = io("http://localhost:5002", {
        path: "/api/socketio",
        transports: ["websocket"],
        reconnection: false, // Disable auto-reconnection to prevent duplicate connections
      });

      socket.once("connect", () => {
        console.log("Terminal Socket Manager: Socket connected");
        manager.socket = socket;
        manager.isConnecting = false;
        resolve(socket);
      });

      socket.once("connect_error", (error) => {
        console.error("Terminal Socket Manager: Connection error", error);
        manager.isConnecting = false;
        manager.connectionPromise = null;
        reject(error);
      });

      // Set a timeout for connection
      setTimeout(() => {
        if (manager.isConnecting) {
          console.error("Terminal Socket Manager: Connection timeout");
          socket.disconnect();
          manager.isConnecting = false;
          manager.connectionPromise = null;
          reject(new Error("Connection timeout"));
        }
      }, 10000); // 10 second timeout
    });

    return manager.connectionPromise;
  },

  setSessionId(sessionId: string | null) {
    console.log(
      `Terminal Socket Manager: Setting session ID: ${sessionId ?? "none"}`,
    );
    manager.sessionId = sessionId;
    // Clear creating flag when session is set or cleared
    if (!sessionId) {
      manager.isCreatingSession = false;
    }
  },

  isCreatingSession(): boolean {
    return manager.isCreatingSession;
  },

  setCreatingSession(value: boolean) {
    manager.isCreatingSession = value;
  },

  getSessionId(): string | null {
    return manager.sessionId;
  },

  async cleanup() {
    console.log("Terminal Socket Manager: Cleaning up");

    if (manager.socket) {
      if (manager.sessionId) {
        console.log(
          `Terminal Socket Manager: Destroying terminal session ${manager.sessionId}`,
        );
        manager.socket.emit("destroy-terminal", {
          sessionId: manager.sessionId,
        });
      }
      manager.socket.disconnect();
      manager.socket = null;
    }

    manager.sessionId = null;
    manager.lastServerId = null;
    manager.isConnecting = false;
    manager.isCreatingSession = false;
    manager.connectionPromise = null;
  },

  isConnected(): boolean {
    return manager.socket?.connected ?? false;
  },
};
