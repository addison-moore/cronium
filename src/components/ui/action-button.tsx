"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ActionButtonProps {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "destructive"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
  isDisabled?: boolean;
  className?: string;
  iconClassName?: string;
}

export function ActionButton({
  label,
  icon,
  onClick,
  href,
  variant = "default",
  size = "default",
  isLoading = false,
  isDisabled = false,
  className = "",
  iconClassName = "p-1.5 bg-primary/10 rounded-md mr-3",
}: ActionButtonProps) {
  const content = (
    <>
      {isLoading ? (
        <>
          <div className="animate-spin mr-2">
            <Loader2 className="h-4 w-4" />
          </div>
          <span>{`${label}...`}</span>
        </>
      ) : (
        <>
          {icon && <div className={iconClassName}>{icon}</div>}
          <span>{label}</span>
        </>
      )}
    </>
  );

  if (href && !isDisabled && !isLoading) {
    return (
      <Button
        variant={variant}
        size={size}
        className={`flex items-center justify-start ${className}`}
        asChild
        disabled={isDisabled || isLoading}
      >
        <Link href={href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      className={`flex items-center justify-start ${className}`}
      disabled={isDisabled || isLoading}
    >
      {content}
    </Button>
  );
}
