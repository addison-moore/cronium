import React from "react";
import type { Metadata } from "next";
import ApiTokensManager from "@/components/dashboard/ApiTokensManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@cronium/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { ScrollArea } from "@cronium/ui";
import { PageHeader, PageShell } from "@cronium/ui";

export const metadata: Metadata = {
  title: "API Tokens | Settings | Cronium",
  description: "Manage your API tokens for programmatic access to Cronium.",
};

const heading = "API Tokens";
const description =
  "Manage your API tokens for programmatic access to Cronium.";
const tabsCopy = {
  tokens: "Tokens",
  usage: "Usage & Documentation",
};
const docsCopy = {
  title: "API Documentation",
  description:
    "Learn how to use your API tokens to access the Cronium API securely.",
  authTitle: "Authentication",
  authDescription:
    "Include your API token in the Authorization header of your requests.",
  exampleTitle: "Example Usage",
  exampleDescription: "Use your token to authenticate direct API requests.",
};

export default function ApiTokensPage() {
  return (
    <ScrollArea className="h-full">
      <PageShell>
        <PageHeader title={heading} description={description} />

        <Tabs defaultValue="tokens" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tokens">{tabsCopy.tokens}</TabsTrigger>
            <TabsTrigger value="usage">{tabsCopy.usage}</TabsTrigger>
          </TabsList>

          <TabsContent value="tokens" className="space-y-4">
            <ApiTokensManager />
          </TabsContent>

          <TabsContent value="usage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{docsCopy.title}</CardTitle>
                <CardDescription>{docsCopy.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">{docsCopy.authTitle}</h3>
                  <p className="text-muted-foreground text-sm">
                    {docsCopy.authDescription}
                  </p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-4 text-sm">
                    <code>{`Authorization: Bearer YOUR_API_TOKEN`}</code>
                  </pre>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-medium">
                    {docsCopy.exampleTitle}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {docsCopy.exampleDescription}
                  </p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-4 text-sm">
                    <code>{`curl -X GET \\
  https://your-cronium-instance.example.com/api/events \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json"`}</code>
                  </pre>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Creating Scripts</h3>
                  <p className="text-muted-foreground text-sm">
                    Create a new script:
                  </p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-4 text-sm">
                    <code>{`curl -X POST \\
  https://your-cronium-instance.example.com/api/events \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Daily Backup",
    "type": "BASH",
    "content": "#!/bin/bash\\necho \\"Backup started\\"\\n...",
    "status": "ACTIVE",
    "scheduleNumber": 1,
    "scheduleUnit": "DAYS",
    "runLocation": "LOCAL",
    "timeoutValue": 60,
    "timeoutUnit": "MINUTES",
    "retries": 3
  }'`}</code>
                  </pre>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Documentation</h3>
                  <p className="text-muted-foreground text-sm">
                    For complete API documentation, visit the{" "}
                    <a
                      href="https://docs.cronium.dev/docs/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      API Reference
                    </a>
                    .
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageShell>
    </ScrollArea>
  );
}
