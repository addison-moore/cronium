"use client";

import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Play,
  Pause,
  Download,
  Archive,
  Trash2,
  X,
} from "lucide-react";

interface BulkActionsToolbarProps {
  selectedCount: number;
  bulkActionLoading: string | null;
  onBulkActivate: () => void;
  onBulkPause: () => void;
  onBulkDownload: () => void;
  onBulkArchive: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActionsToolbar({
  selectedCount,
  bulkActionLoading,
  onBulkActivate,
  onBulkPause,
  onBulkDownload,
  onBulkArchive,
  onBulkDelete,
  onClearSelection,
}: BulkActionsToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium">
            {selectedCount} event(s) selected
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkActivate}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:bg-green-50 hover:border-green-300 dark:hover:bg-green-900/30"
            title="Activate selected events"
          >
            {bulkActionLoading === "activate" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 text-green-600" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkPause}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:bg-yellow-50 hover:border-yellow-300 dark:hover:bg-yellow-900/30"
            title="Pause selected events"
          >
            {bulkActionLoading === "pause" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Pause className="h-4 w-4 text-yellow-600" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkDownload}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30"
            title="Download selected events"
          >
            {bulkActionLoading === "download" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4 text-blue-600" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkArchive}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:bg-slate-50 hover:border-slate-300 dark:hover:bg-slate-900/30"
            title="Archive selected events"
          >
            {bulkActionLoading === "archive" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4 text-slate-600" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkDelete}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:bg-red-50 hover:border-red-300 dark:hover:bg-red-900/30"
            title="Delete selected events"
          >
            {bulkActionLoading === "delete" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-red-600" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="h-8 w-8 p-0"
            title="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
