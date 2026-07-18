"use client";

import React, { useState, useEffect } from "react";
import Terminal from "@/components/terminal/Terminal-lazy";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@cronium/ui";
import { Server, ServerOff, Plus } from "lucide-react";
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

const consoleCopy = {
  title: "Console",
  description:
    "Execute and manage server commands securely using the integrated terminal.",
  selectServer: "Select server",
  noServers: "No Servers Available",
  emptyPrimary:
    "No remote servers are configured. Add a server to start using the console.",
  emptySecondary: "Please select a server from the dropdown above.",
  addServer: "Add New Server",
};

export default function ConsoleClient() {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [autoConnected, setAutoConnected] = useState(false);

  // Use tRPC query to fetch servers
  const { data: serversData, isLoading } = trpc.servers.getAll.useQuery(
    {
      limit: 100,
      offset: 0,
      search: "",
      online: undefined,
      shared: undefined,
    },
    QUERY_OPTIONS.dynamic,
  );

  // Extract servers from the response
  const servers: ServerData[] = serversData?.servers ?? [];

  // Auto-select first available server
  useEffect(() => {
    if (!isLoading && !autoConnected && selectedServerId === null) {
      autoSelectServer();
    }
  }, [isLoading, autoConnected, servers]);

  const autoSelectServer = (): void => {
    console.log("Auto-selecting server:", {
      serversCount: servers.length,
    });

    if (servers.length > 0) {
      // Connect to first available server, preferring online servers
      const onlineServer = servers.find((s) => s.online);
      const firstServer = onlineServer ?? servers[0];
      if (firstServer) {
        console.log("Selecting remote server:", firstServer.name);
        setSelectedServerId(firstServer.id.toString());
      }
    }
    // If no servers available, selectedServerId remains null
    setAutoConnected(true);
  };

  const selectedServer: ServerData | null | undefined = servers.find(
    (s) => s.id.toString() === selectedServerId,
  );

  return (
    <div className="flex h-full flex-col space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{consoleCopy.title}</h1>
          <p className="text-muted-foreground">{consoleCopy.description}</p>
        </div>
      </div>

      {/* Server Selection */}
      <div className="bg-card border-border flex items-center gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Server className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">
            {consoleCopy.selectServer}:
          </span>
        </div>
        <Select
          value={selectedServerId ?? ""}
          onValueChange={setSelectedServerId}
          disabled={isLoading}
        >
          <SelectTrigger className="w-64">
            <SelectValue>
              {selectedServer ? (
                <div className="flex w-full min-w-0 items-center gap-2">
                  {selectedServer.online ? (
                    <Server className="text-success h-4 w-4 flex-shrink-0" />
                  ) : (
                    <ServerOff className="text-destructive h-4 w-4 flex-shrink-0" />
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
                  {isLoading ? "Loading servers..." : "Select a server..."}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {servers.length === 0 ? (
              <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                No servers configured
              </div>
            ) : (
              servers.map((server) => (
                <SelectItem key={server.id} value={server.id.toString()}>
                  <div className="flex w-full min-w-0 items-center gap-2">
                    {server.online ? (
                      <Server className="text-success h-4 w-4 flex-shrink-0" />
                    ) : (
                      <ServerOff className="text-destructive h-4 w-4 flex-shrink-0" />
                    )}
                    <span className="truncate font-medium">{server.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      ({server.address})
                    </span>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-grow">
        {isLoading ? (
          <div className="bg-card border-border flex h-[60vh] items-center justify-center rounded-lg border">
            <div className="space-y-2 text-center">
              <Spinner size="lg" className="mx-auto" />
              <p className="text-muted-foreground">Loading servers...</p>
            </div>
          </div>
        ) : selectedServerId ? (
          <Terminal
            serverId={parseInt(selectedServerId)}
            serverName={selectedServer?.name ?? "Unknown Server"}
          />
        ) : (
          <div className="bg-card border-border space-y-4 rounded-lg border p-8 text-center">
            <div className="text-muted-foreground">
              <Server className="mx-auto mb-4 h-12 w-12 opacity-50" />
              <h3 className="text-foreground mb-2 text-lg font-medium">
                {consoleCopy.noServers}
              </h3>
              <p>
                {servers.length === 0
                  ? consoleCopy.emptyPrimary
                  : consoleCopy.emptySecondary}
              </p>
            </div>
            {servers.length === 0 && (
              <Link
                href="/dashboard/servers/new"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                {consoleCopy.addServer}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
