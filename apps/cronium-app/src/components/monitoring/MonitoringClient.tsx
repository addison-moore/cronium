"use client";

import React from "react";
import { api } from "@/trpc/react";
import { MonitoringPageSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Activity, Server, Database, Cpu } from "lucide-react";

export default function MonitoringClient() {
  const { data: stats, isLoading } =
    api.monitoring.getSystemMonitoring.useQuery({});

  if (isLoading) {
    return <MonitoringPageSkeleton />;
  }

  // Type safe access to metrics
  const metrics = stats?.metrics;

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
            <p className="text-muted-foreground">
              No recent activity to display
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>Database</span>
                <Badge variant="default">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Queue Service</span>
                <Badge variant="default">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>WebSocket Server</span>
                <Badge variant="default">Healthy</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
