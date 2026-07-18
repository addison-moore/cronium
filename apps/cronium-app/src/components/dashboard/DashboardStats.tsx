"use client";

import { StatCard } from "@cronium/ui";
import { ActivityTable } from "@/components/activity";
import { type LogStatus } from "@/shared/schema";
import {
  Code,
  Clock,
  CircleCheck,
  CircleX,
  GitFork,
  Server,
} from "lucide-react";
import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface DashboardStats {
  totalScripts: number;
  activeScripts: number;
  pausedScripts: number;
  draftScripts: number;
  recentExecutions: number;
  successRate: number;
  failureRate: number;
  eventsCount: number;
  workflowsCount: number;
  serversCount: number;
  recentActivity: Array<{
    id: number;
    eventId: number;
    eventName: string;
    status: string;
    duration: number;
    startTime: string;
    executionDuration?: number | null;
    setupDuration?: number | null;
    workflowId?: number | null;
    workflowName?: string | null;
  }>;
}

const statsCopy = {
  totalEvents: {
    title: "Events",
    active: "Active",
    paused: "Paused",
    draft: "Draft",
    href: "/dashboard/events",
  },
  executions: {
    title: "Executions",
    successRate: "Success Rate",
    failureRate: "Failure Rate",
    href: "/dashboard/logs",
  },
  workflows: {
    title: "Workflows",
    description: "Workflow automations connecting multiple events",
    href: "/dashboard/workflows",
  },
  servers: {
    title: "Remote Servers",
    description: "Servers configured for remote execution",
    href: "/dashboard/servers",
  },
  activity: {
    title: "Recent Activity",
    description: "Latest executions across events and workflows",
    empty: "No recent activity",
  },
};

export default function DashboardStats() {
  // Pagination state for Recent Activity
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // tRPC queries
  const {
    data: dashboardData,
    isLoading,
    refetch: refetchDashboard,
    error,
  } = trpc.dashboard.getStats.useQuery(
    {
      days: 30,
    },
    QUERY_OPTIONS.realtime,
  );

  // Note: Recent activity is included in the main dashboard stats response
  // No need for separate activity query

  // Transform tRPC data to match expected interface
  const stats: DashboardStats = {
    totalScripts: (dashboardData?.metrics?.totalScripts as number) ?? 0,
    activeScripts: (dashboardData?.metrics?.activeScripts as number) ?? 0,
    pausedScripts: (dashboardData?.metrics?.pausedScripts as number) ?? 0,
    draftScripts: (dashboardData?.metrics?.draftScripts as number) ?? 0,
    recentExecutions: (dashboardData?.metrics?.recentExecutions as number) ?? 0,
    successRate: (dashboardData?.metrics?.successRate as number) ?? 0,
    failureRate: (dashboardData?.metrics?.failureRate as number) ?? 0,
    eventsCount: (dashboardData?.metrics?.eventsCount as number) ?? 0,
    workflowsCount: (dashboardData?.metrics?.workflowsCount as number) ?? 0,
    serversCount: (dashboardData?.metrics?.serversCount as number) ?? 0,
    recentActivity: Array.isArray(dashboardData?.metrics?.recentActivity)
      ? (dashboardData.metrics.recentActivity as Array<{
          id: number;
          eventId: number;
          eventName: string;
          status: string;
          duration: number;
          startTime: string;
          executionDuration?: number | null;
          setupDuration?: number | null;
          workflowId?: number | null;
          workflowName?: string | null;
        }>)
      : [],
  };

  // Use the total activity count from the API if available
  const _totalActivityCount =
    (dashboardData?.metrics?.totalActivityCount as number) ?? 0;

  // Use recent activity data from stats
  const activityData = stats.recentActivity;
  const isLoadingActivity = isLoading;

  const refreshData = useCallback(async () => {
    await refetchDashboard();
  }, [refetchDashboard]);

  // Calculate pagination values
  const totalItems = activityData?.length ?? 0;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedActivity = activityData.slice(startIndex, endIndex);

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  // Stat cards for displaying statistics
  const statsCards = [
    {
      title: statsCopy.totalEvents.title,
      value: stats.totalScripts,
      icon: <Code className="h-5 w-5" />,
      href: statsCopy.totalEvents.href,
      footer: (
        <div className="flex text-xs">
          <div className="mr-4 flex items-center">
            <div className="bg-success mr-1 h-2 w-2 rounded-full"></div>
            <span>
              {statsCopy.totalEvents.active}: {stats.activeScripts}
            </span>
          </div>
          <div className="mr-4 flex items-center">
            <div className="bg-warning mr-1 h-2 w-2 rounded-full"></div>
            <span>
              {statsCopy.totalEvents.paused}: {stats.pausedScripts}
            </span>
          </div>
          <div className="flex items-center">
            <div className="bg-muted-foreground/40 mr-1 h-2 w-2 rounded-full"></div>
            <span>
              {statsCopy.totalEvents.draft}: {stats.draftScripts}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: statsCopy.executions.title,
      value: stats.recentExecutions,
      icon: <Clock className="h-5 w-5" />,
      href: statsCopy.executions.href,
      footer: (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center">
              <CircleCheck className="text-success mr-1 h-3 w-3" />
              {statsCopy.executions.successRate}
            </span>
            <span>{stats.successRate}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-success h-full rounded-full"
              style={{ width: `${stats.successRate}%` }}
            ></div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center">
              <CircleX className="text-destructive mr-1 h-3 w-3" />
              {statsCopy.executions.failureRate}
            </span>
            <span>{stats.failureRate}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-destructive h-full rounded-full"
              style={{ width: `${stats.failureRate}%` }}
            ></div>
          </div>
        </div>
      ),
    },
    {
      title: statsCopy.workflows.title,
      value: stats.workflowsCount,
      icon: <GitFork className="h-5 w-5 rotate-90" />,
      href: statsCopy.workflows.href,
      footer: statsCopy.workflows.description,
    },
    {
      title: statsCopy.servers.title,
      value: stats.serversCount,
      icon: <Server className="h-5 w-5" />,
      href: statsCopy.servers.href,
      footer: statsCopy.servers.description,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((card, index) => (
          <StatCard
            key={index}
            title={card.title}
            value={card.value}
            icon={card.icon}
            footer={card.footer}
            href={card.href}
            className="h-full"
          />
        ))}
      </div>

      <ActivityTable
        title={statsCopy.activity.title}
        description={statsCopy.activity.description}
        data={paginatedActivity.map((activity) => ({
          id: activity.id,
          eventId: activity.eventId,
          eventName: activity.eventName,
          status: activity.status as LogStatus,
          startTime: activity.startTime || new Date().toISOString(),
          endTime: null,
          duration: activity.duration,
          executionDuration: activity.executionDuration ?? null,
          setupDuration: activity.setupDuration ?? null,
          workflowId: activity.workflowId ?? null,
          workflowName: activity.workflowName ?? null,
        }))}
        isLoading={isLoading || isLoadingActivity}
        onRefresh={refreshData}
        emptyStateMessage={statsCopy.activity.empty}
        showPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        totalItems={totalItems}
        onPageSizeChange={handlePageSizeChange}
      />
      {error && (
        <p className="text-destructive">
          Error: {error.message ?? "Failed to load dashboard data"}
        </p>
      )}
    </div>
  );
}
