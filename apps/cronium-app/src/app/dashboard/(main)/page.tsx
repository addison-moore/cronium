import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@cronium/ui";
import DashboardStats from "@/components/dashboard/DashboardStats";
import { DashboardStatsSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { authOptions } from "@/lib/auth";

// Client wrapper for DashboardStats
function DashboardStatsWrapper() {
  return <DashboardStats />;
}

export default async function Dashboard() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description="High-level visibility into your automations"
        createButton={{
          href: "/dashboard/events/new",
          label: "Create Event",
        }}
      />

      {/* Stream the dashboard stats */}
      <Suspense fallback={<DashboardStatsSkeleton />}>
        <DashboardStatsWrapper />
      </Suspense>
    </PageShell>
  );
}
