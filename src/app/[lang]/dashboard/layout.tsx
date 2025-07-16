import { Suspense } from "react";
import {
  NavigationSkeleton,
  MobileNavigationSkeleton,
} from "@/components/ui/navigation-skeleton";
import DashboardLayoutClient from "./layout-client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

interface DashboardLayoutProps {
  children: React.ReactNode;
  params: { lang: string };
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  // Check authentication on the server
  const session = await getServerSession(authOptions);
  const { lang } = await Promise.resolve(params);

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  return (
    <>
      {/* Mobile navigation skeleton - shown immediately */}
      <div className="md:hidden">
        <MobileNavigationSkeleton />
      </div>

      {/* Desktop navigation skeleton - shown immediately */}
      <div className="hidden md:block">
        <NavigationSkeleton />
      </div>

      {/* Actual navigation - streamed in */}
      <Suspense fallback={null}>
        <DashboardLayoutClient user={session.user}>
          {children}
        </DashboardLayoutClient>
      </Suspense>
    </>
  );
}
