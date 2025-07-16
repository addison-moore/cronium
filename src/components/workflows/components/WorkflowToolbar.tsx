import React from "react";
import {
  Undo,
  RotateCcw,
  CheckCircle,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

interface WorkflowToolbarProps {
  canUndo: boolean;
  canUndoToSave: boolean;
  onUndo: () => void;
  onUndoAllChanges: () => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  onDelete: () => void;
  hasSelection: boolean;
}

export function WorkflowToolbar({
  canUndo,
  canUndoToSave,
  onUndo,
  onUndoAllChanges,
  onSave,
  isSaving,
  hasUnsavedChanges,
  onDelete,
  hasSelection,
}: WorkflowToolbarProps) {
  const t = useTranslations("workflows");

  return (
    <div className="bg-background/95 flex flex-col gap-2 rounded-lg p-2 shadow-lg">
      <div className="flex flex-col gap-1">
        <TooltipProvider>
          {/* Undo Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={canUndo ? "outline" : "ghost"}
                onClick={onUndo}
                disabled={!canUndo}
                className="h-9 w-9 p-0"
              >
                <Undo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{t("undo")} (Ctrl+Z)</p>
            </TooltipContent>
          </Tooltip>

          {/* Undo All Changes */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={canUndoToSave ? "outline" : "ghost"}
                onClick={onUndoAllChanges}
                disabled={!canUndoToSave}
                className="h-9 w-9 p-0"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{t("undoAllChanges")}</p>
            </TooltipContent>
          </Tooltip>

          {/* Save Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={hasUnsavedChanges ? "default" : "outline"}
                onClick={onSave}
                disabled={isSaving || !hasUnsavedChanges}
                className="h-9 w-9 p-0"
              >
                {hasUnsavedChanges ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>
                {hasUnsavedChanges ? t("saveChanges") : t("saved")} (Ctrl+S)
              </p>
            </TooltipContent>
          </Tooltip>

          {/* Delete Selected */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={hasSelection ? "destructive" : "ghost"}
                onClick={onDelete}
                disabled={!hasSelection}
                className="h-9 w-9 p-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{t("deleteSelected")} (Delete)</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Unsaved Changes Indicator */}
      {hasUnsavedChanges && (
        <div className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-500">
          <AlertCircle className="h-3 w-3" />
          <span>{t("unsavedChanges")}</span>
        </div>
      )}
    </div>
  );
}
