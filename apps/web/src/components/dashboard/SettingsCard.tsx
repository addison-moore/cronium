import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SettingsCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className = "",
}: SettingsCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>

      <CardContent className="space-y-4">{children}</CardContent>

      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}
