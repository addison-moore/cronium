"use client";

import { type LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";

interface SettingsSectionProps {
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          <span>{title}</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
