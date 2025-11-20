import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LogsPageSkeleton } from "@/components/logs/LogsPageSkeleton";
import LogsPageClient from "@/components/logs/LogsPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Execution Logs",
  description:
    "Review recent event runs and workflow executions across your workspace.",
};

export default async function LogsPage() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <Suspense fallback={<LogsPageSkeleton />}>
      <LogsPageClient />
    </Suspense>
  );
}
