"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";
import { X } from "lucide-react";

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
        onInteractOutside={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => e.stopPropagation()}
      >
        {(title ?? description ?? showCloseButton) && (
          <DialogHeader className="relative">
            {showCloseButton && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 h-6 w-6"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            )}
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
