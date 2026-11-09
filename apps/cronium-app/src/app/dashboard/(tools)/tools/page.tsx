"use client";

import { Suspense } from "react";
import ToolsDashboard from "@/tools/ToolsDashboard";
import { OAuthResultAlert } from "@/tools/OAuthResultAlert";
import { PageShell, PageHeader } from "@cronium/ui";

export default function ToolsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Tools Dashboard"
        description="Browse actions, monitor health, and track executions"
      />

      {/* Where the OAuth callback sends a person back to: did connecting work? */}
      <Suspense fallback={null}>
        <OAuthResultAlert />
      </Suspense>

      {/* Dashboard component */}
      <ToolsDashboard />
    </PageShell>
  );
}
