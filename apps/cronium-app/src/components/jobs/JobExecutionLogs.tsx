"use client";

import { useEffect, useState, useRef } from "react";
import { CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Terminal, Download, Maximize2, Minimize2 } from "lucide-react";
import { useSocket } from "@/hooks/use-socket";
import { cn } from "@/lib/utils";

interface JobExecutionLogsProps {
  jobId: string;
}

interface LogLine {
  line: string;
  stream: "stdout" | "stderr";
  timestamp: string;
}

export function JobExecutionLogs({ jobId }: JobExecutionLogsProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    // Join the job's log room
    socket.emit("join:log", { jobId });

    // Listen for log lines
    const handleLogLine = (data: {
      jobId: string;
      line: string;
      stream: "stdout" | "stderr";
      timestamp: string;
    }) => {
      if (data.jobId === jobId) {
        setLogs((prev) => [
          ...prev,
          {
            line: data.line,
            stream: data.stream,
            timestamp: data.timestamp,
          },
        ]);
      }
    };

    // Connection status handlers
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    socket.on("log:line", handleLogLine);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Set initial connection status
    setIsConnected(socket.connected);

    return () => {
      socket.emit("leave:log", { jobId });
      socket.off("log:line", handleLogLine);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket, jobId]);

  // Reset the buffer when switching jobs. The App Router reuses the page
  // instance across dynamic-param navigations, so without this, lines from
  // the previous job would stay on screen and interleave with the new job's.
  useEffect(() => {
    setLogs([]);
  }, [jobId]);

  // Auto-scroll to bottom when new logs arrive. The ref points at the Radix
  // ScrollArea Root, which only clips (overflow-hidden) — the element that
  // actually scrolls is the Viewport child, so target that.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport =
      root.querySelector("[data-radix-scroll-area-viewport]") ?? root;
    viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);

  const handleDownload = () => {
    const content = logs
      .map((log) => `[${log.timestamp}] [${log.stream}] ${log.line}`)
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${jobId}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Execution Logs
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge status={isConnected ? "connected" : "disconnected"} />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              title="Download logs"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          "p-0",
          isFullscreen && "bg-background fixed inset-0 z-50",
        )}
      >
        <ScrollArea
          className={cn(
            "h-[400px] bg-black p-4 font-mono text-sm",
            isFullscreen && "h-screen",
          )}
          ref={scrollRef}
        >
          {logs.length === 0 ? (
            <div className="text-muted-foreground">Waiting for logs...</div>
          ) : (
            <div className="space-y-1">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className={cn(
                    "break-all whitespace-pre-wrap",
                    log.stream === "stderr"
                      ? "text-destructive"
                      : "text-success",
                  )}
                >
                  {log.line}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </>
  );
}
