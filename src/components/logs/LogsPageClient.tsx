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
import {
  LogStatus,
  EventType,
  EventStatus,
  EventTriggerType,
  TimeUnit,
  RunLocation,
  WorkflowTriggerType,
  type Event as DbEvent,
  type Workflow,
} from "@/shared/schema";
import type { LogsResponse } from "@/types/api";

export default function LogsPageClient() {
  const t = useTranslations("Logs");

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "events",
    validTabs: ["events", "workflows"],
  });

  const getLogs = async (params: URLSearchParams): Promise<LogsResponse> => {
    try {
      // Extract search parameters
      const page = parseInt(params.get("page") ?? "1");
      const pageSize = parseInt(params.get("pageSize") ?? "20");
      const limit = pageSize;
      const offset = (page - 1) * pageSize;
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

  const getEvents = async (): Promise<DbEvent[]> => {
    try {
      const data = await trpcClient.events.getForFilters.query({
        limit: 100,
        offset: 0,
      });

      // Convert lightweight events to DbEvent type with only required fields
      return data.events.map(event => ({
        id: event.id,
        name: event.name,
        // Set all required fields with default values
        userId: '',
        type: EventType.BASH,
        content: '',
        status: EventStatus.ACTIVE,
        triggerType: EventTriggerType.MANUAL,
        scheduleNumber: 1,
        scheduleUnit: TimeUnit.MINUTES,
        runLocation: RunLocation.LOCAL,
        timeoutValue: 30,
        timeoutUnit: TimeUnit.SECONDS,
        retries: 0,
        executionCount: 0,
        maxExecutions: 0,
        resetCounterOnActive: false,
        successCount: 0,
        failureCount: 0,
        tags: [],
        shared: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Nullable fields
        description: null,
        customSchedule: null,
        startTime: null,
        httpMethod: null,
        httpUrl: null,
        httpHeaders: null,
        httpBody: null,
        httpAuthType: null,
        lastRunAt: null,
        nextRunAt: null,
        toolActionConfig: null,
        serverId: null,
      } as DbEvent));
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
      const data = await trpcClient.workflows.getForFilters.query({
        limit: 100,
        offset: 0,
      });

      // Convert lightweight workflows to Workflow type with only required fields
      return data.workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        // Set all required fields with default values
        userId: '',
        description: null,
        triggerType: WorkflowTriggerType.MANUAL,
        webhookKey: null,
        scheduleNumber: null,
        scheduleUnit: null,
        customSchedule: null,
        runLocation: RunLocation.LOCAL,
        overrideEventServers: false,
        overrideServerIds: null,
        status: EventStatus.DRAFT,
        shared: false,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Workflow));
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