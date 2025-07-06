"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Activity, AlertCircle, Edit, Logs } from "lucide-react";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { trpc } from "@/lib/trpc";
import { LogStatus } from "@/shared/schema";

import {
  EventDetailsHeader,
  EventOverviewTab,
  EventEditTab,
  EventLogsTab,
  EventDeleteDialog,
} from "./index";
import { EventStatus, type Log } from "@/shared/schema";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { EventWithRelations } from "@/server/storage";
import type { Event } from "./types";
import { Spinner } from "../ui/spinner";

interface EventDetailsProps {
  eventId: string;
  langParam: string;
}

export function EventDetails({ eventId, langParam }: EventDetailsProps) {
  // Convert eventId to number for tRPC
  const parsedId = parseInt(eventId);
  // Ensure we have a valid number, not NaN
  const numericEventId = !isNaN(parsedId) ? parsedId : -1; // Use -1 or another sentinel value

  // State
  const [logs, setLogs] = useState<Log[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [totalLogPages, setTotalLogPages] = useState(1);
  const [logsItemsPerPage, setLogsItemsPerPage] = useState(10);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isResettingCounter, setIsResettingCounter] = useState(false);
  const [logPollingInterval, setLogPollingInterval] =
    useState<NodeJS.Timeout | null>(null);

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "overview",
    validTabs: ["overview", "edit", "logs"],
  });

  const router = useRouter();
  const t = useTranslations("Events");

  // tRPC queries
  const {
    data: event,
    isLoading,
    refetch: refetchEvent,
  } = trpc.events.getById.useQuery(
    { id: numericEventId },
    {
      enabled: !isNaN(numericEventId),
      staleTime: 30000, // 30 seconds
    },
  );

  const {
    data: logsData,
    isLoading: isLoadingLogs,
    refetch: refetchLogs,
  } = trpc.events.getLogs.useQuery(
    {
      id: numericEventId,
      limit: logsItemsPerPage,
      offset: (logPage - 1) * logsItemsPerPage,
    },
    {
      enabled: !isNaN(numericEventId),
      staleTime: 5000, // 5 seconds for logs
    },
  );

  // tRPC mutations
  const deleteEventMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Deleted",
        description: "Event has been successfully deleted.",
      });
      router.push(`/${langParam}/dashboard/events`);
    },
  });

  const executeEventMutation = trpc.events.execute.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Executed",
        description: "Event execution initiated successfully.",
        variant: "default",
      });
      // Refresh logs to show new execution
      void refetchLogs();
    },
  });

  const activateEventMutation = trpc.events.activate.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Activated",
        description: "Event has been activated successfully.",
      });
      void refetchEvent();
    },
  });

  const deactivateEventMutation = trpc.events.deactivate.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Paused",
        description: "Event has been paused successfully.",
      });
      void refetchEvent();
    },
  });

  const resetCounterMutation = trpc.events.resetCounter.useMutation({
    onSuccess: () => {
      toast({
        title: "Counter Reset",
        description: "Execution counter has been reset to 0.",
      });
      void refetchEvent();
    },
  });

  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Event Updated",
        description: "Event status updated successfully.",
      });
      void refetchEvent();
    },
  });

  // Extract logs data from tRPC response
  useEffect(() => {
    if (logsData) {
      setLogs(logsData.logs ?? []);
      setTotalLogs(logsData.logs?.length ?? 0);
      setTotalLogPages(
        Math.ceil((logsData.logs?.length ?? 0) / logsItemsPerPage),
      );
    }
  }, [logsData, logsItemsPerPage]);

  // Check for running logs and update their status
  const checkRunningLogsStatus = useCallback(async () => {
    const hasRunningLogs = logs.some((log) => log.status === LogStatus.RUNNING);
    if (hasRunningLogs) {
      // Refetch logs to get updated status
      void refetchLogs();
    }
  }, [logs, refetchLogs]);

  // Use ref to track polling state to avoid dependency issues
  const pollingActiveRef = useRef(false);

  // Start polling for log status updates when there are running logs
  useEffect(() => {
    const hasRunningLogs = logs.some((log) => log.status === LogStatus.RUNNING);

    if (hasRunningLogs && !pollingActiveRef.current) {
      pollingActiveRef.current = true;
      // Poll every 2 seconds for log status updates
      const interval = setInterval(() => {
        void checkRunningLogsStatus();
      }, 2000);
      setLogPollingInterval(interval);
    } else if (!hasRunningLogs && pollingActiveRef.current) {
      // Clear polling when no running logs
      pollingActiveRef.current = false;
      if (logPollingInterval) {
        clearInterval(logPollingInterval);
        setLogPollingInterval(null);
      }
    }
  }, [
    logs.some((log) => log.status === LogStatus.RUNNING),
    checkRunningLogsStatus,
  ]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (logPollingInterval) {
        clearInterval(logPollingInterval);
      }
    };
  }, []);

  // Handle page change for logs
  const handleLogPageChange = (page: number) => {
    setLogPage(page);
    // The query will automatically refetch with the new offset
  };

  // Handle logs refresh
  const handleLogsRefresh = () => {
    void refetchLogs();
  };

  // Handle page size change for logs
  const handleLogsPageSizeChange = (newSize: number) => {
    setLogsItemsPerPage(newSize);
    setLogPage(1); // Reset to first page when changing page size
    // The query will automatically refetch with the new parameters
  };

  // Delete event handlers
  const confirmDelete = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    try {
      await deleteEventMutation.mutateAsync({ id: numericEventId });
      setIsDeleteDialogOpen(false);
    } catch {
      // Error handling is done in the mutation onError callback
      setIsDeleteDialogOpen(false);
    }
  };

  // Reset execution counter handler
  const handleResetCounter = async () => {
    try {
      if (!event) return;
      setIsResettingCounter(true);
      await resetCounterMutation.mutateAsync({ id: numericEventId });
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setIsResettingCounter(false);
    }
  };

  // Run event handler
  const handleRunEvent = async () => {
    try {
      setIsRunning(true);
      await executeEventMutation.mutateAsync({
        id: numericEventId,
        manual: true,
      });

      // Start monitoring immediately for the new running log
      setTimeout(() => {
        void checkRunningLogsStatus();
      }, 1000); // Give the log a second to be created
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      setIsRunning(false);
    }
  };

  // Handle status change for clickable badge
  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!event) return;

    try {
      // For events, we need to handle ACTIVE/PAUSED differently than DRAFT
      if (newStatus === EventStatus.ACTIVE) {
        await activateEventMutation.mutateAsync({
          id: numericEventId,
          resetCounter: false,
        });
      } else if (newStatus === EventStatus.PAUSED) {
        await deactivateEventMutation.mutateAsync({ id: numericEventId });
      } else {
        // For DRAFT, ARCHIVED status use update mutation
        await updateEventMutation.mutateAsync({
          id: numericEventId,
          status: newStatus,
        });
      }
    } catch {
      // Error handling is done in the mutation onError callbacks
    }
  };

  // Handle event update success callback
  const handleEventUpdateSuccess = () => {
    void refetchEvent();
    // Switch back to overview tab after successful edit
    changeTab("overview");
  };

  // Early return for invalid event ID
  if (isNaN(numericEventId)) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            Invalid Event ID
          </h1>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            The provided event ID is not valid.
          </p>
          <Link href={`/${langParam}/dashboard/events`}>
            <Button>Back to Events</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center">
          <Spinner size="lg" />
          <span className="ml-2">{t("LoadingEvent")}</span>
        </div>
      </div>
    );
  }

  // Error state - event not found
  if (!event) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("EventNotFound")}
          </h1>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            {t("EventNotFoundDescription")}
          </p>
          <Link href={`/${langParam}/dashboard/events`}>
            <Button>Back to Events</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Transform EventWithRelations to Event type expected by components
  const transformedEvent: Event | null = event
    ? {
        ...event,
        environmentVariables:
          event.envVars?.map((env) => ({ key: env.key, value: env.value })) ??
          [],
        events: [], // Add empty events array if needed by the Event type
        // Convert Date objects to strings
        createdAt:
          event.createdAt instanceof Date
            ? event.createdAt.toISOString()
            : event.createdAt,
        updatedAt:
          event.updatedAt instanceof Date
            ? event.updatedAt.toISOString()
            : event.updatedAt,
        lastRunAt:
          event.lastRunAt instanceof Date
            ? event.lastRunAt.toISOString()
            : (event.lastRunAt ?? null),
        nextRunAt:
          event.nextRunAt instanceof Date
            ? event.nextRunAt.toISOString()
            : (event.nextRunAt ?? null),
        // Add HTTP request fields if it's an HTTP_REQUEST type
        httpRequest: event.httpMethod
          ? {
              method: event.httpMethod,
              url: event.httpUrl ?? "",
              headers:
                (event.httpHeaders as Array<{ key: string; value: string }>) ??
                [],
              body: event.httpBody ?? null,
            }
          : null,
        // Map conditional actions properly
        successEvents: event.successEvents ?? [],
        failEvents: event.failEvents ?? [],
        alwaysEvents: event.alwaysEvents ?? [],
        conditionEvents: event.conditionEvents ?? [],
        // Add missing fields with defaults
        description: event.description,
        active: event.status === EventStatus.ACTIVE,
        schedule:
          event.customSchedule ??
          `${event.scheduleNumber} ${event.scheduleUnit}`,
        tags: (event.tags as string[]) ?? [],
      }
    : null;

  return (
    <div className="container mx-auto space-y-6 py-6">
      {/* Event Header with Actions */}
      {transformedEvent && (
        <EventDetailsHeader
          event={transformedEvent}
          onDelete={confirmDelete}
          onRun={handleRunEvent}
          onStatusChange={handleStatusChange}
          isRunning={isRunning}
          langParam={langParam}
        />
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <Tab
            value="overview"
            icon={Activity}
            label={t("Overview")}
            className="flex items-center gap-2"
          />
          <Tab
            value="edit"
            icon={Edit}
            label={t("Edit")}
            className="flex items-center gap-2"
          />
          <Tab
            value="logs"
            icon={Logs}
            label={t("Logs")}
            className="flex items-center gap-2"
          />
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {transformedEvent && (
            <EventOverviewTab
              event={transformedEvent}
              onRefresh={async (): Promise<void> => {
                await refetchEvent();
              }}
              langParam={langParam}
              onResetCounter={handleResetCounter}
              isResettingCounter={isResettingCounter}
            />
          )}
        </TabsContent>

        <TabsContent value="edit" className="mt-6">
          {transformedEvent && (
            <EventEditTab
              event={transformedEvent}
              langParam={langParam}
              onEventUpdate={handleEventUpdateSuccess}
              onRefreshLogs={(): void => {
                void refetchEvent();
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <EventLogsTab
            logs={logs}
            totalLogs={totalLogs}
            totalPages={totalLogPages}
            currentPage={logPage}
            itemsPerPage={logsItemsPerPage}
            isLoading={isLoadingLogs}
            onPageChange={handleLogPageChange}
            onPageSizeChange={handleLogsPageSizeChange}
            onRefresh={handleLogsRefresh}
          />
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <EventDeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        eventName={event.name}
        isDeleting={deleteEventMutation.isPending}
      />
    </div>
  );
}
