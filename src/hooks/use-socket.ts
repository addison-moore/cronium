import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function useSocket() {
  const [, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize socket connection if not already connected
    if (!socket) {
      const socketPort = process.env.NEXT_PUBLIC_SOCKET_PORT ?? "5002";
      const socketUrl =
        process.env.NEXT_PUBLIC_SOCKET_URL ?? `http://localhost:${socketPort}`;

      socket = io(socketUrl, {
        path: "/api/socketio",
        transports: ["websocket", "polling"],
        autoConnect: true,
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

export function useSocketConnection() {
  const socket = useSocket();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Set initial state
    setIsConnected(socket.connected);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket]);

  return { socket, isConnected };
}
