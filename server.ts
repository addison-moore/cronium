import { createServer } from "http";
import { Server } from "socket.io";
import { TerminalWebSocketHandler } from "./src/server/terminal-websocket";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/api/socketio",
  cors: {
    origin: "*", // Adjust for production
    methods: ["GET", "POST"],
  },
});

new TerminalWebSocketHandler(io);

const PORT = process.env.SOCKET_PORT || 5002;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
