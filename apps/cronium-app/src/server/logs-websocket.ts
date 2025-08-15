import type { Server, Socket } from "socket.io";
import { storage } from "@/server/storage";
import { getLogsByJobId } from "@/server/storage-extensions";
import { jobService } from "@/lib/services/job-service";
import type { LogStatus, Job, Log } from "@/shared/schema";

interface LogStreamAuth {
  userId: string;
  jobId?: string;
  logId?: number;
}

interface SocketData {
  userId: string;
  job?: Job;
  log?: Log;
}

export class LogsWebSocketHandler {
  private io: Server;
  private activeStreams = new Map<string, Set<string>>(); // logId -> Set of socket IDs

  constructor(io: Server) {
    this.io = io;
    this.setupNamespace();
  }

  private setupNamespace() {
    const logsNamespace = this.io.of("/logs");

    logsNamespace.use(
      (socket, next) =>
        void (async () => {
          try {
            // Validate authentication
            const { userId, jobId, logId } = socket.handshake
              .auth as LogStreamAuth;

            if (!userId) {
              return next(new Error("Authentication required"));
            }

            // Validate access to the job/log
            if (jobId) {
              const job = await jobService.getJob(jobId);
              if (!job || job.userId !== userId) {
                return next(new Error("Access denied"));
              }
              (socket.data as SocketData).job = job;
            }

            if (logId) {
              const log = await storage.getLog(logId);
              if (!log || log.userId !== userId) {
                return next(new Error("Access denied"));
              }
              (socket.data as SocketData).log = log;
            }

            (socket.data as SocketData).userId = userId;
            next();
          } catch {
            next(new Error("Authentication failed"));
          }
        })(),
    );

    logsNamespace.on("connection", (socket: Socket) => {
      console.log(`Client connected to logs namespace: ${socket.id}`);

      // Subscribe to log updates
      socket.on(
        "subscribe",
        async (data: { logId?: number; jobId?: string }) => {
          try {
            let logId: number | undefined;

            if (data.jobId) {
              // Get log ID from job
              const job = await jobService.getJob(data.jobId);
              if (job && job.userId === (socket.data as SocketData).userId) {
                // Find associated log
                const logs = await storage.getLogsByEventId(job.eventId, {
                  limit: 1,
                });
                const logList = (logs as { logs: Log[] }).logs;
                if (logList.length > 0) {
                  logId = logList[0]?.id;
                }
              }
            } else if (data.logId) {
              logId = data.logId;
            }

            if (!logId) {
              socket.emit("error", { message: "Invalid log or job ID" });
              return;
            }

            // Verify access
            const log = await storage.getLog(logId);
            if (!log || log.userId !== (socket.data as SocketData).userId) {
              socket.emit("error", { message: "Access denied" });
              return;
            }

            // Join room for this log
            const roomName = `log:${logId}`;
            void socket.join(roomName);

            // Track active streams
            if (!this.activeStreams.has(roomName)) {
              this.activeStreams.set(roomName, new Set());
            }
            this.activeStreams.get(roomName)!.add(socket.id);

            // Send current log state
            socket.emit("log:initial", {
              logId,
              status: log.status,
              output: log.output ?? "",
              error: log.error,
              startTime: log.startTime,
              endTime: log.endTime,
            });

            console.log(`Socket ${socket.id} subscribed to log ${logId}`);
          } catch (error) {
            console.error("Error subscribing to log:", error);
            socket.emit("error", { message: "Failed to subscribe" });
          }
        },
      );

      // Unsubscribe from log updates
      socket.on("unsubscribe", (data: { logId: number }) => {
        const roomName = `log:${data.logId}`;
        void socket.leave(roomName);

        // Remove from active streams
        const subscribers = this.activeStreams.get(roomName);
        if (subscribers) {
          subscribers.delete(socket.id);
          if (subscribers.size === 0) {
            this.activeStreams.delete(roomName);
          }
        }

        console.log(`Socket ${socket.id} unsubscribed from log ${data.logId}`);
      });

      socket.on("disconnect", () => {
        console.log(`Client disconnected from logs namespace: ${socket.id}`);

        // Clean up subscriptions
        for (const [roomName, subscribers] of this.activeStreams.entries()) {
          subscribers.delete(socket.id);
          if (subscribers.size === 0) {
            this.activeStreams.delete(roomName);
          }
        }
      });
    });
  }

  /**
   * Broadcast log update to all subscribers
   */
  public broadcastLogUpdate(logId: number, update: Partial<Log>) {
    const roomName = `log:${logId}`;
    const logsNamespace = this.io.of("/logs");

    // Include all relevant timing information
    const enhancedUpdate = {
      logId,
      ...update,
      timestamp: new Date().toISOString(),
      // Include timing data if available
      timing: {
        startedAt:
          ((update as Record<string, unknown>).startedAt as Date | undefined) ??
          update.startTime,
        completedAt:
          ((update as Record<string, unknown>).completedAt as
            | Date
            | undefined) ?? update.endTime,
        duration: update.duration,
      },
      // Include execution data if available
      execution: {
        exitCode: (update as any).exitCode,
        status: update.status,
      },
      // Include output data
      output: {
        stdout: update.output,
        stderr: update.error,
        combined: update.output,
      },
    };

    logsNamespace.to(roomName).emit("log:update", enhancedUpdate);

    // Log the broadcast for debugging
    if (this.activeStreams.has(roomName)) {
      const subscriberCount = this.activeStreams.get(roomName)?.size ?? 0;
      console.log(
        `[LogsWebSocket] Broadcasting to ${subscriberCount} subscribers for log ${logId}`,
      );
    }
  }

  /**
   * Broadcast log line to all subscribers
   */
  public broadcastLogLine(
    logId: number,
    line: string,
    stream: "stdout" | "stderr" = "stdout",
  ) {
    const roomName = `log:${logId}`;
    const logsNamespace = this.io.of("/logs");

    logsNamespace.to(roomName).emit("log:line", {
      logId,
      line,
      stream,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast job status update
   */
  public broadcastJobUpdate(job: Job) {
    // Find logs associated with this job
    void getLogsByJobId(job.id)
      .then((logs) => {
        for (const log of logs) {
          this.broadcastLogUpdate(log.id, {
            status: this.mapJobStatusToLogStatus(job.status) as LogStatus,
          });
        }
      })
      .catch((error) => {
        console.error("Error broadcasting job update:", error);
      });
  }

  private mapJobStatusToLogStatus(jobStatus: string): string {
    // This method is deprecated - job service now handles status mapping
    // with proper TIMEOUT and PARTIAL support
    switch (jobStatus) {
      case "queued":
      case "claimed":
        return "PENDING";
      case "running":
        return "RUNNING";
      case "completed":
        return "SUCCESS";
      case "failed":
        return "FAILURE";
      case "cancelled":
        return "FAILURE";
      default:
        return "RUNNING";
    }
  }
}

// Export singleton instance
let logsWebSocketHandler: LogsWebSocketHandler | null = null;

export function initializeLogsWebSocket(io: Server): LogsWebSocketHandler {
  logsWebSocketHandler ??= new LogsWebSocketHandler(io);
  return logsWebSocketHandler;
}

export function getLogsWebSocketHandler(): LogsWebSocketHandler | null {
  return logsWebSocketHandler;
}
