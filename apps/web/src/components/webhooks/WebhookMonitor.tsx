"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  Filter,
  Eye,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/components/providers/TrpcProvider";
import { cn } from "@/lib/utils";
import { QUERY_OPTIONS } from "@/trpc/shared";

// Type definitions for webhook monitoring data
type WebhookStatus =
  | "success"
  | "failure"
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | undefined;

interface WebhookAlert {
  type: string;
  threshold: number;
  currentValue: number;
  triggered: boolean;
}

interface WebhookActivity {
  timestamp: string;
  status: WebhookStatus;
  responseTime: number;
  sourceIp: string;
}

interface WebhookMetrics {
  totalRequests: number;
  successRate: number;
  errorRate: number;
  averageResponseTime: number;
  rateLimitHits: number;
  uniqueIps: number;
}

interface WebhookMonitoringData {
  webhookKey: string | undefined;
  metricsWindow: string;
  realtime: boolean;
  metrics: WebhookMetrics;
  alerts: WebhookAlert[];
  recentActivity: WebhookActivity[];
}

interface WebhookStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  byStatus: Record<string, number>;
  byMethod: Record<string, number>;
}

interface WebhookMonitorProps {
  webhookKey: string;
  onClose?: () => void;
}

export function WebhookMonitor({ webhookKey, onClose }: WebhookMonitorProps) {
  const [timeRange, setTimeRange] = useState("24h");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showPayload, setShowPayload] = useState<string | number | null>(null);
  const { toast } = useToast();

  // tRPC queries
  const {
    data: monitoringData,
    isLoading: isLoadingMonitoring,
    refetch: refetchMonitoring,
  } = trpc.webhooks.getMonitoring.useQuery(
    {
      key: webhookKey,
      includeRealtime: true,
      metricsWindow: timeRange as "1h" | "6h" | "24h" | "7d" | "30d",
      alertThresholds: {
        errorRate: 10,
        rateLimitHits: 100,
        avgResponseTime: 5000,
      },
    },
    QUERY_OPTIONS.realtime,
  );

  const {
    data: executionHistory,
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
  } = trpc.webhooks.getExecutionHistory.useQuery(
    {
      key: webhookKey,
      limit: 50,
      status:
        statusFilter === "all" ? undefined : (statusFilter as WebhookStatus),
      sortBy: "timestamp",
      sortOrder: "desc",
    },
    QUERY_OPTIONS.dynamic,
  );

  const { data: statsData, isLoading: isLoadingStats } =
    trpc.webhooks.getStats.useQuery(
      {
        key: webhookKey,
        period: "day",
        groupBy: "status",
      },
      QUERY_OPTIONS.dynamic,
    );

  const refreshAll = () => {
    void refetchMonitoring();
    void refetchHistory();
    toast({
      title: "Refreshed",
      description: "Monitoring data has been refreshed",
    });
  };

  const formatDateTime = (date: string | Date) => {
    return new Date(date).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const getStatusIcon = (status: string | undefined) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failure":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "timeout":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "rate_limited":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "unauthorized":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case undefined:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800";
      case "failure":
        return "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800";
      case "timeout":
        return "text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950 dark:border-yellow-800";
      case "rate_limited":
        return "text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800";
      default:
        return "text-gray-700 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-950 dark:border-gray-800";
    }
  };

  const exportData = () => {
    if (!executionHistory?.items) return;

    const csvContent = [
      [
        "Timestamp",
        "Status",
        "Method",
        "Source IP",
        "Response Time (ms)",
        "Response Code",
      ].join(","),
      ...executions.map((exec) =>
        [
          formatDateTime(exec.timestamp),
          exec.status,
          exec.method,
          exec.sourceIp,
          exec.responseTime,
          exec.responseCode ?? "N/A",
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webhook-${webhookKey}-executions.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: "Execution history has been exported to CSV",
    });
  };

  if (isLoadingMonitoring || isLoadingHistory || isLoadingStats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin" />
          <p className="text-muted-foreground">Loading monitoring data...</p>
        </div>
      </div>
    );
  }

  const monitoring: WebhookMonitoringData =
    (monitoringData as WebhookMonitoringData) ?? {
      webhookKey: webhookKey || "",
      metricsWindow: timeRange,
      realtime: true,
      metrics: {
        totalRequests: 0,
        successRate: 0,
        errorRate: 0,
        averageResponseTime: 0,
        rateLimitHits: 0,
        uniqueIps: 0,
      },
      alerts: [] as WebhookAlert[],
      recentActivity: [] as WebhookActivity[],
    };

  const stats: WebhookStats = statsData?.metrics
    ? {
        totalExecutions: (statsData.metrics.totalExecutions as number) ?? 0,
        successfulExecutions:
          (statsData.metrics.successfulExecutions as number) ?? 0,
        failedExecutions: (statsData.metrics.failedExecutions as number) ?? 0,
        byStatus:
          statsData.breakdown?.status?.reduce(
            (acc, item) => ({ ...acc, [item.label]: item.value }),
            {},
          ) ?? {},
        byMethod:
          statsData.breakdown?.method?.reduce(
            (acc, item) => ({ ...acc, [item.label]: item.value }),
            {},
          ) ?? {},
      }
    : {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        byStatus: {},
        byMethod: {},
      };

  interface WebhookExecution {
    id: string | number;
    timestamp: string | Date;
    status: string;
    method: string;
    sourceIp: string;
    responseTime: number;
    responseCode?: number;
    payload?: unknown;
    headers?: unknown;
  }

  const executions = (executionHistory?.items ?? []) as WebhookExecution[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Webhook Analytics</h3>
          <p className="text-muted-foreground text-sm">
            Monitoring data for webhook:{" "}
            <code className="bg-muted rounded px-1">{webhookKey}</code>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="6h">Last 6 Hours</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Activity className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Total Requests
              </p>
            </div>
            <p className="text-2xl font-bold">
              {monitoring.metrics.totalRequests}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <p className="text-muted-foreground text-sm font-medium">
                Success Rate
              </p>
            </div>
            <p className="text-2xl font-bold">
              {monitoring.metrics.successRate.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <p className="text-muted-foreground text-sm font-medium">
                Error Rate
              </p>
            </div>
            <p className="text-2xl font-bold">
              {monitoring.metrics.errorRate.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Avg Response
              </p>
            </div>
            <p className="text-2xl font-bold">
              {formatDuration(monitoring.metrics.averageResponseTime)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <p className="text-muted-foreground text-sm font-medium">
                Rate Limits
              </p>
            </div>
            <p className="text-2xl font-bold">
              {monitoring.metrics.rateLimitHits}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Activity className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm font-medium">
                Unique IPs
              </p>
            </div>
            <p className="text-2xl font-bold">{monitoring.metrics.uniqueIps}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {monitoring.alerts && monitoring.alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {monitoring.alerts.map((alert: WebhookAlert, index: number) => (
                <div
                  key={index}
                  className={cn(
                    "rounded-lg border p-3",
                    alert.triggered
                      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                      : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium capitalize">
                        {alert.type.replace(/_/g, " ")}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Current: {String(alert.currentValue)} | Threshold:{" "}
                        {String(alert.threshold)}
                      </p>
                    </div>
                    <Badge
                      variant={alert.triggered ? "destructive" : "default"}
                    >
                      {alert.triggered ? "Triggered" : "OK"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="executions" className="w-full">
        <TabsList>
          <TabsTrigger value="executions">Execution History</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="executions" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4" />
                <Label>Filter by status:</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failure">Failure</SelectItem>
                    <SelectItem value="timeout">Timeout</SelectItem>
                    <SelectItem value="rate_limited">Rate Limited</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportData}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>

          {/* Execution History Table */}
          <Card>
            <CardContent className="p-0">
              {executions.length === 0 ? (
                <div className="py-8 text-center">
                  <Activity className="text-muted-foreground mx-auto mb-4 h-8 w-8" />
                  <p className="text-muted-foreground">
                    No webhook executions found
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Source IP</TableHead>
                      <TableHead>Response Time</TableHead>
                      <TableHead>Response Code</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.map((execution) => (
                      <TableRow key={execution.id as string}>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(execution.status ?? "unknown")}
                            <Badge
                              variant="outline"
                              className={getStatusColor(
                                execution.status ?? "unknown",
                              )}
                            >
                              {execution.status ?? "unknown"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {formatDateTime(execution.timestamp)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {execution.method}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">{execution.sourceIp}</code>
                        </TableCell>
                        <TableCell>
                          {formatDuration(execution.responseTime)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              execution.responseCode &&
                              execution.responseCode >= 200 &&
                              execution.responseCode < 300
                                ? "default"
                                : "destructive"
                            }
                          >
                            {execution.responseCode ?? "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setShowPayload(
                                showPayload === execution.id
                                  ? null
                                  : execution.id,
                              )
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Payload Viewer */}
          {showPayload && (
            <Card>
              <CardHeader>
                <CardTitle>Execution Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(() => {
                    const execution = executions.find(
                      (e) => e.id === showPayload,
                    );
                    if (!execution) return null;

                    return (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <Label>Request Payload</Label>
                          <pre className="bg-muted max-h-40 overflow-auto rounded p-3 text-xs">
                            {JSON.stringify(execution.payload ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <Label>Request Headers</Label>
                          <pre className="bg-muted max-h-40 overflow-auto rounded p-3 text-xs">
                            {JSON.stringify(execution.headers ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {monitoring.recentActivity.map(
                  (activity: WebhookActivity, index: number) => (
                    <div
                      key={index}
                      className="border-border flex items-center justify-between rounded border p-3"
                    >
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(activity.status)}
                        <div>
                          <p className="text-sm font-medium">
                            {activity.status === "success"
                              ? "Successful execution"
                              : "Failed execution"}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {formatDateTime(activity.timestamp)} •{" "}
                            {activity.sourceIp}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {formatDuration(activity.responseTime)}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.byStatus).map(([status, count]) => (
                    <div
                      key={status}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(status)}
                        <span className="capitalize">{status}</span>
                      </div>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Method Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.byMethod).map(([method, count]) => (
                    <div
                      key={method}
                      className="flex items-center justify-between"
                    >
                      <Badge variant="outline" className="font-mono">
                        {method}
                      </Badge>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
