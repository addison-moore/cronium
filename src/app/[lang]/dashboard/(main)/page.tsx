import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import DashboardStats from "@/components/dashboard/DashboardStats";
import { DashboardStatsSkeleton } from "@/components/dashboard/DashboardStatsSkeleton";
import { authOptions } from "@/lib/auth";

interface DashboardPageParams {
  params: Promise<{
    lang: string;
  }>;
}

// Client wrapper for DashboardStats
function DashboardStatsWrapper() {
  return <DashboardStats />;
}

export default async function Dashboard({ params }: DashboardPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  const t = await getTranslations();

  return (
    <div className="container mx-auto space-y-8 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("Dashboard.Title")}</h1>
          <p className="text-muted-foreground">{t("Dashboard.Overview")}</p>
        </div>
        <Link href={`/${lang}/dashboard/events/new`}>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>{t("Dashboard.NewEvent")}</span>
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
