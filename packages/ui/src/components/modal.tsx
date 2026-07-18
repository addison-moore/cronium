"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  showCloseButton?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  full: "max-w-[95vw] max-h-[95vh]",
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "lg",
  showCloseButton = true,
  className = "",
}: ModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={`${sizeClasses[size]} ${className}`}
        showCloseButton={showCloseButton}
        onInteractOutside={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => e.stopPropagation()}
      >
        {(title ?? description) && (
          <DialogHeader className="relative">
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        )}
        <div
          className="flex-1 overflow-auto"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
