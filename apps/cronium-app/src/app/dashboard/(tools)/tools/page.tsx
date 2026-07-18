"use client";

import ToolsDashboard from "@/tools/ToolsDashboard";
import { PageShell, PageHeader } from "@cronium/ui";

export default function ToolsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Tools Dashboard"
        description="Browse actions, monitor health, and track executions"
      />

      {/* Dashboard component */}
      <ToolsDashboard />
    </PageShell>
  );
}
