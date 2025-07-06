"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";
import EventForm from "@/components/event-form/EventForm";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface EventEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: number;
  onEventUpdated?: () => void;
}

export function EventEditModal({
  isOpen,
  onClose,
  eventId,
  onEventUpdated,
}: EventEditModalProps) {
  // tRPC queries for event data and servers
  const {
    data: eventData,
    isLoading: isLoadingEvent,
    error: eventError,
  } = trpc.events.getById.useQuery(
    { id: eventId },
    {
      enabled: isOpen && !!eventId,
      ...QUERY_OPTIONS.dynamic,
    },
  );

  const { isLoading: isLoadingServers } = trpc.servers.getAll.useQuery(
    { limit: 100 },
    {
      enabled: isOpen,
      ...QUERY_OPTIONS.static,
    },
  );

  const isLoading = isLoadingEvent || isLoadingServers;

  // Handle error from event query
  React.useEffect(() => {
    if (eventError) {
      toast({
        title: "Error",
        description:
          eventError.message ?? "Failed to load event data. Please try again.",
        variant: "destructive",
      });
    }
  }, [eventError]);

  const handleEventUpdate = () => {
    // Close modal and notify parent component
    onClose();
    if (onEventUpdated) {
      onEventUpdated();
    }
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Event"
      description="Make changes to the event configuration"
      size="2xl"
      showCloseButton={false}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
          <span className="ml-2">Loading event data...</span>
        </div>
      ) : eventData ? (
        <div
          className="max-h-[70vh] overflow-y-auto"
          onSubmit={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <EventForm
            eventId={eventId}
            initialData={eventData}
            isEditing={true}
            onSuccess={handleEventUpdate}
          />
        </div>
      ) : (
        <div className="py-8 text-center">
          <p className="text-muted-foreground">
            {eventError ? "Failed to load event data" : "Event not found"}
          </p>
        </div>
      )}
    </Modal>
  );
}
