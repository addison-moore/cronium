"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";
import EventForm from "@/components/event-form/EventForm";

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
  const [isLoading, setIsLoading] = useState(true);
  const [eventData, setEventData] = useState<any>(null);
  const [servers, setServers] = useState<any[]>([]);

  // Fetch event data and servers when modal opens
  useEffect(() => {
    if (isOpen && eventId) {
      fetchEventData();
      fetchServers();
    }
  }, [isOpen, eventId]);

  const fetchEventData = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/events/${eventId}`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch event data");
      }

      const data = await response.json();
      setEventData(data);
    } catch (error) {
      console.error("Error fetching event data:", error);
      toast({
        title: "Error",
        description: "Failed to load event data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchServers = async () => {
    try {
      const response = await fetch("/api/servers", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch servers");
      }

      const data = await response.json();
      setServers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching servers:", error);
      setServers([]);
    }
  };

  const handleEventUpdate = () => {
    // Close modal and notify parent component
    onClose();
    if (onEventUpdated) {
      onEventUpdated();
    }
  };

  const handleClose = () => {
    setEventData(null);
    setIsLoading(true);
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
          <p className="text-muted-foreground">Failed to load event data</p>
        </div>
      )}
    </Modal>
  );
}
