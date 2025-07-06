"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { LogStatus, UserRole } from "@/shared/schema";
import { useAuth } from "@/hooks/useAuth";
import {
  Users,
  Code,
  Server,
  CheckCircle,
  XCircle,
  CheckCheck,
  RefreshCw,
  Clock,
  Activity,
  Mail,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/server/api/root";
import { QUERY_OPTIONS } from "@/trpc/shared";

// Types for monitoring data
interface MonitoringData {
  time: string;
  users: {
    total: number;
    active: number;
    admins: number;
    invited?: number;
    disabled?: number;
  };
  events: {
    total: number;
    active: number;
    paused: number;
    draft: number;
  };
  executions: {
    total: number;
    success: number;
    failure: number;
    running: number;
    successRate: number;
    failureRate: number;
  };
  servers?:
    | {
        total: number;
        online: number;
        offline: number;
      }
    | undefined;
  activity?:
    | {
        last24Hours: number;
        lastWeek: number;
        lastMonth: number;
      }
    | undefined;
  recentActivity: Array<{
    id: number;
    eventId: number;
    eventName: string;
    status: LogStatus;
    duration: number;
    startTime: string;
  }>;
  system?:
    | {
        uptime: number;
        memory: {
          total: number;
          used: number;
          free: number;
          rss: number;
          external: number;
          arrayBuffers: number;
        };
        cpu: {
          currentLoad: number;
          systemLoad: number;
          userLoad: number;
          temperature: number;
          manufacturer: string;
          brand: string;
          speed: number;
          cores: number;
        };
        os: {
          platform: string;
          distro: string;
          release: string;
          arch: string;
          hostname: string;
        };
      }
    | undefined;
}

export default function MonitoringPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [currentUptime, setCurrentUptime] = useState<number | null>(null);

  // tRPC queries with proper typing
  const {
    data: monitoringData,
    isLoading,
    refetch,
    error,
  } = trpc.monitoring.getSystemMonitoring.useQuery(
    {
      period: "week",
      includeSystemMetrics: true,
      includeRecentActivity: true,
      includeSettings: false,
    },
    QUERY_OPTIONS.realtime,
  );

  // Type the monitoring data from tRPC
  type SystemMonitoringData =
    RouterOutputs["monitoring"]["getSystemMonitoring"];

  // Helper function to safely extract event stats
  function getEventStats(
    events: SystemMonitoringData["events"],
  ): MonitoringData["events"] {
    // The API returns only total and active, so we default paused and draft to 0
    return {
      total: events.total ?? 0,
      active: events.active ?? 0,
      paused: 0, // Not provided by API
      draft: 0, // Not provided by API
    };
  }

  // Transform tRPC data to match expected interface
  const transformedData: MonitoringData | null = monitoringData
    ? {
        time: monitoringData.timestamp,
        users: monitoringData.users,
        events: getEventStats(monitoringData.events),
        executions: {
          total: monitoringData.executions.total ?? 0,
          success: monitoringData.executions.successful ?? 0,
          failure: monitoringData.executions.failed ?? 0,
          running: monitoringData.executions.running ?? 0,
          successRate: monitoringData.executions.successRate ?? 0,
          failureRate: monitoringData.executions.failureRate ?? 0,
        },
        servers: monitoringData.servers
          ? {
              total: monitoringData.servers.total ?? 0,
              online: monitoringData.servers.online ?? 0,
              offline:
                (monitoringData.servers.total ?? 0) -
                (monitoringData.servers.online ?? 0),
            }
          : undefined,
        activity: monitoringData.activity,
        recentActivity: monitoringData.recentActivity.map((activity) => ({
          id: activity.id,
          eventId: activity.eventId,
          eventName: activity.eventName ?? "Unknown",
          status: activity.status,
          duration: activity.duration ?? 0,
          startTime:
            typeof activity.startTime === "string"
              ? activity.startTime
              : activity.startTime.toISOString(),
        })),
        system: monitoringData.system
          ? {
              uptime: monitoringData.system.uptime,
              memory: monitoringData.system.memory,
              cpu: {
                currentLoad: monitoringData.system.cpu.currentLoad,
                systemLoad: monitoringData.system.cpu.systemLoad,
                userLoad: monitoringData.system.cpu.userLoad,
                temperature: monitoringData.system.cpu.temperature ?? 0,
                manufacturer: "N/A",
                brand: "N/A",
                speed: 0,
                cores: 0,
              },
              os: {
                platform: monitoringData.system.os.platform,
                distro: "N/A",
                release: monitoringData.system.os.version,
                arch: monitoringData.system.os.arch,
                hostname: monitoringData.system.os.hostname ?? "localhost",
              },
            }
          : undefined,
      }
    : null;

  // Effect for updating uptime every second without refetching data
  useEffect(() => {
    if (transformedData?.system?.uptime) {
      // Initialize with the latest fetched uptime
      setCurrentUptime(transformedData.system.uptime);

      // Increment uptime every second
      const uptimeInterval = setInterval(() => {
        setCurrentUptime((prev) => (prev !== null ? prev + 1 : null));
      }, 1000);

      return () => clearInterval(uptimeInterval);
    }
    return; // Explicit return for clarity
  }, [transformedData?.system?.uptime]);

  function formatUptime(seconds: number) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  function formatMemory(bytes: number) {
    const mb = bytes / (1024 * 1024);
    if (mb < 1000) {
      return `${mb.toFixed(2)} MB`;
    }
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }

  if (isLoading || !transformedData) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">System Monitoring</h1>
        </div>

        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold">System Monitoring</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            Last updated: {new Date(transformedData.time).toLocaleTimeString()}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof refetch === "function") void refetch();
            }}
            disabled={isLoading}
            className="bg-background"
          >
            {isLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Top Row: User Statistics and Server Status Side by Side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* User Statistics - Compact */}
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center text-base">
                <Users className="mr-2 h-4 w-4 text-gray-500" />
                User Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                <div className="flex min-w-[70px] flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <Users className="mb-1 h-4 w-4 text-blue-500" />
                  <span className="text-sm font-bold">
                    {transformedData.users.total}
                  </span>
                  <span className="text-xs text-gray-500">Total</span>
                </div>

                <div className="flex min-w-[70px] flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <CheckCheck className="mb-1 h-4 w-4 text-green-500" />
                  <span className="text-sm font-bold">
                    {transformedData.users.active}
                  </span>
                  <span className="text-xs text-gray-500">Active</span>
                </div>

                <div className="flex min-w-[70px] flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <Users className="mb-1 h-4 w-4 text-purple-500" />
                  <span className="text-sm font-bold">
                    {transformedData.users.admins}
                  </span>
                  <span className="text-xs text-gray-500">Admins</span>
                </div>

                {transformedData.users.invited &&
                  transformedData.users.invited > 0 && (
                    <div className="flex min-w-[70px] flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                      <Mail className="mb-1 h-4 w-4 text-amber-500" />
                      <span className="text-sm font-bold">
                        {transformedData.users.invited ?? 0}
                      </span>
                      <span className="text-xs text-gray-500">Invited</span>
                    </div>
                  )}

                {transformedData.users.disabled &&
                  transformedData.users.disabled > 0 && (
                    <div className="flex min-w-[70px] flex-1 flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                      <XCircle className="mb-1 h-4 w-4 text-red-500" />
                      <span className="text-sm font-bold">
                        {transformedData.users.disabled ?? 0}
                      </span>
                      <span className="text-xs text-gray-500">Disabled</span>
                    </div>
                  )}
              </div>

              {user?.role === UserRole.ADMIN && (
                <div className="pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => router.push("/dashboard/admin#users")}
                  >
                    Manage Users
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Server Status - Compact */}
          {transformedData.servers && (
            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-base">
                  <Server className="mr-2 h-4 w-4 text-gray-500" />
                  Server Status
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                    <Server className="mb-1 h-4 w-4 text-blue-500" />
                    <span className="text-sm font-bold">
                      {transformedData.servers.total}
                    </span>
                    <span className="text-xs text-gray-500">Total</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                    <CheckCircle className="mb-1 h-4 w-4 text-green-500" />
                    <span className="text-sm font-bold">
                      {transformedData.servers.online}
                    </span>
                    <span className="text-xs text-gray-500">Online</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                    <XCircle className="mb-1 h-4 w-4 text-red-500" />
                    <span className="text-sm font-bold">
                      {transformedData.servers.total -
                        transformedData.servers.online}
                    </span>
                    <span className="text-xs text-gray-500">Offline</span>
                  </div>
                </div>

                <div className="pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => router.push("/dashboard/servers")}
                  >
                    Manage Servers
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Scripts and Executions */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Events Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <Code className="mr-2 h-5 w-5 text-gray-500" />
                Events Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Events</span>
                <span className="font-bold">
                  {transformedData.events.total}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center">
                    <span className="mr-2 h-3 w-3 rounded-full bg-green-500"></span>
                    Active
                  </span>
                  <span>
                    {transformedData.events.active}
                    {transformedData.events.total > 0 && (
                      <span className="ml-1 text-xs text-gray-500">
                        (
                        {Math.round(
                          (transformedData.events.active /
                            transformedData.events.total) *
                            100,
                        )}
                        %)
                      </span>
                    )}
                  </span>
                </div>
                <Progress
                  value={
                    transformedData.events.total > 0
                      ? (transformedData.events.active /
                          transformedData.events.total) *
                        100
                      : 0
                  }
                  className="h-2 bg-gray-100"
                />

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center">
                    <span className="mr-2 h-3 w-3 rounded-full bg-yellow-500"></span>
                    Paused
                  </span>
                  <span>
                    {transformedData.events.paused}
                    {transformedData.events.total > 0 && (
                      <span className="ml-1 text-xs text-gray-500">
                        (
                        {Math.round(
                          (transformedData.events.paused /
                            transformedData.events.total) *
                            100,
                        )}
                        %)
                      </span>
                    )}
                  </span>
                </div>
                <Progress
                  value={
                    transformedData.events.total > 0
                      ? (transformedData.events.paused /
                          transformedData.events.total) *
                        100
                      : 0
                  }
                  className="h-2 bg-gray-100"
                />

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center">
                    <span className="mr-2 h-3 w-3 rounded-full bg-gray-400"></span>
                    Draft
                  </span>
                  <span>
                    {transformedData.events.draft}
                    {transformedData.events.total > 0 && (
                      <span className="ml-1 text-xs text-gray-500">
                        (
                        {Math.round(
                          (transformedData.events.draft /
                            transformedData.events.total) *
                            100,
                        )}
                        %)
                      </span>
                    )}
                  </span>
                </div>
                <Progress
                  value={
                    transformedData.events.total > 0
                      ? (transformedData.events.draft /
                          transformedData.events.total) *
                        100
                      : 0
                  }
                  className="h-2 bg-gray-100"
                />
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/dashboard/events")}
                >
                  Manage Events
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Executions Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <Activity className="mr-2 h-5 w-5 text-gray-500" />
                Executions Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Executions</span>
                <span className="font-bold">
                  {transformedData.executions.total}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 pb-2">
                <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <CheckCircle className="mb-1 h-6 w-6 text-green-500" />
                  <span className="text-lg font-bold">
                    {transformedData.executions.success}
                  </span>
                  <span className="text-xs text-gray-500">Success</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <XCircle className="mb-1 h-6 w-6 text-red-500" />
                  <span className="text-lg font-bold">
                    {transformedData.executions.failure}
                  </span>
                  <span className="text-xs text-gray-500">Failed</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
                  <RefreshCw className="mb-1 h-6 w-6 animate-spin text-blue-500" />
                  <span className="text-lg font-bold">
                    {transformedData.executions.running}
                  </span>
                  <span className="text-xs text-gray-500">Running</span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center">
                    <CheckCircle className="mr-1 h-4 w-4 text-green-500" />
                    Success Rate
                  </span>
                  <span>{transformedData.executions.successRate}%</span>
                </div>
                <Progress
                  value={transformedData.executions.successRate}
                  className="h-2 bg-gray-100"
                />

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center">
                    <XCircle className="mr-1 h-4 w-4 text-red-500" />
                    Failure Rate
                  </span>
                  <span>{transformedData.executions.failureRate}%</span>
                </div>
                <Progress
                  value={transformedData.executions.failureRate}
                  className="h-2 bg-gray-100"
                />
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/dashboard/logs")}
                >
                  View Execution Logs
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Activity and System Info */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Activity Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <Clock className="mr-2 h-5 w-5 text-gray-500" />
                Activity Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {transformedData.activity && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                    <span className="text-lg font-bold">
                      {transformedData.activity.last24Hours}
                    </span>
                    <span className="text-center text-xs text-gray-500">
                      Last 24 Hours
                    </span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                    <span className="text-lg font-bold">
                      {transformedData.activity.lastWeek}
                    </span>
                    <span className="text-center text-xs text-gray-500">
                      Last Week
                    </span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                    <span className="text-lg font-bold">
                      {transformedData.activity.lastMonth}
                    </span>
                    <span className="text-center text-xs text-gray-500">
                      Last Month
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <h4 className="mb-2 font-medium">Recent Activity</h4>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {transformedData.recentActivity.length > 0 ? (
                    transformedData.recentActivity.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center justify-between rounded bg-gray-50 p-2 text-sm dark:bg-gray-900"
                      >
                        <div className="flex items-center space-x-2">
                          {activity.status === LogStatus.SUCCESS && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                          {activity.status === LogStatus.FAILURE && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          {activity.status === LogStatus.RUNNING && (
                            <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                          )}
                          <span className="max-w-32 truncate font-medium">
                            {activity.eventName}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(activity.startTime).toLocaleTimeString()}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-sm text-gray-500">
                      No recent activity
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* System Information */}
          {transformedData.system && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Server className="mr-2 h-5 w-5 text-gray-500" />
                  System Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Uptime</span>
                    <span className="text-sm">
                      {formatUptime(
                        currentUptime ?? transformedData.system.uptime,
                      )}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Memory Usage</span>
                      <span>
                        {formatMemory(transformedData.system.memory.used)} /{" "}
                        {formatMemory(transformedData.system.memory.total)}
                      </span>
                    </div>
                    <Progress
                      value={
                        (transformedData.system.memory.used /
                          transformedData.system.memory.total) *
                        100
                      }
                      className="h-2 bg-gray-100"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>CPU Load</span>
                      <span>
                        {transformedData.system.cpu.currentLoad.toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={transformedData.system.cpu.currentLoad}
                      className="h-2 bg-gray-100"
                    />
                  </div>

                  <div className="space-y-1 pt-2 text-xs text-gray-600">
                    <div className="flex justify-between">
                      <span>Platform:</span>
                      <span>{transformedData.system.os.platform}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Architecture:</span>
                      <span>{transformedData.system.os.arch}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hostname:</span>
                      <span>{transformedData.system.os.hostname}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-red-700">
            Error: {error.message ?? "Failed to load monitoring data"}
          </p>
        </div>
      )}
    </div>
  );
}
