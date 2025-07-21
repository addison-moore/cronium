"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import type { RouterOutputs } from "@/trpc/shared";

type ToolWithParsedCredentials = RouterOutputs["tools"]["list"][number];
import { ToolPluginRegistry } from "./types/tool-plugin";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Zap,
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  Info,
  Play,
  Pause,
} from "lucide-react";

interface CredentialHealthIndicatorProps {
  toolId?: number;
  compact?: boolean;
  autoCheck?: boolean;
  checkInterval?: number; // in minutes
  onHealthChange?: (status: HealthStatus) => void;
}

interface HealthStatus {
  overall: "healthy" | "warning" | "error" | "unknown";
  checks: HealthCheck[];
  lastChecked: Date | null;
  nextCheck?: Date;
}

interface HealthCheck {
  name: string;
  status: "pass" | "warning" | "fail" | "checking";
  message: string;
  details?: Record<string, unknown>;
  duration?: number; // in ms
}

export default function CredentialHealthIndicator({
  toolId,
  compact = false,
  autoCheck = true,
  checkInterval = 30,
  onHealthChange,
}: CredentialHealthIndicatorProps) {
  const [healthStatus, setHealthStatus] = useState<
    Record<number, HealthStatus>
  >({});
  const [isChecking, setIsChecking] = useState<Record<number, boolean>>({});
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(autoCheck);
  const [selectedTool, setSelectedTool] =
    useState<ToolWithParsedCredentials | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Queries
  const { data: tools = [] } = trpc.tools.list.useQuery(
    toolId ? { id: toolId } : undefined,
    {
      ...QUERY_OPTIONS.dynamic,
    },
  );

  // Mutations
  const testConnectionMutation = trpc.tools.testConnection.useMutation({
    onMutate: ({ id }) => {
      setIsChecking((prev) => ({ ...prev, [id]: true }));
    },
    onSuccess: (result, variables) => {
      const checks: HealthCheck[] = [];

      // Basic connection check
      checks.push({
        name: "Connection",
        status: result.success ? "pass" : "fail",
        message: result.message ?? "Connection test completed",
        duration: result.duration,
      });

      // Additional checks from result details
      if (result.details) {
        if (result.details.authenticated !== undefined) {
          checks.push({
            name: "Authentication",
            status: result.details.authenticated ? "pass" : "fail",
            message: result.details.authenticated
              ? "Authentication successful"
              : "Authentication failed",
          });
        }

        if (result.details.permissions) {
          const hasAllPermissions = Array.isArray(result.details.permissions)
            ? (result.details.permissions as Array<{ granted: boolean }>).every(
                (p) => p.granted,
              )
            : true;

          checks.push({
            name: "Permissions",
            status: hasAllPermissions ? "pass" : "warning",
            message: hasAllPermissions
              ? "All required permissions granted"
              : "Some permissions missing",
            details: result.details.permissions as Record<string, unknown>,
          });
        }

        if (result.details.quota) {
          const quota = result.details.quota as { used: number; limit: number };
          const quotaUsed = (quota.used / quota.limit) * 100;
          checks.push({
            name: "API Quota",
            status: quotaUsed > 90 ? "warning" : "pass",
            message: `${quotaUsed.toFixed(0)}% of quota used`,
            details: result.details.quota as Record<string, unknown>,
          });
        }

        if (result.details.latency !== undefined) {
          const latency = result.details.latency as number;
          checks.push({
            name: "Latency",
            status: latency > 1000 ? "warning" : "pass",
            message: `${latency}ms response time`,
          });
        }
      }

      // Determine overall status
      const hasFailure = checks.some((c) => c.status === "fail");
      const hasWarning = checks.some((c) => c.status === "warning");
      const overall = hasFailure ? "error" : hasWarning ? "warning" : "healthy";

      const newStatus: HealthStatus = {
        overall,
        checks,
        lastChecked: new Date(),
        ...(autoCheckEnabled && {
          nextCheck: new Date(Date.now() + checkInterval * 60 * 1000),
        }),
      };

      setHealthStatus((prev) => ({
        ...prev,
        [variables.id]: newStatus,
      }));

      if (onHealthChange && variables.id === toolId) {
        onHealthChange(newStatus);
      }
    },
    onError: (error, variables) => {
      const newStatus: HealthStatus = {
        overall: "error",
        checks: [
          {
            name: "Connection",
            status: "fail",
            message: error.message ?? "Connection test failed",
          },
        ],
        lastChecked: new Date(),
        ...(autoCheckEnabled && {
          nextCheck: new Date(Date.now() + checkInterval * 60 * 1000),
        }),
      };

      setHealthStatus((prev) => ({
        ...prev,
        [variables.id]: newStatus,
      }));

      if (onHealthChange && variables.id === toolId) {
        onHealthChange(newStatus);
      }
    },
    onSettled: (_, __, variables) => {
      setIsChecking((prev) => ({ ...prev, [variables.id]: false }));
    },
  });

  // Auto-check effect
  useEffect(() => {
    if (!autoCheckEnabled) return;

    const checkTools = () => {
      tools.forEach((tool) => {
        const status = healthStatus[tool.id];
        const shouldCheck =
          !status?.lastChecked ||
          (status.nextCheck && new Date() >= status.nextCheck);

        if (shouldCheck && !isChecking[tool.id]) {
          testConnectionMutation.mutate({ id: tool.id });
        }
      });
    };

    // Initial check
    checkTools();

    // Set up interval
    const interval = setInterval(checkTools, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, [tools, autoCheckEnabled, checkInterval, healthStatus, isChecking]);

  // Manual check
  const checkHealth = (tool: ToolWithParsedCredentials) => {
    testConnectionMutation.mutate({ id: tool.id });
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "pass":
        return "text-green-600 bg-green-100";
      case "warning":
        return "text-yellow-600 bg-yellow-100";
      case "error":
      case "fail":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
      case "pass":
        return <CheckCircle className="h-4 w-4" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4" />;
      case "error":
      case "fail":
        return <AlertCircle className="h-4 w-4" />;
      case "checking":
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      default:
        return <HelpCircle className="h-4 w-4" />;
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-4">
        {tools.map((tool) => {
          const status = healthStatus[tool.id];
          const plugin = ToolPluginRegistry.get(tool.type);
          const checking = isChecking[tool.id];

          return (
            <TooltipProvider key={tool.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "gap-2",
                      status && getStatusColor(status.overall),
                    )}
                    onClick={() => {
                      setSelectedTool(tool);
                      setShowDetails(true);
                    }}
                  >
                    {plugin && <plugin.icon className="h-4 w-4" />}
                    {checking ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      getStatusIcon(status?.overall ?? "unknown")
                    )}
                    {tool.name}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1">
                    <p className="font-medium">
                      Status: {status?.overall ?? "Not checked"}
                    </p>
                    {status?.lastChecked && (
                      <p className="text-xs">
                        Last checked:{" "}
                        {new Date(status.lastChecked).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs">Click for details</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Credential Health Monitor
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={autoCheckEnabled ? "default" : "outline"}>
                {autoCheckEnabled ? "Auto-checking" : "Manual"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoCheckEnabled(!autoCheckEnabled)}
              >
                {autoCheckEnabled ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            {tools.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No tools configured. Add tools to monitor their health.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => {
                  const status = healthStatus[tool.id];
                  const plugin = ToolPluginRegistry.get(tool.type);
                  const checking = isChecking[tool.id];

                  return (
                    <Card
                      key={tool.id}
                      className={cn(
                        "hover:bg-muted/50 cursor-pointer transition-colors",
                        status && {
                          "border-green-200": status.overall === "healthy",
                          "border-yellow-200": status.overall === "warning",
                          "border-red-200": status.overall === "error",
                        },
                      )}
                      onClick={() => {
                        setSelectedTool(tool);
                        setShowDetails(true);
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              {plugin && <plugin.icon className="h-5 w-5" />}
                              <h4 className="font-medium">{tool.name}</h4>
                            </div>
                            {checking ? (
                              <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" />
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  checkHealth(tool);
                                }}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <div className="space-y-2">
                            {status ? (
                              <>
                                <div
                                  className={cn(
                                    "flex items-center gap-2 rounded-md px-2 py-1",
                                    getStatusColor(status.overall),
                                  )}
                                >
                                  {getStatusIcon(status.overall)}
                                  <span className="text-sm font-medium capitalize">
                                    {status.overall}
                                  </span>
                                </div>

                                <div className="space-y-1">
                                  {status.checks
                                    .slice(0, 2)
                                    .map((check, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-sm"
                                      >
                                        <span className="text-muted-foreground">
                                          {check.name}
                                        </span>
                                        <span
                                          className={cn(
                                            "font-medium",
                                            check.status === "pass" &&
                                              "text-green-600",
                                            check.status === "warning" &&
                                              "text-yellow-600",
                                            check.status === "fail" &&
                                              "text-red-600",
                                          )}
                                        >
                                          {check.status}
                                        </span>
                                      </div>
                                    ))}
                                  {status.checks.length > 2 && (
                                    <p className="text-muted-foreground text-xs">
                                      +{status.checks.length - 2} more checks
                                    </p>
                                  )}
                                </div>

                                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                                  <Clock className="h-3 w-3" />
                                  {status.lastChecked
                                    ? new Date(
                                        status.lastChecked,
                                      ).toLocaleTimeString()
                                    : "Never"}
                                  {status.nextCheck && (
                                    <>
                                      <ArrowRight className="h-3 w-3" />
                                      {new Date(
                                        status.nextCheck,
                                      ).toLocaleTimeString()}
                                    </>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 rounded-md bg-gray-100 px-2 py-1 text-gray-600">
                                  <HelpCircle className="h-4 w-4" />
                                  <span className="text-sm font-medium">
                                    Not checked
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-xs">
                                  Click refresh to check connection
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {autoCheckEnabled && tools.length > 0 && (
            <div className="bg-muted/50 mt-6 rounded-lg p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4" />
                <span>
                  Auto-checking every {checkInterval} minutes. Next check in{" "}
                  {(() => {
                    const nextCheck = Object.values(healthStatus)
                      .map((s) => s.nextCheck)
                      .filter(Boolean)
                      .sort()[0];

                    if (!nextCheck) return "N/A";

                    const minutes = Math.max(
                      0,
                      Math.floor(
                        (new Date(nextCheck).getTime() - Date.now()) / 60000,
                      ),
                    );

                    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
                  })()}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTool &&
                ToolPluginRegistry.get(selectedTool.type)?.icon &&
                (() => {
                  const Icon = ToolPluginRegistry.get(selectedTool.type)!.icon;
                  return <Icon className="h-5 w-5" />;
                })()}
              {selectedTool?.name} Health Details
            </DialogTitle>
            <DialogDescription>
              Detailed health check results and diagnostics
            </DialogDescription>
          </DialogHeader>

          {selectedTool && (
            <div className="space-y-4">
              {(() => {
                const status = healthStatus[selectedTool.id];
                if (!status) {
                  return (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        No health check data available. Click refresh to run a
                        check.
                      </AlertDescription>
                    </Alert>
                  );
                }

                return (
                  <>
                    <div
                      className={cn(
                        "flex items-center justify-between rounded-lg p-4",
                        getStatusColor(status.overall),
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(status.overall)}
                        <span className="font-medium capitalize">
                          Overall Status: {status.overall}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => checkHealth(selectedTool)}
                        disabled={isChecking[selectedTool.id]}
                      >
                        <RefreshCw
                          className={cn(
                            "h-4 w-4",
                            isChecking[selectedTool.id] && "animate-spin",
                          )}
                        />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Health Checks</h4>
                      <ScrollArea className="border-border h-[300px] rounded-lg border p-4">
                        <div className="space-y-3">
                          {status.checks.map((check, idx) => (
                            <div
                              key={idx}
                              className="space-y-2 border-b pb-3 last:border-0"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                  {getStatusIcon(check.status)}
                                  <span className="font-medium">
                                    {check.name}
                                  </span>
                                </div>
                                <Badge
                                  variant={
                                    check.status === "pass"
                                      ? "default"
                                      : check.status === "warning"
                                        ? "secondary"
                                        : "destructive"
                                  }
                                >
                                  {check.status}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground text-sm">
                                {check.message}
                              </p>
                              {check.duration && (
                                <p className="text-muted-foreground text-xs">
                                  Duration: {check.duration}ms
                                </p>
                              )}
                              {check.details && (
                                <pre className="bg-muted mt-2 rounded p-2 text-xs">
                                  {JSON.stringify(check.details, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>

                    <div className="text-muted-foreground flex items-center justify-between text-sm">
                      <span>
                        Last checked:{" "}
                        {status.lastChecked
                          ? new Date(status.lastChecked).toLocaleString()
                          : "Never"}
                      </span>
                      {status.nextCheck && (
                        <span>
                          Next check:{" "}
                          {new Date(status.nextCheck).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
