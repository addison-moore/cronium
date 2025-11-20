"use client";

import ToolsDashboard from "@/tools/ToolsDashboard";
import { PageHeader } from "@cronium/ui";

export default function ToolsPage() {
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
