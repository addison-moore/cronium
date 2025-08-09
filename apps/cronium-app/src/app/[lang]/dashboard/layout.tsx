import { Suspense } from "react";
import DashboardLayoutClient from "./layout-client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

interface DashboardLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  // Check authentication on the server
  const session = await getServerSession(authOptions);
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
