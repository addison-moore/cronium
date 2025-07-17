"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EventStatus, ConditionalActionType } from "@/shared/schema";
import type { TimeUnit, RunLocation, EventType } from "@/shared/schema";
import { useToast } from "@/components/ui/use-toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EventsFilters,
  EventsTable,
  BulkActionsToolbar,
} from "@/components/event-list";
import type {
  Event,
  WorkflowData,
  EventListFilters,
  EventListState,
  ServerData,
} from "@/components/event-list";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

export default function EventsList() {
  // Filter state
  const [filters, setFilters] = useState<EventListFilters>({
    searchTerm: "",
    typeFilter: "all",
    statusFilter: "all",
    serverFilter: "all",
    tagFilter: "all",
    workflowFilter: "all",
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  // Component state
  const [state, setState] = useState<EventListState>({
    currentPage: 1,
    itemsPerPage: 10,
    selectedEvents: new Set(),
    bulkActionLoading: null,
    isRunning: {},
  });

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<number | null>(null);

  const t = useTranslations("Events");
  const { toast } = useToast();

  // tRPC queries
  const {
    data: eventsData,
    isLoading: eventsLoading,
    refetch: refetchEvents,
  } = trpc.events.getAll.useQuery(
    {
      limit: 1000, // Get all events for client-side filtering
      offset: 0,
      search: filters.searchTerm ? filters.searchTerm : undefined,
      status:
        filters.statusFilter !== "all"
          ? (filters.statusFilter as EventStatus)
          : undefined,
      type:
        filters.typeFilter !== "all"
          ? (filters.typeFilter as EventType)
          : undefined,
    },
    QUERY_OPTIONS.dynamic,
  );

  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100, offset: 0 },
    QUERY_OPTIONS.static,
  );

  const { data: workflowsData } = trpc.workflows.getAll.useQuery(
    { limit: 100, offset: 0 },
    QUERY_OPTIONS.static,
  );

  // Extract and transform data from tRPC responses
  const rawEvents = eventsData?.events ?? [];

  // Transform events to match the Event interface
  const events: Event[] = rawEvents.map((rawEvent) => {
    // Create a properly typed Event object with only the properties defined in the Event interface
    // Start with required properties
    const event: Event = {
      id: rawEvent.id,
      name: rawEvent.name,
      description: rawEvent.description,
      type: rawEvent.type,
      status: rawEvent.status,
      content: rawEvent.content,
      scheduleNumber: rawEvent.scheduleNumber,
      scheduleUnit: rawEvent.scheduleUnit,
      customSchedule: rawEvent.customSchedule ?? null,
      userId: rawEvent.userId,
      // Convert Date objects to strings
      createdAt:
        rawEvent.createdAt instanceof Date
          ? rawEvent.createdAt.toISOString()
          : String(rawEvent.createdAt ?? ""),
      updatedAt:
        rawEvent.updatedAt instanceof Date
          ? rawEvent.updatedAt.toISOString()
          : String(rawEvent.updatedAt ?? ""),
      lastRunAt:
        rawEvent.lastRunAt instanceof Date
          ? rawEvent.lastRunAt.toISOString()
          : rawEvent.lastRunAt === null
            ? null
            : String(rawEvent.lastRunAt ?? ""),
      nextRunAt:
        rawEvent.nextRunAt instanceof Date
          ? rawEvent.nextRunAt.toISOString()
          : rawEvent.nextRunAt === null
            ? null
            : String(rawEvent.nextRunAt ?? ""),
    };

    // Add optional fields if they exist in the raw data
    if (typeof rawEvent.successCount === "number")
      event.successCount = rawEvent.successCount;
    if (typeof rawEvent.failureCount === "number")
      event.failureCount = rawEvent.failureCount;
    if (Array.isArray(rawEvent.tags))
      event.tags = rawEvent.tags.map((tag) => {
        if (tag === null || tag === undefined) return "";
        if (typeof tag === "string") return tag;
        if (typeof tag === "number" || typeof tag === "boolean")
          return String(tag);
        return "";
      });
    if (typeof rawEvent.shared === "boolean") event.shared = rawEvent.shared;

    // HTTP specific fields
    if (rawEvent.httpMethod) event.httpMethod = rawEvent.httpMethod;
    if (rawEvent.httpUrl) event.httpUrl = rawEvent.httpUrl;
    if (rawEvent.httpBody !== undefined && rawEvent.httpBody !== null)
      event.httpBody = rawEvent.httpBody;

    // Handle httpHeaders specially to ensure it matches the expected type
    if (Array.isArray(rawEvent.httpHeaders)) {
      event.httpHeaders = rawEvent.httpHeaders.map(
        (header: { key?: unknown; value?: unknown }) => ({
          key:
            typeof header.key === "string"
              ? header.key
              : typeof header.key === "number" ||
                  typeof header.key === "boolean"
                ? String(header.key)
                : "",
          value:
            typeof header.value === "string"
              ? header.value
              : typeof header.value === "number" ||
                  typeof header.value === "boolean"
                ? String(header.value)
                : "",
        }),
      );
    }

    // Server related fields
    if (rawEvent.runLocation) event.runLocation = rawEvent.runLocation;
    if ("serverId" in rawEvent && rawEvent.serverId !== undefined) {
      event.serverId =
        typeof rawEvent.serverId === "number" ? rawEvent.serverId : null;
    }

    // Additional fields if they exist in the raw data
    if (typeof rawEvent.timeoutValue === "number")
      event.timeoutValue = rawEvent.timeoutValue;
    if (rawEvent.timeoutUnit) event.timeoutUnit = rawEvent.timeoutUnit;
    if (typeof rawEvent.retries === "number") event.retries = rawEvent.retries;

    // Optional fields that might not exist in all events - handle safely with type checking
    if ("gistId" in rawEvent && rawEvent.gistId !== undefined) {
      event.gistId =
        rawEvent.gistId === null || rawEvent.gistId === undefined
          ? null
          : typeof rawEvent.gistId === "string"
            ? rawEvent.gistId
            : typeof rawEvent.gistId === "number" ||
                typeof rawEvent.gistId === "boolean"
              ? String(rawEvent.gistId)
              : "";
    }

    if ("gistFileName" in rawEvent && rawEvent.gistFileName !== undefined) {
      event.gistFileName =
        rawEvent.gistFileName === null || rawEvent.gistFileName === undefined
          ? null
          : typeof rawEvent.gistFileName === "string"
            ? rawEvent.gistFileName
            : typeof rawEvent.gistFileName === "number" ||
                typeof rawEvent.gistFileName === "boolean"
              ? String(rawEvent.gistFileName)
              : "";
    }

    if ("workflowId" in rawEvent && rawEvent.workflowId !== undefined) {
      event.workflowId =
        typeof rawEvent.workflowId === "number" ? rawEvent.workflowId : null;
    }

    return event;
  });

  const servers = (serversData?.servers ?? []) as ServerData[];

  // Transform workflow data to match the WorkflowData interface
  const rawWorkflows = (workflowsData?.workflows ?? []) as Array<{
    id: number;
    name: string;
    description?: string | null;
  }>;
  const workflows: WorkflowData[] = rawWorkflows.map((workflow) => {
    const workflowData: WorkflowData = {
      id: workflow.id,
      name: workflow.name,
      eventIds: [], // Initialize empty eventIds array
    };
    if (workflow.description) {
      workflowData.description = workflow.description;
    }
    return workflowData;
  });

  // For workflow-event relationships, we'll need to extract from events or implement a separate endpoint
  const workflowEvents: { workflowId: number; eventId: number }[] = [];

  // tRPC mutations
  const deleteEventMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event has been successfully deleted.",
        variant: "success",
      });
      void refetchEvents();
    },
  });

  const executeEventMutation = trpc.events.execute.useMutation({
    onSuccess: () => {
      toast({
        title: t("EventExecuted"),
        description: "Event execution initiated successfully.",
        variant: "success",
      });
      void refetchEvents();
    },
  });

  const createEventMutation = trpc.events.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event duplicated successfully",
        variant: "success",
      });
      void refetchEvents();
    },
  });

  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: (_, variables) => {
      const statusText = variables.status?.toLowerCase() ?? "updated";
      toast({
        title: "Success",
        description: `Event status updated to ${statusText} successfully.`,
        variant: "success",
      });
      void refetchEvents();
    },
  });

  const activateEventMutation = trpc.events.activate.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event activated successfully.",
        variant: "success",
      });
      void refetchEvents();
    },
  });

  const deactivateEventMutation = trpc.events.deactivate.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event paused successfully.",
        variant: "success",
      });
      void refetchEvents();
    },
  });

  // Helper functions for state updates
  const updateFilters = (newFilters: Partial<EventListFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    // Reset to first page when filters change
    if (
      Object.keys(newFilters).some(
        (key) => key !== "sortBy" && key !== "sortOrder",
      )
    ) {
      setState((prev) => ({
        ...prev,
        currentPage: 1,
        selectedEvents: new Set(),
      }));
    }
  };

  const updateState = (newState: Partial<EventListState>) => {
    setState((prev) => ({ ...prev, ...newState }));
  };

  const handleClearFilters = () => {
    setFilters({
      searchTerm: "",
      typeFilter: "all",
      statusFilter: "all",
      serverFilter: "all",
      tagFilter: "all",
      workflowFilter: "all",
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    setState((prev) => ({
      ...prev,
      currentPage: 1,
      selectedEvents: new Set(),
    }));
  };

  // Apply filters to events
  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.name
      .toLowerCase()
      .includes(filters.searchTerm.toLowerCase());
    const matchesType =
      filters.typeFilter === "all" || !filters.typeFilter
        ? true
        : event.type === (filters.typeFilter as EventType);
    const matchesStatus =
      filters.statusFilter === "all" || !filters.statusFilter
        ? event.status !== EventStatus.ARCHIVED // Exclude archived events when "all" is selected
        : event.status === (filters.statusFilter as EventStatus);
    const matchesServer =
      filters.serverFilter === "all" || !filters.serverFilter
        ? true
        : filters.serverFilter === "local"
          ? event.runLocation === "local" ||
            (!event.serverId &&
              (!event.eventServers || event.eventServers.length === 0))
          : (event.eventServers?.includes(parseInt(filters.serverFilter)) ??
              false) ||
            event.serverId === parseInt(filters.serverFilter);
    const matchesTag =
      filters.tagFilter === "all" || !filters.tagFilter
        ? true
        : event.tags &&
          Array.isArray(event.tags) &&
          event.tags.includes(filters.tagFilter);
    const matchesWorkflow =
      filters.workflowFilter === "all" || !filters.workflowFilter
        ? true
        : workflowEvents.some(
            (we) =>
              we.workflowId === parseInt(filters.workflowFilter) &&
              we.eventId === event.id,
          );

    return (
      matchesSearch &&
      matchesType &&
      matchesStatus &&
      matchesServer &&
      matchesTag &&
      matchesWorkflow
    );
  });

  // Apply sorting to filtered events
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    let comparison = 0;

    switch (filters.sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "createdAt":
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "lastRunAt":
        // Handle null values: never-executed events should be considered "older" than any executed event
        if (!a.lastRunAt && !b.lastRunAt) comparison = 0;
        else if (!a.lastRunAt)
          comparison = -1; // Never-executed is "older"
        else if (!b.lastRunAt)
          comparison = 1; // Never-executed is "older"
        else
          comparison =
            new Date(a.lastRunAt).getTime() - new Date(b.lastRunAt).getTime();
        break;
      default:
        comparison = 0;
    }

    return filters.sortOrder === "asc" ? comparison : -comparison;
  });

  // Calculate pagination values
  const totalItems = sortedEvents.length;
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const paginatedEvents = sortedEvents.slice(startIndex, endIndex);

  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setState((prev) => ({
      ...prev,
      itemsPerPage: newSize,
      currentPage: 1,
      selectedEvents: new Set(),
    }));
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setState((prev) => ({
      ...prev,
      currentPage: page,
      selectedEvents: new Set(),
    }));
  };

  // Handle event deletion
  const confirmDelete = (id: number) => {
    setDeleteEventId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteEventId) return;

    try {
      await deleteEventMutation.mutateAsync({ id: deleteEventId });
      setIsDeleteDialogOpen(false);
      setDeleteEventId(null);
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  // Handle running an event
  const handleRunEvent = async (id: number) => {
    try {
      // Set loading state for this specific event
      updateState({ isRunning: { ...state.isRunning, [id]: true } });

      await executeEventMutation.mutateAsync({ id, manual: true });
    } catch {
      // Error handling is done in the mutation onError callback
    } finally {
      // Clear loading state for this specific event
      updateState({ isRunning: { ...state.isRunning, [id]: false } });
    }
  };

  // Handle duplicate event
  const handleDuplicateEvent = async (eventId: number) => {
    try {
      // Find the event in the current data first to avoid unnecessary query
      const existingEvent = events.find((e) => e.id === eventId);
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const eventData = existingEvent;

      // Create duplicate event with "(copy)" appended to name
      // Create a new event object with only the properties expected by the API
      // Using explicit type casting to ensure compatibility with the API
      const duplicateData: {
        name: string;
        type: EventType;
        description?: string;
        shared?: boolean;
        tags?: string[];
        content?: string;
        status?: EventStatus;
        httpMethod?: string;
        httpUrl?: string;
        httpHeaders?: Array<{ key: string; value: string }>;
        httpBody?: string;
        scheduleNumber?: number;
        scheduleUnit?: TimeUnit;
        customSchedule?: string;
        startTime?: string;
        runLocation?: RunLocation;
        serverId?: number;
        serverIds?: number[];
        timeoutValue?: number;
        timeoutUnit?: TimeUnit;
        retries?: number;
        maxExecutions?: number;
        resetCounterOnActive?: boolean;
        envVars?: Array<{ key: string; value: string }>;
        onSuccessActions?: Array<{
          type: string;
          action: ConditionalActionType;
          value?: string;
          targetScriptId?: number | null;
          details?: {
            targetEventId?: number | null;
            toolId?: number | null;
            message?: string;
            emailAddresses?: string;
            emailSubject?: string;
          };
        }>;
        onFailActions?: Array<{
          type: string;
          action: ConditionalActionType;
          value?: string;
          targetScriptId?: number | null;
          details?: {
            targetEventId?: number | null;
            toolId?: number | null;
            message?: string;
            emailAddresses?: string;
            emailSubject?: string;
          };
        }>;
      } = Object.fromEntries(
        Object.entries({
          name: `${eventData.name} (copy)`,
          description: eventData.description ?? undefined,
          shared: Boolean(eventData.shared),
          tags: Array.isArray(eventData.tags) ? eventData.tags.map(String) : [],
          type: eventData.type,
          content: eventData.content ?? undefined,
          status: EventStatus.DRAFT, // Set to draft status for new copy

          // HTTP specific fields
          httpMethod: eventData.httpMethod ?? undefined,
          httpUrl: eventData.httpUrl ?? undefined,
          httpHeaders: Array.isArray(eventData.httpHeaders)
            ? eventData.httpHeaders.map(
                (h: { key?: unknown; value?: unknown }) => ({
                  key:
                    typeof h.key === "string"
                      ? h.key
                      : typeof h.key === "number" || typeof h.key === "boolean"
                        ? String(h.key)
                        : "",
                  value:
                    typeof h.value === "string"
                      ? h.value
                      : typeof h.value === "number" ||
                          typeof h.value === "boolean"
                        ? String(h.value)
                        : "",
                }),
              )
            : [],
          httpBody: eventData.httpBody ?? undefined,

          // Schedule related fields
          scheduleNumber:
            typeof eventData.scheduleNumber === "number"
              ? eventData.scheduleNumber
              : 0,
          scheduleUnit: eventData.scheduleUnit as TimeUnit,
          customSchedule: eventData.customSchedule ?? undefined,
          startTime: undefined, // Reset timing for copy

          // Server related fields
          runLocation: eventData.runLocation as RunLocation,
          serverId:
            typeof eventData.serverId === "number"
              ? eventData.serverId
              : undefined,
          serverIds: Array.isArray(
            (eventData as unknown as Record<string, unknown>).selectedServerIds,
          )
            ? ((eventData as unknown as Record<string, unknown>)
                .selectedServerIds as number[])
            : Array.isArray(
                  (eventData as unknown as Record<string, unknown>)
                    .eventServers,
                )
              ? ((eventData as unknown as Record<string, unknown>)
                  .eventServers as number[])
              : [],

          // Additional fields
          timeoutValue:
            typeof eventData.timeoutValue === "number"
              ? eventData.timeoutValue
              : undefined,
          timeoutUnit: eventData.timeoutUnit
            ? (eventData.timeoutUnit as TimeUnit)
            : undefined,
          retries:
            typeof eventData.retries === "number"
              ? eventData.retries
              : undefined,
          maxExecutions:
            typeof (eventData as unknown as Record<string, unknown>)
              .maxExecutions === "number"
              ? ((eventData as unknown as Record<string, unknown>)
                  .maxExecutions as number)
              : undefined,
          resetCounterOnActive: Boolean(
            (eventData as unknown as Record<string, unknown>)
              .resetCounterOnActive,
          ),

          // Environment variables
          envVars: Array.isArray(
            (eventData as unknown as Record<string, unknown>).envVars,
          )
            ? (
                (eventData as unknown as Record<string, unknown>)
                  .envVars as Array<{ key?: unknown; value?: unknown }>
              ).map((env) => ({
                key:
                  typeof env.key === "string"
                    ? env.key
                    : typeof env.key === "number" ||
                        typeof env.key === "boolean"
                      ? String(env.key)
                      : "",
                value:
                  typeof env.value === "string"
                    ? env.value
                    : typeof env.value === "number" ||
                        typeof env.value === "boolean"
                      ? String(env.value)
                      : "",
              }))
            : Array.isArray(
                  (eventData as unknown as Record<string, unknown>)
                    .environmentVariables,
                )
              ? (
                  (eventData as unknown as Record<string, unknown>)
                    .environmentVariables as Array<{
                    key?: unknown;
                    value?: unknown;
                  }>
                ).map((env) => ({
                  key:
                    typeof env.key === "string"
                      ? env.key
                      : typeof env.key === "number" ||
                          typeof env.key === "boolean"
                        ? String(env.key)
                        : "",
                  value:
                    typeof env.value === "string"
                      ? env.value
                      : typeof env.value === "number" ||
                          typeof env.value === "boolean"
                        ? String(env.value)
                        : "",
                }))
              : [],

          // Event triggers - Using tRPC expected format
          onSuccessActions: Array.isArray(
            (eventData as unknown as Record<string, unknown>).onSuccessActions,
          )
            ? (
                (eventData as unknown as Record<string, unknown>)
                  .onSuccessActions as Array<Record<string, unknown>>
              ).map((e) => ({
                action: (e.action ??
                  ConditionalActionType.SCRIPT) as ConditionalActionType,
                details: {
                  targetEventId:
                    typeof e.targetEventId === "number"
                      ? e.targetEventId
                      : typeof e.targetScriptId === "number"
                        ? e.targetScriptId
                        : null,
                  toolId: typeof e.toolId === "number" ? e.toolId : null,
                  message:
                    typeof e.message === "string"
                      ? e.message
                      : typeof e.value === "string"
                        ? e.value
                        : typeof e.message === "number" ||
                            typeof e.message === "boolean"
                          ? String(e.message)
                          : typeof e.value === "number" ||
                              typeof e.value === "boolean"
                            ? String(e.value)
                            : "",
                  emailAddresses:
                    typeof e.emailAddresses === "string"
                      ? e.emailAddresses
                      : typeof e.emailAddresses === "number" ||
                          typeof e.emailAddresses === "boolean"
                        ? String(e.emailAddresses)
                        : "",
                  emailSubject:
                    typeof e.emailSubject === "string"
                      ? e.emailSubject
                      : typeof e.emailSubject === "number" ||
                          typeof e.emailSubject === "boolean"
                        ? String(e.emailSubject)
                        : "",
                },
              }))
            : [],

          onFailActions: Array.isArray(
            (eventData as unknown as Record<string, unknown>).onFailActions,
          )
            ? (
                (eventData as unknown as Record<string, unknown>)
                  .onFailActions as Array<Record<string, unknown>>
              ).map((e) => ({
                action: (e.action ??
                  ConditionalActionType.SCRIPT) as ConditionalActionType,
                details: {
                  targetEventId:
                    typeof e.targetEventId === "number"
                      ? e.targetEventId
                      : typeof e.targetScriptId === "number"
                        ? e.targetScriptId
                        : null,
                  toolId: typeof e.toolId === "number" ? e.toolId : null,
                  message:
                    typeof e.message === "string"
                      ? e.message
                      : typeof e.value === "string"
                        ? e.value
                        : typeof e.message === "number" ||
                            typeof e.message === "boolean"
                          ? String(e.message)
                          : typeof e.value === "number" ||
                              typeof e.value === "boolean"
                            ? String(e.value)
                            : "",
                  emailAddresses:
                    typeof e.emailAddresses === "string"
                      ? e.emailAddresses
                      : typeof e.emailAddresses === "number" ||
                          typeof e.emailAddresses === "boolean"
                        ? String(e.emailAddresses)
                        : "",
                  emailSubject:
                    typeof e.emailSubject === "string"
                      ? e.emailSubject
                      : typeof e.emailSubject === "number" ||
                          typeof e.emailSubject === "boolean"
                        ? String(e.emailSubject)
                        : "",
                },
              }))
            : [],
        }).filter(([_, value]) => value !== undefined),
      ) as typeof duplicateData;

      await createEventMutation.mutateAsync(duplicateData);
    } catch {
      // Error handling is done in the mutation onError callback
    }
  };

  // Handle status change from dropdown
  const handleStatusChange = async (id: number, newStatus: EventStatus) => {
    try {
      if (newStatus === EventStatus.ACTIVE) {
        await activateEventMutation.mutateAsync({ id, resetCounter: false });
      } else if (newStatus === EventStatus.PAUSED) {
        await deactivateEventMutation.mutateAsync({ id });
      } else {
        // For draft/archived status, use update
        await updateEventMutation.mutateAsync({ id, status: newStatus });
      }
    } catch {
      // Error handling is done in the mutation onError callbacks
    }
  };

  const handleBulkDelete = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "delete" });

    let successCount = 0;
    let failureCount = 0;

    try {
      // Process deletions sequentially to avoid overwhelming the server
      for (const eventId of Array.from(state.selectedEvents)) {
        try {
          await deleteEventMutation.mutateAsync({ id: eventId });
          successCount++;
        } catch {
          failureCount++;
        }
      }

      // Show appropriate success/failure message
      if (successCount > 0 && failureCount === 0) {
        toast({
          title: "Success",
          description: `Successfully deleted ${successCount} event(s).`,
          variant: "success",
        });
      } else if (successCount > 0 && failureCount > 0) {
        toast({
          title: "Partial Success",
          description: `Deleted ${successCount} of ${state.selectedEvents.size} event(s). ${failureCount} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: `Failed to delete all ${state.selectedEvents.size} event(s).`,
          variant: "destructive",
        });
      }

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "An unexpected error occurred during bulk deletion.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkActivate = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "activate" });
    try {
      const activatePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return activateEventMutation.mutateAsync({
            id: eventId,
            resetCounter: false,
          });
        },
      );

      const results = await Promise.allSettled(activatePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Activated ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully activated ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "Failed to activate some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkPause = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "pause" });
    try {
      const pausePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return deactivateEventMutation.mutateAsync({ id: eventId });
        },
      );

      const results = await Promise.allSettled(pausePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Paused ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully paused ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "Failed to pause some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const downloadMutation = trpc.events.download.useMutation();

  const handleBulkDownload = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "download" });
    try {
      const eventIds = Array.from(state.selectedEvents);

      const downloadData = await downloadMutation.mutateAsync({
        eventIds,
        format: "json",
      });

      // Create blob and download
      const blob = new Blob([downloadData.data], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadData.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: `Successfully downloaded ${state.selectedEvents.size} event(s).`,
        variant: "success",
      });

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "Failed to download events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  const handleBulkArchive = async () => {
    if (state.selectedEvents.size === 0) return;

    updateState({ bulkActionLoading: "archive" });
    try {
      const archivePromises = Array.from(state.selectedEvents).map(
        async (eventId) => {
          return updateEventMutation.mutateAsync({
            id: eventId,
            status: EventStatus.ARCHIVED,
          });
        },
      );

      const results = await Promise.allSettled(archivePromises);
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        toast({
          title: "Partial Success",
          description: `Archived ${state.selectedEvents.size - failures.length} of ${state.selectedEvents.size} event(s). ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Successfully archived ${state.selectedEvents.size} event(s).`,
          variant: "success",
        });
      }

      updateState({ selectedEvents: new Set() });
    } catch {
      toast({
        title: "Error",
        description: "Failed to archive some events. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateState({ bulkActionLoading: null });
    }
  };

  return (
    <div className="border-border bg-secondary-bg rounded-lg border p-4">
      <EventsFilters
        filters={filters}
        onFiltersChange={updateFilters}
        onClearFilters={handleClearFilters}
        events={events}
        servers={servers}
        workflows={workflows}
      />

      <BulkActionsToolbar
        selectedCount={state.selectedEvents.size}
        bulkActionLoading={state.bulkActionLoading}
        onBulkActivate={handleBulkActivate}
        onBulkPause={handleBulkPause}
        onBulkDownload={handleBulkDownload}
        onBulkArchive={handleBulkArchive}
        onBulkDelete={handleBulkDelete}
        onClearSelection={() => updateState({ selectedEvents: new Set() })}
      />

      <EventsTable
        events={paginatedEvents}
        servers={servers}
        selectedEvents={state.selectedEvents}
        onSelectedEventsChange={(selected) =>
          updateState({ selectedEvents: selected })
        }
        onEventRun={handleRunEvent}
        onEventDuplicate={handleDuplicateEvent}
        onEventStatusChange={handleStatusChange}
        onEventDelete={confirmDelete}
        isRunning={state.isRunning}
        isLoading={eventsLoading}
        searchTerm={filters.searchTerm}
      />

      {/* Pagination Controls */}
      {totalItems > 0 && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Items per page selector */}
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground text-sm">
                Items per page:
              </span>
              <Select
                value={state.itemsPerPage.toString()}
                onValueChange={(value) => handlePageSizeChange(parseInt(value))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pagination component */}
            <Pagination
              currentPage={state.currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              itemsPerPage={state.itemsPerPage}
              totalItems={totalItems}
            />
          </div>
        </div>
      )}

      <ConfirmationDialog
        title={t("DeleteEventConfirmation")}
        description={t("DeleteEventDescription")}
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDelete}
        cancelText={t("Cancel")}
        confirmText={t("Delete")}
        loadingText={t("Deleting")}
        variant="destructive"
      />
    </div>
  );
}
