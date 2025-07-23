import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { MonitoringPageSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { UserRole } from "@/shared/schema";
import MonitoringClient from "@/components/monitoring/MonitoringClient";

interface MonitoringPageParams {
  params: Promise<{
    lang: string;
  }>;
}

export async function generateMetadata({
  params: _params,
}: MonitoringPageParams) {
  const t = await getTranslations();

  return {
    title: t("Monitoring.Title"),
    description: t("Monitoring.Description"),
  };
}

export default async function MonitoringPage({ params }: MonitoringPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Check admin role
  if (session.user.role !== UserRole.ADMIN) {
    redirect(`/${lang}/dashboard`);
  }

  return (
    <Suspense fallback={<MonitoringPageSkeleton />}>
      <MonitoringClient />
    </Suspense>
  );
}
