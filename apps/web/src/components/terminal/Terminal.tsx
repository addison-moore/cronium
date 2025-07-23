"use client";

import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/hooks/useAuth";

// Define interfaces for XTerm types
interface Terminal {
  dispose(): void;
  open(parent: HTMLElement): void;
  write(data: string): void;
  loadAddon(addon: unknown): void;
  onData(callback: (data: string) => void): void;
  cols: number;
  rows: number;
  unicode: {
    activeVersion: string;
  };
}

interface FitAddon {
  fit(): void;
}

export interface TerminalProps {
  serverId?: number | null;
  serverName?: string;
}

/**
 * Terminal component that provides a Unix-like terminal experience
 * using xterm.js and REST API with proper shell configuration.
 */
export default function Terminal({
  serverId = null,
  serverName = "Local Server",
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { user, isLoading: isUserLoading } = useAuth();

  const [loading, setLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !terminalRef.current || isUserLoading || !user) {
      return;
    }

    const initTerminal = async () => {
      try {
        // Clear existing terminal
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }

        // Dynamic imports to avoid SSR
        const [
          { Terminal: XTerm },
          { FitAddon },
          { Unicode11Addon },
          { WebLinksAddon },
        ] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-unicode11"),
          import("@xterm/addon-web-links"),
        ]);

        // Create terminal
        const term = new XTerm({
          theme: {
            background: "#002b36",
            foreground: "#839496",
            cursor: "#839496",
          },
          fontSize: 14,
          fontFamily:
            '"FiraCode Nerd Font Mono", "Fira Code", "Consolas", "Monaco", monospace',
          cursorBlink: true,
          rows: 30,
          cols: 120,
          scrollback: 1000,
          convertEol: true,
          allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        const unicode11Addon = new Unicode11Addon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(unicode11Addon);
        term.loadAddon(webLinksAddon);

        termRef.current = term as Terminal;
        fitAddonRef.current = fitAddon as FitAddon;

        // Open terminal
        term.open(terminalRef.current!);
        fitAddon.fit();

        // Activate Unicode 11 support
        term.unicode.activeVersion = "11";

        // Connect to Socket.IO server
        const socket = io("http://localhost:5002", {
          // Connect to standalone Socket.IO server
          path: "/api/socketio",
          transports: ["websocket"], // Explicitly use websockets
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          console.log("Terminal: Socket.IO connected");
          setLoading(true);
          console.log(
            "Terminal: Emitting 'create-terminal' with userId:",
            user.id,
          );
          socket.emit("create-terminal", {
            userId: user.id,
            serverId: serverId ?? undefined,
            cols: term.cols,
            rows: term.rows,
          });
        });

        socket.on(
          "terminal-created",
          ({ sessionId }: { sessionId: string }) => {
            sessionIdRef.current = sessionId;
            setLoading(false);
            console.log(
              "Terminal: 'terminal-created' event received, sessionId:",
              sessionId,
            );
            term.write(`Welcome to Cronium Terminal - ${serverName}\r\n`);
            term.write("Using your default shell configuration...\r\n\r\n");
            // The actual prompt will be sent by the backend shell
          },
        );

        socket.on("terminal-output", ({ data }: { data: string }) => {
          // console.log("Terminal: 'terminal-output' event received, data:", data);
          term.write(data);
        });

        socket.on("terminal-exit", ({ exitCode }: { exitCode: number }) => {
          console.log(
            "Terminal: 'terminal-exit' event received, exitCode:",
            exitCode,
          );
          term.write(`\r\n[Process exited with code ${exitCode}]\r\n`);
          term.dispose();
          socket.disconnect();
        });

        socket.on("terminal-error", ({ error }: { error: string }) => {
          console.error(
            "Terminal: 'terminal-error' event received, error:",
            error,
          );
          term.write(`\r\nError: ${error}\r\n`);
          setLoading(false);
        });

        socket.on("disconnect", () => {
          console.log("Terminal: Socket.IO disconnected");
          term.write("\r\n[Disconnected from terminal server]\r\n");
        });

        term.onData((data) => {
          if (sessionIdRef.current) {
            // console.log("Terminal: Emitting 'terminal-input', data:", data);
            socket.emit("terminal-input", {
              sessionId: sessionIdRef.current,
              input: data,
            });
          }
        });

        // Resize handling
        const handleResize = () => {
          if (fitAddonRef.current && sessionIdRef.current) {
            fitAddonRef.current.fit();
            socket.emit("terminal-resize", {
              sessionId: sessionIdRef.current,
              cols: term.cols,
              rows: term.rows,
            });
          }
        };
        window.addEventListener("resize", handleResize);

        return () => {
          window.removeEventListener("resize", handleResize);
          if (termRef.current) {
            termRef.current.dispose();
          }
          if (socketRef.current) {
            if (sessionIdRef.current) {
              socketRef.current.emit("destroy-terminal", {
                sessionId: sessionIdRef.current,
              });
            }
            socketRef.current.disconnect();
          }
        };
      } catch (error) {
        console.error("Terminal initialization failed:", error);
        return () => {
          // Empty cleanup function on error
        };
      }
    };

    void initTerminal().then((cleanupFn) => {
      // Store cleanup function to call on unmount
      return cleanupFn;
    });

    // Return empty cleanup for now
    return () => {
      // Cleanup will be handled by initTerminal promise
    };
  }, [serverId, serverName, isClient, user, isUserLoading]);

  if (!isClient || isUserLoading) {
    return (
      <div className="border-border bg-solarized-base03 relative flex h-[60vh] w-full items-center justify-center overflow-hidden rounded border pb-2">
        <div className="text-gray-400">Loading terminal...</div>
      </div>
    );
  }

  return (
    <div className="border-border bg-solarized-base03 relative h-[60vh] w-full overflow-auto rounded border pb-2">
      <div ref={terminalRef} className="h-full w-full p-2" />
      {loading && (
        <div className="absolute top-2 right-2 rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-300">
          Executing...
        </div>
      )}
    </div>
  );
}
