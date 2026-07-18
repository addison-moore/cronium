import type { ReactNode } from "react";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  OctagonAlert,
  StickyNote,
} from "lucide-react";

type CalloutVariant = "info" | "tip" | "warning" | "danger" | "note";

// Local class join: this is a server component, and @cronium/ui's cn() is
// bundled behind a "use client" banner.
function cx(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const VARIANTS: Record<
  CalloutVariant,
  {
    container: string;
    icon: typeof Info;
    iconColor: string;
    titleColor: string;
  }
> = {
  info: {
    container: "border-info/40 bg-info/10",
    icon: Info,
    iconColor: "text-info",
    titleColor: "text-info-text",
  },
  tip: {
    container: "border-success/40 bg-success/10",
    icon: Lightbulb,
    iconColor: "text-success",
    titleColor: "text-success-text",
  },
  warning: {
    container: "border-warning/40 bg-warning/10",
    icon: AlertTriangle,
    iconColor: "text-warning",
    titleColor: "text-warning-text",
  },
  danger: {
    container: "border-destructive/40 bg-destructive/10",
    icon: OctagonAlert,
    iconColor: "text-destructive",
    titleColor: "text-destructive-text",
  },
  note: {
    container: "border-primary/40 bg-primary/10",
    icon: StickyNote,
    iconColor: "text-primary",
    titleColor: "text-primary",
  },
};

interface CalloutProps {
  variant?: CalloutVariant;
  /** When set, renders an icon + title row above the content */
  title?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The one docs callout. Replaces the hand-rolled per-hue note boxes:
 * info (blue), tip (green), warning (amber — also for the old yellow/orange
 * boxes), danger (red), note (violet). Without a title it is a plain tinted
 * container, so arbitrary content (lists, grids) nests unchanged.
 */
export function Callout({
  variant = "info",
  title,
  className,
  children,
}: CalloutProps) {
  const config = VARIANTS[variant];
  const Icon = config.icon;

  return (
    <div
      className={cx("rounded-lg border p-4", config.container, className)}
      data-callout={variant}
    >
      {title && (
        <div className="mb-2 flex items-center gap-2">
          <Icon className={cx("h-4 w-4 shrink-0", config.iconColor)} />
          <span className={cx("text-sm font-semibold", config.titleColor)}>
            {title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
