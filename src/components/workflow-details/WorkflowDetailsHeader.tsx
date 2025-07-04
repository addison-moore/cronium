"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Play, RefreshCw, GitFork } from "lucide-react";
import { EventStatus, Workflow } from "@/shared/schema";
import { Button } from "@/components/ui/button";
import { ClickableStatusBadge } from "@/components/ui/clickable-status-badge";

interface WorkflowDetailsHeaderProps {
  workflow: Workflow;
  langParam: string;
  onDelete: () => void;
  onRun: () => void;
  onStatusChange: (newStatus: EventStatus) => Promise<void>;
  isRunning: boolean;
}

export function WorkflowDetailsHeader({
  workflow,
  langParam,
  onDelete,
  onRun,
  onStatusChange,
  isRunning,
}: WorkflowDetailsHeaderProps) {
  return (
    <div className="flex justify-between gap-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit h-8">
          <Link href={`/${langParam}/dashboard/workflows`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Workflows
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <GitFork className="h-5 w-5 rotate-90" />
            <h1 className="text-xl font-bold truncate">{workflow.name}</h1>
          </div>
          <ClickableStatusBadge
            currentStatus={workflow.status}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-center md:justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900"
        >
          {isRunning ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              <span className="sm:inline">Running</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-1.5" />
              <span className="sm:inline">Run Now</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:text-red-800 dark:bg-red-950 dark:text-red-300 dark:border-red-900 dark:hover:bg-red-900 dark:hover:text-red-200"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          <span className="sm:inline">Delete</span>
        </Button>
      </div>
    </div>
  );
}
