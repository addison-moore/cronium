"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ServerForm from "@/components/dashboard/ServerForm";
import { Spinner } from "@/components/ui/spinner";

export default function EditServerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [server, setServer] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverId, setServerId] = useState<number | null>(null);

  const router = useRouter();

  useEffect(() => {
    const initializeParams = async () => {
      const resolvedParams = await params;
      const id = parseInt(resolvedParams.id);
      setServerId(id);
    };
    initializeParams();
  }, [params]);

  useEffect(() => {
    if (serverId !== null) {
      fetchServer();
    }
  }, [serverId]);

  const fetchServer = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/servers/${String(serverId)}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError("Server not found");
          return;
        }
        throw new Error("Failed to fetch server details");
      }

      const data = await response.json();
      setServer(data);
    } catch (error) {
      console.error("Error fetching server:", error);
      setError("Failed to load server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccess = (updatedServerId?: number) => {
    router.push(`/dashboard/servers/${String(updatedServerId ?? serverId)}`);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link
              href={
                serverId
                  ? `/dashboard/servers/${serverId}`
                  : "/dashboard/servers"
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

  if (error ?? !server) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <Button variant="ghost" size="sm" className="mr-2" asChild>
            <Link href="/dashboard/servers">
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
                {error ??
                  "The server you're trying to edit doesn't exist or has been deleted."}
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

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" asChild>
          <Link
            href={
              serverId ? `/dashboard/servers/${serverId}` : "/dashboard/servers"
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
