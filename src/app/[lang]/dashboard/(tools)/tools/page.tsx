"use client";

import ToolsDashboard from "@/tools/ToolsDashboard";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslations } from "next-intl";

export default function ToolsPage() {
  const _t = useTranslations();

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title="Tools Dashboard"
        description="Browse actions, monitor health, and track executions"
      />

      {/* Dashboard component */}
      <ToolsDashboard />
    </div>
  );
}
