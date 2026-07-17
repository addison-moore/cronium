import { Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@cronium/ui";
import { ServersTableClient } from "@/components/server-list/ServersTableClient";
import { ServersPageTabs } from "@/components/server-list/ServersPageTabs";
import { ServersTableSkeleton } from "@cronium/ui";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Servers",
    description: "Manage the servers available for workflow execution",
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

export default async function ServersPage() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title="Servers"
        createButton={{
          href: "/dashboard/servers/new",
          label: "Add Server",
          icon: <Plus className="h-4 w-4" />,
        }}
      />

      <ServersPageTabs
        serversTab={
          <Suspense fallback={<ServersTableSkeleton />}>
            <ServersList />
          </Suspense>
        }
      />
    </div>
  );
}
