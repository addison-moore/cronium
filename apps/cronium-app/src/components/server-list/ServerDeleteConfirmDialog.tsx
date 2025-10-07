"use client";

import React, { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Spinner } from "@cronium/ui";
import { AlertTriangle, Server, Calendar, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface ServerDeleteConfirmDialogProps {
  serverId: number | null;
  serverName: string;
  isOpen: boolean;
  isArchived?: boolean;
  onClose: () => void;
  onConfirm: (action: "archive" | "delete", reason?: string) => void;
}

type DeletionImpact = {
  eventCount: number;
  eventServerCount: number;
  executionCount: number;
  activeEvents: Array<{ id: number; name: string; status: string }>;
};

export function ServerDeleteConfirmDialog({
  serverId,
  serverName,
  isOpen,
  isArchived = false,
  onClose,
  onConfirm,
}: ServerDeleteConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedAction, setSelectedAction] = useState<"archive" | "delete">(
    "archive",
  );

  // Fetch impact analysis when dialog opens
  const { data: impact, isLoading: impactLoading } =
    trpc.servers.getDeletionImpact.useQuery(
      { id: serverId! },
      {
        enabled: isOpen && serverId !== null,
      },
    ) as { data: DeletionImpact | undefined; isLoading: boolean };

  // Reset confirmation text when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmText("");
      setArchiveReason("");
      setIsDeleting(false);
      setSelectedAction(isArchived ? "delete" : "archive");
    }
  }, [isOpen, isArchived]);

  const handleConfirm = () => {
    if (confirmText !== serverName) {
      return;
    }

    setIsDeleting(true);
    onConfirm(selectedAction, archiveReason);
    setIsDeleting(false);
    onClose();
  };

  const hasActiveResources =
    impact &&
    (impact.eventCount > 0 ||
      impact.eventServerCount > 0 ||
      impact.activeEvents.length > 0);

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive h-5 w-5" />
            {isArchived ? "Permanently Delete" : "Remove"} Server: {serverName}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Choose how you want to remove this server from your system.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4 pt-4">
          {impactLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
              <span className="ml-2">Analyzing impact...</span>
            </div>
          ) : impact ? (
            <>
              {/* Impact Summary */}
              <div className="space-y-3">
                <h4 className="text-foreground font-semibold">
                  Deletion Impact Analysis:
                </h4>

                <div className="grid gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4" />
                      Events using this server:
                    </span>
                    <span
                      className={`font-semibold ${impact.eventCount > 0 ? "text-amber-600" : "text-green-600"}`}
                    >
                      {impact.eventCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">
                      <Server className="h-4 w-4" />
                      Multi-server configurations:
                    </span>
                    <span
                      className={`font-semibold ${impact.eventServerCount > 0 ? "text-amber-600" : "text-green-600"}`}
                    >
                      {impact.eventServerCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4" />
                      Historical executions:
                    </span>
                    <span className="text-muted-foreground font-semibold">
                      {impact.executionCount}
                    </span>
                  </div>
                </div>

                {/* Active Events Warning */}
                {impact.activeEvents.length > 0 && (
                  <Alert className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-600">
                      <strong>Warning:</strong> {impact.activeEvents.length}{" "}
                      active event{impact.activeEvents.length > 1 ? "s" : ""}{" "}
                      will be affected:
                      <ul className="mt-2 list-inside list-disc text-sm">
                        {impact.activeEvents.slice(0, 3).map((event) => (
                          <li key={event.id}>{event.name}</li>
                        ))}
                        {impact.activeEvents.length > 3 && (
                          <li className="text-muted-foreground">
                            and {impact.activeEvents.length - 3} more...
                          </li>
                        )}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Action Selection */}
                {!isArchived && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Choose action:
                    </Label>
                    <div className="space-y-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          value="archive"
                          checked={selectedAction === "archive"}
                          onChange={(e) =>
                            setSelectedAction(
                              e.target.value as "archive" | "delete",
                            )
                          }
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium">
                            Archive (Recommended)
                          </div>
                          <div className="text-muted-foreground text-sm">
                            Safely archive the server. Credentials will be
                            purged but you can restore it later.
                          </div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          value="delete"
                          checked={selectedAction === "delete"}
                          onChange={(e) =>
                            setSelectedAction(
                              e.target.value as "archive" | "delete",
                            )
                          }
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium">Permanently Delete</div>
                          <div className="text-muted-foreground text-sm">
                            Immediately and permanently delete the server. This
                            cannot be undone.
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Archive Reason */}
                {selectedAction === "archive" && !isArchived && (
                  <div className="space-y-2">
                    <Label
                      htmlFor="archive-reason"
                      className="text-sm font-medium"
                    >
                      Reason for archiving (optional):
                    </Label>
                    <Input
                      id="archive-reason"
                      type="text"
                      value={archiveReason}
                      onChange={(e) => setArchiveReason(e.target.value)}
                      placeholder="e.g., Server decommissioned, No longer needed"
                      disabled={isDeleting}
                    />
                  </div>
                )}

                {/* What will happen */}
                <Alert>
                  <AlertDescription className="text-sm">
                    <strong>This action will:</strong>
                    <ul className="mt-2 list-inside list-disc">
                      {selectedAction === "archive" && !isArchived ? (
                        <>
                          <li>Archive the server configuration</li>
                          <li>Immediately purge SSH keys and passwords</li>
                          <li>Hide server from active lists</li>
                          <li>Allow restoration within 30 days</li>
                          <li>Schedule automatic deletion after 30 days</li>
                        </>
                      ) : (
                        <>
                          <li>Permanently delete the server configuration</li>
                          <li>Remove all SSH keys and credentials</li>
                          {impact.eventCount > 0 && (
                            <li>
                              Convert {impact.eventCount} event
                              {impact.eventCount > 1 ? "s" : ""} to local
                              execution
                            </li>
                          )}
                          {impact.eventServerCount > 0 && (
                            <li>
                              Remove from {impact.eventServerCount} multi-server
                              configuration
                              {impact.eventServerCount > 1 ? "s" : ""}
                            </li>
                          )}
                          <li>Keep execution history for audit purposes</li>
                        </>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              </div>

              {/* Confirmation Input */}
              <div className="space-y-2">
                <Label htmlFor="confirm-delete" className="text-sm font-medium">
                  Type{" "}
                  <span className="bg-muted rounded px-1 py-0.5 font-mono">
                    {serverName}
                  </span>{" "}
                  to confirm:
                </Label>
                <Input
                  id="confirm-delete"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Enter server name"
                  className={
                    confirmText && confirmText !== serverName
                      ? "border-destructive"
                      : ""
                  }
                  disabled={isDeleting}
                />
                {confirmText && confirmText !== serverName && (
                  <p className="text-destructive text-xs">
                    Server name does not match
                  </p>
                )}
              </div>
            </>
          ) : (
            <p>Unable to analyze deletion impact. Please try again.</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={confirmText !== serverName || impactLoading || isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                {selectedAction === "archive" ? "Archiving..." : "Deleting..."}
              </>
            ) : selectedAction === "archive" && !isArchived ? (
              "Archive Server"
            ) : hasActiveResources ? (
              "Delete Anyway"
            ) : (
              "Delete Server"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
