import { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { LogStatus } from "@/shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { createSocketAuthProvider } from "@/lib/socket-ticket-client";
import { resolveSocketClientUrl } from "@/lib/socket-client-url";

interface LogUpdate {
  logId: number;
  status?: LogStatus;
  output?: string | null;
  error?: string | null;
  endTime?: Date | null;
  duration?: number | null;
  timestamp?: string;
  // Future support for metadata (e.g., multi-server results)
  metadata?: Record<string, unknown>;
}

export function useLogsSocket(): {
  socket: Socket | null;
  isConnected: boolean;
  subscribeToLog: (logId: number) => void;
  unsubscribeFromLog: (logId: number) => void;
  subscribeToLogUpdates: (
    onUpdate: (update: LogUpdate) => void,
  ) => (() => void) | undefined;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();
  const subscribedLogsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!user?.id) return;

    // Initialize socket connection to logs namespace
    const socketUrl = resolveSocketClientUrl(window.location);

    const logsSocket = io(`${socketUrl}/logs`, {
      path: "/api/socketio",
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: createSocketAuthProvider("logs"),
    });

    logsSocket.on("connect", () => {
      console.log("Logs socket connected");
      setIsConnected(true);

      // Replay every subscription intent: this restores subscriptions after
      // a reconnect and flushes ones requested before the socket connected.
      subscribedLogsRef.current.forEach((logId) => {
        logsSocket.emit("subscribe", { logId });
      });
    });

    logsSocket.on("disconnect", () => {
      console.log("Logs socket disconnected");
      setIsConnected(false);
    });

    logsSocket.on("error", (error) => {
      console.error("Logs socket error:", error);
    });

    setSocket(logsSocket);

    return () => {
      if (logsSocket) {
        // Unsubscribe from all logs
        subscribedLogsRef.current.forEach((logId) => {
          logsSocket.emit("unsubscribe", { logId });
        });
        logsSocket.disconnect();
      }
    };
  }, [user?.id]);

  const subscribeToLog = useCallback(
    (logId: number) => {
      // Record the intent even while disconnected: the connect handler
      // replays the whole set, so a subscription made before the socket
      // connects is flushed on connect instead of being silently dropped.
      subscribedLogsRef.current.add(logId);
      if (!socket?.connected) return;

      // Subscribe to this specific log
      socket.emit("subscribe", { logId });
      console.log(`Subscribed to log ${logId}`);
    },
    [socket],
  );

  const unsubscribeFromLog = useCallback(
    (logId: number) => {
      // Always cancel the intent so a queued id is not replayed on connect
      subscribedLogsRef.current.delete(logId);
      if (!socket) return;

      // Unsubscribe from this specific log
      socket.emit("unsubscribe", { logId });
      console.log(`Unsubscribed from log ${logId}`);
    },
    [socket],
  );

  const subscribeToLogUpdates = useCallback(
    (onUpdate: (update: LogUpdate) => void) => {
      if (!socket) return;

      const handleLogUpdate = (data: LogUpdate) => {
        onUpdate(data);
      };

      socket.on("log:update", handleLogUpdate);

      return () => {
        socket.off("log:update", handleLogUpdate);
      };
    },
    [socket],
  );

  return {
    socket,
    isConnected,
    subscribeToLog,
    unsubscribeFromLog,
    subscribeToLogUpdates,
  };
}
