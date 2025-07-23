"use client";

import { useRouter } from "next/navigation";
import { X, PlusCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "./spinner";

interface FormActionsProps {
  isSubmitting: boolean;
  isEditing?: boolean;
  cancelRoute: string;
  saveText?: {
    creating?: string;
    updating?: string;
    create?: string;
    update?: string;
    cancel?: string;
  };
  className?: string;
}

/**
 * Reusable form actions component that provides consistent form submission and cancel buttons
 * with appropriate loading states and icons.
 */
export function FormActions({
  isSubmitting,
  isEditing = false,
  cancelRoute,
  saveText = {},
  className = "flex justify-end gap-3 mt-6",
}: FormActionsProps) {
  const router = useRouter();

  // Default text values with fallbacks
  const {
    creating = "Creating...",
    updating = "Updating...",
    create = "Create",
    update = "Update",
    cancel = "Cancel",
  } = saveText;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(cancelRoute)}
        disabled={isSubmitting}
      >
        <X className="mr-2 h-4 w-4" />
        {cancel}
      </Button>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Spinner size="lg" />
            {isEditing ? updating : creating}
          </>
        ) : (
          <>
            <div className="mr-2">
              {isEditing ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <PlusCircle className="h-4 w-4" />
              )}
            </div>
            {isEditing ? update : create}
          </>
        )}
      </Button>
    </div>
  );
}
