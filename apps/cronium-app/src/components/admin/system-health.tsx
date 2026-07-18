"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
  ErrorState,
} from "@cronium/ui";
import { RefreshCw, Database, MemoryStick, Cpu, Server } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc";

const copy = {
  title: "System Health",
  description: "Live health of the Cronium application and its dependencies.",
  overall: "Overall Status",
  services: "Service Health",
  system: "System Information",
  refresh: "Refresh",
  refreshing: "Refreshing...",
  uptime: "Uptime",
  platform: "Platform",
  nodeVersion: "Node.js",
  hostname: "Hostname",
  processMemory: "Process Memory",
  cpuLoad: "CPU Load (1m avg)",
  lastUpdated: "Last updated",
  loadFailed: "Failed to load system health",
};

const SERVICE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  database: { label: "Database", icon: Database },
  cache: { label: "Cache (Valkey/Redis)", icon: Server },
  memory: { label: "Memory", icon: MemoryStick },
  cpu: { label: "CPU", icon: Cpu },
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color =
    clamped > 90
      ? "bg-destructive"
      : clamped > 75
        ? "bg-warning"
        : "bg-success";
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className={`${color} h-full rounded-full`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SystemHealth() {
  const {
    data: health,
    isLoading: healthLoading,
    isFetching: healthFetching,
    error: healthError,
    refetch: refetchHealth,
  } = trpc.monitoring.getHealthCheck.useQuery(
    {},
    { refetchInterval: 30000, refetchOnWindowFocus: false },
  );

  const {
    data: metricsData,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = trpc.monitoring.getSystemMetrics.useQuery(
    {},
    { refetchInterval: 30000, refetchOnWindowFocus: false },
  );

  const isLoading = healthLoading || metricsLoading;
  const handleRefresh = () => {
    void refetchHealth();
    void refetchMetrics();
  };

  if (isLoading) {
    return <HealthSkeleton />;
  }

  if (healthError && !health) {
    return (
      <ErrorState
        title={copy.loadFailed}
        message={healthError.message}
        onRetry={handleRefresh}
      />
    );
  }

  const services = health?.services ?? {};
  const overall = health?.status ?? "unknown";
  const system = metricsData?.data?.current;
  const memoryPercent = system
    ? (system.memory.used / system.memory.total) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Overall status + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{copy.overall}:</span>
          <StatusBadge
            status={
              overall === "healthy"
                ? "healthy"
                : overall === "degraded"
                  ? "warning"
                  : overall === "unhealthy"
                    ? "unhealthy"
                    : "unknown"
            }
            size="lg"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={healthFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${healthFetching ? "motion-safe:animate-spin" : ""}`}
          />
          {healthFetching ? copy.refreshing : copy.refresh}
        </Button>
      </div>

      {/* Service health cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Object.entries(services).map(([name, service]) => {
          const meta = SERVICE_META[name] ?? { label: name, icon: Server };
          const Icon = meta.icon;
          return (
            <Card key={name}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="text-muted-foreground h-5 w-5" />
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <StatusBadge
                    status={service.status === "up" ? "healthy" : "unhealthy"}
                  />
                  {service.latency !== undefined && (
                    <span className="text-muted-foreground text-xs">
                      {Math.round(service.latency)}ms
                    </span>
                  )}
                </div>
                {service.error && (
                  <p className="text-destructive-text mt-2 truncate text-xs">
                    {service.error}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* System information */}
      {system && (
        <Card>
          <CardHeader>
            <CardTitle>{copy.system}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground">{copy.uptime}</p>
                <p className="font-medium">{formatUptime(system.uptime)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{copy.platform}</p>
                <p className="font-medium">
                  {system.os.platform} ({system.os.arch})
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{copy.nodeVersion}</p>
                <p className="font-medium">{system.os.version}</p>
              </div>
              {system.os.hostname && (
                <div>
                  <p className="text-muted-foreground">{copy.hostname}</p>
                  <p className="truncate font-medium">{system.os.hostname}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {copy.processMemory}
                  </span>
                  <span className="font-medium">
                    {formatBytes(system.memory.used)} /{" "}
                    {formatBytes(system.memory.total)}
                  </span>
                </div>
                <UsageBar percent={memoryPercent} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{copy.cpuLoad}</span>
                  <span className="font-medium">
                    {system.cpu.currentLoad.toFixed(1)}%
                  </span>
                </div>
                <UsageBar percent={system.cpu.currentLoad} />
              </div>
            </div>

            {metricsData?.data?.lastUpdated && (
              <p className="text-muted-foreground text-xs">
                {copy.lastUpdated}:{" "}
                {new Date(metricsData.data.lastUpdated).toLocaleTimeString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
