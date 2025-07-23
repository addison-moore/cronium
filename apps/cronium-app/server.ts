import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { TerminalWebSocketHandler } from "./src/server/terminal-websocket";
import {
  initializeLogsWebSocket,
  getLogsWebSocketHandler,
} from "./src/server/logs-websocket";
import type { Log } from "./src/shared/schema";

// Type definitions for request body
interface LogUpdateRequest {
  logId: number;
  update: Partial<Log>;
}

// Create Express app for HTTP endpoints
const app = express();
app.use(express.json());

// Create HTTP server with Express
const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: "/api/socketio",
  cors: {
    origin: "*", // Adjust for production
    methods: ["GET", "POST"],
  },
});

new TerminalWebSocketHandler(io);
initializeLogsWebSocket(io);

// HTTP endpoint for broadcasting log updates
app.post("/broadcast/log-update", (req, res) => {
  try {
    const body = req.body as LogUpdateRequest;
    const { logId, update } = body;

    if (!logId || !update) {
      return res.status(400).json({ error: "Missing logId or update data" });
    }

    const wsHandler = getLogsWebSocketHandler();
    if (wsHandler) {
      wsHandler.broadcastLogUpdate(logId, update);
      return res.json({ success: true });
    } else {
      return res
        .status(500)
        .json({ error: "WebSocket handler not initialized" });
    }
  } catch (error) {
    console.error("Broadcast error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.SOCKET_PORT ?? 5002;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
