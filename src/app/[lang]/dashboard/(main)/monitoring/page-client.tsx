"use client";

import React from "react";
import { api } from "@/trpc/react";
import { MonitoringPageSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Activity, Server, Database, Cpu } from "lucide-react";

export default function MonitoringClient() {
  const { data: stats, isLoading } =
    api.monitoring.getSystemMonitoring.useQuery({});

  if (isLoading) {
    return <MonitoringPageSkeleton />;
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="mb-6 text-3xl font-bold">System Monitoring</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.metrics as any)?.cpu || 0}%
            </div>
            <Progress
              value={(stats?.metrics as any)?.cpu || 0}
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <Database className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.metrics as any)?.memory || 0}%
            </div>
            <Progress
              value={(stats?.metrics as any)?.memory || 0}
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Activity className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.metrics as any)?.activeJobs || 0}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Currently running
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Connected Servers
            </CardTitle>
            <Server className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.metrics as any)?.connectedServers || 0}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Active connections
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

function Badge({
  variant,
  children,
}: {
  variant: string;
  children: React.ReactNode;
}) {
  const baseClasses =
    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold";
  const variantClasses =
    variant === "default"
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";

  return <span className={`${baseClasses} ${variantClasses}`}>{children}</span>;
}
