"use client";

import React from "react";
import { useRouter } from "next/navigation";
import EventForm from "@/components/event-form/EventForm";
import { type Event } from "./types";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";

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
        toast({
          title: "Success",
          description: "Event updated successfully",
        });
      }
    } catch (error) {
      console.error("Error fetching updated event:", error);
      toast({
        title: "Warning",
        description: "Event may have been updated, but failed to refresh data",
        variant: "destructive",
      });

      router.refresh();
    }
  };

  // Convert string dates to Date objects to satisfy TypeScript requirements
  const eventWithDateObjects = {
    ...event,
    createdAt: event.createdAt ? new Date(event.createdAt) : new Date(),
    updatedAt: event.updatedAt ? new Date(event.updatedAt) : new Date(),
    lastRunAt: event.lastRunAt ? new Date(event.lastRunAt) : null,
    nextRunAt: event.nextRunAt ? new Date(event.nextRunAt) : null,
  };

  return (
    <div className="space-y-4">
      <EventForm
        initialData={eventWithDateObjects}
        isEditing={true}
        eventId={event.id}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
