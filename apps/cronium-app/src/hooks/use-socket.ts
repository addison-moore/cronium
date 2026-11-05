import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { createSocketAuthProvider } from "@/lib/socket-ticket-client";
import { resolveSocketClientUrl } from "@/lib/socket-client-url";

let socket: Socket | null = null;

export function useSocket(): Socket | null {
  const [, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize socket connection if not already connected
    if (!socket) {
      const socketUrl = resolveSocketClientUrl(window.location);

      socket = io(socketUrl, {
        path: "/api/socketio",
        transports: ["websocket", "polling"],
        autoConnect: true,
        auth: createSocketAuthProvider("terminal"),
      });

      socket.on("connect", () => {
        console.log("Socket connected");
        setIsConnected(true);
      });

      socket.on("disconnect", () => {
        console.log("Socket disconnected");
        setIsConnected(false);
      });

      socket.on("error", (error) => {
        console.error("Socket error:", error);
      });
    }

    return () => {
      // Don't disconnect on component unmount to maintain persistent connection
    };
  }, []);

  return socket;
}
