"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import EventForm from "@/components/event-form/EventForm-lazy";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export default function EditEventPage() {
  const router = useRouter();
  const { id, lang } = useParams();
  const eventId = typeof id === "string" ? parseInt(id) : 0;
  const t = useTranslations("Events");
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
        router.push(`/${String(lang)}/dashboard/events/${eventId}`);
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

  // Check if the user is the owner of the event
  if (event.userId !== user?.id) {
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
        <div className="bg-muted/50 mt-8 rounded-lg p-8 text-center">
          <Lock className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="mb-2 text-lg font-semibold">
            {t("CannotEditSharedEvent")}
          </h3>
          <p className="text-muted-foreground mb-4">
            {t("SharedEventEditDescription")}
          </p>
          <Button
            onClick={() =>
              router.push(`/${String(lang)}/dashboard/events/${eventId}`)
            }
            variant="outline"
          >
            {t("backToEvent")}
          </Button>
        </div>
      </div>
    );
  }

  // Transform the event data to match EventWithConditionalActions format
  const transformedEvent = {
    ...event,
    successEvents: event.successEvents.map((action) => ({
      id: action.id,
      type: action.type,
      ...(action.value !== null && { value: action.value }),
      ...(action.emailSubject !== null && {
        emailSubject: action.emailSubject,
      }),
      ...(action.targetEventId !== null && {
        targetEventId: action.targetEventId,
      }),
      ...(action.toolId !== null && { toolId: action.toolId }),
      ...(action.message !== null && { message: action.message }),
    })),
    failEvents: event.failEvents.map((action) => ({
      id: action.id,
      type: action.type,
      ...(action.value !== null && { value: action.value }),
      ...(action.emailSubject !== null && {
        emailSubject: action.emailSubject,
      }),
      ...(action.targetEventId !== null && {
        targetEventId: action.targetEventId,
      }),
      ...(action.toolId !== null && { toolId: action.toolId }),
      ...(action.message !== null && { message: action.message }),
    })),
    alwaysEvents: event.alwaysEvents.map((action) => ({
      id: action.id,
      type: action.type,
      ...(action.value !== null && { value: action.value }),
      ...(action.emailSubject !== null && {
        emailSubject: action.emailSubject,
      }),
      ...(action.targetEventId !== null && {
        targetEventId: action.targetEventId,
      }),
      ...(action.toolId !== null && { toolId: action.toolId }),
      ...(action.message !== null && { message: action.message }),
    })),
    conditionEvents: event.conditionEvents.map((action) => ({
      id: action.id,
      type: action.type,
      ...(action.value !== null && { value: action.value }),
      ...(action.emailSubject !== null && {
        emailSubject: action.emailSubject,
      }),
      ...(action.targetEventId !== null && {
        targetEventId: action.targetEventId,
      }),
      ...(action.toolId !== null && { toolId: action.toolId }),
      ...(action.message !== null && { message: action.message }),
    })),
  };

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
          initialData={transformedEvent}
          isEditing={true}
          onSuccess={handleSuccess}
          layout="page"
        />
      </div>
    </div>
  );
}
