"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Key, Clock, Code } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ApiRequestPreviewProps {
  method: string;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: string | Record<string, unknown>;
  authType?: "none" | "api_key" | "bearer" | "basic";
  timeout?: number;
}

export function ApiRequestPreview({
  method = "GET",
  url,
  headers = {},
  queryParams = {},
  body,
  authType = "none",
  timeout = 30000,
}: ApiRequestPreviewProps) {
  const getMethodColor = () => {
    switch (method.toUpperCase()) {
      case "GET":
        return "bg-blue-500";
      case "POST":
        return "bg-green-500";
      case "PUT":
        return "bg-yellow-500";
      case "DELETE":
        return "bg-red-500";
      case "PATCH":
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  const buildFullUrl = () => {
    if (Object.keys(queryParams).length === 0) {
      return url;
    }

    const params = new URLSearchParams(queryParams).toString();
    return `${url}${url.includes("?") ? "&" : "?"}${params}`;
  };

  const formatHeaders = () => {
    const allHeaders = { ...headers };

    // Add auth headers for preview
    if (authType === "bearer") {
      allHeaders.Authorization = "Bearer ***********";
    } else if (authType === "api_key") {
      allHeaders["X-API-Key"] = "***********";
    } else if (authType === "basic") {
      allHeaders.Authorization = "Basic ***********";
    }

    return allHeaders;
  };

  const formatBody = () => {
    if (!body) return null;

    try {
      return JSON.stringify(body, null, 2);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(body);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            API Request Preview
          </CardTitle>
          <div className="flex items-center gap-2">
            {authType !== "none" && (
              <Badge variant="outline" className="gap-1">
                <Key className="h-3 w-3" />
                {authType}
              </Badge>
            )}
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {timeout / 1000}s
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Method and URL */}
          <div className="flex items-center gap-2">
            <Badge
              className={`${getMethodColor()} text-white`}
              variant="default"
            >
              {method.toUpperCase()}
            </Badge>
            <code className="bg-muted flex-1 rounded px-2 py-1 text-sm">
              {buildFullUrl()}
            </code>
          </div>

          {/* Headers */}
          {Object.keys(formatHeaders()).length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Code className="h-4 w-4" />
                Headers
              </div>
              <div className="bg-muted/50 rounded border p-3">
                <pre className="text-xs">
                  {Object.entries(formatHeaders()).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-blue-600 dark:text-blue-400">
                        {key}
                      </span>
                      : {value}
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          )}

          {/* Request Body */}
          {body && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Code className="h-4 w-4" />
                Request Body
              </div>
              <div className="bg-muted/50 rounded border p-3">
                <pre className="max-h-64 overflow-auto text-xs">
                  {formatBody()}
                </pre>
              </div>
            </div>
          )}

          {/* Example Response */}
          <div>
            <div className="text-muted-foreground mb-2 text-sm font-medium">
              Example Response
            </div>
            <div className="bg-muted/30 rounded border border-dashed p-3">
              <pre className="text-muted-foreground text-xs">
                {`{
  "status": "success",
  "data": {
    // Response data will appear here
  },
  "timestamp": "${new Date().toISOString()}"
}`}
              </pre>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
