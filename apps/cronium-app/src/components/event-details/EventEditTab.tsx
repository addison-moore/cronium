"use client";

import React from "react";
import { useRouter } from "next/navigation";
import EventForm from "@/components/event-form/EventForm-lazy";
import { type Event } from "./types";
import { trpc } from "@/lib/trpc";
import { useToast } from "@cronium/ui";
import { TimeUnit, RunLocation, type ConditionalAction } from "@/shared/schema";

interface EventEditTabProps {
  event: Event;
  langParam: string;
  onEventUpdate: (event: Event) => void;
  onRefreshLogs: () => void;
}

export function EventEditTab({
  event,
  onEventUpdate,
  onRefreshLogs,
}: EventEditTabProps) {
  const router = useRouter();
  const { toast } = useToast();

  // tRPC query to get updated event data
  const { refetch: refetchEvent } = trpc.events.getById.useQuery(
    { id: event.id },
    {
      enabled: false, // Only fetch when manually triggered
    },
  );

  const handleSuccess = async () => {
    try {
      const result = await refetchEvent();
      if (result.data) {
        // Transform EventWithRelations to Event by adding missing properties
        const eventData: Event = {
          ...result.data,
          // Convert date objects to strings if they exist
          createdAt:
            typeof result.data.createdAt === "string"
              ? result.data.createdAt
              : result.data.createdAt instanceof Date
                ? result.data.createdAt.toISOString()
                : new Date().toISOString(),
          updatedAt:
            typeof result.data.updatedAt === "string"
              ? result.data.updatedAt
              : result.data.updatedAt instanceof Date
                ? result.data.updatedAt.toISOString()
                : new Date().toISOString(),
          lastRunAt:
            typeof result.data.lastRunAt === "string"
              ? result.data.lastRunAt
              : result.data.lastRunAt instanceof Date
                ? result.data.lastRunAt.toISOString()
                : null,
          nextRunAt:
            typeof result.data.nextRunAt === "string"
              ? result.data.nextRunAt
              : result.data.nextRunAt instanceof Date
                ? result.data.nextRunAt.toISOString()
                : null,
          // Add missing properties required by Event interface
          environmentVariables:
            result.data.envVars?.map((env) => ({
              key: env.key,
              value: env.value,
            })) || [],
          events: [],
        } as Event;

        onEventUpdate(eventData);
        // Also refresh the logs to show any changes
        onRefreshLogs();
      }
    } catch (error) {
      console.error("Error fetching updated event:", error);
      toast({
        title: "Warning",
        description: "Event may have been updated, but failed to refresh data",
        variant: "info",
      });

      router.refresh();
    }
  };

  // Convert string dates to Date objects and ensure valid enums
  const scheduleUnitValue = event.scheduleUnit?.toUpperCase();
  const validScheduleUnit = Object.values(TimeUnit).includes(
    scheduleUnitValue as TimeUnit,
  )
    ? (scheduleUnitValue as TimeUnit)
    : TimeUnit.MINUTES;

  const runLocationValue = event.runLocation?.toUpperCase();
  const validRunLocation = Object.values(RunLocation).includes(
    runLocationValue as RunLocation,
  )
    ? (runLocationValue as RunLocation)
    : RunLocation.LOCAL;

  // Convert timeoutUnit to proper enum
  const timeoutUnitValue = event.timeoutUnit?.toUpperCase();
  const validTimeoutUnit = Object.values(TimeUnit).includes(
    timeoutUnitValue as TimeUnit,
  )
    ? (timeoutUnitValue as TimeUnit)
    : TimeUnit.SECONDS;

  // Helper function to convert null values to undefined for conditional actions
  const transformConditionalAction = (
    action: ConditionalAction,
  ): {
    id: number;
    type: string;
    value?: string;
    emailSubject?: string;
    targetEventId?: number;
    toolId?: number;
    message?: string;
  } => {
    const result: {
      id: number;
      type: string;
      value?: string;
      emailSubject?: string;
      targetEventId?: number;
      toolId?: number;
      message?: string;
    } = {
      id: action.id,
      type: action.type as string, // Convert enum to string
    };

    // Only add properties if they have values (not null or undefined)
    if (action.value) result.value = action.value;
    if (action.emailSubject) result.emailSubject = action.emailSubject;
    if (action.targetEventId) result.targetEventId = action.targetEventId;
    if (action.toolId) result.toolId = action.toolId;
    if (action.message) result.message = action.message;

    return result;
  };

  const eventWithDateObjects = {
    ...event,
    createdAt: event.createdAt ? new Date(event.createdAt) : new Date(),
    updatedAt: event.updatedAt ? new Date(event.updatedAt) : new Date(),
    lastRunAt: event.lastRunAt ? new Date(event.lastRunAt) : null,
    nextRunAt: event.nextRunAt ? new Date(event.nextRunAt) : null,
    scheduleUnit: validScheduleUnit,
    runLocation: validRunLocation,
    timeoutUnit: validTimeoutUnit,
    resetCounterOnActive:
      typeof event.resetCounterOnActive === "string"
        ? event.resetCounterOnActive === "true"
        : event.resetCounterOnActive,
    // Transform conditional actions to convert null to undefined
    successEvents: event.successEvents?.map(transformConditionalAction),
    failEvents: event.failEvents?.map(transformConditionalAction),
    alwaysEvents: event.alwaysEvents?.map(transformConditionalAction),
    conditionEvents: event.conditionEvents?.map(transformConditionalAction),
  };

  return (
    <div className="space-y-4">
      <EventForm
        initialData={eventWithDateObjects}
        isEditing={true}
        eventId={event.id}
        onSuccess={handleSuccess}
        layout="embedded"
      />
    </div>
  );
}
