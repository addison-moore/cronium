"use client";

import { useTranslations, useLocale } from "next-intl";
import { StatCard } from "@/components/ui/stat-card";
import { ActivityTable } from "@/components/activity";
import { type LogStatus } from "@/shared/schema";
import {
  Code,
  Clock,
  Check,
  AlertTriangle,
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
    workflowId?: number | null;
    workflowName?: string | null;
  }>;
}

export default function DashboardStats() {
  const t = useTranslations();
  const locale = useLocale();

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
    totalScripts: dashboardData?.totalScripts ?? 0,
    activeScripts: dashboardData?.activeScripts ?? 0,
    pausedScripts: dashboardData?.pausedScripts ?? 0,
    draftScripts: dashboardData?.draftScripts ?? 0,
    recentExecutions: dashboardData?.recentExecutions ?? 0,
    successRate: dashboardData?.successRate ?? 0,
    failureRate: dashboardData?.failureRate ?? 0,
    eventsCount: dashboardData?.eventsCount ?? 0,
    workflowsCount: dashboardData?.workflowsCount ?? 0,
    serversCount: dashboardData?.serversCount ?? 0,
    recentActivity:
      dashboardData?.recentActivity?.map((activity) => ({
        id: activity.id,
        eventId: activity.eventId,
        eventName: activity.eventName,
        status: activity.status,
        duration: activity.duration,
        startTime: activity.startTime ?? new Date().toISOString(),
        workflowId: activity.workflowId,
        workflowName: activity.workflowName,
      })) ?? [],
  };

  // Use the total activity count from the API if available
  const totalActivityCount =
    (dashboardData?.totalActivityCount as number | undefined) ??
    stats.recentActivity.length;

  const refreshData = useCallback(async () => {
    await refetchDashboard();
  }, [refetchDashboard]);

  // Calculate pagination values
  const totalItems = totalActivityCount;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedActivity = stats.recentActivity.slice(startIndex, endIndex);

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
      title: t("Dashboard.Stats.TotalScripts"),
      value: stats.totalScripts,
      icon: <Code className="h-5 w-5" />,
      href: `/${locale}/dashboard/events`,
      footer: (
        <div className="flex text-xs">
          <div className="mr-4 flex items-center">
            <div className="mr-1 h-2 w-2 rounded-full bg-green-500"></div>
            <span>
              {t("Dashboard.Stats.Active")}: {stats.activeScripts}
            </span>
          </div>
          <div className="mr-4 flex items-center">
            <div className="mr-1 h-2 w-2 rounded-full bg-yellow-500"></div>
            <span>
              {t("Dashboard.Stats.Paused")}: {stats.pausedScripts}
            </span>
          </div>
          <div className="flex items-center">
            <div className="mr-1 h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></div>
            <span>
              {t("Dashboard.Stats.Draft")}: {stats.draftScripts}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: t("Dashboard.Stats.Executions"),
      value: stats.recentExecutions,
      icon: <Clock className="h-5 w-5" />,
      href: `/${locale}/dashboard/logs`,
      footer: (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center">
              <Check className="mr-1 h-3 w-3 text-green-500" />
              {t("Dashboard.Stats.SuccessRate")}
            </span>
            <span>{stats.successRate}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: `${stats.successRate}%` }}
            ></div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center">
              <AlertTriangle className="mr-1 h-3 w-3 text-red-500" />
              {t("Dashboard.Stats.FailureRate")}
            </span>
            <span>{stats.failureRate}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-red-500"
              style={{ width: `${stats.failureRate}%` }}
            ></div>
          </div>
        </div>
      ),
    },
    {
      title: t("Dashboard.Stats.Workflows"),
      value: stats.workflowsCount,
      icon: <GitFork className="h-5 w-5 rotate-90" />,
      href: `/${locale}/dashboard/workflows`,
      footer: t("Dashboard.Stats.WorkflowsDescription"),
    },
    {
      title: t("Dashboard.Stats.RemoteServers"),
      value: stats.serversCount,
      icon: <Server className="h-5 w-5" />,
      href: `/${locale}/dashboard/servers`,
      footer: t("Dashboard.Stats.ServersDescription"),
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
        title={t("Dashboard.RecentActivity.Title") ?? "Recent Activity"}
        description={
          t("Dashboard.RecentActivity.Description") ??
          "Recent event and workflow executions"
        }
        data={paginatedActivity.map((activity) => ({
          id: activity.id,
          eventId: activity.eventId,
          eventName: activity.eventName,
          status: activity.status as LogStatus,
          startTime: activity.startTime,
          endTime: null,
          duration: activity.duration,
          workflowId: activity.workflowId ?? null,
          workflowName: activity.workflowName ?? null,
        }))}
        isLoading={isLoading}
        onRefresh={refreshData}
        emptyStateMessage={
          t("Dashboard.RecentActivity.EmptyState") ?? "No recent activity"
        }
        showPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        totalItems={totalItems}
        onPageSizeChange={handlePageSizeChange}
      />
      {error && (
        <p className="text-red-500">
          Error: {error.message ?? "Failed to load dashboard data"}
        </p>
      )}
    </div>
  );
}
