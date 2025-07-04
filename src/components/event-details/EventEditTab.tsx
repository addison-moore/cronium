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
  const { data: updatedEventData, refetch: refetchEvent } =
    trpc.events.getById.useQuery(
      { id: event.id },
      {
        enabled: false, // Only fetch when manually triggered
      },
    );

  const handleSuccess = async () => {
    // Fetch the updated event data and update the parent component
    try {
      const result = await refetchEvent();
      if (result.data) {
        onEventUpdate(result.data);
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
      // Fallback to page refresh if fetch fails
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <EventForm
        initialData={event}
        isEditing={true}
        eventId={event.id}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
