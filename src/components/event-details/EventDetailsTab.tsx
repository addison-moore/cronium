"use client";

import React, { useState } from "react";
import { MonacoEditor } from "@/components/ui/monaco-editor";
import { EventType } from "@/shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTranslations } from "next-intl";
import type { Event } from "./types";
import { Save, Edit, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";

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
  const t = useTranslations("Events");
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(event.content || "");

  // Cast event to Event for UI-specific properties
  const Event = event as Event;

  // tRPC mutation for updating event content
  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: (updatedEvent) => {
      // Update the event content locally
      if (onEventUpdate) {
        onEventUpdate(updatedEvent);
      }
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Event content updated successfully",
      });
    },
    onError: (error) => {
      console.error("Error updating event:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update event",
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
    } catch (error) {
      // Error handled by mutation onError
    }
  };

  const handleCancel = () => {
    setEditedContent(event.content || "");
    setIsEditing(false);
  };

  const renderHttpRequestDetails = () => {
    if (!event?.httpRequest) return null;

    return (
      <div className="mt-5 space-y-4">
        <div className="flex items-center">
          <span className="w-24 text-sm font-medium">{t("method")}:</span>
          <Badge className="border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
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
            <span className="text-sm font-medium">{t("headers")}:</span>
            <div className="border-border overflow-hidden rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">{t("key")}</TableHead>
                    <TableHead>{t("value")}</TableHead>
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
            <span className="text-sm font-medium">{t("body")}:</span>
            <div className="border-border overflow-hidden rounded border">
              <MonacoEditor
                height="200px"
                language="json"
                value={event.httpRequest.body}
                readOnly={true}
                editorSettings={{
                  fontSize: 12,
                  theme: "vs-dark",
                  minimap: false,
                  lineNumbers: true,
                  wordWrap: false,
                }}
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
            <span className="text-sm font-medium">{t("script")}:</span>
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
                      : "plaintext"
              }
              value={editedContent}
              onChange={(value) => setEditedContent(value || "")}
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
            <MonacoEditor
              height="400px"
              language={
                event.type === EventType.NODEJS
                  ? "javascript"
                  : event.type === EventType.PYTHON
                    ? "python"
                    : event.type === EventType.BASH
                      ? "bash"
                      : "plaintext"
              }
              value={event.content || ""}
              readOnly={true}
              editorSettings={{
                fontSize: 12,
                theme: "vs-dark",
                wordWrap: false,
                minimap: false,
                lineNumbers: true,
              }}
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
              <span className="text-sm font-medium">{t("name")}:</span>
              <p className="mt-1">{event.name}</p>
            </div>

            {Event.description && (
              <div>
                <span className="text-sm font-medium">{t("description")}:</span>
                <p className="text-muted-foreground mt-1">
                  {Event.description}
                </p>
              </div>
            )}

            <div>
              <span className="text-sm font-medium">{t("type")}:</span>
              <div className="mt-1">
                <Badge variant="secondary">{event.type}</Badge>
              </div>
            </div>

            <div>
              <span className="text-sm font-medium">{t("status")}:</span>
              <div className="mt-1">
                <Badge
                  variant={Event.active ? "default" : "secondary"}
                  className={Event.active ? "bg-green-100 text-green-800" : ""}
                >
                  {Event.active ? t("active") : t("inactive")}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {Event.schedule && (
              <div>
                <span className="text-sm font-medium">{t("schedule")}:</span>
                <p className="mt-1 font-mono text-sm">{Event.schedule}</p>
              </div>
            )}

            <div>
              <span className="text-sm font-medium">{t("created")}:</span>
              <p className="mt-1 text-sm">
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>

            <div>
              <span className="text-sm font-medium">{t("updated")}:</span>
              <p className="mt-1 text-sm">
                {new Date(event.updatedAt).toLocaleString()}
              </p>
            </div>

            {event.executionCount !== undefined && (
              <div>
                <span className="text-sm font-medium">{t("executions")}:</span>
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
            <AccordionTrigger>{t("scriptContent")}</AccordionTrigger>
            <AccordionContent>{renderScriptDetails()}</AccordionContent>
          </AccordionItem>
        )}

        {event.type === EventType.HTTP_REQUEST && (
          <AccordionItem value="http-details">
            <AccordionTrigger>{t("httpRequestDetails")}</AccordionTrigger>
            <AccordionContent>{renderHttpRequestDetails()}</AccordionContent>
          </AccordionItem>
        )}

        {Event.conditionalActions && Event.conditionalActions.length > 0 && (
          <AccordionItem value="conditional-actions">
            <AccordionTrigger>{t("conditionalActions")}</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {Event.conditionalActions.map((action, index) => (
                  <div
                    key={index}
                    className="border-border bg-background rounded-lg border p-3"
                  >
                    <div className="mb-2 flex items-center space-x-2">
                      <Badge variant="outline">{action.type}</Badge>
                      <Badge variant="secondary">{action.action}</Badge>
                    </div>
                    {action.description && (
                      <p className="text-muted-foreground text-sm">
                        {action.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
