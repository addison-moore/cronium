import React, { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import { LogDetailsSkeleton } from "@/components/logs/LogDetailsSkeleton";
import type { Metadata } from "next";

// Dynamic import the client component
import dynamic from "next/dynamic";

const LogDetailsClient = dynamic(
  () => import("./page-original").then((mod) => ({ default: mod.default })),
  {
    ssr: true,
    loading: () => <LogDetailsSkeleton />,
  },
);

interface LogDetailsPageProps {
  params: Promise<{
    id: string;
    lang: string;
  }>;
}

export async function generateMetadata({
  params,
}: LogDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const parsedId = parseInt(id);

  if (isNaN(parsedId)) {
    return {
      title: "Log Not Found",
    };
  }

  try {
    const log = await api.logs.getById({ id: parsedId });
    return {
      title: `Log #${log.id} - ${log.eventName}`,
      description: `Execution log for ${log.eventName}`,
    };
  } catch (_error) {
    return {
      title: "Log Not Found",
    };
  }
}

export default async function LogDetailsPage({ params }: LogDetailsPageProps) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { id, lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Validate ID
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    notFound();
  }

  // Pre-validate log exists to show 404 early
  try {
    await api.logs.getById({ id: parsedId });
  } catch (_error) {
    notFound();
  }

  return (
    <Suspense fallback={<LogDetailsSkeleton />}>
      <LogDetailsClient params={Promise.resolve({ id, lang })} />
    </Suspense>
  );
}
