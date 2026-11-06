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
import {
  assertSocketSecurityStoreAvailable,
  closeSocketSecurityStore,
  subscribeToSocketSecurityEvents,
} from "./src/server/socket-security-store";
import { SHUTDOWN_TIMEOUT_MS } from "./src/server/socket-server-shutdown";
import { socketUserAuthorizationFingerprint } from "./src/lib/socket-ticket";
import { storage } from "./src/server/storage";
import { UserStatus, type Job, type Log } from "./src/shared/schema";

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

const terminalHandler = new TerminalWebSocketHandler(io);
initializeLogsWebSocket(io);

function disconnectUser(userId: string): void {
  terminalHandler.revokeUser(userId);
  for (const namespace of [io.sockets, io.of("/logs")]) {
    for (const socket of namespace.sockets.values()) {
      if (socket.data.userId === userId) socket.disconnect(true);
    }
  }
}

function disconnectAllSockets(): void {
  terminalHandler.revokeAll();
  for (const namespace of [io.sockets, io.of("/logs")]) {
    for (const socket of namespace.sockets.values()) {
      socket.disconnect(true);
    }
  }
}

async function revalidateConnectedUsers(): Promise<void> {
  const sockets = [
    ...io.sockets.sockets.values(),
    ...io.of("/logs").sockets.values(),
  ];
  const principals = new Map<string, Set<string>>();
  for (const socket of sockets) {
    const userId = socket.data.userId;
    const fingerprint = socket.data.authorizationFingerprint;
    if (typeof userId !== "string" || typeof fingerprint !== "string") {
      socket.disconnect(true);
      continue;
    }
    const fingerprints = principals.get(userId) ?? new Set<string>();
    fingerprints.add(fingerprint);
    principals.set(userId, fingerprints);
  }

  await Promise.all(
    [...principals].map(async ([userId, connectedFingerprints]) => {
      try {
        const user = await storage.getUser(userId);
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          connectedFingerprints.size !== 1 ||
          !connectedFingerprints.has(socketUserAuthorizationFingerprint(user))
        ) {
          disconnectUser(userId);
        }
      } catch (error) {
        console.error(`Socket user revalidation failed for ${userId}:`, error);
        disconnectUser(userId);
      }
    }),
  );
  await terminalHandler.revalidateSessions();
}

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

let unsubscribeSecurityEvents: (() => Promise<void>) | null = null;
let revalidationInterval: NodeJS.Timeout | null = null;
let revalidationInFlight = false;
let shuttingDown = false;

async function start(): Promise<void> {
  await assertSocketSecurityStoreAvailable();
  unsubscribeSecurityEvents = await subscribeToSocketSecurityEvents((event) => {
    if (event.type === "revoke-all") disconnectAllSockets();
    else if (event.userId) disconnectUser(event.userId);
  });

  revalidationInterval = setInterval(() => {
    if (revalidationInFlight) return;
    revalidationInFlight = true;
    void revalidateConnectedUsers().finally(() => {
      revalidationInFlight = false;
    });
  }, 10_000);

  httpServer.listen(PORT, () => {
    console.log(`Socket.IO server listening on port ${PORT}`);
  });
}

async function closeConnections(): Promise<void> {
  if (revalidationInterval) clearInterval(revalidationInterval);
  terminalHandler.cleanup();
  // Sockets go first: until they are closed they still need to hear revocations,
  // and a hung Valkey must not leave this server accepting connections.
  await io.close();
  await unsubscribeSecurityEvents?.();
  await closeSocketSecurityStore();
}

/**
 * Exits explicitly, because closing what this file owns isn't enough. Its imports
 * open the cache service's Valkey client and start the SSH service's interval, and
 * either one keeps the process alive indefinitely.
 *
 * The status is what the signal would have produced, and what Next exits with
 * beside this server. worker.ts exits 0, but start.sh reports a 0 from either of
 * its servers as a failure, so that would turn every `docker stop` into Exited (1).
 */
function shutdown(exitCode: number): void {
  // The other signal arriving during a stop. The same one again never gets here:
  // `once` has removed its listener, so the default action kills the process, even
  // if its event loop is stuck.
  if (shuttingDown) process.exit(exitCode);
  shuttingDown = true;

  setTimeout(() => {
    console.error(
      `Socket.IO server still closing after ${SHUTDOWN_TIMEOUT_MS}ms; exiting anyway`,
    );
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS);

  void closeConnections()
    .catch((error) => {
      console.error("Socket.IO server failed to close cleanly:", error);
    })
    .finally(() => process.exit(exitCode));
}

// A second signal ends the process at once, whichever it is. start.sh sends one when
// Next exits first, and it is how a second Ctrl-C gets past a stop that is taking too long.
process.once("SIGTERM", () => shutdown(143));
process.once("SIGINT", () => shutdown(130));

void start().catch((error) => {
  // A stop during startup closes the store the preflight is waiting on.
  if (shuttingDown) return;
  console.error("Socket.IO server failed security preflight:", error);
  process.exit(1);
});
