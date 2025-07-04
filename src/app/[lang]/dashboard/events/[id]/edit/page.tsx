"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import EventForm from "@/components/event-form/EventForm";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";

export default function EditEventPage() {
  const router = useRouter();
  const { id, lang } = useParams();
  const eventId = typeof id === "string" ? parseInt(id) : 0;
  const t = useTranslations("Events");

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
        router.push(`/${lang}/dashboard/events/${eventId}`);
      }
    },
    [router, lang],
  );

  if (isLoading) {
    return (
      <div className="container py-6">
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
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

  return (
    <div className="container py-6">
      <PageHeader
        title={t("editEvent")}
        description={t("editEventDescription")}
        backLink={{
          href: `/dashboard/events/${eventId}`,
          label: t("backToEvent"),
        }}
      />

      <div className="mt-6">
        <EventForm
          eventId={eventId}
          initialData={event}
          isEditing={true}
          onSuccess={handleSuccess}
        />
      </div>
    </div>
  );
}
