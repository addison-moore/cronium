"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { Plus } from "lucide-react";
import DashboardStats from "@/components/dashboard/DashboardStats";

export default function Dashboard() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <div className="container mx-auto space-y-8 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("Dashboard.Title")}</h1>
          <p className="text-muted-foreground">{t("Dashboard.Overview")}</p>
        </div>
        <Link href={`/${locale}/dashboard/events/new`}>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>{t("Dashboard.NewEvent")}</span>
          </Button>
        </Link>
      </div>

      <DashboardStats />
    </div>
  );
}
