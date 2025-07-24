"use client";

import React from "react";
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
import { useTranslations } from "next-intl";

interface EventDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  eventName: string;
}

export function EventDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  eventName,
}: EventDeleteDialogProps) {
  const t = useTranslations("Events");

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteEventConfirmation")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteEventWarning", { eventName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-destructive hover:bg-destructive/90"
            disabled={isDeleting}
          >
            {isDeleting ? t("deleting") : t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
