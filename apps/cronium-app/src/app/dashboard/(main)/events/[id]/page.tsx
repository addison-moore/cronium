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

export default async function EventDetailPage({
  params,
}: EventDetailPageProps) {
  // Check authentication
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session) {
    redirect("/auth/signin");
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
      <EventDetails eventId={id} />
    </Suspense>
  );
}
