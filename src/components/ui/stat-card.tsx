"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: string | number;
    label: string;
    isPositive?: boolean;
  };
  footer?: ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
}

/**
 * A reusable stat card component for displaying statistics on dashboards
 */
export function StatCard({
  title,
  value,
  icon,
  trend,
  footer,
  className = "",
  href,
  onClick,
}: StatCardProps) {
  // Create card content
  const cardContent = (
    <>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-muted-foreground">{icon}</div>
        </div>

        {trend && (
          <div className="mt-2 flex items-center text-xs">
            <span
              className={`mr-1 ${trend.isPositive ? "text-green-500" : "text-red-500"}`}
            >
              {trend.isPositive ? "↑" : "↓"} {trend.value}
            </span>
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        )}

        {footer && (
          <div className="mt-4 text-xs text-muted-foreground">{footer}</div>
        )}
      </CardContent>
    </>
  );

  // Define hover effects class
  const hoverClass =
    href || onClick
      ? "group hover:shadow-md hover:border-[#7c3aed] dark:hover:border-violet-500 transition-all duration-300 cursor-pointer"
      : "";

  // Combine classes
  const cardClass = `${className} ${hoverClass}`;

  // Return appropriate element based on props
  if (href) {
    return (
      <Link href={href} className="block">
        <Card className={cardClass}>{cardContent}</Card>
      </Link>
    );
  } else if (onClick) {
    return (
      <Card className={cardClass} onClick={onClick}>
        {cardContent}
      </Card>
    );
  } else {
    return <Card className={cardClass}>{cardContent}</Card>;
  }
}
