"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { EventType } from "@/shared/schema";

interface JsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ImportEventData {
  name: string;
  description?: string;
  shared?: boolean;
  type: string;
  content?: string;
  httpMethod?: string | null;
  httpUrl?: string | null;
  httpHeaders?: string | null;
  httpBody?: string | null;
  status?: string;
  triggerType?: string;
  scheduleNumber?: number | null;
  scheduleUnit?: string | null;
  customSchedule?: string;
  runLocation?: string;
  serverId?: number | null;
  timeoutValue?: number;
  timeoutUnit?: string;
  retries?: number;
  startTime?: string | null;
  maxExecutions?: number;
  resetCounterOnActive?: boolean;
  tags?: string[];
  envVars?: Array<{
    key: string;
    value: string;
    isSecret?: boolean;
  }>;
  successEvents?: Array<{
    type: string;
    value: string;
  }>;
  failEvents?: Array<{
    type: string;
    value: string;
  }>;
}

export function JsonImportModal({ isOpen, onClose }: JsonImportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();

  const handleSubmit = async () => {
    if (!jsonInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter JSON data",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to create events",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Parse JSON input
      let eventData: ImportEventData;
      try {
        eventData = JSON.parse(jsonInput);
      } catch (parseError) {
        toast({
          title: "Invalid JSON",
          description: "Please check your JSON format and try again",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Validate required fields
      if (!eventData.name) {
        toast({
          title: "Missing Required Field",
          description: "Event name is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (!eventData.type) {
        toast({
          title: "Missing Required Field",
          description: "Event type is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Clean the data (remove id, userId, createdAt, updatedAt, and null values)
      const cleanEventData: any = {
        name: eventData.name,
        type: eventData.type,
        status: eventData.status || "DRAFT",
        timeoutValue: eventData.timeoutValue || 30,
        timeoutUnit: eventData.timeoutUnit || "SECONDS",
        retries: eventData.retries || 0,
        runLocation: eventData.runLocation || "LOCAL",
        shared: eventData.shared || false,
        tags: eventData.tags || [],
      };

      // Add optional fields only if they have valid values
      if (eventData.description) {
        cleanEventData.description = eventData.description;
      }

      if (eventData.content) {
        cleanEventData.content = eventData.content;
      }

      if (eventData.triggerType) {
        cleanEventData.triggerType = eventData.triggerType;
      }

      if (eventData.scheduleNumber) {
        cleanEventData.scheduleNumber = eventData.scheduleNumber;
      }

      if (eventData.scheduleUnit) {
        cleanEventData.scheduleUnit = eventData.scheduleUnit;
      }

      if (eventData.customSchedule) {
        cleanEventData.customSchedule = eventData.customSchedule;
      }

      if (eventData.serverId) {
        cleanEventData.serverId = eventData.serverId;
      }

      if (eventData.startTime) {
        cleanEventData.startTime = eventData.startTime;
      }

      if (eventData.maxExecutions) {
        cleanEventData.maxExecutions = eventData.maxExecutions;
      }

      if (eventData.resetCounterOnActive !== undefined) {
        cleanEventData.resetCounterOnActive = eventData.resetCounterOnActive;
      }

      // Handle HTTP-specific fields only for HTTP_REQUEST type
      if (eventData.type === EventType.HTTP_REQUEST) {
        if (eventData.httpMethod) {
          cleanEventData.httpMethod = eventData.httpMethod;
        }
        if (eventData.httpUrl) {
          cleanEventData.httpUrl = eventData.httpUrl;
        }
        if (eventData.httpBody) {
          cleanEventData.httpBody = eventData.httpBody;
        }
        if (eventData.httpHeaders) {
          // Convert headers to the expected format
          if (typeof eventData.httpHeaders === "string") {
            try {
              const parsedHeaders = JSON.parse(eventData.httpHeaders);
              if (Array.isArray(parsedHeaders)) {
                cleanEventData.httpHeaders = parsedHeaders;
              }
            } catch {
              // If parsing fails, skip headers
            }
          } else if (Array.isArray(eventData.httpHeaders)) {
            cleanEventData.httpHeaders = eventData.httpHeaders;
          }
        }
      }

      // Add environment variables if provided
      if (eventData.envVars && eventData.envVars.length > 0) {
        cleanEventData.envVars = eventData.envVars.map((envVar) => ({
          key: envVar.key,
          value: envVar.value,
          isSecret: envVar.isSecret || false,
        }));
      }

      // Add success events if provided
      if (eventData.successEvents && eventData.successEvents.length > 0) {
        cleanEventData.onSuccessEvents = eventData.successEvents.map(
          (event) => ({
            type: event.type,
            value: event.value,
          }),
        );
      }

      // Add fail events if provided
      if (eventData.failEvents && eventData.failEvents.length > 0) {
        cleanEventData.onFailEvents = eventData.failEvents.map((event) => ({
          type: event.type,
          value: event.value,
        }));
      }

      // Submit to API
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cleanEventData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create event");
      }

      const newEvent = await response.json();

      toast({
        title: "Success",
        description: `Event "${eventData.name}" created successfully`,
      });

      // Close modal and reset form
      setJsonInput("");
      onClose();

      // Redirect to the newly created event's details page
      const lang = params.lang as string;
      router.push(`/${lang}/dashboard/events/${newEvent.id}`);
    } catch (error) {
      console.error("Error creating event from JSON:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create event",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setJsonInput("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[80vh] max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add Events from JSON</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="text-muted-foreground text-sm">
            Paste your event JSON data below. The system will automatically
            ignore any existing IDs, user IDs, and timestamps to create a new
            event.
          </div>

          <Textarea
            placeholder="Paste your JSON event data here..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
            disabled={isSubmitting}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !jsonInput.trim()}
          >
            {isSubmitting ? "Creating Event..." : "Create Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
