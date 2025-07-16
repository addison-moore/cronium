import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LogsPageSkeleton } from "@/components/logs/LogsPageSkeleton";
import dynamic from "next/dynamic";
import type { Metadata } from "next";

// Dynamic import the client component
const LogsClient = dynamic(() => import("./page-original"), {
  ssr: false,
  loading: () => <LogsPageSkeleton />,
});

interface LogsPageParams {
  params: {
    lang: string;
  };
}

export async function generateMetadata({
  params: _params,
}: LogsPageParams): Promise<Metadata> {
  const t = await getTranslations("Logs");

  return {
    title: t("Title"),
    description: t("Description"),
  };
}

export default async function LogsPage({ params }: LogsPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await Promise.resolve(params);

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  return (
    <Suspense fallback={<LogsPageSkeleton />}>
      <LogsClient />
    </Suspense>
  );
}
