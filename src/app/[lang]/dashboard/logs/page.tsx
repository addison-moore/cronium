"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { ActivityTableWithFilters } from "@/components/activity";
import WorkflowExecutionHistory from "@/components/workflows/WorkflowExecutionHistory";
import { Code, GitFork } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { trpcClient } from "@/lib/trpc";
import { LogStatus, type Event, type Workflow } from "@/shared/schema";
import type { LogsResponse } from "@/types/api";

// Simple types for component data
interface SimpleEvent {
  id: number;
  name: string;
}

interface SimpleWorkflow {
  id: number;
  name: string;
}

export default function LogsPage() {
  const t = useTranslations("Logs");

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "events",
    validTabs: ["events", "workflows"],
  });

  const getLogs = async (params: URLSearchParams): Promise<LogsResponse> => {
    try {
      // Extract search parameters
      const limit = parseInt(params.get("limit") ?? "20");
      const offset = parseInt(params.get("offset") ?? "0");
      const status = params.get("status");
      const eventId = params.get("eventId")
        ? parseInt(params.get("eventId")!)
        : undefined;
      const workflowId = params.get("workflowId")
        ? parseInt(params.get("workflowId")!)
        : undefined;
      const date = params.get("date") ?? undefined;

      // Validate status parameter
      const validStatus =
        status && Object.values(LogStatus).includes(status as LogStatus)
          ? (status as LogStatus)
          : undefined;

      const data = await trpcClient.logs.getAll.query({
        limit,
        offset,
        status: validStatus,
        eventId,
        workflowId,
        date,
      });

      return {
        logs: data.logs ?? [],
        total: data.total ?? 0,
        items: data.logs ?? [],
        hasMore: data.hasMore ?? false,
        limit,
        offset,
      };
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast({
        title: "Error",
        description: "Failed to load logs. Please try again.",
        variant: "destructive",
      });
      return {
        logs: [],
        total: 0,
        items: [],
        hasMore: false,
        limit: 20,
        offset: 0,
      };
    }
  };

  const getEvents = async (): Promise<Event[]> => {
    try {
      const data = await trpcClient.events.getAll.query({
        limit: 100,
        offset: 0,
      });

      return data.events ?? [];
    } catch (error) {
      console.error("Error fetching events:", error);
      toast({
        title: "Error",
        description: "Failed to load scripts. Please try again.",
        variant: "destructive",
      });
      return [];
    }
  };

  const fetchWorkflows = async (): Promise<Workflow[]> => {
    try {
      const data = await trpcClient.workflows.getAll.query({
        limit: 100,
        offset: 0,
      });

      return data.workflows ?? [];
    } catch (error) {
      console.error("Error fetching workflows:", error);
      toast({
        title: "Error",
        description: "Failed to load workflows. Please try again.",
        variant: "destructive",
      });
      return [];
    }
  };

  return (
    <div className="container mx-auto p-4">
      <div className="space-y-6">
        <PageHeader title={t("Title")} description={t("Description")} />

        <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
          <TabsList>
            <Tab value="events" icon={Code} label="Events" />
            <Tab
              value="workflows"
              icon={GitFork}
              label="Workflows"
              iconClassName="rotate-90"
            />
          </TabsList>

          <TabsContent value="events" className="space-y-4">
            <ActivityTableWithFilters
              title={t("RecentActivity")}
              getLogs={getLogs}
              getEvents={getEvents}
              fetchWorkflows={fetchWorkflows}
              pageSize={20}
            />
          </TabsContent>

          <TabsContent value="workflows" className="space-y-4">
            <WorkflowExecutionHistory />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
