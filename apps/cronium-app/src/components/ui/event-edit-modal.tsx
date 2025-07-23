"use client";

import React from "react";
import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
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
  const { user } = useAuth();

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
        eventData.userId === user?.id ? (
          <div
            className="max-h-[70vh] overflow-y-auto"
            onSubmit={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <EventForm
              eventId={eventId}
              initialData={{
                ...eventData,
                successEvents: eventData.successEvents.map((action) => ({
                  id: action.id,
                  type: action.type,
                  ...(action.value !== null && { value: action.value }),
                  ...(action.emailSubject !== null && {
                    emailSubject: action.emailSubject,
                  }),
                  ...(action.targetEventId !== null && {
                    targetEventId: action.targetEventId,
                  }),
                  ...(action.toolId !== null && { toolId: action.toolId }),
                  ...(action.message !== null && { message: action.message }),
                })),
                failEvents: eventData.failEvents.map((action) => ({
                  id: action.id,
                  type: action.type,
                  ...(action.value !== null && { value: action.value }),
                  ...(action.emailSubject !== null && {
                    emailSubject: action.emailSubject,
                  }),
                  ...(action.targetEventId !== null && {
                    targetEventId: action.targetEventId,
                  }),
                  ...(action.toolId !== null && { toolId: action.toolId }),
                  ...(action.message !== null && { message: action.message }),
                })),
                alwaysEvents: eventData.alwaysEvents.map((action) => ({
                  id: action.id,
                  type: action.type,
                  ...(action.value !== null && { value: action.value }),
                  ...(action.emailSubject !== null && {
                    emailSubject: action.emailSubject,
                  }),
                  ...(action.targetEventId !== null && {
                    targetEventId: action.targetEventId,
                  }),
                  ...(action.toolId !== null && { toolId: action.toolId }),
                  ...(action.message !== null && { message: action.message }),
                })),
                conditionEvents: eventData.conditionEvents.map((action) => ({
                  id: action.id,
                  type: action.type,
                  ...(action.value !== null && { value: action.value }),
                  ...(action.emailSubject !== null && {
                    emailSubject: action.emailSubject,
                  }),
                  ...(action.targetEventId !== null && {
                    targetEventId: action.targetEventId,
                  }),
                  ...(action.toolId !== null && { toolId: action.toolId }),
                  ...(action.message !== null && { message: action.message }),
                })),
              }}
              isEditing={true}
              onSuccess={handleEventUpdate}
              layout="modal"
              onCancel={handleClose}
              showFooter={false}
            />
          </div>
        ) : (
          <div className="py-8 text-center">
            <Lock className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-semibold">
              Cannot Edit Shared Event
            </h3>
            <p className="text-muted-foreground mb-4">
              You don't have permission to edit this event because it's shared
              with you.
            </p>
            <Button onClick={handleClose} variant="outline">
              Close
            </Button>
          </div>
        )
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
