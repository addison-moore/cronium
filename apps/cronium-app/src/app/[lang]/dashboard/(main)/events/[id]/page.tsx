import React, { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EventDetails } from "@/components/event-details/EventDetails";
import { EventDetailsSkeleton } from "@/components/event-details/EventDetailsSkeleton";
import { api } from "@/trpc/server";
import type { Metadata } from "next";
import type { Event } from "@/shared/schema";

interface EventDetailPageProps {
  params: Promise<{
    id: string;
    lang: string;
  }>;
}

export async function generateMetadata({
  params,
}: EventDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const parsedId = parseInt(id);

  if (isNaN(parsedId)) {
    return {
      title: "Event Not Found",
    };
  }

  try {
    const event: Event = await api.events.getById({ id: parsedId });
    return {
      title: `${event.name} - Event Details`,
      description: event.description ?? `Details for event ${event.name}`,
    };
  } catch {
    return {
      title: "Event Not Found",
    };
  }
}

// Client wrapper that loads EventDetails
function EventDetailsWrapper({
  eventId,
  langParam,
}: {
  eventId: string;
  langParam: string;
}) {
  return <EventDetails eventId={eventId} langParam={langParam} />;
}

export default async function EventDetailPage({
  params,
}: EventDetailPageProps) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { id, lang } = await params;

  if (!session) {
    redirect(`/${lang}/auth/signin`);
  }

  // Validate ID
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    notFound();
  }

  // Verify event exists (optional - for better error handling)
  try {
    await api.events.getById({ id: parsedId });
  } catch {
    notFound();
  }

  return (
    <Suspense fallback={<EventDetailsSkeleton />}>
      <EventDetailsWrapper eventId={id} langParam={lang} />
    </Suspense>
  );
}
