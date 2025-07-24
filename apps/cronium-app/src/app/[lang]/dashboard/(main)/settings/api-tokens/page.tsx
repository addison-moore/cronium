import React from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Tokens | Settings | Cronium",
  description: "Manage your API tokens for programmatic access to Cronium.",
};

export default async function ApiTokensPage() {
  const t = await getTranslations("Settings.APITokens");

  return (
    <ScrollArea className="h-full">
      <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
        <DashboardHeader heading={t("Title")} text={t("Description")} />

        <Tabs defaultValue="tokens" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tokens">{t("Tabs.Tokens")}</TabsTrigger>
            <TabsTrigger value="usage">{t("Tabs.Usage")}</TabsTrigger>
          </TabsList>

          <TabsContent value="tokens" className="space-y-4">
            <ApiTokensManager />
          </TabsContent>

          <TabsContent value="usage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("Documentation.Title")}</CardTitle>
                <CardDescription>
                  {t("Documentation.Description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">
                    {t("Documentation.Authentication.Title")}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {t("Documentation.Authentication.Description")}
                  </p>
                  <pre className="bg-muted overflow-x-auto rounded-md p-4 text-sm">
                    <code>{`Authorization: Bearer YOUR_API_TOKEN`}</code>
                  </pre>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-medium">
                    {t("Documentation.Example.Title")}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {t("Documentation.Example.Description")}
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
      </div>
    </ScrollArea>
  );
}
