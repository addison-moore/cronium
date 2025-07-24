"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { useToast } from "@cronium/ui";
import { useAuth } from "@/hooks/useAuth";
import {
  EventType,
  EventStatus,
  EventTriggerType,
  RunLocation,
  TimeUnit,
  ConditionalActionType,
} from "@/shared/schema";
import { trpc } from "@/lib/trpc";
import { type z } from "zod";
import { createEventSchema } from "@/shared/schemas/events";

interface JsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Type for the input data from JSON
interface ImportEventData {
  name: string;
  description?: string;
  shared?: boolean;
  type: string; // Will be validated as EventType
  content?: string;
  httpMethod?: string | null;
  httpUrl?: string | null;
  httpHeaders?: unknown; // Can be string, array, or object
  httpBody?: string | null;
  status?: string; // Will be validated as EventStatus
  triggerType?: string; // Will be validated as EventTriggerType
  scheduleNumber?: number | null;
  scheduleUnit?: string | null; // Will be validated as TimeUnit
  customSchedule?: string;
  runLocation?: string; // Will be validated as RunLocation
  serverId?: number | null;
  timeoutValue?: number;
  timeoutUnit?: string; // Will be validated as TimeUnit
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

// Type for the validated and transformed data
type CreateEventInput = z.infer<typeof createEventSchema>;

export function JsonImportModal({ isOpen, onClose }: JsonImportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const createEventMutation = trpc.events.create.useMutation();

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
      let eventData: unknown;
      try {
        eventData = JSON.parse(jsonInput);
      } catch {
        toast({
          title: "Invalid JSON",
          description: "Please check your JSON format and try again",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Validate that eventData is an object
      if (typeof eventData !== "object" || eventData === null) {
        toast({
          title: "Invalid Data",
          description: "JSON must contain an object",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Type guard for the parsed data
      const importData = eventData as ImportEventData;

      // Validate required fields
      if (!importData.name) {
        toast({
          title: "Missing Required Field",
          description: "Event name is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (!importData.type) {
        toast({
          title: "Missing Required Field",
          description: "Event type is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Validate event type is valid enum value
      if (!Object.values(EventType).includes(importData.type as EventType)) {
        toast({
          title: "Invalid Event Type",
          description: `Event type must be one of: ${Object.values(EventType).join(", ")}`,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Helper function to validate enum values
      const validateEnum = <T extends Record<string, string>>(
        value: string | undefined | null,
        enumObj: T,
        defaultValue: T[keyof T],
      ): T[keyof T] => {
        if (!value) return defaultValue;
        return Object.values(enumObj).includes(value)
          ? (value as T[keyof T])
          : defaultValue;
      };

      // Parse HTTP headers if provided
      const parseHttpHeaders = (
        headers: unknown,
      ): Array<{ key: string; value: string }> => {
        if (!headers) return [];

        if (typeof headers === "string") {
          try {
            const parsed: unknown = JSON.parse(headers);
            if (Array.isArray(parsed)) {
              return parsed.filter(
                (h): h is { key: string; value: string } =>
                  typeof h === "object" &&
                  h !== null &&
                  "key" in h &&
                  "value" in h &&
                  typeof (h as Record<string, unknown>).key === "string" &&
                  typeof (h as Record<string, unknown>).value === "string",
              );
            }
          } catch {
            // Invalid JSON, return empty array
          }
        } else if (Array.isArray(headers)) {
          return headers.filter(
            (h): h is { key: string; value: string } =>
              typeof h === "object" &&
              h !== null &&
              "key" in h &&
              "value" in h &&
              typeof (h as Record<string, unknown>).key === "string" &&
              typeof (h as Record<string, unknown>).value === "string",
          );
        }
        return [];
      };

      // Prepare the event data for creation
      const eventType = importData.type as EventType;
      const eventInput: CreateEventInput = {
        name: importData.name,
        type: eventType,
        description: importData.description,
        shared: importData.shared ?? false,
        content: importData.content,
        httpMethod: importData.httpMethod ?? undefined,
        httpUrl: importData.httpUrl ?? undefined,
        httpHeaders: parseHttpHeaders(importData.httpHeaders),
        httpBody: importData.httpBody ?? undefined,
        status: validateEnum(importData.status, EventStatus, EventStatus.DRAFT),
        triggerType: validateEnum(
          importData.triggerType,
          EventTriggerType,
          EventTriggerType.MANUAL,
        ),
        scheduleNumber: importData.scheduleNumber ?? undefined,
        scheduleUnit: validateEnum(
          importData.scheduleUnit,
          TimeUnit,
          TimeUnit.MINUTES,
        ),
        customSchedule: importData.customSchedule,
        runLocation: validateEnum(
          importData.runLocation,
          RunLocation,
          RunLocation.LOCAL,
        ),
        serverId: importData.serverId ?? undefined,
        selectedServerIds: [],
        timeoutValue: importData.timeoutValue ?? 30,
        timeoutUnit: validateEnum(
          importData.timeoutUnit,
          TimeUnit,
          TimeUnit.SECONDS,
        ),
        retries: importData.retries ?? 0,
        startTime: importData.startTime ?? undefined,
        maxExecutions: importData.maxExecutions ?? 0,
        resetCounterOnActive: importData.resetCounterOnActive ?? false,
        tags: importData.tags ?? [],
        envVars: Array.isArray(importData.envVars)
          ? importData.envVars.map((envVar) => ({
              key: envVar.key,
              value: envVar.value,
            }))
          : [],
        onSuccessActions: Array.isArray(importData.successEvents)
          ? importData.successEvents.map((e) => ({
              type: "ON_SUCCESS",
              action: ConditionalActionType.SCRIPT,
              details: {
                targetEventId: null,
                message: e.value,
              },
            }))
          : [],
        onFailActions: Array.isArray(importData.failEvents)
          ? importData.failEvents.map((e) => ({
              type: "ON_FAILURE",
              action: ConditionalActionType.SCRIPT,
              details: {
                targetEventId: null,
                message: e.value,
              },
            }))
          : [],
      };

      // Validate with schema
      const validationResult = createEventSchema.safeParse(eventInput);
      if (!validationResult.success) {
        const errors = validationResult.error.flatten();
        const firstError =
          Object.values(errors.fieldErrors)[0]?.[0] ??
          errors.formErrors[0] ??
          "Invalid event data";
        toast({
          title: "Validation Error",
          description: firstError,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Submit to API using tRPC
      const newEvent = await createEventMutation.mutateAsync(
        validationResult.data,
      );

      toast({
        title: "Success",
        description: `Event "${importData.name}" created successfully`,
      });

      // Close modal and reset form
      setJsonInput("");
      onClose();

      // Redirect to the newly created event's details page
      const lang = params.lang as string;
      router.push(`/${lang}/dashboard/events/${newEvent?.id ?? ""}`);
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
