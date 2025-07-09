"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  BarChart3,
  Info,
  ArrowRight,
} from "lucide-react";

interface ToolActionHealthMonitorProps {
  toolId?: number;
  compact?: boolean;
  refreshInterval?: number; // in seconds
}

export default function ToolActionHealthMonitor({
  toolId,
  compact = false,
  refreshInterval = 60,
}: ToolActionHealthMonitorProps) {
  const [selectedAction, setSelectedAction] = useState<{
    toolId: number;
    actionId: string;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Query for health data
  const {
    data: healthData,
    refetch,
    isLoading,
  } = trpc.tools.getToolActionHealth.useQuery(
    toolId ? { toolId } : undefined,
    autoRefresh
      ? {
          ...QUERY_OPTIONS.dynamic,
          refetchInterval: refreshInterval * 1000,
        }
      : QUERY_OPTIONS.dynamic,
  );

  // Query for specific action health
  const { data: actionHealthData } = trpc.tools.getToolActionHealth.useQuery(
    selectedAction
      ? { toolId: selectedAction.toolId, actionId: selectedAction.actionId }
      : undefined,
    {
      ...QUERY_OPTIONS.dynamic,
      enabled: !!selectedAction,
    },
  );

  // Auto-refresh control
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      refetch();
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refetch]);

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-600 bg-green-100";
      case "degraded":
        return "text-yellow-600 bg-yellow-100";
      case "failing":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-4 w-4" />;
      case "degraded":
        return <AlertTriangle className="h-4 w-4" />;
      case "failing":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  // Format latency
  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (compact) {
    return (
      <Card className="w-full">
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center">
              <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          ) : healthData?.summary ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Tool Action Health
                  </span>
                </div>
                <Badge
                  variant={
                    healthData.summary.overallHealthScore >= 80
                      ? "default"
                      : "destructive"
                  }
                >
                  {healthData.summary.overallHealthScore}%
                </Badge>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="text-center">
                  <div className="font-medium text-green-600">
                    {healthData.summary.healthy}
                  </div>
                  <div className="text-muted-foreground">Healthy</div>
                </div>
                <div className="text-center">
                  <div className="font-medium text-yellow-600">
                    {healthData.summary.degraded}
                  </div>
                  <div className="text-muted-foreground">Degraded</div>
                </div>
                <div className="text-center">
                  <div className="font-medium text-red-600">
                    {healthData.summary.failing}
                  </div>
                  <div className="text-muted-foreground">Failing</div>
                </div>
                <div className="text-center">
                  <div className="font-medium text-gray-600">
                    {healthData.summary.unknown}
                  </div>
                  <div className="text-muted-foreground">Unknown</div>
                </div>
              </div>

              {healthData.unhealthyActions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowDetails(true)}
                >
                  View {healthData.unhealthyActions.length} Issues
                  <ArrowRight className="ml-2 h-3 w-3" />
                </Button>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground text-center text-sm">
              No health data available
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Tool Action Health Monitor
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={autoRefresh ? "default" : "outline"}>
                {autoRefresh ? "Auto-refresh" : "Manual"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                {autoRefresh ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn("h-4 w-4", isLoading && "animate-spin")}
                />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : healthData ? (
            <div className="space-y-6">
              {/* Overall Health Summary */}
              {healthData.summary && (
                <div className="rounded-lg border p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-medium">
                      Overall Health Score
                    </h3>
                    <span className="text-2xl font-bold">
                      {healthData.summary.overallHealthScore}%
                    </span>
                  </div>
                  <Progress
                    value={healthData.summary.overallHealthScore}
                    className={cn(
                      "h-2",
                      healthData.summary.overallHealthScore >= 80 &&
                        "bg-green-100",
                      healthData.summary.overallHealthScore >= 50 &&
                        healthData.summary.overallHealthScore < 80 &&
                        "bg-yellow-100",
                      healthData.summary.overallHealthScore < 50 &&
                        "bg-red-100",
                    )}
                  />

                  <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">
                          {healthData.summary.healthy}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Healthy Actions
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <span className="text-sm font-medium">
                          {healthData.summary.degraded}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Degraded Actions
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-medium">
                          {healthData.summary.failing}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Failing Actions
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Info className="h-4 w-4 text-gray-600" />
                        <span className="text-sm font-medium">
                          {healthData.summary.unknown}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Unknown Status
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Unhealthy Actions */}
              {healthData.unhealthyActions &&
                healthData.unhealthyActions.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">
                      Actions Needing Attention
                    </h3>
                    <ScrollArea className="h-[300px] rounded-lg border">
                      <div className="space-y-2 p-4">
                        {healthData.unhealthyActions.map((action) => (
                          <Card
                            key={`${action.toolId}-${action.actionId}`}
                            className={cn(
                              "hover:bg-muted/50 cursor-pointer transition-colors",
                              action.status === "failing" && "border-red-200",
                              action.status === "degraded" &&
                                "border-yellow-200",
                            )}
                            onClick={() => {
                              setSelectedAction({
                                toolId: action.toolId,
                                actionId: action.actionId,
                              });
                              setShowDetails(true);
                            }}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    {getStatusIcon(action.status)}
                                    <span className="font-medium">
                                      Tool {action.toolId} - {action.actionId}
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground flex items-center gap-4 text-xs">
                                    <span>Health: {action.healthScore}%</span>
                                    <span>
                                      Failure Rate: {action.failureRate}
                                    </span>
                                    <span>
                                      Avg Latency:{" "}
                                      {formatLatency(action.averageLatency)}
                                    </span>
                                  </div>
                                </div>
                                <Badge
                                  variant={
                                    action.status === "failing"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                  className={cn(getStatusColor(action.status))}
                                >
                                  {action.status}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground mt-2 text-xs">
                                Last run:{" "}
                                {new Date(
                                  action.lastExecutionTime,
                                ).toLocaleString()}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

              {/* No issues */}
              {healthData.unhealthyActions &&
                healthData.unhealthyActions.length === 0 && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>All Systems Operational</AlertTitle>
                    <AlertDescription>
                      All tool actions are running within normal parameters.
                    </AlertDescription>
                  </Alert>
                )}
            </div>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No health monitoring data available yet. Tool actions need to be
                executed to collect health metrics.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {selectedAction
                ? `Tool Action Health Details`
                : "Tool Action Health Overview"}
            </DialogTitle>
            <DialogDescription>
              {selectedAction
                ? `Detailed metrics for Tool ${selectedAction.toolId} - ${selectedAction.actionId}`
                : "Overview of all unhealthy tool actions"}
            </DialogDescription>
          </DialogHeader>

          {selectedAction && actionHealthData ? (
            <Tabs defaultValue="metrics" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="metrics">Metrics</TabsTrigger>
                <TabsTrigger value="recommendations">
                  Recommendations
                </TabsTrigger>
              </TabsList>

              <TabsContent value="metrics" className="space-y-4">
                {actionHealthData.metrics && (
                  <>
                    <div className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium">
                          Health Score
                        </span>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={actionHealthData.metrics.healthScore}
                            className="w-24"
                          />
                          <span className="text-sm font-bold">
                            {actionHealthData.metrics.healthScore}%
                          </span>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "rounded-md px-3 py-1 text-center",
                          getStatusColor(actionHealthData.metrics.status),
                        )}
                      >
                        {actionHealthData.metrics.status.toUpperCase()}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <Card>
                        <CardContent className="p-4">
                          <h4 className="mb-2 text-sm font-medium">
                            Execution Stats
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Total Executions
                              </span>
                              <span className="font-medium">
                                {actionHealthData.metrics.totalExecutions}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Success Count
                              </span>
                              <span className="font-medium text-green-600">
                                {actionHealthData.metrics.successCount}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Failure Count
                              </span>
                              <span className="font-medium text-red-600">
                                {actionHealthData.metrics.failureCount}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Consecutive Failures
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  actionHealthData.metrics.consecutiveFailures >
                                    0 && "text-red-600",
                                )}
                              >
                                {actionHealthData.metrics.consecutiveFailures}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="p-4">
                          <h4 className="mb-2 text-sm font-medium">
                            Performance Metrics
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Average Latency
                              </span>
                              <span className="font-medium">
                                {formatLatency(
                                  actionHealthData.metrics.averageLatency,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Min Latency
                              </span>
                              <span className="font-medium">
                                {formatLatency(
                                  actionHealthData.metrics.minLatency,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Max Latency
                              </span>
                              <span className="font-medium">
                                {formatLatency(
                                  actionHealthData.metrics.maxLatency,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Last Execution
                              </span>
                              <span className="font-medium">
                                {new Date(
                                  actionHealthData.metrics.lastExecutionTime,
                                ).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="recommendations" className="space-y-4">
                {actionHealthData.recommendations &&
                actionHealthData.recommendations.length > 0 ? (
                  <div className="space-y-3">
                    {actionHealthData.recommendations.map((rec, idx) => (
                      <Alert key={idx}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{rec}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      No specific recommendations at this time. The tool action
                      is performing within acceptable parameters.
                    </AlertDescription>
                  </Alert>
                )}

                {actionHealthData.needsAttention && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Immediate Attention Required</AlertTitle>
                    <AlertDescription>
                      This tool action is experiencing significant issues and
                      requires investigation.
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>
            </Tabs>
          ) : !selectedAction && healthData?.unhealthyActions ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {healthData.unhealthyActions.map((action) => (
                  <Card
                    key={`${action.toolId}-${action.actionId}`}
                    className="hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedAction({
                        toolId: action.toolId,
                        actionId: action.actionId,
                      });
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(action.status)}
                            <span className="font-medium">
                              Tool {action.toolId} - {action.actionId}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1">
                              <span className="text-muted-foreground">
                                Health Score
                              </span>
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={action.healthScore}
                                  className="h-2 w-16"
                                />
                                <span className="font-medium">
                                  {action.healthScore}%
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <span className="text-muted-foreground">
                                Failure Rate
                              </span>
                              <span className="font-medium">
                                {action.failureRate}
                              </span>
                            </div>
                          </div>
                          <div className="text-muted-foreground flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Avg: {formatLatency(action.averageLatency)}
                            </span>
                            <span>
                              Last run:{" "}
                              {new Date(
                                action.lastExecutionTime,
                              ).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant={
                            action.status === "failing"
                              ? "destructive"
                              : "secondary"
                          }
                          className={cn(getStatusColor(action.status))}
                        >
                          {action.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
