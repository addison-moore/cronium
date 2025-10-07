import { Suspense } from "react";
import DashboardLayoutClient from "./layout-client";
import { getCachedServerSession } from "@/lib/auth-cache";
import { redirect } from "next/navigation";

interface DashboardLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  // Check authentication on the server (cached to avoid repeated DB calls)
  const session = await getCachedServerSession();
  const { lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  return (
    <Suspense fallback={null}>
      <DashboardLayoutClient user={session.user}>
        {children}
      </DashboardLayoutClient>
    </Suspense>
  );
}
