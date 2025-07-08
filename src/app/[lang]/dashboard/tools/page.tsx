"use client";

import ToolsDashboard from "@/components/tools/ToolsDashboard";
import { useTranslations } from "next-intl";

export default function ToolsPage() {
  const t = useTranslations();

  return (
    <div className="container mx-auto space-y-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tools Dashboard</h1>
          <p className="text-muted-foreground">
            Browse actions, monitor health, and track executions
          </p>
        </div>
      </div>

      {/* Dashboard component */}
      <ToolsDashboard dict={t} />
    </div>
  );
}
