"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit,
  RefreshCw,
  AlertCircle,
  Code,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import ServerEventsList from "@/components/dashboard/ServerEventsList";
import ServerForm from "@/components/dashboard/ServerForm";
import { ServerDetailsHeader } from "@/components/server-details/ServerDetailsHeader";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface ServerDetailsPageProps {
  params: Promise<{ id: string; lang: string }>;
}

interface SystemInfo {
  platform?: string;
  release?: string;
  cpuCores?: number;
  totalMemory?: string;
  freeMemory?: string;
  uptime?: {
    days: number;
    hours: number;
    minutes: number;
  };
}

export default function ServerDetailsPage({ params }: ServerDetailsPageProps) {
  const resolvedParams = use(params);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [hasCheckedHealth, setHasCheckedHealth] = useState(false);
  const [isManualCheck, setIsManualCheck] = useState(false);

  const router = useRouter();
  const serverId = parseInt(resolvedParams.id);

  // Tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "overview",
    validTabs: ["overview", "edit"],
  });

  // tRPC queries and mutations
  const utils = trpc.useUtils();
  const {
    data: server,
    isLoading,
    refetch: refetchServer,
  } = trpc.servers.getById.useQuery({ id: serverId }, QUERY_OPTIONS.static);

  const checkHealthMutation = trpc.servers.checkHealth.useMutation({
    onSuccess: (data) => {
      // Only show toast for manual health checks
      if (isManualCheck) {
        toast({
          title: data.online ? "Server Online" : "Server Offline",
          description: `Health check completed at ${new Date(data.lastChecked).toLocaleString()}`,
          variant: data.online ? "default" : "destructive",
        });
      }
      // Store system info from health check
      if (data.systemInfo) {
        setSystemInfo(data.systemInfo);
      }
      // Only invalidate query for manual checks to avoid infinite loops
      if (isManualCheck) {
        void utils.servers.getById.invalidate({ id: serverId });
      }
      // Reset manual check flag
      setIsManualCheck(false);
    },
  });

  const deleteServerMutation = trpc.servers.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Server Deleted",
        description: "The server has been successfully deleted.",
      });
      router.push("/dashboard/servers");
    },
    onSettled: () => {
      setIsDeleteDialogOpen(false);
    },
  });

  // Auto-check server status when component mounts
  useEffect(() => {
    if (server && !hasCheckedHealth) {
      // Always perform health check on page load to get fresh system info
      checkHealthMutation.mutate({ id: serverId });
      setHasCheckedHealth(true);
    }
  }, [server, hasCheckedHealth, serverId]);

  const checkServerStatus = async () => {
    setIsManualCheck(true);
    checkHealthMutation.mutate({ id: serverId });
  };

  const handleDeleteServer = async () => {
    deleteServerMutation.mutate({ id: serverId });
  };

  const handleServerUpdate = () => {
    void refetchServer();
    // Switch back to overview tab after successful update
    changeTab("overview");
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link href="/dashboard/servers">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Servers
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Loading Server...</h1>
        </div>

        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link href="/dashboard/servers">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Servers
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Server Not Found</h1>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-8">
              <AlertCircle className="mb-4 h-16 w-16 text-red-500" />
              <h2 className="mb-2 text-xl font-semibold">Server Not Found</h2>
              <p className="mb-4 text-center text-gray-500">
                The server you're looking for doesn't exist or has been deleted.
              </p>
              <Button asChild>
                <Link href="/dashboard/servers">View All Servers</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderOverviewTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connection Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-500">
                Server Address
              </p>
              <p className="font-medium">{server.address}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Username</p>
              <p className="font-medium">{server.username}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">SSH Port</p>
              <p className="font-medium">{server.port}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Last Checked</p>
              <p className="font-medium">
                {server.lastChecked
                  ? formatDate(server.lastChecked.toISOString())
                  : "Never"}
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={checkServerStatus}
              disabled={checkHealthMutation.isPending}
              className="w-full"
            >
              {checkHealthMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Check Status
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        {/* System Information Card */}
        {systemInfo && (
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {systemInfo?.platform && (
                <div>
                  <p className="text-sm font-medium text-gray-500">Platform</p>
                  <p className="font-medium">{systemInfo.platform}</p>
                </div>
              )}
              {systemInfo?.release && (
                <div>
                  <p className="text-sm font-medium text-gray-500">Release</p>
                  <p className="font-medium">{systemInfo.release}</p>
                </div>
              )}
              {systemInfo?.cpuCores && (
                <div>
                  <p className="text-sm font-medium text-gray-500">CPU Cores</p>
                  <p className="font-medium">{systemInfo.cpuCores}</p>
                </div>
              )}
              {systemInfo?.totalMemory && (
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Total Memory
                  </p>
                  <p className="font-medium">{systemInfo.totalMemory}</p>
                </div>
              )}
              {systemInfo?.freeMemory && (
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Free Memory
                  </p>
                  <p className="font-medium">{systemInfo.freeMemory}</p>
                </div>
              )}
              {systemInfo?.uptime && (
                <div>
                  <p className="text-sm font-medium text-gray-500">Uptime</p>
                  <p className="font-medium">
                    {systemInfo.uptime.days}d {systemInfo.uptime.hours}h{" "}
                    {systemInfo.uptime.minutes}m
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events Running on this Server</CardTitle>
          <CardDescription>
            Events configured to run on this server
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServerEventsList serverId={serverId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="flex w-full items-center justify-start"
            onClick={() => changeTab("edit")}
          >
            <Edit className="mr-2 h-4 w-4" />
            Edit Server
          </Button>

          <Button
            variant="outline"
            className="flex w-full items-center justify-start"
            asChild
          >
            <Link href={`/dashboard/events/new?serverId=${serverId}`}>
              <Code className="mr-2 h-4 w-4" />
              Create Event
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="container mx-auto space-y-6 py-6">
      <ServerDetailsHeader
        server={{
          id: serverId,
          name: server.name,
          online: server.online ?? false,
        }}
        langParam={resolvedParams.lang}
        onDelete={() => setIsDeleteDialogOpen(true)}
      />

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <TabsList>
          <Tab value="overview" label="Overview" className="py-2" icon={Eye} />
          <Tab value="edit" label="Edit" className="py-2" icon={Edit} />
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {renderOverviewTab()}
        </TabsContent>

        <TabsContent value="edit" className="space-y-4">
          <ServerForm
            initialServer={server}
            isEditing={true}
            onSuccess={handleServerUpdate}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              server and remove it from any events that are configured to run on
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteServerMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteServer}
              disabled={deleteServerMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteServerMutation.isPending ? (
                <>
                  <Spinner size="lg" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
