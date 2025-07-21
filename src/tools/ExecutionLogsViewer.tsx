"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Info,
  Loader2,
  MoreHorizontal,
  Pause,
  Search,
  Terminal,
  Trash,
  XCircle,
  FileText,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

export interface ExecutionLog {
  id: string;
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  category: "system" | "tool" | "workflow" | "event" | "action";
  message: string;
  context?: {
    toolName?: string;
    actionName?: string;
    eventId?: number;
    workflowId?: number;
    executionId?: string;
    userId?: string;
  };
  metadata?: Record<string, unknown>;
  duration?: number;
  status?: "running" | "success" | "failed" | "cancelled";
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

interface ExecutionLogsViewerProps {
  toolId?: number;
  eventId?: number;
  workflowId?: number;
  executionId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in seconds
  maxLogs?: number;
  className?: string;
}

interface LogFilters {
  level: string[];
  category: string[];
  status: string[];
  search: string;
  timeRange: "1h" | "6h" | "24h" | "7d" | "30d" | "all";
}

const LOG_LEVELS = ["debug", "info", "warn", "error"];
const LOG_CATEGORIES = ["system", "tool", "workflow", "event", "action"];
const LOG_STATUSES = ["running", "success", "failed", "cancelled"];

export function ExecutionLogsViewer({
  toolId,
  eventId,
  workflowId,
  executionId,
  className,
}: ExecutionLogsViewerProps) {
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<ExecutionLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ExecutionLog | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState<LogFilters>({
    level: [],
    category: [],
    status: [],
    search: "",
    timeRange: "24h",
  });

  // Mock data generation for demonstration
  useEffect(() => {
    const generateMockLogs = () => {
      const mockLogs: ExecutionLog[] = [];
      const now = new Date();

      for (let i = 0; i < 50; i++) {
        const timestamp = new Date(
          now.getTime() - Math.random() * 24 * 60 * 60 * 1000,
        );
        const level = LOG_LEVELS[
          Math.floor(Math.random() * LOG_LEVELS.length)
        ] as ExecutionLog["level"];
        const category = LOG_CATEGORIES[
          Math.floor(Math.random() * LOG_CATEGORIES.length)
        ] as ExecutionLog["category"];
        const status =
          Math.random() > 0.3
            ? (LOG_STATUSES[
                Math.floor(Math.random() * LOG_STATUSES.length)
              ] as ExecutionLog["status"])
            : undefined;

        const logEntry: ExecutionLog = {
          id: `log-${i}`,
          timestamp,
          level,
          category,
          message: `${category} ${level} log message ${i}`,
          context: {
            ...(toolId && { toolName: "Slack" }),
            ...(toolId && { actionName: "send-message" }),
            eventId: eventId ?? Math.floor(Math.random() * 100),
            executionId:
              executionId ?? `exec-${Math.random().toString(36).substr(2, 9)}`,
          },
          metadata: {
            host: "worker-1",
            region: "us-east-1",
            version: "1.0.0",
          },
          duration: Math.random() * 5000,
        };

        if (status) {
          logEntry.status = status;
        }

        if (level === "error") {
          logEntry.error = {
            code: "ERR_CONNECTION",
            message: "Failed to connect to service",
            stack: "Error: Failed to connect\n    at connect()\n    at main()",
          };
        }

        mockLogs.push(logEntry);
      }

      setLogs(
        mockLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
      );
    };

    generateMockLogs();
  }, [toolId, eventId, workflowId, executionId]);

  // Filter logs
  useEffect(() => {
    let filtered = [...logs];

    // Level filter
    if (filters.level.length > 0) {
      filtered = filtered.filter((log) => filters.level.includes(log.level));
    }

    // Category filter
    if (filters.category.length > 0) {
      filtered = filtered.filter((log) =>
        filters.category.includes(log.category),
      );
    }

    // Status filter
    if (filters.status.length > 0) {
      filtered = filtered.filter(
        (log) => log.status && filters.status.includes(log.status),
      );
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ??
          log.error?.message.toLowerCase().includes(searchLower) ??
          JSON.stringify(log.metadata).toLowerCase().includes(searchLower),
      );
    }

    // Time range filter
    if (filters.timeRange !== "all") {
      const now = new Date();
      const timeRanges = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };
      const cutoff = new Date(now.getTime() - timeRanges[filters.timeRange]);
      filtered = filtered.filter((log) => log.timestamp >= cutoff);
    }

    setFilteredLogs(filtered);
  }, [logs, filters]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  // Toggle log expansion
  const toggleLogExpansion = (logId: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  // Copy log to clipboard
  const copyLog = (log: ExecutionLog) => {
    const logData = {
      ...log,
      timestamp: log.timestamp.toISOString(),
    };
    navigator.clipboard
      .writeText(JSON.stringify(logData, null, 2))
      .then(() => {
        toast({
          title: "Copied",
          description: "Log entry copied to clipboard",
        });
      })
      .catch((err) => {
        toast({
          title: "Error",
          description: "Failed to copy to clipboard",
          variant: "destructive",
        });
        console.error("Clipboard write failed:", err);
      });
  };

  // Export logs
  const exportLogs = () => {
    const data = filteredLogs.map((log) => ({
      ...log,
      timestamp: log.timestamp.toISOString(),
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-logs-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Exported",
      description: `${filteredLogs.length} logs exported`,
    });
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    setFilteredLogs([]);
    toast({
      title: "Cleared",
      description: "All logs have been cleared",
    });
  };

  // Get level color
  const getLevelColor = (level: string) => {
    switch (level) {
      case "debug":
        return "text-gray-500";
      case "info":
        return "text-blue-600";
      case "warn":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  // Get level icon
  const getLevelIcon = (level: string) => {
    switch (level) {
      case "debug":
        return <Terminal className="h-3 w-3" />;
      case "info":
        return <Info className="h-3 w-3" />;
      case "warn":
        return <AlertTriangle className="h-3 w-3" />;
      case "error":
        return <XCircle className="h-3 w-3" />;
      default:
        return <Activity className="h-3 w-3" />;
    }
  };

  // Get status icon
  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "running":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "success":
        return <CheckCircle className="h-3 w-3 text-green-600" />;
      case "failed":
        return <XCircle className="h-3 w-3 text-red-600" />;
      case "cancelled":
        return <AlertCircle className="h-3 w-3 text-gray-600" />;
      default:
        return null;
    }
  };

  // Get log statistics
  const getLogStats = () => {
    const stats = {
      total: filteredLogs.length,
      byLevel: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      avgDuration: 0,
    };

    let totalDuration = 0;
    let durationCount = 0;

    filteredLogs.forEach((log) => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] ?? 0) + 1;
      stats.byCategory[log.category] =
        (stats.byCategory[log.category] ?? 0) + 1;
      if (log.status) {
        stats.byStatus[log.status] = (stats.byStatus[log.status] ?? 0) + 1;
      }
      if (log.duration) {
        totalDuration += log.duration;
        durationCount++;
      }
    });

    stats.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;

    return stats;
  };

  const stats = getLogStats();

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Execution Logs
            <Badge variant="outline">{filteredLogs.length} logs</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAutoScroll(!autoScroll)}
                  >
                    {autoScroll ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportLogs}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Logs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={clearLogs}>
                  <Trash className="mr-2 h-4 w-4" />
                  Clear Logs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="logs" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="filters">Filters</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4 space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search logs..."
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                className="pl-9"
              />
            </div>

            {/* Logs List */}
            <ScrollArea
              ref={scrollAreaRef}
              className="border-border h-[500px] rounded-lg border"
            >
              <div className="space-y-2 p-4">
                {filteredLogs.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 opacity-50" />
                    <p>No logs found</p>
                    <p className="text-sm">
                      Adjust your filters or wait for new logs
                    </p>
                  </div>
                ) : (
                  filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className={cn(
                        "hover:bg-muted/50 cursor-pointer space-y-2 rounded-lg border p-3 transition-colors",
                        selectedLog?.id === log.id && "bg-muted",
                        log.level === "error" && "border-red-200",
                        log.level === "warn" && "border-yellow-200",
                      )}
                      onClick={() => setSelectedLog(log)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLogExpansion(log.id);
                            }}
                          >
                            {expandedLogs.has(log.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </Button>
                          <div
                            className={cn("mt-0.5", getLevelColor(log.level))}
                          >
                            {getLevelIcon(log.level)}
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">
                                {format(log.timestamp, "HH:mm:ss.SSS")}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {log.category}
                              </Badge>
                              {log.status && getStatusIcon(log.status)}
                              {log.duration && (
                                <span className="text-muted-foreground text-xs">
                                  {log.duration}ms
                                </span>
                              )}
                            </div>
                            <p className="text-sm">{log.message}</p>
                            {log.error && (
                              <div className="text-xs text-red-600">
                                {log.error.code}: {log.error.message}
                              </div>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyLog(log);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>

                      {expandedLogs.has(log.id) && (
                        <div className="space-y-2 pl-8 text-xs">
                          {log.context &&
                            Object.keys(log.context).length > 0 && (
                              <div>
                                <strong>Context:</strong>
                                <pre className="bg-muted mt-1 rounded p-2">
                                  {JSON.stringify(log.context, null, 2)}
                                </pre>
                              </div>
                            )}
                          {log.metadata &&
                            Object.keys(log.metadata).length > 0 && (
                              <div>
                                <strong>Metadata:</strong>
                                <pre className="bg-muted mt-1 rounded p-2">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          {log.error?.stack && (
                            <div>
                              <strong>Stack Trace:</strong>
                              <pre className="bg-muted mt-1 overflow-x-auto rounded p-2">
                                {log.error.stack}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="filters" className="mt-4 space-y-4">
            {/* Time Range */}
            <div className="space-y-2">
              <Label>Time Range</Label>
              <Select
                value={filters.timeRange}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    timeRange: value as LogFilters["timeRange"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">Last Hour</SelectItem>
                  <SelectItem value="6h">Last 6 Hours</SelectItem>
                  <SelectItem value="24h">Last 24 Hours</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Level Filters */}
            <div className="space-y-2">
              <Label>Log Levels</Label>
              <div className="grid grid-cols-2 gap-2">
                {LOG_LEVELS.map((level) => (
                  <div key={level} className="flex items-center space-x-2">
                    <Checkbox
                      id={`level-${level}`}
                      checked={filters.level.includes(level)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFilters({
                            ...filters,
                            level: [...filters.level, level],
                          });
                        } else {
                          setFilters({
                            ...filters,
                            level: filters.level.filter((l) => l !== level),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor={`level-${level}`}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <span className={getLevelColor(level)}>
                        {getLevelIcon(level)}
                      </span>
                      {level}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Category Filters */}
            <div className="space-y-2">
              <Label>Categories</Label>
              <div className="grid grid-cols-2 gap-2">
                {LOG_CATEGORIES.map((category) => (
                  <div key={category} className="flex items-center space-x-2">
                    <Checkbox
                      id={`category-${category}`}
                      checked={filters.category.includes(category)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFilters({
                            ...filters,
                            category: [...filters.category, category],
                          });
                        } else {
                          setFilters({
                            ...filters,
                            category: filters.category.filter(
                              (c) => c !== category,
                            ),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor={`category-${category}`}
                      className="cursor-pointer capitalize"
                    >
                      {category}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Filters */}
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="grid grid-cols-2 gap-2">
                {LOG_STATUSES.map((status) => (
                  <div key={status} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status}`}
                      checked={filters.status.includes(status)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFilters({
                            ...filters,
                            status: [...filters.status, status],
                          });
                        } else {
                          setFilters({
                            ...filters,
                            status: filters.status.filter((s) => s !== status),
                          });
                        }
                      }}
                    />
                    <Label
                      htmlFor={`status-${status}`}
                      className="flex cursor-pointer items-center gap-2 capitalize"
                    >
                      {getStatusIcon(status)}
                      {status}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                setFilters({
                  level: [],
                  category: [],
                  status: [],
                  search: "",
                  timeRange: "24h",
                })
              }
            >
              Clear Filters
            </Button>
          </TabsContent>

          <TabsContent value="stats" className="mt-4 space-y-4">
            <div className="grid gap-4">
              {/* Overall Stats */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{stats.total}</div>
                    <p className="text-muted-foreground text-sm">Total Logs</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">
                      {stats.avgDuration.toFixed(0)}ms
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Avg Duration
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* By Level */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">By Level</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.byLevel).map(([level, count]) => (
                      <div
                        key={level}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <span className={getLevelColor(level)}>
                            {getLevelIcon(level)}
                          </span>
                          <span className="capitalize">{level}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 rounded-full bg-gray-200">
                            <div
                              className={cn(
                                "h-2 rounded-full",
                                level === "error" && "bg-red-500",
                                level === "warn" && "bg-yellow-500",
                                level === "info" && "bg-blue-500",
                                level === "debug" && "bg-gray-500",
                              )}
                              style={{
                                width: `${(count / stats.total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-muted-foreground text-sm">
                            {count}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* By Category */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">By Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.byCategory).map(
                      ([category, count]) => (
                        <div
                          key={category}
                          className="flex items-center justify-between"
                        >
                          <span className="capitalize">{category}</span>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-32 rounded-full bg-gray-200">
                              <div
                                className="bg-primary h-2 rounded-full"
                                style={{
                                  width: `${(count / stats.total) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-muted-foreground text-sm">
                              {count}
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* By Status */}
              {Object.keys(stats.byStatus).length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">By Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(stats.byStatus).map(([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            {getStatusIcon(status)}
                            <span className="capitalize">{status}</span>
                          </div>
                          <span className="text-muted-foreground text-sm">
                            {count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
