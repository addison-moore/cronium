import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "./button";

interface BackLinkProps {
  href: string;
  label: string;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

/**
 * A standardized back link component with an arrow icon
 */
export function BackLink({
  href,
  label,
  variant = "ghost",
  size = "sm",
  className = "",
}: BackLinkProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={`mr-2 ${className}`}
      asChild
    >
      <Link href={href}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}
