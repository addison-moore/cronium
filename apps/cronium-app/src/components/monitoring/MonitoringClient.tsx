"use client";

import React from "react";
import { trpc } from "@/lib/trpc";
import { MonitoringPageSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Activity, Server, Database, Cpu } from "lucide-react";

const SERVICE_LABELS: Record<string, string> = {
  database: "Database",
  memory: "Memory",
  cpu: "CPU",
  cache: "Cache (Valkey/Redis)",
};

export default function MonitoringClient() {
  const { data: stats, isLoading } =
    trpc.monitoring.getSystemMonitoring.useQuery({});
  const { data: health } = trpc.monitoring.getHealthCheck.useQuery({});
  const { data: activityData } = trpc.monitoring.getActivityFeed.useQuery({
    limit: 10,
    offset: 0,
  });

  if (isLoading) {
    return <MonitoringPageSkeleton />;
  }

  // Type safe access to metrics
  const metrics = stats?.metrics;
  const services = health?.services ?? {};
  const activities = activityData?.items ?? [];

  return (
    <div className="container mx-auto p-4">
      <h1 className="mb-6 text-3xl font-bold">System Monitoring</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Cpu className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(metrics?.totalEvents ?? 0)}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Active: {Number(metrics?.activeEvents ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Database className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(metrics?.totalUsers ?? 0)}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Active: {Number(metrics?.activeUsers ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Executions
            </CardTitle>
            <Activity className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(metrics?.totalExecutions ?? 0)}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              In {String(metrics?.period ?? "day")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
            <Server className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(metrics?.totalServers ?? 0)}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Online: {Number(metrics?.onlineServers ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-muted-foreground">
                No recent activity to display
              </p>
            ) : (
              <div className="space-y-3">
                {activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {activity.title}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {activity.description}
                      </p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {activity.timestamp
                        ? new Date(activity.timestamp).toLocaleString()
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(services).length === 0 ? (
              <p className="text-muted-foreground">
                Health information unavailable
              </p>
            ) : (
              <div className="space-y-2">
                {Object.entries(services).map(([name, service]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span>{SERVICE_LABELS[name] ?? name}</span>
                    <div className="flex items-center gap-2">
                      {service.latency !== undefined && (
                        <span className="text-muted-foreground text-xs">
                          {Math.round(service.latency)}ms
                        </span>
                      )}
                      <StatusBadge
                        status={service.status === "up" ? "healthy" : "offline"}
                        label={service.status === "up" ? "Healthy" : "Down"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
