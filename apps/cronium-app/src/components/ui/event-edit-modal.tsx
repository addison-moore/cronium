"use client";

import React from "react";
import { Lock } from "lucide-react";
import { Modal } from "@cronium/ui";
import { toast } from "@cronium/ui";
import { Spinner } from "@cronium/ui";
import { Button } from "@cronium/ui";
import EventForm from "@/components/event-form/EventForm-lazy";
import { useAuth } from "@/hooks/useAuth";
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
  const handleEventUpdate = () => {
    // Close modal and notify parent component
    onClose();
    if (onEventUpdated) {
      onEventUpdated();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Event"
      description="Make changes to the event configuration"
      size="2xl"
      showCloseButton={false}
    >
      {/* Inside the Modal so it mounts on each opening, which is what reads the event. */}
      <EventEditModalContent
        eventId={eventId}
        onSaved={handleEventUpdate}
        onCancel={onClose}
      />
    </Modal>
  );
}

interface EventEditModalContentProps {
  eventId: number;
  onSaved: () => void;
  onCancel: () => void;
}

function EventEditModalContent({
  eventId,
  onSaved,
  onCancel,
}: EventEditModalContentProps) {
  const { user } = useAuth();

  // A save sends the whole form back, so the form has to start from the event as it is
  // now. A cached copy can be older than the last save, and saving it would put the old
  // values back, so read the event on every opening and hold the form until the answer
  // is in. Focus refetches are off so that no read can land on a form being edited.
  const {
    data: eventData,
    isFetching: isFetchingEvent,
    isFetchedAfterMount,
    error: eventError,
  } = trpc.events.getById.useQuery(
    { id: eventId },
    {
      enabled: !!eventId,
      ...QUERY_OPTIONS.dynamic,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    },
  );
  const isLoadingEvent = isFetchingEvent && !isFetchedAfterMount;

  const { isLoading: isLoadingServers } = trpc.servers.getAll.useQuery(
    { limit: 100 },
    QUERY_OPTIONS.static,
  );

  const isLoading = isLoadingEvent || isLoadingServers;

  // Handle error from event query, once this opening's read has finished: an earlier
  // opening's error stays on the query until a read succeeds.
  React.useEffect(() => {
    if (eventError && !isLoadingEvent) {
      toast({
        title: "Error",
        description:
          eventError.message ?? "Failed to load event data. Please try again.",
        variant: "destructive",
      });
    }
  }, [eventError, isLoadingEvent]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="lg" />
        <span className="ml-2">Loading event data...</span>
      </div>
    );
  }

  // A copy from before the failed read may still be cached. It's not one to offer to save.
  if (eventError || !eventData) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground mb-4">
          {eventError ? "Failed to load event data" : "Event not found"}
        </p>
        <Button onClick={onCancel} variant="outline">
          Close
        </Button>
      </div>
    );
  }

  if (eventData.userId !== user?.id) {
    return (
      <div className="py-8 text-center">
        <Lock className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
        <h3 className="mb-2 text-lg font-semibold">Cannot Edit Shared Event</h3>
        <p className="text-muted-foreground mb-4">
          You don't have permission to edit this event because it's shared with
          you.
        </p>
        <Button onClick={onCancel} variant="outline">
          Close
        </Button>
      </div>
    );
  }

  return (
    <div
      className="max-h-[70vh] overflow-y-auto"
      onSubmit={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <EventForm
        eventId={eventId}
        initialData={eventData}
        isEditing={true}
        onSuccess={onSaved}
        layout="modal"
        onCancel={onCancel}
      />
    </div>
  );
}
