"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { Lock } from "lucide-react";
import EventForm from "@/components/event-form/EventForm-lazy";
import { PageHeader, DetailPageSkeleton } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const copy = {
  title: "Edit Event",
  description: "Update your event details",
  backToEvent: "Back to Event",
  cannotEditTitle: "You can't edit this shared event",
  cannotEditDescription:
    "Only the event owner can make changes to shared events.",
} as const;

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params?.id ? parseInt(params.id) : 0;
  const { user } = useAuth();

  // Validate eventId
  if (!eventId || isNaN(eventId)) {
    return (
      <div className="container py-6">
        <div className="bg-destructive/10 text-destructive rounded-md p-4">
          <h2 className="text-lg font-semibold">Error</h2>
          <p>Invalid event ID. Please check the URL and try again.</p>
        </div>
      </div>
    );
  }

  // Fetch the event data using tRPC
  const {
    data: event,
    isLoading,
    error,
  } = trpc.events.getById.useQuery({ id: eventId });

  // Handle form submission success
  const handleSuccess = useCallback(
    (eventId?: number) => {
      if (eventId) {
        router.push(`/dashboard/events/${eventId}`);
      }
    },
    [router],
  );

  if (isLoading) {
    return <DetailPageSkeleton withSidebar={false} />;
  }

  if (error || !event) {
    return (
      <div className="container py-6">
        <div className="bg-destructive/10 text-destructive rounded-md p-4">
          <h2 className="text-lg font-semibold">Error</h2>
          <p>Failed to load event details. Please try again later.</p>
        </div>
      </div>
    );
  }

  // Check if the user is the owner of the event
  if (event.userId !== user?.id) {
    return (
      <div className="container py-6">
        <PageHeader
          title={copy.title}
          description={copy.description}
          backLink={{
            href: `/dashboard/events/${eventId}`,
            label: copy.backToEvent,
          }}
        />
        <div className="bg-muted/50 mt-8 rounded-lg p-8 text-center">
          <Lock className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="mb-2 text-lg font-semibold">{copy.cannotEditTitle}</h3>
          <p className="text-muted-foreground mb-4">
            {copy.cannotEditDescription}
          </p>
          <Button
            onClick={() => router.push(`/dashboard/events/${eventId}`)}
            variant="outline"
          >
            {copy.backToEvent}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        backLink={{
          href: `/dashboard/events/${eventId}`,
          label: copy.backToEvent,
        }}
      />

      <div className="mt-6">
        <EventForm
          eventId={eventId}
          initialData={event}
          isEditing={true}
          onSuccess={handleSuccess}
          layout="page"
        />
      </div>
    </div>
  );
}
