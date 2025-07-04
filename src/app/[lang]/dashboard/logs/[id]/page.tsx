"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  XCircle,
  Code,
  Terminal,
  Calendar,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/use-toast";
import type { LogStatus } from "@/shared/schema";
import { Spinner } from "@/components/ui/spinner";

interface LogDetails {
  id: number;
  eventId: number;
  eventName: string;
  status: LogStatus;
  output: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  retries: number;
  error?: string;
  scriptContent: string;
  scriptType: string;
}

// Helper component for the Back to Logs button
function BackButton({ lang }: { lang: string }) {
  return (
    <Button variant="ghost" size="sm" className="mr-2" asChild>
      <Link href={`/${lang}/dashboard/logs`}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to Logs
      </Link>
    </Button>
  );
}

// Helper component for loading state
function LoadingState({ lang }: { lang: string }) {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <BackButton lang={lang} />
        <h1 className="text-2xl font-bold">Loading Log Details...</h1>
      </div>

      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    </div>
  );
}

// Helper component for not found state
function NotFoundState({ lang }: { lang: string }) {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <BackButton lang={lang} />
        <h1 className="text-2xl font-bold">Log Not Found</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center p-8">
            <XCircle className="mb-4 h-16 w-16 text-red-500" />
            <h2 className="mb-2 text-xl font-semibold">Log Not Found</h2>
            <p className="mb-4 text-center text-gray-500">
              The log entry you're looking for doesn't exist or has been
              deleted.
            </p>
            <Button asChild>
              <Link href={`/${lang}/dashboard/logs`}>View All Logs</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Format helpers
function formatDate(dateString: string | null) {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleString();
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "N/A";

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} minutes ${remainingSeconds.toFixed(0)} seconds`;
}

function getStatusBadge(status: LogStatus) {
  return <StatusBadge status={status} size="md" />;
}

export default function LogDetailsPage({
  params,
}: {
  params: { id: string; lang: string };
}) {
  // We'll keep a default language until params are properly resolved
  const [lang, setLang] = useState("en");
  const [id, setId] = useState("");
  const [logDetails, setLogDetails] = useState<LogDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Safely extract params for Next.js 15
  useEffect(() => {
    async function initializeParams() {
      try {
        const resolvedParams = await Promise.resolve(params);
        setLang(resolvedParams.lang);
        setId(resolvedParams.id);
      } catch (error) {
        console.error("Error resolving params:", error);
        // Default to english if params can't be resolved
        setLang("en");
      }
    }

    initializeParams();
  }, [params]);

  // Fetch log details once we have an ID
  useEffect(() => {
    if (id) {
      fetchLogDetails(id);
    }
  }, [id]);

  // Fetch log details based on the ID
  const fetchLogDetails = async (logId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/logs/${logId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch log details");
      }

      const data = await response.json();
      setLogDetails(data);
    } catch (error) {
      console.error("Error fetching log details:", error);
      toast({
        title: "Error",
        description: "Failed to load log details. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state while waiting for params and data
  if (isLoading) {
    return <LoadingState lang={lang} />;
  }

  // Show not found state if we have no log details
  if (!logDetails) {
    return <NotFoundState lang={lang} />;
  }

  // Render the log details
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <BackButton lang={lang} />
        <h1 className="text-2xl font-bold">Execution Log Details</h1>
        <div className="ml-4">{getStatusBadge(logDetails.status)}</div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Terminal className="mr-2 h-5 w-5" />
              Execution Output
            </CardTitle>
            <CardDescription>Output from the script execution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-50">
              {logDetails.output ? (
                <pre className="whitespace-pre-wrap">{logDetails.output}</pre>
              ) : (
                <p className="text-slate-400 italic">No output recorded</p>
              )}

              {logDetails.error && (
                <>
                  <div className="my-4 border-t border-red-700"></div>
                  <div className="font-semibold text-red-400">Error:</div>
                  <pre className="whitespace-pre-wrap text-red-400">
                    {logDetails.error}
                  </pre>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Information about this execution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="flex items-center text-sm font-medium text-gray-500">
                <Code className="mr-2 h-4 w-4" />
                Event
              </p>
              <p className="font-medium">
                <Link
                  href={`/${lang}/dashboard/events/${logDetails.eventId}`}
                  className="text-blue-600 hover:underline"
                >
                  {logDetails.eventName}
                </Link>
              </p>
            </div>

            <div>
              <p className="flex items-center text-sm font-medium text-gray-500">
                <Calendar className="mr-2 h-4 w-4" />
                Started At
              </p>
              <p className="font-medium">{formatDate(logDetails.startTime)}</p>
            </div>

            {logDetails.endTime && (
              <div>
                <p className="flex items-center text-sm font-medium text-gray-500">
                  <Calendar className="mr-2 h-4 w-4" />
                  Ended At
                </p>
                <p className="font-medium">{formatDate(logDetails.endTime)}</p>
              </div>
            )}

            <div>
              <p className="flex items-center text-sm font-medium text-gray-500">
                <Timer className="mr-2 h-4 w-4" />
                Duration
              </p>
              <p className="font-medium">
                {formatDuration(logDetails.duration)}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Retries</p>
              <p className="font-medium">{logDetails.retries || 0}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Script Type</p>
              <p className="font-medium">{logDetails.scriptType}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Code className="mr-2 h-5 w-5" />
            Script Content
          </CardTitle>
          <CardDescription>
            The code that was executed during this run
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-auto rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-50">
            <pre className="whitespace-pre-wrap">
              {logDetails.scriptContent}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
