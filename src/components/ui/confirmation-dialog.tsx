"use client";

import { ReactNode, useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "./spinner";

interface ConfirmationDialogProps {
  title: string;
  description: string;
  cancelText?: string;
  confirmText?: string;
  confirmVariant?: "destructive" | "default";
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;

  // Support two modes of controlling the dialog:
  // 1. External state control (controlled component)
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  loadingText?: string;
  variant?: string; // For backward compatibility

  // 2. Trigger-based (uncontrolled component)
  trigger?: ReactNode;
}

/**
 * A reusable confirmation dialog component with standardized styling
 */
export function ConfirmationDialog({
  title,
  description,
  cancelText = "Cancel",
  confirmText = "Confirm",
  confirmVariant = "destructive",
  icon = <AlertTriangle className="h-5 w-5 text-amber-500" />,
  onConfirm,
  // External state control props
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  loadingText,
  variant,
  // Trigger-based props
  trigger,
}: ConfirmationDialogProps) {
  // Determine if we're in controlled or uncontrolled mode
  const isControlled =
    controlledOpen !== undefined && controlledOnOpenChange !== undefined;

  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Use either controlled or internal state
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (controlledOnOpenChange as (value: boolean) => void)
    : setInternalOpen;

  // Handle confirmation with loading state
  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
      setOpen(false);
    }
  };

  // Map variant to confirmVariant if provided
  const effectiveVariant =
    variant === "destructive" ? "destructive" : confirmVariant;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <div onClick={() => setOpen(true)}>{trigger}</div>}

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center mb-2">
            {icon}
            <AlertDialogTitle className="ml-2">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={isConfirming}>
              <X className="h-4 w-4 mr-2" />
              {cancelText}
            </Button>
          </AlertDialogCancel>

          <AlertDialogAction asChild>
            <Button
              variant={effectiveVariant}
              onClick={handleConfirm}
              disabled={isConfirming}
            >
              {isConfirming ? (
                <>
                  <Spinner size="lg" />
                  {loadingText || confirmText}
                </>
              ) : (
                confirmText
              )}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
