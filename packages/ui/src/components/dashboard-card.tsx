"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Button } from "./button";

interface DashboardCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  buttonText: string;
  buttonLink: string;
  variant?: "default" | "primary" | "outline";
}

export function DashboardCard({
  title,
  description,
  icon,
  buttonText,
  buttonLink,
  variant = "default",
}: DashboardCardProps) {
  return (
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="mb-1 text-xl tracking-tight">{title}</CardTitle>
          <CardDescription className="text-sm">{description}</CardDescription>
        </div>
        <div className="bg-primary/10 text-primary rounded-md p-2">{icon}</div>
      </CardHeader>
      <CardContent className="pt-4 pb-6">
        <Button
          className={variant === "default" ? "w-full" : "w-full"}
          variant={
            variant === "default"
              ? "default"
              : variant === "outline"
                ? "outline"
                : "default"
          }
          asChild
        >
          <Link href={buttonLink}>{buttonText}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
