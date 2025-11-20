import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { MonitoringPageSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { UserRole } from "@/shared/schema";
import MonitoringClient from "@/components/monitoring/MonitoringClient";

export async function generateMetadata() {
  return {
    title: "Monitoring",
    description: "Monitor system performance and track application metrics",
  };
}

export default async function MonitoringPage() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  // Check admin role
  if (session.user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={<MonitoringPageSkeleton />}>
      <MonitoringClient />
    </Suspense>
  );
}
