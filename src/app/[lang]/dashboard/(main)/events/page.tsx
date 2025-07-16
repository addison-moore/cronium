import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { EventsListClient } from "@/components/event-list/EventsListClient";
import { EventsPageActions } from "@/components/event-list/EventsPageActions";
import { EventsTableSkeleton } from "@/components/ui/table-skeleton";
import { authOptions } from "@/lib/auth";
import { api } from "@/trpc/server";
import type { EventType } from "@/shared/schema";
import type { Event, WorkflowData } from "@/components/event-list";
import type { Metadata } from "next";

interface EventsPageParams {
  params: {
    lang: string;
  };
}

export async function generateMetadata({
  params: _params,
}: EventsPageParams): Promise<Metadata> {
  const t = await getTranslations("Events");

  return {
    title: t("Title"),
    description: t("Description"),
  };
}

// Async component that fetches and renders the events list
async function EventsList({ lang: _lang }: { lang: string }) {
  // Fetch data on the server side
  const [eventsData, serversData, workflowsData] = await Promise.all([
    api.events.getAll({ limit: 1000, offset: 0 }),
    api.servers.getAll({ limit: 100, offset: 0 }),
    api.workflows.getAll({ limit: 100, offset: 0 }),
  ]);

  // Transform events to match the Event interface
  const events: Event[] = eventsData.events.map((rawEvent) => {
    // Parse tags if they exist
    let tags: string[] | undefined;
    if (rawEvent.tags) {
      try {
        tags = Array.isArray(rawEvent.tags)
          ? rawEvent.tags
          : JSON.parse(rawEvent.tags as string);
      } catch {
        tags = [];
      }
    }

    // Parse httpHeaders if they exist
    let httpHeaders: Array<{ key: string; value: string }> | undefined;
    if (rawEvent.httpHeaders) {
      try {
        httpHeaders = Array.isArray(rawEvent.httpHeaders)
          ? rawEvent.httpHeaders
          : JSON.parse(rawEvent.httpHeaders as string);
      } catch {
        httpHeaders = undefined;
      }
    }

    // Create a properly typed Event object
    const event: Event = {
      id: rawEvent.id,
      name: rawEvent.name,
      description: rawEvent.description,
      type: rawEvent.type as EventType,
      status: rawEvent.status,
      content: rawEvent.content,
      scheduleNumber: rawEvent.scheduleNumber,
      scheduleUnit: rawEvent.scheduleUnit,
      customSchedule: rawEvent.customSchedule,
      userId: rawEvent.userId,
      createdAt: rawEvent.createdAt.toISOString(),
      updatedAt: rawEvent.updatedAt.toISOString(),
      lastRunAt: rawEvent.lastRunAt ? rawEvent.lastRunAt.toISOString() : null,
      nextRunAt: rawEvent.nextRunAt ? rawEvent.nextRunAt.toISOString() : null,
      successCount: rawEvent.successCount,
      failureCount: rawEvent.failureCount,
      // Server related fields
      runLocation: rawEvent.runLocation ?? undefined,
      serverId: rawEvent.serverId ?? null,
      eventServers: (rawEvent as any).eventServers ?? undefined,
      // Additional fields
      timeoutValue: rawEvent.timeoutValue,
      timeoutUnit: rawEvent.timeoutUnit,
      retries: rawEvent.retries,
      shared: rawEvent.shared,
    };

    // Add optional properties only if they have values
    if (tags !== undefined) {
      event.tags = tags;
    }
    if (httpHeaders !== undefined) {
      event.httpHeaders = httpHeaders;
    }
    if (rawEvent.httpMethod) {
      event.httpMethod = rawEvent.httpMethod;
    }
    if (rawEvent.httpUrl) {
      event.httpUrl = rawEvent.httpUrl;
    }
    if (rawEvent.httpBody) {
      event.httpBody = rawEvent.httpBody;
    }

    return event;
  });

  // Transform server data
  const servers = serversData.servers.map((server) => ({
    id: server.id,
    name: server.name,
  }));

  // Transform workflow data
  const workflows: WorkflowData[] = workflowsData.workflows.map((workflow) => {
    const workflowData: WorkflowData = {
      id: workflow.id,
      name: workflow.name,
    };
    if (workflow.description !== null) {
      workflowData.description = workflow.description;
    }
    return workflowData;
  });

  return (
    <EventsListClient
      initialEvents={events}
      servers={servers}
      workflows={workflows}
    />
  );
}

export default async function EventsPage({ params }: EventsPageParams) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { lang } = await Promise.resolve(params);

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Get translations
  const t = await getTranslations("Events");

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title={t("Title")}
        description={t("Description")}
        createButton={{
          href: `/${lang}/dashboard/events/new`,
          label: t("NewEvent"),
          icon: <Plus className="h-4 w-4" />,
        }}
        actions={<EventsPageActions />}
      />

      {/* Stream the events list */}
      <Suspense fallback={<EventsTableSkeleton />}>
        <EventsList lang={lang} />
      </Suspense>
    </div>
  );
}
