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

// Health check endpoint
app.get("/health", (_req, res) => {
  const wsHandler = getLogsWebSocketHandler();
  const isHealthy = wsHandler !== null;

  if (isHealthy) {
    return res.json({ status: "healthy", timestamp: new Date().toISOString() });
  } else {
    return res.status(503).json({
      status: "unhealthy",
      error: "WebSocket handler not initialized",
    });
  }
});

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
      console.log(`[WebSocket] Broadcasting log update for log ${logId}`);
      return res.json({ success: true });
    } else {
      console.error("[WebSocket] Handler not initialized");
      return res
        .status(500)
        .json({ error: "WebSocket handler not initialized" });
    }
  } catch (error) {
    console.error("Broadcast error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// HTTP endpoint for broadcasting job updates
app.post("/broadcast/job-update", (req, res) => {
  try {
    const job = req.body as any;

    if (!job || !job.id) {
      return res.status(400).json({ error: "Missing job data" });
    }

    const wsHandler = getLogsWebSocketHandler();
    if (wsHandler) {
      wsHandler.broadcastJobUpdate(job);
      console.log(`[WebSocket] Broadcasting job update for job ${job.id}`);
      return res.json({ success: true });
    } else {
      console.error("[WebSocket] Handler not initialized");
      return res
        .status(500)
        .json({ error: "WebSocket handler not initialized" });
    }
  } catch (error) {
    console.error("Broadcast error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// HTTP endpoint for broadcasting execution updates
app.post("/broadcast/execution-update", (req, res) => {
  try {
    const { executionId, status, ...data } = req.body;

    if (!executionId || !status) {
      return res.status(400).json({ error: "Missing executionId or status" });
    }

    const wsHandler = getLogsWebSocketHandler();
    if (wsHandler) {
      // Find associated logs and broadcast update
      console.log(
        `[WebSocket] Broadcasting execution update for ${executionId}`,
      );
      // Note: We'll need to implement a method to find logs by execution ID
      // For now, we'll emit a general execution update
      const logsNamespace = io.of("/logs");
      logsNamespace.emit("execution:update", {
        executionId,
        status,
        ...data,
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true });
    } else {
      console.error("[WebSocket] Handler not initialized");
      return res
        .status(500)
        .json({ error: "WebSocket handler not initialized" });
    }
  } catch (error) {
    console.error("Broadcast error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// HTTP endpoint for broadcasting log lines (streaming output)
app.post("/broadcast/log-line", (req, res) => {
  try {
    const { logId, line, stream = "stdout" } = req.body;

    if (!logId || !line) {
      return res.status(400).json({ error: "Missing logId or line data" });
    }

    const wsHandler = getLogsWebSocketHandler();
    if (wsHandler) {
      wsHandler.broadcastLogLine(logId, line, stream);
      return res.json({ success: true });
    } else {
      console.error("[WebSocket] Handler not initialized");
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
