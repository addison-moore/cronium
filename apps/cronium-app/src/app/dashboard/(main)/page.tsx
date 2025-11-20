import { Suspense } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Button } from "@cronium/ui";
import { Plus } from "lucide-react";
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
    <div className="container mx-auto space-y-8 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            High-level visibility into your automations
          </p>
        </div>
        <Link href="/dashboard/events/new">
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>Create Event</span>
          </Button>
        </Link>
      </div>

      {/* Stream the dashboard stats */}
      <Suspense fallback={<DashboardStatsSkeleton />}>
        <DashboardStatsWrapper />
      </Suspense>
    </div>
  );
}
