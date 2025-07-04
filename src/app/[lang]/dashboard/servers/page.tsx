"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Server, Plus, Eye, Edit, CheckCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { StatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StandardizedTable,
  StandardizedTableLink,
  StandardizedTableColumn,
  StandardizedTableAction,
} from "@/components/ui/standardized-table";
import { ServerFilters } from "@/components/server-list/ServerFilters";
import { trpc } from "@/lib/trpc";

interface ServerData {
  id: number;
  name: string;
  address: string;
  username: string;
  port: number;
  createdAt: string;
  updatedAt: string;
  online: boolean | undefined;
  lastChecked: string | undefined;
}

interface ServerListFilters {
  searchTerm: string;
  statusFilter: string;
  sortBy: string;
  sortOrder: string;
}

export default function ServersPage() {
  const t = useTranslations("Servers");
  const params = useParams();
  const lang = params.lang as string;

  const [isCheckingStatus, setIsCheckingStatus] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Filter state
  const [filters, setFilters] = useState<ServerListFilters>({
    searchTerm: "",
    statusFilter: "all",
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  // tRPC queries and mutations
  const {
    data: serversData,
    isLoading,
    refetch: refetchServers,
  } = trpc.servers.getAll.useQuery({
    limit: 1000, // Get all servers for client-side filtering
    offset: 0,
    search: filters.searchTerm || undefined,
    online:
      filters.statusFilter === "online"
        ? true
        : filters.statusFilter === "offline"
          ? false
          : undefined,
  });

  const checkHealthMutation = trpc.servers.checkHealth.useMutation({
    onSuccess: (data) => {
      toast({
        title: data.online ? t("ServerOnline") : t("ServerOffline"),
        description: `Health check completed at ${new Date(data.lastChecked).toLocaleString()}`,
        variant: data.online ? "default" : "destructive",
      });
      refetchServers();
    },
    onSettled: () => {
      setIsCheckingStatus(null);
    },
  });

  const deleteServerMutation = trpc.servers.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Server Deleted",
        description: "The server has been successfully deleted.",
      });
      refetchServers();
    },
  });

  const servers = (serversData?.servers || []).map((server) => ({
    ...server,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
    lastChecked: server.lastChecked?.toISOString() || undefined,
    online: server.online === null ? undefined : server.online,
  }));

  const checkServerStatus = async (serverId: number): Promise<void> => {
    setIsCheckingStatus(serverId);
    checkHealthMutation.mutate({ id: serverId });
  };

  const deleteServer = async (serverId: number): Promise<void> => {
    deleteServerMutation.mutate({ id: serverId });
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  // Helper functions for filter updates
  const updateFilters = (newFilters: Partial<ServerListFilters>): void => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    // Reset to first page when filters change
    setCurrentPage(1);
  };

  const handleClearFilters = (): void => {
    setFilters({
      searchTerm: "",
      statusFilter: "all",
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    setCurrentPage(1);
  };

  // Apply filters to servers
  const filteredServers = servers.filter((server) => {
    const matchesSearch =
      server.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      server.address.toLowerCase().includes(filters.searchTerm.toLowerCase());

    const matchesStatus =
      filters.statusFilter === "all" ||
      (filters.statusFilter === "online" && server.online === true) ||
      (filters.statusFilter === "offline" && server.online === false) ||
      (filters.statusFilter === "unknown" && server.online === undefined);

    return matchesSearch && matchesStatus;
  });

  // Apply sorting to filtered servers
  const sortedServers = [...filteredServers].sort((a, b) => {
    let comparison = 0;

    switch (filters.sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "createdAt":
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "lastChecked":
        if (!a.lastChecked && !b.lastChecked) comparison = 0;
        else if (!a.lastChecked) comparison = -1;
        else if (!b.lastChecked) comparison = 1;
        else
          comparison =
            new Date(a.lastChecked).getTime() -
            new Date(b.lastChecked).getTime();
        break;
      default:
        comparison = 0;
    }

    return filters.sortOrder === "asc" ? comparison : -comparison;
  });

  // Calculate pagination values
  const totalItems = sortedServers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedServers = sortedServers.slice(startIndex, endIndex);

  // Handle page size change
  const handlePageSizeChange = (newSize: number): void => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  // Handle page change
  const handlePageChange = (page: number): void => {
    setCurrentPage(page);
  };

  const columns: StandardizedTableColumn<ServerData>[] = [
    {
      key: "name",
      header: t("Name"),
      cell: (server) => (
        <StandardizedTableLink href={`/${lang}/dashboard/servers/${server.id}`}>
          {server.name}
        </StandardizedTableLink>
      ),
    },
    {
      key: "address",
      header: t("Address"),
      cell: (server) => server.address,
    },
    {
      key: "ssh",
      header: t("SSH"),
      cell: (server) => `${server.username}@${server.address}:${server.port}`,
    },
    {
      key: "status",
      header: t("Status.Title"),
      cell: (server) => {
        if (server.online === undefined) {
          return (
            <StatusBadge
              status="pending"
              label={t("Status.Unknown")}
              size="sm"
            />
          );
        } else if (server.online) {
          return (
            <StatusBadge status="online" label={t("Status.Online")} size="sm" />
          );
        } else {
          return (
            <StatusBadge
              status="offline"
              label={t("Status.Offline")}
              size="sm"
            />
          );
        }
      },
    },
    {
      key: "added",
      header: t("Added"),
      cell: (server) => formatDate(server.createdAt),
    },
    {
      key: "lastChecked",
      header: t("LastChecked"),
      cell: (server) =>
        server.lastChecked ? formatDate(server.lastChecked) : "-",
    },
  ];

  const getServerActions = (server: ServerData): StandardizedTableAction[] => [
    {
      label: isCheckingStatus === server.id ? t("Checking") : t("CheckStatus"),
      icon: <CheckCircle className="h-4 w-4" />,
      onClick: () => checkServerStatus(server.id),
      disabled: isCheckingStatus === server.id || checkHealthMutation.isPending,
    },
    {
      label: t("ViewDetails"),
      icon: <Eye className="h-4 w-4" />,
      onClick: () =>
        (window.location.href = `/${lang}/dashboard/servers/${server.id}`),
    },
    {
      label: t("EditServer"),
      icon: <Edit className="h-4 w-4" />,
      onClick: () =>
        (window.location.href = `/${lang}/dashboard/servers/${server.id}#edit`),
      separator: true,
    },
    {
      label: deleteServerMutation.isPending ? "Deleting..." : "Delete Server",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => deleteServer(server.id),
      disabled: deleteServerMutation.isPending,
      variant: "destructive",
      separator: true,
    },
  ];

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("Title")}</h1>
        </div>

        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

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

      {servers.length === 0 && !isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-8">
              <Server className="mb-4 h-16 w-16 text-gray-300" />
              <h2 className="mb-2 text-xl font-semibold">
                {t("NoServersFound")}
              </h2>
              <p className="mb-4 text-center text-gray-500">
                {t("NoServersMessage")}
              </p>
              <Button asChild>
                <Link href={`/${lang}/dashboard/servers/new`}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("AddYourFirstServer")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border-border bg-secondary-bg rounded-lg border p-4">
          <ServerFilters
            filters={filters}
            onFiltersChange={updateFilters}
            onClearFilters={handleClearFilters}
          />

          <StandardizedTable
            data={paginatedServers}
            columns={columns}
            actions={getServerActions}
            isLoading={isLoading}
            emptyMessage={
              sortedServers.length === 0
                ? "No servers match your filters."
                : t("NoServersFound")
            }
          />

          {/* Pagination Controls */}
          {totalItems > 0 && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Items per page selector */}
                <div className="flex items-center space-x-2">
                  <span className="text-muted-foreground text-sm">
                    Items per page:
                  </span>
                  <Select
                    value={itemsPerPage.toString()}
                    onValueChange={(value) =>
                      handlePageSizeChange(parseInt(value))
                    }
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Pagination component */}
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  itemsPerPage={itemsPerPage}
                  totalItems={totalItems}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
