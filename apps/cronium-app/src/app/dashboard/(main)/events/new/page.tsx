"use client";

import { PageShell } from "@cronium/ui";
import { useRouter } from "next/navigation";
import EventForm from "@/components/event-form/EventForm-lazy";

export default function NewEventPage() {
  const router = useRouter();

  const handleSuccess = (eventId?: number) => {
    if (eventId) {
      router.push(`/dashboard/events/${eventId}`);
    } else {
      router.push(`/dashboard/events`);
    }
  };

  return (
    <PageShell>
      <h1 className="mb-6 text-2xl font-semibold">Create New Event</h1>
      <EventForm isEditing={false} onSuccess={handleSuccess} layout="page" />
    </PageShell>
  );
}
