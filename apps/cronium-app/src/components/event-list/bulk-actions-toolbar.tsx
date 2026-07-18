"use client";

import { Button } from "@cronium/ui";
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
    <div className="bg-muted/50 border-border mb-4 rounded-lg border p-3">
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
            className="hover:border-success/40 hover:bg-success/10 h-8 w-8 p-0"
            title="Activate selected events"
          >
            {bulkActionLoading === "activate" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="text-success h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkPause}
            disabled={bulkActionLoading !== null}
            className="hover:border-warning/40 hover:bg-warning/10 h-8 w-8 p-0"
            title="Pause selected events"
          >
            {bulkActionLoading === "pause" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Pause className="text-warning h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkDownload}
            disabled={bulkActionLoading !== null}
            className="hover:border-info/40 hover:bg-info/10 h-8 w-8 p-0"
            title="Download selected events"
          >
            {bulkActionLoading === "download" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="text-info h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkArchive}
            disabled={bulkActionLoading !== null}
            className="h-8 w-8 p-0 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/30"
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
            className="hover:border-destructive/40 hover:bg-destructive/10 h-8 w-8 p-0"
            title="Delete selected events"
          >
            {bulkActionLoading === "delete" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="text-destructive h-4 w-4" />
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
