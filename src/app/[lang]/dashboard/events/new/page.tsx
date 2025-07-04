"use client";

import { useRouter, useParams } from "next/navigation";
import EventForm from "@/components/event-form/EventForm";

export default function NewEventPage() {
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;

  const handleSuccess = (eventId?: number) => {
    if (eventId) {
      router.push(`/${lang}/dashboard/events/${eventId}`);
    } else {
      router.push(`/${lang}/dashboard/events`);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <EventForm isEditing={false} onSuccess={handleSuccess} />
    </div>
  );
}
