import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ServersTableClient } from "@/components/server-list/ServersTableClient";
import { ServersTableSkeleton } from "@/components/ui/table-skeleton";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import type { Metadata } from "next";

interface ServerPageParams {
  params: Promise<{
    lang: string;
  }>;
}

export async function generateMetadata({
  params: _params,
}: ServerPageParams): Promise<Metadata> {
  const t = await getTranslations("Servers");

  return {
    title: t("Title"),
    description: t("Description"),
  };
}

// Async component that fetches and renders the servers list
async function ServersList() {
  // Fetch servers on the server side
  const serversData = await api.servers.getAll({
    limit: 100,
    offset: 0,
  });

  // Transform server data for client
  const servers = serversData.servers.map((server) => ({
    ...server,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
    lastChecked: server.lastChecked?.toISOString() ?? undefined,
    online: server.online ?? undefined,
  }));

  return <ServersTableClient initialServers={servers} />;
}

export default async function ServersPage({ params }: ServerPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Get translations
  const t = await getTranslations("Servers");

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title={t("Title")}
        createButton={{
          href: `/${lang}/dashboard/servers/new`,
          label: t("AddServer"),
          icon: <Plus className="h-4 w-4" />,
        }}
      />

      {/* Stream the servers list */}
      <Suspense fallback={<ServersTableSkeleton />}>
        <ServersList />
      </Suspense>
    </div>
  );
}
