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
import { trpc, trpcClient } from "@/lib/trpc";

export default function LogsPage() {
  const t = useTranslations("Logs");

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "events",
    validTabs: ["events", "workflows"],
  });

  // tRPC-based fetch functions
  const fetchLogs = async (params: URLSearchParams) => {
    try {
      // Extract search parameters
      const limit = parseInt(params.get("limit") || "20");
      const offset = parseInt(params.get("offset") || "0");
      const status = params.get("status") || undefined;
      const eventId = params.get("eventId")
        ? parseInt(params.get("eventId")!)
        : undefined;
      const workflowId = params.get("workflowId")
        ? parseInt(params.get("workflowId")!)
        : undefined;
      const date = params.get("date") || undefined;

      // Use tRPC to fetch logs
      const data = await trpcClient.logs.getAll.query({
        limit,
        offset,
        status: status as any,
        eventId,
        workflowId,
        date,
      });

      return {
        logs: data.logs || [],
        total: data.total || 0,
      };
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast({
        title: "Error",
        description: "Failed to load logs. Please try again.",
        variant: "destructive",
      });
      return { logs: [], total: 0 };
    }
  };

  const fetchScripts = async () => {
    try {
      const data = await trpcClient.events.getAll.query({
        limit: 1000,
        offset: 0,
      });

      return (
        data.events?.map((event: any) => ({
          id: event.id,
          name: event.name,
        })) || []
      );
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

  const fetchWorkflows = async () => {
    try {
      const data = await trpcClient.workflows.getAll.query({
        limit: 1000,
        offset: 0,
      });

      return (
        data.workflows?.map((workflow: any) => ({
          id: workflow.id,
          name: workflow.name,
        })) || []
      );
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
              fetchLogs={fetchLogs}
              fetchScripts={fetchScripts}
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
