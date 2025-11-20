"use client";

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
    <div className="container mx-auto p-4">
      <h1 className="mb-6 text-2xl font-bold">Create New Event</h1>
      <EventForm isEditing={false} onSuccess={handleSuccess} layout="page" />
    </div>
  );
}
