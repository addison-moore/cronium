"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/hooks/useAuth";
import { terminalSocketManager } from "@/lib/terminal-socket-manager";

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
  serverId: number;
  serverName: string;
}

/**
 * Terminal component that provides a Unix-like terminal experience
 * using xterm.js and Socket.IO with singleton connection management.
 */
export default function Terminal({ serverId, serverName }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { user, isLoading: isUserLoading } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const hasInitializedRef = useRef(false);
  const serverNameRef = useRef<string>(serverName);
  const initializationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [loading, setLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Update server name ref when prop changes
  useEffect(() => {
    serverNameRef.current = serverName;
  }, [serverName]);

  useEffect(() => {
    if (!isClient || !terminalRef.current || isUserLoading || !user) {
      return;
    }

    // Clear any existing initialization timeout
    if (initializationTimeoutRef.current) {
      clearTimeout(initializationTimeoutRef.current);
      initializationTimeoutRef.current = null;
    }

    // Prevent multiple initializations
    if (hasInitializedRef.current) {
      console.log("Terminal: Already initialized, skipping...");
      return;
    }

    let cleanupExecuted = false;

    const initTerminal = async () => {
      try {
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

        // Get socket from manager
        console.log(`Terminal: Getting socket for server ${serverId}`);
        setLoading(true);

        const socket = await terminalSocketManager.getSocket(serverId);

        if (cleanupExecuted) {
          console.log(
            "Terminal: Component unmounted during socket connection, aborting",
          );
          return null;
        }

        socketRef.current = socket;

        // Check if we already have a session
        const existingSessionId = terminalSocketManager.getSessionId();
        if (existingSessionId) {
          console.log(
            `Terminal: Reusing existing session ${existingSessionId}`,
          );
          setLoading(false);
          // Session already exists, just set up listeners
        } else {
          // Need to create a new session
          console.log(`Terminal: No existing session, will create new one`);
        }

        // Remove all previous listeners to avoid duplicates
        socket.removeAllListeners("terminal-created");
        socket.removeAllListeners("terminal-output");
        socket.removeAllListeners("terminal-exit");
        socket.removeAllListeners("terminal-error");

        // Set up event handlers
        socket.on(
          "terminal-created",
          ({ sessionId }: { sessionId: string }) => {
            console.log(`Terminal: Session created: ${sessionId}`);
            terminalSocketManager.setSessionId(sessionId);
            terminalSocketManager.setCreatingSession(false);
            setLoading(false);
            term.write(
              `Welcome to Cronium Terminal - ${serverNameRef.current}\r\n`,
            );
            term.write("Using your default shell configuration...\r\n\r\n");
          },
        );

        socket.on("terminal-output", ({ data }: { data: string }) => {
          if (termRef.current) {
            termRef.current.write(data);
          }
        });

        socket.on("terminal-exit", ({ exitCode }: { exitCode: number }) => {
          console.log(`Terminal: Process exited with code ${exitCode}`);
          if (termRef.current) {
            termRef.current.write(
              `\r\n[Process exited with code ${exitCode}]\r\n`,
            );
          }
          // Clear the session ID when terminal exits
          terminalSocketManager.setSessionId(null);
        });

        socket.on("terminal-error", ({ error }: { error: string }) => {
          console.error(`Terminal: Error: ${error}`);
          if (termRef.current) {
            termRef.current.write(`\r\nError: ${error}\r\n`);
          }
          terminalSocketManager.setCreatingSession(false);
          setLoading(false);
        });

        // Only create a new terminal session if we don't have one and we're not already creating one
        if (!existingSessionId && !terminalSocketManager.isCreatingSession()) {
          console.log(
            `Terminal: Creating terminal session for user ${user.id} on server ${serverId}`,
          );
          terminalSocketManager.setCreatingSession(true);
          socket.emit("create-terminal", {
            userId: user.id,
            serverId: serverId,
            cols: term.cols,
            rows: term.rows,
          });
        } else if (terminalSocketManager.isCreatingSession()) {
          console.log(
            "Terminal: Session creation already in progress, skipping duplicate request",
          );
        }

        // Handle terminal input
        term.onData((data) => {
          const sessionId = terminalSocketManager.getSessionId();
          if (sessionId && socketRef.current) {
            socketRef.current.emit("terminal-input", {
              sessionId: sessionId,
              input: data,
            });
          }
        });

        // Resize handling
        const handleResize = () => {
          if (fitAddonRef.current && socketRef.current) {
            fitAddonRef.current.fit();
            const sessionId = terminalSocketManager.getSessionId();
            if (sessionId && termRef.current) {
              socketRef.current.emit("terminal-resize", {
                sessionId: sessionId,
                cols: termRef.current.cols,
                rows: termRef.current.rows,
              });
            }
          }
        };

        window.addEventListener("resize", handleResize);

        // Return cleanup function
        return () => {
          window.removeEventListener("resize", handleResize);
        };
      } catch (error) {
        console.error("Terminal initialization failed:", error);
        setLoading(false);
        if (termRef.current) {
          termRef.current.write(
            `\r\nFailed to initialize terminal: ${error}\r\n`,
          );
        }
        return null;
      }
    };

    let cleanupFn: (() => void) | null = null;

    // Initialize terminal with a delay and mark as initialized immediately
    hasInitializedRef.current = true;
    initializationTimeoutRef.current = setTimeout(async () => {
      const cleanup = await initTerminal();
      if (!cleanupExecuted) {
        cleanupFn = cleanup;
      }
    }, 500);

    // Cleanup function
    return () => {
      cleanupExecuted = true;
      if (initializationTimeoutRef.current) {
        clearTimeout(initializationTimeoutRef.current);
        initializationTimeoutRef.current = null;
      }

      console.log("Terminal: Cleaning up component");

      if (cleanupFn) {
        cleanupFn();
      }

      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }

      // Note: We don't clean up the socket here as it's managed by the singleton
      // The socket will be reused by the next mount if it's the same server

      hasInitializedRef.current = false;
    };
  }, [serverId, isClient, user, isUserLoading]);

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
          Connecting...
        </div>
      )}
    </div>
  );
}
