"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Play, RefreshCw, GitFork } from "lucide-react";
import { type EventStatus, type Workflow } from "@/shared/schema";
import { Button } from "@cronium/ui";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";

interface WorkflowDetailsHeaderProps {
  workflow: Workflow;
  onDelete: () => void;
  onRun: () => void;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  isRunning: boolean;
}

export function WorkflowDetailsHeader({
  workflow,
  onDelete,
  onRun,
  onStatusChange,
  isRunning,
}: WorkflowDetailsHeaderProps) {
  return (
    <div className="mb-6 flex justify-between gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button variant="ghost" size="sm" asChild className="h-8 w-fit">
          <Link href="/dashboard/workflows">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Workflows
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <GitFork className="h-5 w-5 rotate-90" />
            <h1 className="truncate text-xl font-bold">{workflow.name}</h1>
          </div>
          <ClickableStatusBadge
            currentStatus={workflow.status}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2 md:justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="border-info/40 bg-info/10 text-info-text hover:bg-info/20"
        >
          {isRunning ? (
            <>
              <RefreshCw className="mr-1.5 h-4 w-4 motion-safe:animate-spin" />
              <span className="sm:inline">Running</span>
            </>
          ) : (
            <>
              <Play className="mr-1.5 h-4 w-4" />
              <span className="sm:inline">Run Now</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="border-destructive/40 bg-destructive/10 text-destructive-text hover:bg-destructive/20"
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          <span className="sm:inline">Delete</span>
        </Button>
      </div>
    </div>
  );
}
