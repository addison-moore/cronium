import { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { LogStatus } from "@/shared/schema";
import { useAuth } from "@/hooks/useAuth";

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

export function useLogsSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();
  const subscribedLogsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!user?.id) return;

    // Initialize socket connection to logs namespace
    const socketPort = process.env.NEXT_PUBLIC_SOCKET_PORT ?? "5002";
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ?? `http://localhost:${socketPort}`;

    const logsSocket = io(`${socketUrl}/logs`, {
      path: "/api/socketio",
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: {
        userId: user.id,
      },
    });

    logsSocket.on("connect", () => {
      console.log("Logs socket connected");
      setIsConnected(true);

      // Re-subscribe to all previously subscribed logs
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
      if (!socket || !isConnected) return;

      // Subscribe to this specific log
      socket.emit("subscribe", { logId });
      subscribedLogsRef.current.add(logId);
      console.log(`Subscribed to log ${logId}`);
    },
    [socket, isConnected],
  );

  const unsubscribeFromLog = useCallback(
    (logId: number) => {
      if (!socket) return;

      // Unsubscribe from this specific log
      socket.emit("unsubscribe", { logId });
      subscribedLogsRef.current.delete(logId);
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
