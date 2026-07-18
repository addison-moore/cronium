"use client";
import React, { useState } from "react";
import { MonacoEditor, CodeViewer } from "@cronium/ui";
import { EventType } from "@/shared/schema";
import { Card, CardContent } from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Button } from "@cronium/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cronium/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@cronium/ui";
import type { Event } from "./types";
import { Save, Edit, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@cronium/ui";
import { formatDate } from "@/lib/utils";

const copy = {
  method: "Method",
  headers: "Headers",
  key: "Key",
  value: "Value",
  body: "Body",
  script: "Script",
  name: "Name",
  description: "Description",
  type: "Type",
  status: "Status",
  active: "Active",
  inactive: "Inactive",
  schedule: "Schedule",
  created: "Created",
  updated: "Updated",
  executions: "Executions",
  scriptContent: "Script Content",
  httpRequestDetails: "HTTP Request Details",
} as const;

interface EventDetailsTabProps {
  event: Event;
  expandedAccordionItems: string[];
  toggleAccordionItem: (value: string) => void;
  onEventUpdate?: (updatedEvent: Event) => void;
}

export function EventDetailsTab({
  event,
  expandedAccordionItems,
  toggleAccordionItem,
  onEventUpdate,
}: EventDetailsTabProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(event.content ?? "");

  // Cast event to Event for UI-specific properties
  const Event = event;

  // tRPC mutation for updating event content
  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: (updatedEvent) => {
      // Update the event content locally
      if (onEventUpdate && updatedEvent) {
        // Transform EventWithRelations to Event by adding missing properties
        const transformedEvent = {
          ...updatedEvent,
          // Ensure dates are converted to strings to match the Event interface
          createdAt:
            typeof updatedEvent.createdAt === "string"
              ? updatedEvent.createdAt
              : updatedEvent.createdAt.toISOString(),
          updatedAt:
            typeof updatedEvent.updatedAt === "string"
              ? updatedEvent.updatedAt
              : updatedEvent.updatedAt.toISOString(),
          lastRunAt:
            updatedEvent.lastRunAt === null
              ? null
              : typeof updatedEvent.lastRunAt === "string"
                ? updatedEvent.lastRunAt
                : updatedEvent.lastRunAt.toISOString(),
          nextRunAt:
            updatedEvent.nextRunAt === null
              ? null
              : typeof updatedEvent.nextRunAt === "string"
                ? updatedEvent.nextRunAt
                : updatedEvent.nextRunAt.toISOString(),
          environmentVariables:
            updatedEvent.envVars?.map((env) => ({
              key: env.key,
              value: env.value,
            })) || [],
          events: [], // Add empty events array if it doesn't exist in updatedEvent
          tags: Array.isArray(updatedEvent.tags) ? updatedEvent.tags : [], // Ensure tags is a string array
        };
        onEventUpdate(transformedEvent);
      }
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Event content updated successfully",
        variant: "success",
      });
    },
    onError: (error) => {
      console.error("Error updating event:", error);
      toast({
        title: "Error",
        description: error.message ?? "Failed to update event",
        variant: "destructive",
      });
    },
  });

  const handleSave = async () => {
    try {
      await updateEventMutation.mutateAsync({
        id: event.id,
        content: editedContent,
      });
    } catch {
      // Error handled by mutation onError
    }
  };

  const handleCancel = () => {
    setEditedContent(event.content ?? "");
    setIsEditing(false);
  };

  const renderHttpRequestDetails = () => {
    if (!event?.httpRequest) return null;

    return (
      <div className="mt-5 space-y-4">
        <div className="flex items-center">
          <span className="w-24 text-sm font-medium">{copy.method}:</span>
          <Badge className="border-info/40 bg-info/10 text-info-text hover:bg-info/20">
            {event.httpRequest.method}
          </Badge>
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium">URL:</span>
          <div className="bg-muted rounded p-2 font-mono text-sm break-all">
            {event.httpRequest.url}
          </div>
        </div>

        {event.httpRequest.headers && event.httpRequest.headers.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">{copy.headers}:</span>
            <div className="border-border overflow-hidden rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">{copy.key}</TableHead>
                    <TableHead>{copy.value}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.httpRequest.headers.map((header, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-xs">
                        {header.key}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {header.value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {event.httpRequest.body && (
          <div className="space-y-2">
            <span className="text-sm font-medium">{copy.body}:</span>
            <div className="border-border overflow-hidden rounded border">
              <CodeViewer
                code={event.httpRequest.body}
                language="json"
                height="200px"
                theme="dark"
                showLineNumbers={true}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderScriptDetails = () => {
    if (
      !event ||
      ![EventType.NODEJS, EventType.PYTHON, EventType.BASH].includes(event.type)
    )
      return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-sm font-medium">{copy.script}:</span>
            <div className="flex items-center space-x-2">
              <Badge variant="secondary">{event.type}</Badge>
              {event.servers && event.servers.length > 0 && (
                <Badge variant="outline">
                  Server: {event.servers[0]?.name}
                </Badge>
              )}
            </div>
          </div>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <Edit className="mr-1 h-4 w-4" />
              Edit
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <MonacoEditor
              height="400px"
              language={
                event.type === EventType.NODEJS
                  ? "javascript"
                  : event.type === EventType.PYTHON
                    ? "python"
                    : event.type === EventType.BASH
                      ? "bash"
                      : "text"
              }
              value={editedContent}
              onChange={(value) => setEditedContent(value ?? "")}
              editorSettings={{
                fontSize: 14,
                theme: "vs-dark",
                wordWrap: false,
                minimap: false,
                lineNumbers: true,
              }}
            />
            <div className="flex items-center space-x-2">
              <Button
                onClick={handleSave}
                disabled={updateEventMutation.isPending}
                size="sm"
              >
                <Save className="mr-1 h-4 w-4" />
                {updateEventMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateEventMutation.isPending}
                size="sm"
              >
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded border">
            <CodeViewer
              code={event.content ?? ""}
              language={
                event.type === EventType.NODEJS
                  ? "javascript"
                  : event.type === EventType.PYTHON
                    ? "python"
                    : event.type === EventType.BASH
                      ? "bash"
                      : "text"
              }
              height="400px"
              theme="dark"
              showLineNumbers={true}
            />
          </div>
        )}
      </div>
    );
  };

  const renderEventInfo = () => (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium">{copy.name}:</span>
              <p className="mt-1">{event.name}</p>
            </div>

            {Event.description && (
              <div>
                <span className="text-sm font-medium">{copy.description}:</span>
                <p className="text-muted-foreground mt-1">
                  {Event.description}
                </p>
              </div>
            )}

            <div>
              <span className="text-sm font-medium">{copy.type}:</span>
              <div className="mt-1">
                <Badge variant="secondary">{event.type}</Badge>
              </div>
            </div>

            <div>
              <span className="text-sm font-medium">{copy.status}:</span>
              <div className="mt-1">
                <Badge
                  variant={Event.active ? "default" : "secondary"}
                  className={
                    Event.active ? "bg-success/10 text-success-text" : ""
                  }
                >
                  {Event.active ? copy.active : copy.inactive}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {Event.schedule && (
              <div>
                <span className="text-sm font-medium">{copy.schedule}:</span>
                <p className="mt-1 font-mono text-sm">{Event.schedule}</p>
              </div>
            )}

            <div>
              <span className="text-sm font-medium">{copy.created}:</span>
              <p className="mt-1 text-sm">{formatDate(event.createdAt)}</p>
            </div>

            <div>
              <span className="text-sm font-medium">{copy.updated}:</span>
              <p className="mt-1 text-sm">{formatDate(event.updatedAt)}</p>
            </div>

            {event.executionCount !== undefined && (
              <div>
                <span className="text-sm font-medium">{copy.executions}:</span>
                <p className="mt-1">{event.executionCount}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {renderEventInfo()}

      <Accordion
        type="multiple"
        value={expandedAccordionItems}
        onValueChange={(value) => {
          value.forEach(toggleAccordionItem);
        }}
      >
        {[EventType.NODEJS, EventType.PYTHON, EventType.BASH].includes(
          event.type,
        ) && (
          <AccordionItem value="script-content">
            <AccordionTrigger>{copy.scriptContent}</AccordionTrigger>
            <AccordionContent>{renderScriptDetails()}</AccordionContent>
          </AccordionItem>
        )}

        {event.type === EventType.HTTP_REQUEST && (
          <AccordionItem value="http-details">
            <AccordionTrigger>{copy.httpRequestDetails}</AccordionTrigger>
            <AccordionContent>{renderHttpRequestDetails()}</AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
