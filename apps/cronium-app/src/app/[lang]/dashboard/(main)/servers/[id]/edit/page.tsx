"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@cronium/ui";
import { Card, CardContent } from "@cronium/ui";
import ServerForm from "@/components/dashboard/ServerForm";
import { Spinner } from "@cronium/ui";
import { trpc } from "@/lib/trpc";
import { useToast } from "@cronium/ui";

interface EditServerPageProps {
  params: Promise<{ id: string; lang: string }>;
}

export default function EditServerPage({ params }: EditServerPageProps) {
  const resolvedParams = use(params);
  const serverId = parseInt(resolvedParams.id);
  const lang = resolvedParams.lang;
  const router = useRouter();
  const { toast } = useToast();

  // Use tRPC query to fetch server data
  const {
    data: server,
    isLoading,
    error: serverError,
  } = trpc.servers.getById.useQuery(
    { id: serverId },
    {
      enabled: !isNaN(serverId),
    },
  );

  // Handle invalid server ID
  useEffect(() => {
    if (isNaN(serverId)) {
      toast({
        title: "Error",
        description: "Invalid server ID",
        variant: "destructive",
      });
      router.push(`/${lang}/dashboard/servers`);
    }
  }, [serverId, router, lang, toast]);

  // Handle server error
  useEffect(() => {
    if (serverError) {
      if (serverError.data?.code === "NOT_FOUND") {
        toast({
          title: "Error",
          description: "Server not found",
          variant: "destructive",
        });
        router.push(`/${lang}/dashboard/servers`);
      } else if (serverError.data?.code === "FORBIDDEN") {
        toast({
          title: "Error",
          description: "Access denied",
          variant: "destructive",
        });
        router.push(`/${lang}/dashboard/servers`);
      } else {
        toast({
          title: "Error",
          description: "Failed to load server data. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [serverError, router, lang, toast]);

  const handleSuccess = (updatedServerId?: number) => {
    router.push(
      `/${lang}/dashboard/servers/${String(updatedServerId ?? serverId)}`,
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link
              href={
                !isNaN(serverId)
                  ? `/${lang}/dashboard/servers/${serverId}`
                  : `/${lang}/dashboard/servers`
              }
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Server
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

  if (serverError ?? !server) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link href={`/${lang}/dashboard/servers`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Servers
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Error</h1>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-8">
              <AlertCircle className="mb-4 h-16 w-16 text-red-500" />
              <h2 className="mb-2 text-xl font-semibold">Server Not Found</h2>
              <p className="mb-4 text-center text-gray-500">
                {serverError?.message ??
                  "The server you're trying to edit doesn't exist or has been deleted."}
              </p>
              <Button asChild>
                <Link href={`/${lang}/dashboard/servers`}>
                  View All Servers
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" asChild>
          <Link
            href={
              !isNaN(serverId)
                ? `/${lang}/dashboard/servers/${serverId}`
                : `/${lang}/dashboard/servers`
            }
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Server
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Edit {server.name}</h1>
      </div>

      <div className="bg-card border-input mx-auto max-w-4xl rounded-lg border p-6">
        <ServerForm
          initialServer={server}
          isEditing={true}
          onSuccess={handleSuccess}
        />
      </div>
    </div>
  );
}
