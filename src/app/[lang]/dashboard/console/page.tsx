"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import Terminal from "@/components/terminal/Terminal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Server, ServerOff, Plus } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface ServerData {
  id: number;
  name: string;
  address: string;
  username: string;
  port: number;
  online?: boolean | null;
}

export default function ConsolePage() {
  const t = useTranslations("Console");
  const params = useParams<{ lang: string }>();
  const lang = params.lang;
  const { permissions, loading: permissionsLoading } = usePermissions();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [autoConnected, setAutoConnected] = useState(false);

  // Use tRPC query to fetch servers
  const { data: serversData, isLoading } = trpc.servers.getAll.useQuery(
    {
      limit: 1000,
      offset: 0,
      search: "",
      online: undefined,
      shared: undefined,
    },
    QUERY_OPTIONS.dynamic,
  );

  const servers = serversData?.servers ?? [];

  // Auto-select server based on permissions
  useEffect(() => {
    if (
      !isLoading &&
      !permissionsLoading &&
      !autoConnected &&
      selectedServerId === null &&
      permissions
    ) {
      autoSelectServer();
    }
  }, [isLoading, permissionsLoading, autoConnected, servers, permissions]);

  const autoSelectServer = (): void => {
    console.log("Auto-selecting server:", {
      localAccess: permissions?.localServerAccess,
      serversCount: servers.length,
      permissions,
    });

    if (permissions?.localServerAccess) {
      // User has local server access, connect to local
      console.log("Selecting local server");
      setSelectedServerId("local");
    } else if (servers.length > 0) {
      // No local access, connect to first available server
      const firstServer = servers[0];
      if (firstServer) {
        console.log("Selecting first remote server:", firstServer.name);
        setSelectedServerId(firstServer.id.toString());
      }
    }
    // If no servers available, selectedServerId remains null
    setAutoConnected(true);
  };

  const selectedServer: ServerData | null | undefined =
    selectedServerId === "local"
      ? null
      : servers.find((s) => s.id.toString() === selectedServerId);

  return (
    <div className="flex h-full flex-col space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
      </div>

      {/* Server Selection */}
      <div className="bg-card border-border flex items-center gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Server className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">{t("selectServer")}:</span>
        </div>
        <Select
          value={selectedServerId ?? ""}
          onValueChange={setSelectedServerId}
          disabled={isLoading || permissionsLoading}
        >
          <SelectTrigger className="w-64">
            <SelectValue>
              {selectedServerId === "local" ? (
                <div className="flex w-full min-w-0 items-center gap-2">
                  <Server className="h-4 w-4 flex-shrink-0 text-green-500" />
                  <span className="truncate">Local Server</span>
                </div>
              ) : selectedServer ? (
                <div className="flex w-full min-w-0 items-center gap-2">
                  {selectedServer.online ? (
                    <Server className="h-4 w-4 flex-shrink-0 text-green-500" />
                  ) : (
                    <ServerOff className="h-4 w-4 flex-shrink-0 text-red-500" />
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="truncate font-medium">
                      {selectedServer.name}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      ({selectedServer.address})
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  Select a server...
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {permissions.localServerAccess && (
              <SelectItem value="local">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 flex-shrink-0 text-green-500" />
                  <span>Local Server</span>
                </div>
              </SelectItem>
            )}
            {servers.map((server) => (
              <SelectItem key={server.id} value={server.id.toString()}>
                <div className="flex w-full min-w-0 items-center gap-2">
                  {server.online ? (
                    <Server className="h-4 w-4 flex-shrink-0 text-green-500" />
                  ) : (
                    <ServerOff className="h-4 w-4 flex-shrink-0 text-red-500" />
                  )}
                  <span className="truncate font-medium">{server.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    ({server.address})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-grow">
        {isLoading || permissionsLoading ? (
          <div className="bg-card border-border flex h-[60vh] items-center justify-center rounded-lg border">
            <div className="space-y-2 text-center">
              <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
              <p className="text-muted-foreground">Loading terminal...</p>
            </div>
          </div>
        ) : selectedServerId ? (
          <Terminal
            serverId={
              selectedServerId === "local" ? null : parseInt(selectedServerId)
            }
            serverName={
              selectedServerId === "local"
                ? "Local Server"
                : (selectedServer?.name ?? "Unknown Server")
            }
          />
        ) : (
          <div className="bg-card border-border space-y-4 rounded-lg border p-8 text-center">
            <div className="text-muted-foreground">
              <Server className="mx-auto mb-4 h-12 w-12 opacity-50" />
              <h3 className="text-foreground mb-2 text-lg font-medium">
                No Servers Available
              </h3>
              <p>
                {!permissions.localServerAccess && servers.length === 0
                  ? "You don't have access to the local server and no remote servers are configured."
                  : servers.length === 0
                    ? "No remote servers are configured."
                    : "No accessible servers found."}
              </p>
            </div>
            <Link
              href={`/${lang}/dashboard/servers/new`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add New Server
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
