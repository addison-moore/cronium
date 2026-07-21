import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { TerminalWebSocketHandler } from "./src/server/terminal-websocket";
import {
  initializeLogsWebSocket,
  getLogsWebSocketHandler,
} from "./src/server/logs-websocket";
import {
  isAllowedSocketOrigin,
  resolveAllowedSocketOrigins,
  verifyInternalBroadcastAuthorization,
} from "./src/server/socket-security";
import type { Job, Log } from "./src/shared/schema";

// Type definitions for request body
interface LogUpdateRequest {
  logId: number;
  update: Partial<Log>;
}

// Create Express app for HTTP endpoints
const app = express();
app.disable("x-powered-by");

// Authenticate producers before parsing their potentially large request body.
app.use("/broadcast", (req, res, next) => {
  if (!verifyInternalBroadcastAuthorization(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));

// Create HTTP server with Express
const httpServer = createServer(app);
const allowedOrigins = resolveAllowedSocketOrigins();
if (allowedOrigins.length === 0) {
  throw new Error(
    "PUBLIC_APP_URL, AUTH_URL, or SOCKET_ALLOWED_ORIGINS must configure a trusted socket origin",
  );
}

const io = new Server(httpServer, {
  path: "/api/socketio",
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  allowRequest: (request, callback) => {
    callback(
      null,
      isAllowedSocketOrigin(request.headers.origin, allowedOrigins),
    );
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
    const job = req.body as Job;

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
      console.log(
        `[WebSocket] Broadcasting execution update for ${executionId}`,
      );
      wsHandler.broadcastExecutionUpdate(executionId, status, data);
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

const PORT = Number.parseInt(process.env.SOCKET_PORT ?? "5002", 10);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error("SOCKET_PORT must be an integer between 0 and 65535");
}

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
